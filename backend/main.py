from __future__ import annotations
import io
import json
import logging
import pickle
import sqlite3
import uuid
from datetime import datetime, date, timezone
from pathlib import Path
from typing import Any, Optional
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from PIL.ExifTags import TAGS
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles



# DeepFace
try:
    from deepface import DeepFace
    DEEPFACE_AVAILABLE = True
except ImportError:
    DEEPFACE_AVAILABLE = False
    logging.warning("DeepFace not installed. Face recognition will be unavailable.")

# CLIP
try:
    import torch
    import open_clip

    _clip_device = "cuda" if torch.cuda.is_available() else "cpu"
    _clip_model, _clip_preprocess, _ = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="openai"
    )
    _clip_model = _clip_model.to(_clip_device)
    _clip_model.eval()
    _clip_tokenizer = open_clip.get_tokenizer("ViT-B-32")
    CLIP_AVAILABLE = True
    logging.getLogger("synapse").info("CLIP loaded on %s.", _clip_device)
except Exception as _clip_err:
    CLIP_AVAILABLE = False
    logging.warning("CLIP not available (%s). Album grouping will be unavailable.", _clip_err)

# Config & Paths
BASE_DIR        = Path(__file__).parent
DATA_DIR        = BASE_DIR / "data"
PHOTOS_DIR      = DATA_DIR / "photos"
FACES_DIR       = DATA_DIR / "faces"
PROFILE_DIR     = DATA_DIR / "profiles"
EMBEDDINGS_FILE = DATA_DIR / "embeddings.pkl"
DB_PATH         = DATA_DIR / "synapse.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
FACES_DIR.mkdir(parents=True, exist_ok=True)
PROFILE_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
log = logging.getLogger("synapse")

# FastAPI
app = FastAPI(
    title="Synapse",
    version="0.1.0",
)

app.mount("/static/photos",   StaticFiles(directory=str(PHOTOS_DIR)),  name="photos")
app.mount("/static/faces",    StaticFiles(directory=str(FACES_DIR)),   name="faces")
app.mount("/static/profiles", StaticFiles(directory=str(PROFILE_DIR)), name="profiles")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS people (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            relationship    TEXT,
            avatar          TEXT,
            color           TEXT,
            initials        TEXT,
            profile_photo   TEXT,
            is_user         INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS photos (
            id              TEXT PRIMARY KEY,
            filename        TEXT NOT NULL,
            taken_at        TEXT,
            month_label     TEXT,
            year_label      TEXT,
            clip_embedding  TEXT,
            clip_labels     TEXT,
            created_at      TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS photo_people (
            photo_id    TEXT,
            person_id   TEXT,
            confidence  REAL,
            PRIMARY KEY (photo_id, person_id)
        );

        CREATE TABLE IF NOT EXISTS albums (
            id          TEXT PRIMARY KEY,
            label       TEXT NOT NULL,
            emoji       TEXT,
            color       TEXT,
            scene       TEXT,
            created_at  TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS album_photos (
            album_id    TEXT,
            photo_id    TEXT,
            PRIMARY KEY (album_id, photo_id)
        );

        CREATE TABLE IF NOT EXISTS pending_faces (
            id          TEXT PRIMARY KEY,
            photo_id    TEXT NOT NULL,
            face_crop   TEXT NOT NULL,
            embedding   TEXT,
            created_at  TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """)

        for migration in [
            "ALTER TABLE people ADD COLUMN is_user INTEGER DEFAULT 0",
            "ALTER TABLE photos ADD COLUMN year_label TEXT",
            "ALTER TABLE photos ADD COLUMN clip_embedding TEXT",
            "ALTER TABLE photos ADD COLUMN clip_labels TEXT",
        ]:
            try:
                conn.execute(migration)
            except Exception:
                pass

        rows = conn.execute(
            "SELECT id, taken_at, month_label FROM photos WHERE year_label IS NULL OR year_label = ''"
        ).fetchall()
        for row in rows:
            year = None
            if row["taken_at"]:
                try:
                    year = str(datetime.fromisoformat(row["taken_at"]).year)
                except Exception:
                    pass
            if not year and row["month_label"]:
                parts = row["month_label"].strip().rsplit(" ", 1)
                if len(parts) == 2 and parts[1].isdigit():
                    year = parts[1]
            if year:
                conn.execute(
                    "UPDATE photos SET year_label = ? WHERE id = ?",
                    (year, row["id"]),
                )
        if rows:
            log.info("Backfilled year_label for %d existing photos.", len(rows))

    log.info("Database initialised at %s", DB_PATH)

init_db()

class EmbeddingStore:
    def __init__(self, path):
        self.path = path
        self._data = {}
        self._load()

    def _load(self):
        if self.path.exists():
            with open(self.path, "rb") as f:
                self._data = pickle.load(f)
            log.info("Loaded embeddings for %d people.", len(self._data))

    def save(self):
        with open(self.path, "wb") as f:
            pickle.dump(self._data, f)

    def add(self, person_id, embedding):
        self._data.setdefault(person_id, []).append(embedding)
        self.save()

    def get_all(self):
        return self._data

    def remove_person(self, person_id):
        self._data.pop(person_id, None)
        self.save()

embedding_store = EmbeddingStore(EMBEDDINGS_FILE)

# DeepFace Face Recognition
RECOGNITION_MODEL        = "Facenet512"
RECOGNITION_THRESHOLD    = 0.40
MIN_DETECTION_CONFIDENCE = 0.65

def extract_taken_at(image):
    """Extract DateTimeOriginal from EXIF data and return as ISO string."""
    try:
        exif = image._getexif()
        if not exif:
            return None
        for tag, value in exif.items():
            if TAGS.get(tag) == "DateTimeOriginal":
                return datetime.strptime(value, "%Y:%m:%d %H:%M:%S").isoformat()
    except Exception:
        return None
    return None

def cosine_distance(a, b):
    norm_a, norm_b = np.linalg.norm(a), np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 1.0
    return float(1.0 - np.dot(a, b) / (norm_a * norm_b))

def _detection_confidence(result):
    """
    Extract the detector confidence score from a DeepFace result dict.
    """
    region = result.get("facial_area", {})
    score = region.get("confidence") or result.get("face_confidence")
    if score is not None:
        return float(score)
    return 1.0

def extract_embedding(image):
    """
    Extract a single face embedding from a PIL image using DeepFace.
    """
    if not DEEPFACE_AVAILABLE:
        return None
    try:
        result = DeepFace.represent(
            img_path=np.array(image.convert("RGB")),
            model_name=RECOGNITION_MODEL,
            enforce_detection=True,
            detector_backend="retinaface",
        )
        if result:
            conf = _detection_confidence(result[0])
            if conf < MIN_DETECTION_CONFIDENCE:
                log.debug("Single embedding rejected, low confidence: %.3f", conf)
                return None
            return np.array(result[0]["embedding"])
    except Exception as exc:
        log.debug("Embedding extraction failed (no face or error): %s", exc)
    return None

def extract_all_face_data(image):
    """
    Detect all faces in an image and return embeddings + regions via DeepFace.
    """
    if not DEEPFACE_AVAILABLE:
        return []

    img_array = np.array(image.convert("RGB"))

    try:
        results = DeepFace.represent(
            img_path=img_array,
            model_name=RECOGNITION_MODEL,
            enforce_detection=True,
            detector_backend="retinaface",
        )
    except Exception as exc:
        log.debug("No faces detected (or error): %s", exc)
        return []

    valid_faces = []
    for r in results:
        region = r.get("facial_area", {})
        conf = _detection_confidence(r)
        if conf < MIN_DETECTION_CONFIDENCE:
            log.debug(
                "Detection skipped, low confidence %.3f at region %s", conf, region
            )
            continue
        valid_faces.append({"embedding": np.array(r["embedding"]), "region": region})

    log.info(
        "extract_all_face_data: %d raw detections -> %d valid faces",
        len(results),
        len(valid_faces),
    )
    return valid_faces

def match_embedding_to_person(embedding):
    best_person_id = None
    best_distance  = float("inf")

    for person_id, stored_embeddings in embedding_store.get_all().items():
        for stored in stored_embeddings:
            dist = cosine_distance(embedding, stored)
            if dist < best_distance:
                best_distance  = dist
                best_person_id = person_id

    if best_distance < RECOGNITION_THRESHOLD:
        confidence = round(1.0 - best_distance, 4)
        return best_person_id, confidence

    return None, 0.0

def identify_faces_in_image(image):
    """
    Detect, match, and classify all faces in image using DeepFace.
    """
    face_data = extract_all_face_data(image)
    matched = []
    unknown = []

    img_w, img_h = image.size

    for fd in face_data:
        emb    = fd["embedding"]
        region = fd.get("region", {})

        person_id, conf = match_embedding_to_person(emb)

        if person_id:
            embedding_store.add(person_id, emb)
            matched.append({"person_id": person_id, "confidence": conf})
        else:
            x = region.get("x", 0)
            y = region.get("y", 0)
            w = region.get("w", img_w)
            h = region.get("h", img_h)
            x, y = max(0, x), max(0, y)
            w = min(w, img_w - x)
            h = min(h, img_h - y)
            face_crop = image.crop((x, y, x + w, y + h))
            unknown.append({"face_crop": face_crop, "embedding": emb})

    return matched, unknown

def save_face_crop(face_crop, face_id):
    filename = f"{face_id}.jpg"
    path = FACES_DIR / filename
    face_crop = face_crop.resize((200, 200), Image.LANCZOS)
    face_crop.save(path, "JPEG", quality=85)
    return filename

# CLIP Image Embedding
def encode_image_clip(image):
    """Encode a PIL image with CLIP and return a normalised float32 vector."""
    if not CLIP_AVAILABLE:
        return None
    try:
        with torch.no_grad():
            img_tensor = _clip_preprocess(image).unsqueeze(0).to(_clip_device)
            feat = _clip_model.encode_image(img_tensor)
            feat = feat / feat.norm(dim=-1, keepdim=True)
            return feat.cpu().numpy()[0].astype(np.float32)
    except Exception as exc:
        log.debug("CLIP image encoding failed: %s", exc)
        return None

def encode_text_clip(prompts):
    """Return a mean-pooled, normalised CLIP text embedding for a list of prompts."""
    if not CLIP_AVAILABLE:
        return None
    try:
        with torch.no_grad():
            tokens = _clip_tokenizer(prompts).to(_clip_device)
            feats  = _clip_model.encode_text(tokens)
            feats  = feats / feats.norm(dim=-1, keepdim=True)
            mean   = feats.mean(dim=0)
            mean   = mean / mean.norm()
            return mean.cpu().numpy().astype(np.float32)
    except Exception as exc:
        log.debug("CLIP text encoding failed: %s", exc)
        return None

# CLIP Multi-Label Auto-Albuming
ALBUM_LABEL_PROMPTS = [
    ("Food", "🍽️", "#d35400", [
        "a photo of food",
        "a meal or dish",
    ]),
    ("Travel", "✈️", "#1abc9c", [
        "a travel destination",
        "a tourist location or landmark",
    ]),
    ("Celebration", "🎉", "#8e44ad", [
        "a celebration or party",
        "people celebrating an event",
    ]),
    ("Nature", "🌿", "#27ae60", [
        "a nature scene",
        "outdoor landscape with plants or trees",
    ]),
    ("Beach", "🏖️", "#2980b9", [
        "a beach or seaside",
        "ocean or coastal scene",
    ]),
    ("Fitness", "💪", "#e74c3c", [
        "exercise or fitness activity",
        "people working out or doing sports",
    ]),
    ("Family", "👨‍👩‍👧", "#3498db", [
        "a family photo",
        "parents and children together",
    ]),
]

ALBUM_CLIP_THRESHOLD = 0.24
_album_prompt_cache = None

def _get_album_prompt_embeddings():
    global _album_prompt_cache
    if _album_prompt_cache is None:
        _album_prompt_cache = {}
        for label, _, _, prompts in ALBUM_LABEL_PROMPTS:
            per_prompt = [encode_text_clip([p]) for p in prompts]
            _album_prompt_cache[label] = per_prompt
            log.info("Encoded %d prompts for album '%s'.", len(prompts), label)
    return _album_prompt_cache

def classify_image_into_albums(image_embedding):
    prompt_embs = _get_album_prompt_embeddings()
    assigned = []

    for label, _, _, _ in ALBUM_LABEL_PROMPTS:
        per_prompt_embs = prompt_embs.get(label, [])
        max_sim = 0.0
        for emb in per_prompt_embs:
            if emb is None:
                continue
            sim = float(np.dot(image_embedding, emb))
            if sim > max_sim:
                max_sim = sim
        if max_sim >= ALBUM_CLIP_THRESHOLD:
            assigned.append(label)
    return assigned

def cluster_photos_into_albums():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.id, p.filename, p.month_label, p.taken_at,
                   p.clip_embedding,
                   GROUP_CONCAT(pp.person_id) as people
            FROM photos p
            LEFT JOIN photo_people pp ON pp.photo_id = p.id
            GROUP BY p.id
        """).fetchall()

    if not rows:
        return []

    records   = [dict(r) for r in rows]
    photo_ids = [r["id"] for r in records]

    clip_vectors = []
    for rec in records:
        vec = None
        if rec.get("clip_embedding"):
            try:
                vec = np.array(json.loads(rec["clip_embedding"]), dtype=np.float32)
            except Exception:
                vec = None
        if vec is None and CLIP_AVAILABLE:
            photo_path = PHOTOS_DIR / rec["filename"]
            if photo_path.exists():
                try:
                    img = Image.open(photo_path).convert("RGB")
                    vec = encode_image_clip(img)
                    if vec is not None:
                        with get_db() as conn:
                            conn.execute(
                                "UPDATE photos SET clip_embedding=? WHERE id=?",
                                (json.dumps(vec.tolist()), rec["id"]),
                            )
                except Exception as exc:
                    log.debug("Could not encode %s: %s", rec["filename"], exc)
        clip_vectors.append(vec)

    assigned_labels_per_photo = []

    if CLIP_AVAILABLE:
        for vec in clip_vectors:
            if vec is None:
                assigned_labels_per_photo.append([])
            else:
                assigned_labels_per_photo.append(classify_image_into_albums(vec))
    else:
        assigned_labels_per_photo = [[] for _ in records]

    with get_db() as conn:
        existing_rows = conn.execute("SELECT id, label, emoji, color, scene FROM albums").fetchall()
    album_by_label = {r["label"].lower(): dict(r) for r in existing_rows}

    prompt_meta = {
        label: (emoji, color, label)
        for label, emoji, color, _ in ALBUM_LABEL_PROMPTS
    }

    touched_album_ids = set()

    with get_db() as conn:
        for idx, label_list in enumerate(assigned_labels_per_photo):
            photo_id = photo_ids[idx]
            for label in label_list:
                key = label.lower()
                if key not in album_by_label:
                    emoji, color, scene = prompt_meta.get(label, ("📷", "#7f8c8d", label))
                    album_id = str(uuid.uuid4())
                    conn.execute(
                        "INSERT OR IGNORE INTO albums (id, label, emoji, color, scene) VALUES (?,?,?,?,?)",
                        (album_id, label, emoji, color, scene),
                    )
                    album_by_label[key] = {
                        "id": album_id, "label": label,
                        "emoji": emoji, "color": color, "scene": scene,
                    }
                    log.info("Created new album '%s' (%s).", label, album_id)

                album_id = album_by_label[key]["id"]
                conn.execute(
                    "INSERT OR IGNORE INTO album_photos (album_id, photo_id) VALUES (?,?)",
                    (album_id, photo_id),
                )
                touched_album_ids.add(album_id)

    albums = []
    if touched_album_ids:
        with get_db() as conn:
            for album_id in touched_album_ids:
                row = conn.execute(
                    "SELECT a.*, COUNT(ap.photo_id) as count "
                    "FROM albums a LEFT JOIN album_photos ap ON ap.album_id = a.id "
                    "WHERE a.id=? GROUP BY a.id",
                    (album_id,)
                ).fetchone()
                if row:
                    albums.append({
                        "id":    row["id"],
                        "label": row["label"],
                        "emoji": row["emoji"],
                        "color": row["color"],
                        "count": row["count"],
                        "scene": row["scene"],
                    })
    log.info(
        "CLIP multi-label classification: %d photos -> %d albums touched (CLIP=%s).",
        len(records), len(albums), CLIP_AVAILABLE,
    )
    return albums

# Constellation Layout
def get_constellation_for_month(month, year):
    now = datetime.now()
    target_year = year or now.year

    try:
        month_dt = (
            datetime.strptime(month[:3], "%b")
            if len(month) <= 4
            else datetime.strptime(month, "%B")
        )
    except ValueError:
        month_dt = now
    month_label_pattern = f"{month_dt.strftime('%B')} {target_year}"

    with get_db() as conn:
        month_photos = conn.execute("""
            SELECT ph.id, ph.filename,
                   GROUP_CONCAT(pp.person_id) as people_ids
            FROM photos ph
            LEFT JOIN photo_people pp ON pp.photo_id = ph.id
            WHERE ph.month_label = ?
            GROUP BY ph.id
        """, (month_label_pattern,)).fetchall()

        month_person_ids = set()
        for mp in month_photos:
            for pid in (mp["people_ids"] or "").split(","):
                if pid:
                    month_person_ids.add(pid)

        if month_person_ids:
            placeholders = ",".join("?" * len(month_person_ids))
            people = conn.execute(f"""
                SELECT p.id, p.name, p.avatar, p.color, p.initials, p.profile_photo,
                       p.is_user,
                       COUNT(DISTINCT pp.photo_id) as photo_count
                FROM people p
                LEFT JOIN photo_people pp ON pp.person_id = p.id
                WHERE (p.id IN ({placeholders}) AND p.is_user = 0) OR p.is_user = 1
                GROUP BY p.id
                ORDER BY p.is_user DESC, p.name
            """, tuple(month_person_ids)).fetchall()
        else:
            people = conn.execute("""
                SELECT p.id, p.name, p.avatar, p.color, p.initials, p.profile_photo,
                       p.is_user,
                       COUNT(DISTINCT pp.photo_id) as photo_count
                FROM people p
                LEFT JOIN photo_people pp ON pp.person_id = p.id
                WHERE p.is_user = 1
                GROUP BY p.id
            """).fetchall()

        user_row = conn.execute(
            "SELECT value FROM app_settings WHERE key='user_profile_photo'"
        ).fetchone()
        user_photo = user_row["value"] if user_row else None

        user_person_row = conn.execute(
            "SELECT id FROM people WHERE is_user=1 LIMIT 1"
        ).fetchone()
        user_person_id = user_person_row["id"] if user_person_row else None

    user_node = None
    regular_people = []
    for person in people:
        if person["is_user"]:
            user_node = person
        else:
            regular_people.append(person)

    def build_person_month_photos(person_id):
        result = []
        for mp in month_photos:
            ids = (mp["people_ids"] or "").split(",")
            if person_id in ids:
                result.append({
                    "id":       mp["id"],
                    "filename": mp["filename"],
                })
        return result[:8]

    user_month_photos = []
    if user_person_id:
        for mp in month_photos:
            ids = (mp["people_ids"] or "").split(",")
            if user_person_id in ids:
                user_month_photos.append({
                    "id":       mp["id"],
                    "filename": mp["filename"],
                })

    nodes = []
    for person in regular_people:
        nodes.append({
            "id":            person["id"],
            "name":          person["name"],
            "avatar":        person["avatar"] or "👤",
            "color":         person["color"] or "#87CEEB",
            "initials":      person["initials"] or (person["name"][0].upper() if person["name"] else "?"),
            "profile_photo": person["profile_photo"],
            "photo_count":   person["photo_count"],
            "is_user":       False,
            "month_photos":  build_person_month_photos(person["id"]),
        })

    nodes.sort(key=lambda n: n["photo_count"], reverse=True)

    if user_node:
        user_data = {
            "id":            user_node["id"],
            "name":          user_node["name"],
            "avatar":        user_node["avatar"],
            "color":         "#8b7cf8",
            "initials":      user_node["initials"] or "You",
            "profile_photo": user_node["profile_photo"] or user_photo,
            "photo_count":   len(user_month_photos),
            "is_user":       True,
            "month_photos":  user_month_photos[:8],
        }
    else:
        user_data = {
            "id":            "user",
            "name":          "You",
            "avatar":        "",
            "color":         "#8b7cf8",
            "initials":      "You",
            "profile_photo": user_photo,
            "photo_count":   len(user_month_photos),
            "is_user":       True,
            "month_photos":  user_month_photos[:8],
        }

    return {
        "nodes":        nodes,
        "user":         user_data,
        "month_label":  month_label_pattern,
        "total_photos": len(month_photos),
    }

# On This Day
def get_on_this_day():
    today = date.today()
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.*, GROUP_CONCAT(pp.person_id) as people
            FROM photos p
            LEFT JOIN photo_people pp ON pp.photo_id = p.id
            WHERE strftime('%m-%d', p.taken_at) = ?
            GROUP BY p.id
            ORDER BY p.taken_at DESC
            LIMIT 1
        """, (f"{today.month:02d}-{today.day:02d}",)).fetchall()

        if not rows:
            rows = conn.execute("""
                SELECT p.*, GROUP_CONCAT(pp.person_id) as people
                FROM photos p
                LEFT JOIN photo_people pp ON pp.photo_id = p.id
                GROUP BY p.id
                ORDER BY p.created_at DESC
                LIMIT 1
            """).fetchall()

        if not rows:
            return None

        ph = rows[0]
        person_names = []
        if ph["people"]:
            for pid in ph["people"].split(","):
                row = conn.execute("SELECT name FROM people WHERE id=?", (pid,)).fetchone()
                if row:
                    person_names.append(row["name"])

        return {
            "photo_id":       ph["id"],
            "id":             ph["id"],
            "filename":       ph["filename"],
            "month_label":    ph["month_label"],
            "month":          ph["month_label"],
            "label":          (ph["filename"] or "").replace(ph["id"] + "_", "").rsplit(".", 1)[0] or "A Memory",
            "people":         person_names,
            "taken_at":       ph["taken_at"],
            "formatted_date": _format_date_display(ph["taken_at"]),
        }
    
# Helpers
def _format_date_display(taken_at):
    if not taken_at:
        return ""
    try:
        dt     = datetime.fromisoformat(taken_at)
        day    = str(dt.day)
        month  = dt.strftime("%B")
        year   = str(dt.year)
        hour   = dt.hour
        minute = dt.strftime("%M")
        period = "am" if hour < 12 else "pm"
        hour12 = hour % 12 or 12
        return f"{day} {month} {year} {hour12}:{minute}{period}"
    except (ValueError, TypeError):
        return taken_at or ""

def _format_photo_row(ph):
    filename = ph["filename"] or ""
    raw_id   = ph["id"] or ""
    clean    = filename.replace(raw_id + "_", "").rsplit(".", 1)[0]
    label    = clean.replace("_", " ").replace("-", " ").strip() or "Photo"

    people_csv  = ph["people"] if "people" in ph.keys() else None
    people_list = [p for p in people_csv.split(",") if p] if people_csv else []

    taken_at = ph["taken_at"] if "taken_at" in ph.keys() else None

    clip_labels_raw = ph["clip_labels"] if "clip_labels" in ph.keys() else None
    clip_labels = []
    if clip_labels_raw:
        try:
            clip_labels = json.loads(clip_labels_raw)
        except Exception:
            clip_labels = [clip_labels_raw]

    return {
        "id":             raw_id,
        "filename":       filename,
        "label":          label,
        "month":          ph["month_label"] or "",
        "month_label":    ph["month_label"] or "",
        "year_label":     ph["year_label"] if "year_label" in ph.keys() else "",
        "clip_labels":    clip_labels,
        "taken_at":       taken_at,
        "formatted_date": _format_date_display(taken_at),
        "people":         people_list,
    }

def _format_person_row(row):
    name     = row["name"] or "Unknown"
    initials = row["initials"] or name[0].upper()
    avatar   = row["avatar"] or "👤"
    color    = row["color"] or "#87CEEB"
    return {
        "id":            row["id"],
        "name":          name,
        "relationship":  row["relationship"] or "Other",
        "avatar":        avatar,
        "color":         color,
        "initials":      initials,
        "profile_photo": row["profile_photo"] if "profile_photo" in row.keys() else None,
        "photoCount":    row["photo_count"] if "photo_count" in row.keys() else 0,
        "photo_count":   row["photo_count"] if "photo_count" in row.keys() else 0,
        "is_user":       bool(row["is_user"]) if "is_user" in row.keys() else False,
    }

# API Routes
@app.get("/health")
def health_check():
    return {
        "status":                   "ok",
        "deepface":                 DEEPFACE_AVAILABLE,
        "clip":                     CLIP_AVAILABLE,
        "recognition_model":        RECOGNITION_MODEL if DEEPFACE_AVAILABLE else None,
        "recognition_threshold":    RECOGNITION_THRESHOLD,
        "min_detection_confidence": MIN_DETECTION_CONFIDENCE,
        "timestamp":                datetime.now(timezone.utc).isoformat(),
    }

# Settings 
@app.get("/settings")
def get_settings():
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
    return {r["key"]: r["value"] for r in rows}

@app.post("/settings/profile-photo")
async def upload_profile_photo(
    file: UploadFile = File(...),
    name: Optional[str] = Form("You"),
):
    image_bytes = await file.read()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    filename  = f"user_{uuid.uuid4()}.jpg"
    save_path = PROFILE_DIR / filename
    thumb = image.resize((300, 300), Image.LANCZOS)
    thumb.save(save_path, "JPEG", quality=90)

    user_name = (name or "You").strip() or "You"

    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
            ("user_profile_photo", filename),
        )
        existing = conn.execute(
            "SELECT id FROM people WHERE is_user=1 LIMIT 1"
        ).fetchone()

    if existing:
        user_id = existing["id"]
        with get_db() as conn:
            conn.execute(
                "UPDATE people SET name=?, profile_photo=?, initials=? WHERE id=?",
                (user_name, filename, user_name[0].upper(), user_id),
            )
    else:
        user_id  = str(uuid.uuid4())
        initials = user_name[0].upper()
        with get_db() as conn:
            conn.execute(
                "INSERT INTO people "
                "(id, name, relationship, avatar, color, initials, profile_photo, is_user) "
                "VALUES (?,?,?,?,?,?,?,1)",
                (user_id, user_name, "Self", "🧑", "#8b7cf8", initials, filename),
            )

    embedding = extract_embedding(image)
    if embedding is not None:
        embedding_store.add(user_id, embedding)
        log.info("User face enrolled for person %s", user_id)

    return {
        "profile_photo": filename,
        "url":           f"/static/profiles/{filename}",
        "user_id":       user_id,
        "user_name":     user_name,
    }

# People
class PersonCreate(BaseModel):
    name: str
    relationship: Optional[str] = None
    avatar: Optional[str] = None
    color: Optional[str] = None
    initials: Optional[str] = None

@app.post("/people", status_code=201)
def create_person(body: PersonCreate):
    person_id = str(uuid.uuid4())
    initials  = body.initials or (body.name[0].upper() if body.name else "?")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO people (id, name, relationship, avatar, color, initials) VALUES (?,?,?,?,?,?)",
            (person_id, body.name, body.relationship, body.avatar, body.color, initials),
        )
    return {
        "id":            person_id,
        "name":          body.name,
        "relationship":  body.relationship or "Other",
        "avatar":        body.avatar or "👤",
        "color":         body.color or "#87CEEB",
        "initials":      initials,
        "profile_photo": None,
        "photoCount":    0,
        "photo_count":   0,
        "is_user":       False,
    }

@app.get("/people")
def list_people():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.*, COUNT(DISTINCT pp.photo_id) as photo_count
            FROM people p
            LEFT JOIN photo_people pp ON pp.person_id = p.id
            GROUP BY p.id
            ORDER BY p.name
        """).fetchall()
    return [_format_person_row(r) for r in rows]

@app.patch("/people/{person_id}")
def update_person(person_id: str, body: dict):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM people WHERE id=?", (person_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Person not found.")
    allowed = {"name", "relationship", "color", "avatar"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(422, "No valid fields to update.")
    if "name" in updates and updates["name"]:
        updates["initials"] = updates["name"][0].upper()
    set_clause = ", ".join(f"{k}=?" for k in updates)
    with get_db() as conn:
        conn.execute(f"UPDATE people SET {set_clause} WHERE id=?", (*updates.values(), person_id))
    with get_db() as conn:
        updated = conn.execute(
            "SELECT p.*, COUNT(DISTINCT pp.photo_id) as photo_count "
            "FROM people p LEFT JOIN photo_people pp ON pp.person_id = p.id "
            "WHERE p.id=? GROUP BY p.id",
            (person_id,)
        ).fetchone()
    return _format_person_row(updated)

@app.post("/people/{person_id}/profile-photo")
async def update_person_profile_photo(person_id: str, file: UploadFile = File(...)):
    with get_db() as conn:
        row = conn.execute("SELECT id, profile_photo FROM people WHERE id=?", (person_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"Person {person_id} not found.")

    image_bytes = await file.read()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    old_fn = row["profile_photo"]
    if old_fn:
        try:
            (PROFILE_DIR / old_fn).unlink(missing_ok=True)
        except Exception:
            pass

    filename  = f"{person_id}_profile.jpg"
    save_path = PROFILE_DIR / filename
    thumb = image.resize((300, 300), Image.LANCZOS)
    thumb.save(save_path, "JPEG", quality=90)

    with get_db() as conn:
        conn.execute("UPDATE people SET profile_photo=? WHERE id=?", (filename, person_id))

    embedding = extract_embedding(image)
    if embedding is not None:
        embedding_store.add(person_id, embedding)

    with get_db() as conn:
        updated = conn.execute(
            "SELECT p.*, COUNT(DISTINCT pp.photo_id) as photo_count "
            "FROM people p LEFT JOIN photo_people pp ON pp.person_id = p.id "
            "WHERE p.id=? GROUP BY p.id",
            (person_id,)
        ).fetchone()

    return {
        "updated":       True,
        "person_id":     person_id,
        "profile_photo": filename,
        "url":           f"/static/profiles/{filename}",
        "person":        _format_person_row(updated) if updated else None,
    }

@app.delete("/people/{person_id}")
def delete_person(person_id: str):
    embedding_store.remove_person(person_id)
    with get_db() as conn:
        conn.execute("DELETE FROM photo_people WHERE person_id=?", (person_id,))
        conn.execute("DELETE FROM people WHERE id=?", (person_id,))
    return {"deleted": person_id}


# Face Enrollment
@app.post("/people/{person_id}/enroll")
async def enroll_face(person_id: str, file: UploadFile = File(...)):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM people WHERE id=?", (person_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"Person {person_id} not found.")

    image_bytes = await file.read()
    image = Image.open(io.BytesIO(image_bytes))
    embedding = extract_embedding(image)

    if embedding is None:
        raise HTTPException(422, "No face detected. Please use a clear, front-facing photo.")

    embedding_store.add(person_id, embedding)

    filename  = f"{person_id}_profile.jpg"
    save_path = PROFILE_DIR / filename
    thumb = image.convert("RGB").resize((300, 300), Image.LANCZOS)
    thumb.save(save_path, "JPEG", quality=90)

    with get_db() as conn:
        conn.execute("UPDATE people SET profile_photo=? WHERE id=?", (filename, person_id))

    return {
        "enrolled":         True,
        "person_id":        person_id,
        "profile_photo":    filename,
        "total_references": len(embedding_store.get_all().get(person_id, [])),
    }

# Pending Faces
@app.get("/pending-faces")
def list_pending_faces():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, photo_id, face_crop FROM pending_faces ORDER BY created_at DESC"
        ).fetchall()
    return [
        {
            "id":       r["id"],
            "photo_id": r["photo_id"],
            "face_url": f"/static/faces/{r['face_crop']}",
        }
        for r in rows
    ]

class ConfirmFaceBody(BaseModel):
    person_id:    Optional[str] = None
    name:         Optional[str] = None
    relationship: Optional[str] = None

@app.post("/pending-faces/{face_id}/confirm")
def confirm_face(face_id: str, body: ConfirmFaceBody):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM pending_faces WHERE id=?", (face_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Pending face not found.")

    embedding = np.array(json.loads(row["embedding"])) if row["embedding"] else None

    if not body.person_id:
        if not body.name:
            raise HTTPException(422, "Provide either person_id or a name for the new person.")

        person_id = str(uuid.uuid4())
        initials  = body.name[0].upper()
        colors    = ["#87CEEB", "#DDA0DD", "#98FB98", "#FFB6C1", "#F0E68C", "#AED6F1", "#A9DFBF"]
        color     = colors[len(body.name) % len(colors)]

        face_fn    = row["face_crop"]
        profile_fn = f"{person_id}_profile.jpg"
        import shutil
        shutil.copy2(FACES_DIR / face_fn, PROFILE_DIR / profile_fn)

        with get_db() as conn:
            conn.execute(
                "INSERT INTO people "
                "(id, name, relationship, avatar, color, initials, profile_photo) "
                "VALUES (?,?,?,?,?,?,?)",
                (person_id, body.name, body.relationship or "Other", "👤", color, initials, profile_fn),
            )
    else:
        person_id  = body.person_id
        profile_fn = None

    if embedding is not None:
        embedding_store.add(person_id, embedding)

    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO photo_people (photo_id, person_id, confidence) VALUES (?,?,?)",
            (row["photo_id"], person_id, 0.95),
        )
        conn.execute("DELETE FROM pending_faces WHERE id=?", (face_id,))

    with get_db() as conn:
        person_row = conn.execute(
            "SELECT p.*, COUNT(DISTINCT pp.photo_id) as photo_count "
            "FROM people p LEFT JOIN photo_people pp ON pp.person_id = p.id "
            "WHERE p.id=? GROUP BY p.id",
            (person_id,)
        ).fetchone()

    return {
        "confirmed":  True,
        "person_id":  person_id,
        "new_person": body.person_id is None,
        "person":     _format_person_row(person_row) if person_row else None,
    }

@app.delete("/pending-faces/{face_id}")
def dismiss_pending_face(face_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM pending_faces WHERE id=?", (face_id,))
    return {"dismissed": face_id}

# Photos
@app.get("/photos")
def list_photos(person_id: Optional[str] = None, limit: int = 200):
    with get_db() as conn:
        if person_id:
            rows = conn.execute("""
                SELECT p.*, GROUP_CONCAT(pp.person_id) as people
                FROM photos p
                JOIN photo_people pp ON pp.photo_id = p.id
                WHERE pp.person_id = ?
                GROUP BY p.id
                ORDER BY p.taken_at DESC
                LIMIT ?
            """, (person_id, limit)).fetchall()
        else:
            rows = conn.execute("""
                SELECT p.*, GROUP_CONCAT(pp.person_id) as people
                FROM photos p
                LEFT JOIN photo_people pp ON pp.photo_id = p.id
                GROUP BY p.id
                ORDER BY p.taken_at DESC
                LIMIT ?
            """, (limit,)).fetchall()
    return [_format_photo_row(r) for r in rows]

@app.get("/photos/years")
def list_available_years():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT DISTINCT strftime('%Y', taken_at) AS year
            FROM photos
            WHERE taken_at IS NOT NULL
            ORDER BY year DESC
        """).fetchall()

    years = [r["year"] for r in rows if r["year"]]
    return {"years": years}

@app.get("/photos/{photo_id}")
def get_photo(photo_id: str):
    with get_db() as conn:
        row = conn.execute("""
            SELECT p.*, GROUP_CONCAT(pp.person_id) as people
            FROM photos p
            LEFT JOIN photo_people pp ON pp.photo_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
        """, (photo_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Photo not found.")
    return _format_photo_row(row)

# Analyze photos
@app.post("/photos/analyze", status_code=201)
async def analyze_photo(
    file: UploadFile = File(...),
    taken_at: Optional[str] = Form(None),
    month_label: Optional[str] = Form(None),
):
    """
    1. Save photo to disk.
    2. CLIP image embedding (normalised).
    3. CLIP album pre-classification (stored for reference).
    4. DeepFace face detection and recognition.
    5. Persist to DB.
    6. Trigger full CLIP album re-clustering.
    """
    image_bytes = await file.read()
    photo_id    = str(uuid.uuid4())
    filename    = f"{photo_id}_{file.filename}"
    save_path   = PHOTOS_DIR / filename

    with open(save_path, "wb") as fh:
        fh.write(image_bytes)

    _raw_image = Image.open(io.BytesIO(image_bytes))
    exif_taken_at = extract_taken_at(_raw_image)
    if not taken_at and exif_taken_at:
        taken_at = exif_taken_at
        log.info("EXIF DateTimeOriginal extracted: %s", taken_at)
    image = _raw_image.convert("RGB")

    # 1. CLIP image embedding
    clip_vec  = encode_image_clip(image)
    clip_json = json.dumps(clip_vec.tolist()) if clip_vec is not None else None

    # 2. CLIP album labels for this photo
    clip_labels: list[str] = []
    if clip_vec is not None:
        clip_labels = classify_image_into_albums(clip_vec)
    clip_labels_json = json.dumps(clip_labels)

    # 3. DeepFace face detection and recognition
    matched, unknown_faces = identify_faces_in_image(image)
    person_ids = [m["person_id"] for m in matched if m["person_id"]]

    ref_dt = None
    if taken_at:
        try:
            ref_dt = datetime.fromisoformat(taken_at)
        except (ValueError, TypeError):
            pass
    if ref_dt is None:
        ref_dt = datetime.now()

    month_label_str = ref_dt.strftime("%B %Y")
    year_label      = str(ref_dt.year)

    # 4. Persist
    with get_db() as conn:
        conn.execute("""
            INSERT INTO photos
                (id, filename, taken_at, month_label, year_label, clip_embedding, clip_labels)
            VALUES (?,?,?,?,?,?,?)
        """, (
            photo_id, filename, taken_at, month_label_str, year_label,
            clip_json, clip_labels_json,
        ))
        for m in matched:
            if m["person_id"]:
                conn.execute(
                    "INSERT OR IGNORE INTO photo_people (photo_id, person_id, confidence) VALUES (?,?,?)",
                    (photo_id, m["person_id"], m["confidence"]),
                )

    # 5. Save unknown faces as pending
    pending_face_records: list[dict] = []
    for uf in unknown_faces:
        face_id  = str(uuid.uuid4())
        face_fn  = save_face_crop(uf["face_crop"], face_id)
        emb_json = json.dumps(uf["embedding"].tolist())
        with get_db() as conn:
            conn.execute(
                "INSERT INTO pending_faces (id, photo_id, face_crop, embedding) VALUES (?,?,?,?)",
                (face_id, photo_id, face_fn, emb_json),
            )
        pending_face_records.append({
            "id":       face_id,
            "photo_id": photo_id,
            "face_url": f"/static/faces/{face_fn}",
        })

    # 6. Re-run CLIP multi-label album assignment
    try:
        cluster_photos_into_albums()
    except Exception as e:
        log.warning("Album assignment failed after photo import: %s", e)

    clean_label = (
        (file.filename or "").rsplit(".", 1)[0].replace("_", " ").replace("-", " ").strip()
        or "Photo"
    )

    return {
        "photo_id":       photo_id,
        "filename":       filename,
        "label":          clean_label,
        "month":          month_label_str,
        "year":           year_label,
        "clip_labels":    clip_labels,
        "formatted_date": _format_date_display(taken_at),
        "people":         person_ids,
        "pending_faces":  pending_face_records,
    }

# Albums
@app.post("/albums/cluster")
def trigger_clustering():
    albums = cluster_photos_into_albums()
    return {"albums_created": len(albums), "albums": albums}

@app.get("/albums")
def list_albums():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT a.*, COUNT(ap.photo_id) as count
            FROM albums a
            LEFT JOIN album_photos ap ON ap.album_id = a.id
            GROUP BY a.id
            ORDER BY count DESC
        """).fetchall()
    return [dict(r) for r in rows]

@app.get("/albums/{album_id}/photos")
def get_album_photos(album_id: str):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT p.*, GROUP_CONCAT(pp.person_id) as people
            FROM photos p
            JOIN album_photos ap ON ap.photo_id = p.id
            LEFT JOIN photo_people pp ON pp.photo_id = p.id
            WHERE ap.album_id = ?
            GROUP BY p.id
        """, (album_id,)).fetchall()
    return [_format_photo_row(r) for r in rows]

# Constellation Layout
@app.get("/constellation/{month}")
def constellation(month: str, year: Optional[int] = None):
    return get_constellation_for_month(month, year)

# On This Day
@app.get("/on-this-day")
def on_this_day():
    result = get_on_this_day()
    if not result:
        raise HTTPException(404, "No memories found yet. Import some photos first!")
    return result