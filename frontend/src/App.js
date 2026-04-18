import { useState, useRef, useEffect, useCallback } from "react";
import homeIcon from './assets/icons/home.png';
import peopleIcon from "./assets/icons/people.png";
import videoIcon from "./assets/icons/videos.png";
import settingsIcon from "./assets/icons/settings.png";
import './App.css';

const API = "https://44444hearts-synapse.hf.space";

// Helpers
const photoUrl   = (fn) => fn ? `${API}/static/photos/${fn}` : null;
const profileUrl = (fn) => fn ? `${API}/static/profiles/${fn}` : null;

const RELATIONSHIPS = ["Wife","Husband","Son","Daughter","Mother","Father","Sister","Brother",
  "Grandmother","Grandfather","Granddaughter","Grandson","Friend","Neighbour","Doctor","Carer","Other"];
const COLORS = ["#FFB347","#87CEEB","#DDA0DD","#98FB98","#FFB6C1","#AED6F1","#A9DFBF","#D7BDE2","#FADBD8"];

const MONTHS = [
  { short:"Jan", name:"January"   },
  { short:"Feb", name:"February"  },
  { short:"Mar", name:"March"     },
  { short:"Apr", name:"April"     },
  { short:"May", name:"May"       },
  { short:"Jun", name:"June"      },
  { short:"Jul", name:"July"      },
  { short:"Aug", name:"August"    },
  { short:"Sep", name:"September" },
  { short:"Oct", name:"October"   },
  { short:"Nov", name:"November"  },
  { short:"Dec", name:"December"  },
];

// Raw constellation pixel coordinates (12 shapes for 12 months)
const CONSTELLATION_RAW = [
  // Jan: Flower
  [[329,784],[323,849],[367,867],[369,895],[301,861],[320,915],[349,936],[413,934],[452,852],[398,874],[381,895],[380,869],[425,846],[421,785],[393,799],[372,778],[356,799]],
  // Feb: Bunny 
  [[79,533],[77,578],[45,616],[68,643],[97,644],[82,690],[129,681],[135,693],[192,691],[214,669],[199,643],[164,608],[119,607],[110,598],[127,586],[126,535],[117,533],[104,551]],
  // Mar: Airplane
  [[458,54],[299,112],[292,123],[345,148],[348,192],[377,169],[412,191]],
  // Apr: Fox
  [[797,538],[797,615],[869,686],[933,615],[933,540],[924,538],[887,570],[843,570],[807,538]],
  // May: Swan
  [[1537,847],[1497,824],[1482,853],[1500,906],[1413,897],[1446,944],[1519,943],[1549,920],[1511,854],[1538,853]],
  // Jun: Bird
  [[552,866],[523,851],[503,863],[475,814],[465,848],[442,833],[458,895],[435,952],[472,921],[522,896],[531,879]],
  // Jul: Dove
  [[1156,643],[1129,642],[1098,661],[1037,646],[1066,690],[1016,704],[1041,730],[1075,704],[1083,707],[1122,694]],
  // Aug: Crab
  [[252,426],[235,453],[248,503],[229,530],[251,551],[252,527],[335,526],[345,551],[364,525],[345,504],[358,455],[337,427],[334,460],[271,455],[264,462],[256,458]],
  // Sep: Penguin
  [[689,557],[640,533],[600,547],[550,676],[584,667],[611,690],[651,690],[639,667],[650,659],[653,573],[688,567]],
  // Oct: Dinosaur
  [[527,223],[512,230],[493,279],[443,307],[453,315],[461,360],[469,359],[473,323],[497,326],[502,358],[513,359],[523,245],[541,256],[545,239]],
  // Nov: Bear
  [[1015,71],[1034,81],[1034,108],[1062,138],[1113,137],[1139,107],[1139,80],[1157,74],[1140,49],[1108,75],[1064,75],[1035,49]],
  // Dec: Cat
  [[632,423],[634,475],[649,488],[632,553],[749,554],[750,526],[714,534],[700,489],[715,477],[717,423],[697,448],[653,448]],
];

// Normalize each shape's coordinates to [0,1] 
function normalizeShape(pts) {
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  return pts.map(p => [(p[0] - minX) / rangeX, (p[1] - minY) / rangeY]);
}

const CONSTELLATION_SHAPES_NORMALIZED = CONSTELLATION_RAW.map(normalizeShape);

// Map coordinates into Universe with padding
function getConstellationPositions(monthIdx, W, H) {
  const padX = W * 0.10, padY = H * 0.10;
  const useW = W - padX * 2, useH = H - padY * 2;
  const normalized = CONSTELLATION_SHAPES_NORMALIZED[monthIdx] || CONSTELLATION_SHAPES_NORMALIZED[0];
  return normalized.map(([nx, ny]) => ({
    cx: padX + nx * useW,
    cy: padY + ny * useH,
  }));
}

// API calls
async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(`${API}${path}`, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    console.error("API error:", path, e);
    throw e;
  }
}

// Small components
function ToggleSwitch({ on, onToggle }) {
  return (
    <button className={`toggle-switch ${on ? "on" : ""}`} onClick={onToggle}>
      <div className="toggle-thumb" />
    </button>
  );
}

function Loader() {
  return <span className="loader" />;
}

// Displays photo labelled with people inside
function PhotoModal({ photo, people, onClose }) {
  const imgSrc = photoUrl(photo.filename);
  const dateDisplay = photo.formatted_date || photo.taken_at || "";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal slide-up" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <button className="modal-close" onClick={onClose}>✕</button>

        <div className="modal-content">
          <div className="photo-wrap">
            {imgSrc ? (
              <img src={imgSrc} alt={photo.label} className="photo-detail-img" />
            ) : (
              <div className="photo-detail-emoji">{photo.emoji || "📷"}</div>
            )}
            {dateDisplay && (
              <div style={{ fontSize:15, color:"var(--muted)", marginBottom:12, letterSpacing:".2px" }}>
                {dateDisplay}
              </div>
            )}
            <div className="photo-action-row">
              <button className="photo-action-btn secondary">📤 Share</button>
              <button className="photo-action-btn primary">🔔 Remind</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Shows albums as grids
function AlbumModal({ album, people, onClose }) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/albums/${album.id}/photos`)
      .then(setPhotos)
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false));
  }, [album.id]);

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal slide-up" onClick={e => e.stopPropagation()}>
          <div className="modal-handle" />
          <button className="modal-close" onClick={onClose}>✕</button>

          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
            <div style={{ width:56, height:56, borderRadius:16, background:album.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, flexShrink:0 }}>
              {album.emoji}
            </div>
            <div>
              <div className="modal-title" style={{ marginBottom:2 }}>{album.scene}</div>
              <div style={{ fontSize:14, color:"var(--muted)" }}>{album.count} photos</div>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign:"center", padding:"40px 0" }}><Loader /></div>
          ) : photos.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">{album.emoji}</span>
              <div className="empty-state-title">No photos yet</div>
              <div className="empty-state-sub">Import photos to populate this album.</div>
            </div>
          ) : (
            <div className="album-photos-grid">
              {photos.map((p, idx) => {
                const src = photoUrl(p.filename);
                const dateDisplay = p.formatted_date || p.taken_at || "";
                return (
                  <div key={p.id ?? idx} className="album-photo-thumb" onClick={() => setSelectedPhoto(p)}>
                    {src
                      ? <img src={src} alt={p.label} />
                      : <div style={{ background:p.color+"CC", width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:30 }}>{p.emoji}</div>
                    }
                    {dateDisplay && (
                      <div className="album-photo-label">{dateDisplay}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {selectedPhoto && (
        <PhotoModal photo={selectedPhoto} people={people} onClose={() => setSelectedPhoto(null)} />
      )}
    </>
  );
}

// Shows photos for each person
function PersonModal({ person, people, onClose, onUpdated }) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [photos, setPhotos]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editing, setEditing]     = useState(false);
  const [editName, setEditName]   = useState(person.name);
  const [editRel, setEditRel]     = useState(person.relationship || "");
  const [saving, setSaving]       = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const modalPhotoInputRef = useRef(null);

  useEffect(() => {
    apiFetch(`/photos?person_id=${person.id}&limit=12`)
      .then(setPhotos)
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false));
  }, [person.id]);

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const updated = await apiFetch(`/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), relationship: editRel }),
      });
      onUpdated?.(updated);
      setEditing(false);
    } catch (e) {
      alert("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleModalPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(`/people/${person.id}/profile-photo`, { method:"POST", body:form });
      if (res.person) onUpdated?.(res.person);
    } catch(err) {
      alert("Photo upload failed: " + err.message);
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  };

  const profileSrc = person.profile_photo ? profileUrl(person.profile_photo) : null;
  const photoCount = person.photoCount ?? person.photo_count ?? photos.length;
  const relationship = person.relationship || "Other";

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal slide-up" onClick={e => e.stopPropagation()}>
          <div className="modal-handle" />
          <button className="modal-close" onClick={onClose}>✕</button>

          {/* Header row */}
          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
            <div style={{ position:"relative", flexShrink:0 }}>
              <div style={{ width:68, height:68, borderRadius:"50%", background:(person.color||"#87CEEB")+"25", display:"flex", alignItems:"center", justifyContent:"center", fontSize:34, overflow:"hidden", border:`2px solid ${person.color||"#87CEEB"}60` }}>
                {uploadingPhoto
                  ? <Loader />
                  : profileSrc
                    ? <img src={profileSrc} alt={person.name} style={{ width:"100%", height:"100%", objectFit:"cover", borderRadius:"50%" }} />
                    : <span>{person.avatar || "👤"}</span>
                }
              </div>
              <input ref={modalPhotoInputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleModalPhotoUpload} />
              {!person.is_user && (
                <button onClick={() => modalPhotoInputRef.current?.click()}
                  style={{ position:"absolute", bottom:-4, right:-4, width:24, height:24, borderRadius:"50%", background:"var(--accent)", border:"2px solid white", fontSize:10, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  ✏️
                </button>
              )}
            </div>
            <div style={{ flex:1 }}>
              {editing ? (
                <>
                  <input className="form-input" value={editName} onChange={e => setEditName(e.target.value)}
                    style={{ marginBottom:8, fontSize:18, fontFamily:"Lora,serif", fontWeight:700 }} maxLength={30} />
                  <div className="rel-picker">
                    {RELATIONSHIPS.map(r => (
                      <div key={r} className={`rel-opt ${editRel===r?"selected":""}`} onClick={() => setEditRel(r)}>{r}</div>
                    ))}
                  </div>
                  <div style={{ display:"flex", gap:8, marginTop:10 }}>
                    <button className="primary-btn" style={{ marginTop:0, flex:1 }} onClick={handleSave} disabled={saving || !editName.trim()}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => { setEditing(false); setEditName(person.name); setEditRel(person.relationship||""); }}
                      style={{ flex:1, padding:"16px", background:"var(--parchment)", border:"none", borderRadius:14, fontSize:14, fontWeight:500, cursor:"pointer" }}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="modal-title" style={{ marginBottom:2 }}>{person.name}</div>
                  <div style={{ fontSize:14, color:"var(--muted)" }}>
                    {person.is_user
                      ? `${photos.length} memories`
                      : `${relationship} · ${photoCount} memories`
                    }
                  </div>
                  {!person.is_user && (
                    <button onClick={() => setEditing(true)}
                      style={{ marginTop:6, padding:"5px 14px", background:"var(--parchment)", border:"none", borderRadius:10, fontSize:12, fontWeight:600, color:"var(--accent)", cursor:"pointer" }}>
                      Edit ✏️
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign:"center", padding:"40px 0" }}><Loader /></div>
          ) : photos.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">📷</span>
              <div className="empty-state-title">No memories yet</div>
              <div className="empty-state-sub">
                {person.is_user
                  ? "Upload photos and you'll appear here when recognised."
                  : `Import photos to see ${person.name}'s memories here.`
                }
              </div>
            </div>
          ) : (
            <div className="memories-grid">
              {photos.slice(0, 6).map((p) => {
                const src = photoUrl(p.filename);
                const dateDisplay = p.formatted_date || p.taken_at || "";
                return (
                  <div key={p.id} style={{ display:"flex", flexDirection:"column", gap:4 }}>
                    <div className="memory-thumb" onClick={() => setSelectedPhoto(p)}
                      style={{ background:p.color+"30", border:`1.5px solid ${p.color}25` }}>
                      {src
                        ? <img src={src} alt={p.label} />
                        : <span>{p.emoji}</span>
                      }
                    </div>
                    {dateDisplay && (
                      <div style={{ fontSize:11, color:"var(--muted)", textAlign:"center" }}>{dateDisplay}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!editing && (
            <>
              <div style={{ fontSize:13, color:"var(--muted)", textAlign:"center", marginBottom:16 }}>
                Showing {Math.min(photos.length, 6)} of {photos.length} memories
              </div>
              <button className="primary-btn" onClick={onClose}>Close</button>
            </>
          )}
        </div>
      </div>
      {selectedPhoto && (
        <PhotoModal photo={selectedPhoto} people={people} onClose={() => setSelectedPhoto(null)} />
      )}
    </>
  );
}

// Face Confirm Modal
function FaceConfirmModal({ pendingFaces, people, onConfirm, onDismiss, onClose }) {
  const [current, setCurrent] = useState(0);
  const face = pendingFaces[current];
  const [mode, setMode] = useState("choose");
  const [selectedPersonId, setSelectedPersonId] = useState(null);
  const [name, setName] = useState("");
  const [relationship, setRel] = useState("");
  const [saving, setSaving] = useState(false);

  if (!face) return null;

  const advanceOrClose = () => {
    if (current < pendingFaces.length - 1) {
      setCurrent(c => c + 1);
      setMode("choose");
      setSelectedPersonId(null);
      setName("");
      setRel("");
    } else {
      onClose();
    }
  };

  const handleConfirmExisting = async () => {
    if (!selectedPersonId) return;
    setSaving(true);
    try {
      await onConfirm(face.id, { person_id: selectedPersonId });
      advanceOrClose();
    } finally { setSaving(false); }
  };

  const handleConfirmNew = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onConfirm(face.id, { name: name.trim(), relationship });
      advanceOrClose();
    } finally { setSaving(false); }
  };

  // "Not a face" — dismiss just this detection
  const handleNotAFace = async () => {
    setSaving(true);
    try {
      await onDismiss(face.id);
      advanceOrClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal slide-up" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <button className="modal-close" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="modal-title">Who is this?</div>
        <div className="modal-sub" style={{ marginBottom:6 }}>
          {current + 1} of {pendingFaces.length} detected {pendingFaces.length === 1 ? "face" : "faces"}
        </div>

        {/* Face image */}
        <div style={{ textAlign:"center", marginBottom:16 }}>
          <img
            src={`${API}${face.face_url}`}
            alt="Detected face"
            style={{
              width:130,
              height:130,
              borderRadius:"50%",
              objectFit:"cover",
              border:"3px solid var(--parchment)",
              background:"var(--parchment)",
            }}
          />
        </div>

        {/* ── Choose mode ── */}
        {mode === "choose" && (
          <>
            {/* Primary actions row */}
            <div style={{ display:"flex", gap:8, marginBottom:16 }}>
              <button
                className="primary-btn"
                style={{ marginTop:0, flex:1 }}
                onClick={() => setMode("new")}
              >
                ＋ New Person
              </button>
              <button
                onClick={handleNotAFace}
                disabled={saving}
                style={{
                  flex:1,
                  padding:"14px 10px",
                  borderRadius:14,
                  border:"1.5px solid #e74c3c55",
                  background:"#e74c3c11",
                  color:"#e74c3c",
                  fontSize:15,
                  fontWeight:600,
                  cursor:"pointer",
                  fontFamily:"DM Sans,sans-serif",
                }}
              >
                {saving ? "…" : "✕ Not a face"}
              </button>
            </div>

            {/* Existing people grid */}
            {people.length > 0 && (
              <>
                <div className="form-label" style={{ marginBottom:10 }}>Or select existing person</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16, maxHeight:500, overflowY:"auto" }}>
                  {people.map(p => {
                    const src = profileUrl(p.profile_photo);
                    const displayName = p.is_user ? "You" : p.name;
                    return (
                      <div key={p.id} onClick={() => setSelectedPersonId(p.id)}
                        style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6, padding:"12px 8px", borderRadius:14, background:selectedPersonId===p.id?"rgba(181,101,29,.1)":"var(--parchment)", border:`2px solid ${selectedPersonId===p.id?"var(--accent)":"transparent"}`, cursor:"pointer" }}>
                        <div style={{ width:48, height:48, borderRadius:"50%", overflow:"hidden", background:(p.color||"#87CEEB")+"30", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>
                          {src ? <img src={src} alt={displayName} style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : p.avatar}
                        </div>
                        <div style={{ fontSize:12, fontWeight:600, textAlign:"center" }}>{displayName}</div>
                      </div>
                    );
                  })}
                </div>
                {selectedPersonId && (
                  <button className="primary-btn" onClick={handleConfirmExisting} disabled={saving}>
                    {saving ? "Saving…" : "Confirm Person"}
                  </button>
                )}
              </>
            )}
          </>
        )}

        {/* ── New person mode ── */}
        {mode === "new" && (
          <>
            <button onClick={() => setMode("choose")} style={{ background:"none", border:"none", color:"var(--accent)", fontSize:13, fontWeight:500, cursor:"pointer", marginBottom:12, padding:0 }}>← Back</button>
            <div className="form-field">
              <label className="form-label">Name</label>
              <input className="form-input" placeholder="e.g. Margaret" value={name} onChange={e => setName(e.target.value)} maxLength={30} />
            </div>
            <div className="form-field">
              <label className="form-label">Relationship</label>
              <div className="rel-picker">
                {RELATIONSHIPS.map(r => (
                  <div key={r} className={`rel-opt ${relationship===r?"selected":""}`} onClick={() => setRel(r)}>{r}</div>
                ))}
              </div>
            </div>
            <button className="primary-btn" onClick={handleConfirmNew} disabled={!name.trim() || saving}>
              {saving ? "Saving…" : `Add ${name.trim() || "Person"}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Import photos from user's gallery
function ImportModal({ onClose, onImportDone }) {
  const [step, setStep]       = useState("select");
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState({ total:0, matched:0, unknown:0, albums:0 });
  const [pendingFaces, setPendingFaces] = useState([]);
  const [people, setPeople]   = useState([]);
  const fileRef = useRef(null);

  const loadPeople = () => apiFetch("/people").then(setPeople).catch(() => {});
  useEffect(() => { loadPeople(); }, []);

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    setStep("importing");
    setProgress(0);
    const allPending = [];
    let matched = 0;
    let totalProcessed = 0;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await apiFetch("/photos/analyze", { method:"POST", body:form });
        matched    += (res.people || []).length;
        allPending.push(...(res.pending_faces || []));
      } catch (e) { console.warn("Failed to analyze:", file.name, e); }
      totalProcessed++;
      setProgress(Math.round((totalProcessed / files.length) * 100));
    }
    const albums = await apiFetch("/albums").catch(() => []);
    setResults({ total: files.length, matched, unknown: allPending.length, albums: albums.length });
    setPendingFaces(allPending);
    setStep("done");
    onImportDone();
  };

  const confirmFace = async (faceId, body) => {
    await apiFetch(`/pending-faces/${faceId}/confirm`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
    await loadPeople();
  };

  const dismissFace = async (faceId) => {
    await apiFetch(`/pending-faces/${faceId}`, { method:"DELETE" });
  };

  if (step === "done" && pendingFaces.length > 0) {
    return <FaceConfirmModal pendingFaces={pendingFaces} people={people} onConfirm={confirmFace} onDismiss={dismissFace} onClose={onClose} />;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal slide-up" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <button className="modal-close" onClick={onClose}>✕</button>

        {step === "select" && (
          <>
            <div className="modal-title">Import Photos</div>
            <div className="upload-zone" onClick={() => fileRef.current?.click()}>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={e => handleFiles(e.target.files)} />
              <div style={{ fontSize:48, marginBottom:12 }}>📷</div>
              <div style={{ fontSize:16, fontWeight:600, marginBottom:4 }}>Tap to select photos</div>
            </div>
          </>
        )}

        {step === "importing" && (
          <>
            <div className="modal-title">Importing…</div>
            <div className="modal-sub">Please keep the app open while photos are being processed.</div>
            <div className="import-progress">
              <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>{progress}% complete</div>
              <div className="import-bar-bg"><div className="import-bar" style={{ width:`${progress}%` }} /></div>
              <div className="import-stats"><span>Analysing faces...</span><span>{progress}%</span></div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {["Uploading photos","Detecting faces","Recognising people","Building albums"].map((t, i) => (
                <div key={t} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:"var(--parchment)", borderRadius:10 }}>
                  <span style={{ fontSize:16 }}>{progress > i * 25 ? "✅" : <span className="pulse">⏳</span>}</span>
                  <span style={{ fontSize:14, fontWeight:500 }}>{t}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {step === "done" && pendingFaces.length === 0 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
          <div style={{ width: "100%", maxWidth: 400 }}>
            <div style={{ textAlign:"center" }}>
              <div className="modal-title">Import Complete!</div>

              <div style={{ fontSize:15, color:"var(--muted)", marginTop:8, marginBottom:24 }}>
                {results.total} photo{results.total!==1?"s":""} imported and organised.
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:24 }}>
                {[[results.matched,"Faces matched"],[results.albums,"Albums"]].map(([n, l]) => (
                  <div key={l} style={{ background:"var(--parchment)", borderRadius:12, padding:"14px 8px", textAlign:"center" }}>
                    <div style={{ fontFamily:"Lora,serif", fontSize:24, fontWeight:700 }}>{n}</div>
                    <div style={{ fontSize:11, color:"var(--muted)" }}>{l}</div>
                  </div>
                ))}
              </div>
              <button className="primary-btn" onClick={onClose}>
                Explore Memories
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

// Constellations
function ConstellationMonth({ monthIdx, monthName, nodes, user, selectedIds, onPersonToggle, onuserTap }) {
  const W = 390, H = 560;

  const bgStars = Array.from({ length: 80 }, (_, i) => {
    const s = (x) => { const v = Math.sin(x) * 10000; return v - Math.floor(v); };
    return { x: s(i * 3.1) * W, y: s(i * 2.7 + 1) * H, r: s(i * 5.3 + 2) * 0.8 + 0.2, op: 0.5 + s(i * 7.0 + 3) * 0.5 };
  });

  const allPositions = getConstellationPositions(monthIdx, W, H);

  const userCX = allPositions.length > 0
    ? allPositions.reduce((s, p) => s + p.cx, 0) / allPositions.length
    : W / 2;
  const userCY = allPositions.length > 0
    ? allPositions.reduce((s, p) => s + p.cy, 0) / allPositions.length
    : H / 2;

  const personNodeR = 14;
  const emptyNodeR  = 4;

  return (
    <div style={{ width:"100%", position:"relative", background:"var(--space)", borderRadius:20, overflow:"hidden" }}>
      <div style={{ position:"absolute", top:14, left:16, fontSize:11, fontWeight:600, color:"rgba(255,255,255)", letterSpacing:1, textTransform:"uppercase", zIndex:5 }}>
        {monthName}
      </div>

      {nodes.length > 0 && (
        <div style={{ position:"absolute", top:14, right:16, fontSize:10, color:"rgba(255,255,255)", zIndex:5, fontWeight:500 }}>
          Tap to select
        </div>
      )}

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:"block" }}>
        {bgStars.map((s, i) => <circle key={`bg${i}`} cx={s.x} cy={s.y} r={s.r} fill={`rgba(255,255,255,${s.op})`} />)}

        {allPositions.length > 1 && allPositions.map((pos, i) => {
          const next = allPositions[(i + 1) % allPositions.length];
          return (
            <line key={`cl${i}`} x1={pos.cx} y1={pos.cy} x2={next.cx} y2={next.cy}
              stroke="rgba(139,124,248,1)" strokeWidth={0.8} strokeDasharray="3,6" />
          );
        })}

        {nodes.map((node, i) => {
          if (i >= allPositions.length) return null;
          const { cx, cy } = allPositions[i];
          return (
            <line key={`ol${i}`} x1={userCX} y1={userCY} x2={cx} y2={cy}
              stroke="white" strokeOpacity={0.2} strokeWidth={1} strokeDasharray="3,5" />
          );
        })}

        {nodes.map((nodeA, a) => nodes.slice(a + 1).map((nodeB, _b) => {
          const b = a + 1 + _b;
          if (!selectedIds.has(nodeA.id) || !selectedIds.has(nodeB.id)) return null;
          if (a >= allPositions.length || b >= allPositions.length) return null;
          return (
            <line key={`sel${a}-${b}`}
              x1={allPositions[a].cx} y1={allPositions[a].cy}
              x2={allPositions[b].cx} y2={allPositions[b].cy}
              stroke="rgba(201,168,76,.7)" strokeWidth={1.5} strokeDasharray="3,4" />
          );
        }))}

        {allPositions.map((pos, i) => {
          if (i < nodes.length) return null;
          return (
            <circle key={`empty${i}`} cx={pos.cx} cy={pos.cy} r={emptyNodeR}
              fill="white"/>
          );
        })}

        {nodes.map((node, i) => {
          if (i >= allPositions.length) return null;
          const { cx, cy } = allPositions[i];
          const hasProfile = !!node.profile_photo;
          const isSelected = selectedIds.has(node.id);

          return (
            <g key={node.id} onClick={() => onPersonToggle(node)} style={{ cursor:"pointer" }}>
              {isSelected && (
                <>
                  <circle cx={cx} cy={cy} r={personNodeR + 10} fill="rgba(201,168,76,.18)" />
                  <circle cx={cx} cy={cy} r={personNodeR + 6} fill="none" stroke="rgba(201,168,76,.85)" strokeWidth={2} strokeDasharray="4,3" />
                </>
              )}
              {!isSelected && <circle cx={cx} cy={cy} r={personNodeR + 6} fill="rgba(139,124,248,.08)" />}

              {hasProfile ? (
                <>
                  <circle cx={cx} cy={cy} r={personNodeR} fill="white" />
                  <image href={`${API}/static/profiles/${node.profile_photo}`}
                    x={cx - personNodeR} y={cy - personNodeR}
                    width={personNodeR * 2} height={personNodeR * 2}
                    style={{ clipPath:`circle(${personNodeR}px at ${personNodeR}px ${personNodeR}px)` }} />
                  <circle cx={cx} cy={cy} r={personNodeR} fill="none"
                    stroke={isSelected ? "#C9A84C" : (node.color||"#8b7cf8")} strokeWidth={isSelected ? 2.5 : 2} />
                </>
              ) : (
                <>
                  <circle cx={cx} cy={cy} r={personNodeR}
                    fill={isSelected ? "#C9A84C" : (node.color||"#8b7cf8")} opacity={0.9} />
                  <text x={cx} y={cy + 4} fontSize="10" textAnchor="middle" fill="white" fontWeight="700" pointerEvents="none">
                    {node.initials || "?"}
                  </text>
                </>
              )}
              <text x={cx} y={cy + personNodeR + 14} fontSize="8" textAnchor="middle"
                fill={isSelected ? "rgba(201,168,76,.95)" : "rgba(255,255,255)"}
                fontWeight={isSelected ? "700" : "400"}
                pointerEvents="none">{node.name}</text>
              {isSelected && (
                <text x={cx} y={cy - personNodeR - 5} fontSize="9" textAnchor="middle"
                  fill="#C9A84C" fontWeight="700" pointerEvents="none">✓</text>
              )}
            </g>
          );
        })}

        {user && (
          <g onClick={onuserTap} style={{ cursor:"pointer" }}>
            <circle cx={userCX} cy={userCY} r={30} fill="rgba(139,124,248,.10)" />
            <circle cx={userCX} cy={userCY} r={24} fill="rgba(139,124,248,.18)" />
            <circle cx={userCX} cy={userCY} r={18} fill="#261f3a" />
            {user.profile_photo && (
              <image 
                href={profileUrl(user.profile_photo)} 
                x={userCX - 16} 
                y={userCY - 16} 
                width={32} 
                height={32}
                style={{ clipPath: "circle(16px at 16px 16px)" }} 
              />
            )}
            <circle cx={userCX} cy={userCY} r={18} fill="none" stroke="rgba(139,124,248,.85)" strokeWidth={2} />
            <circle cx={userCX} cy={userCY} r={24} fill="none" stroke="rgba(139,124,248,.3)" strokeWidth={1} />
            <text x={userCX} y={userCY + 36} fontSize="8" textAnchor="middle"
              fill="rgba(139,124,248,.9)" fontWeight="600" pointerEvents="none">{user.name}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

// Shows photos shared between all selected people in the constellation
function SharedPhotosModal({ selectedNodes, people, onClose, onPhotoTap }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);

  // Stable string key so the dep array avoids a complex expression warning
  const selectedNodeIds = selectedNodes.map(n => n.id).join(",");

  useEffect(() => {
    if (selectedNodes.length === 0) { setLoading(false); return; }

    Promise.all(selectedNodes.map(n => apiFetch(`/photos?person_id=${n.id}&limit=200`)))
      .then(results => {
        if (results.length === 0) { setPhotos([]); return; }
        const idSets = results.map(list => new Set(list.map(p => p.id)));
        const sharedIds = [...idSets[0]].filter(id => idSets.every(s => s.has(id)));
        const sharedSet = new Set(sharedIds);
        const shared = results[0].filter(p => sharedSet.has(p.id));
        setPhotos(shared);
      })
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false));
  // selectedNodes is intentionally accessed inside via the stable selectedNodeIds key
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeIds]);

  const names = selectedNodes.map(n => n.name);
  const title = names.length === 1
    ? `${names[0]}'s Photos`
    : names.length === 2
      ? `${names[0]} & ${names[1]}`
      : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal slide-up" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <button className="modal-close" onClick={onClose}>✕</button>

        <div style={{ marginBottom:20 }}>
          <div className="modal-title" style={{ marginBottom:4 }}>{title}</div>
          <div style={{ fontSize:13, color:"var(--muted)" }}>
            {loading ? "Loading shared memories…" : `${photos.length} shared ${photos.length === 1 ? "memory" : "memories"}`}
          </div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:10 }}>
            {selectedNodes.map(n => (
              <span key={n.id} style={{ padding:"3px 10px", background:"rgba(201,168,76,.12)", border:"1px solid rgba(201,168,76,.35)", borderRadius:20, fontSize:12, color:"#C9A84C", fontWeight:600 }}>
                {n.name}
              </span>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign:"center", padding:"40px 0" }}><Loader /></div>
        ) : photos.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">📷</span>
            <div className="empty-state-title">No shared memories</div>
            <div className="empty-state-sub">
              {selectedNodes.length === 1
                ? `No photos found for ${selectedNodes[0].name} yet.`
                : "These people have not appeared together in any photos yet."}
            </div>
          </div>
        ) : (
          <div className="memories-grid">
            {photos.map(p => {
              const src = photoUrl(p.filename);
              const dateDisplay = p.formatted_date || p.taken_at || "";
              return (
                <div key={p.id} style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  <div className="memory-thumb" onClick={() => onPhotoTap(p)}
                    style={{ background:(p.color||"#87CEEB")+"30", border:`1.5px solid ${p.color||"#87CEEB"}25`, position:"relative" }}>
                    {src
                      ? <img src={src} alt={p.label} />
                      : <span>{p.emoji}</span>
                    }
                  </div>
                  {dateDisplay && (
                    <div style={{ fontSize:11, color:"var(--muted)", textAlign:"center" }}>{dateDisplay}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button className="primary-btn" onClick={onClose} style={{ marginTop:8 }}>Close</button>
      </div>
    </div>
  );
}

// Displays Universe and Collections
function HomeTab({ people, homeView, onRefresh, onPeopleUpdate }) {
  const [selectedPhoto, setPhoto]   = useState(null);
  const [selectedPerson, setPerson] = useState(null);
  const [selectedAlbum, setAlbum]   = useState(null);
  const [otd, setOtd]               = useState(null);
  const [albums, setAlbums]         = useState([]);
  const [albumCovers, setAlbumCovers] = useState({});
  const [constellationData, setConData] = useState(null);
  const [conLoading, setConLoading]     = useState(false);
  const [showuserModal, setShowuserModal] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState(new Set());
  const [showSharedPhotos, setShowSharedPhotos] = useState(false);

  const now = new Date();
  const currentMonthIdx = now.getMonth();
  const currentYear = now.getFullYear();
  const [availableYears, setAvailableYears] = useState([String(currentYear)]);
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [selectedMonthIdx, setMonthIdx] = useState(currentMonthIdx);

  const monthScrollRef = useRef(null);
  useEffect(() => {
    if (monthScrollRef.current) {
      const chips = monthScrollRef.current.querySelectorAll(".month-chip");
      chips[selectedMonthIdx]?.scrollIntoView({ behavior:"smooth", inline:"center", block:"nearest" });
    }
  }, [selectedMonthIdx]);

  useEffect(() => { setSelectedNodeIds(new Set()); }, [selectedMonthIdx, selectedYear, homeView]);

  const selectedYearRef = useRef(selectedYear);
  useEffect(() => { selectedYearRef.current = selectedYear; }, [selectedYear]);

  useEffect(() => {
    apiFetch("/on-this-day").then(setOtd).catch(() => {});
    apiFetch("/albums").then(async albs => {
      setAlbums(albs);
      const covers = {};
      await Promise.all(albs.map(async (a) => {
        try {
          const photos = await apiFetch(`/albums/${a.id}/photos`);
          if (photos.length > 0) {
            const pick = photos[Math.floor(Math.random() * photos.length)];
            if (pick.filename) covers[a.id] = photoUrl(pick.filename);
          }
        } catch {}
      }));
      setAlbumCovers(covers);
    }).catch(() => {});

    apiFetch("/photos/years")
      .then(data => {
        const years = data.years?.map(String) || [String(currentYear)];
        setAvailableYears(years);
    
        setSelectedYear(prev => {
          if (years.includes(prev)) return prev;
    
          return years.includes(String(currentYear))
            ? String(currentYear)
            : years[0];
        });
      })
      .catch(() => {});
  // eslint-disable-next-line
  }, [onRefresh]);

  useEffect(() => {
    if (homeView !== "universe") return;
    const monthName = MONTHS[selectedMonthIdx].name;
    setConLoading(true);
    setConData(null);
    apiFetch(`/constellation/${monthName}?year=${selectedYear}`)
      .then(setConData)
      .catch(() => setConData(null))
      .finally(() => setConLoading(false));
  }, [homeView, selectedMonthIdx, selectedYear, onRefresh]);

  const handlePersonToggle = (node) => {
    setSelectedNodeIds(prev => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  const MAX_DISPLAY = 12;
  const autoNodes = [...(constellationData?.nodes || [])]
    .sort((a, b) => (b.photo_count || 0) - (a.photo_count || 0))
    .slice(0, MAX_DISPLAY);

  const selectedNodes = autoNodes.filter(n => selectedNodeIds.has(n.id));

  const activeMonth = MONTHS[selectedMonthIdx];

  return (
    <>
      <div className="scroll-area">
        {homeView === "universe" ? (
          <div style={{ padding:"0 20px 20px" }}>
            <div className="universe-nav">
              <select
                className="year-select"
                value={selectedYear}
                onChange={e => setSelectedYear(e.target.value)}
              >
                {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <div className="month-chip-scroll" ref={monthScrollRef}>
                {MONTHS.map((m, i) => (
                  <button key={m.short} className={`month-chip ${i===selectedMonthIdx?"active":""}`} onClick={() => setMonthIdx(i)}>
                    <div className="chip-label">{m.short}</div>
                  </button>
                ))}
              </div>
            </div>

            {conLoading
              ? <div style={{ height:520, background:"var(--space)", borderRadius:20, display:"flex", alignItems:"center", justifyContent:"center" }}><Loader /></div>
              : <ConstellationMonth
                  monthIdx={selectedMonthIdx}
                  monthName={`${activeMonth.name} ${selectedYear}`}
                  nodes={autoNodes}
                  user={constellationData?.user || null}
                  selectedIds={selectedNodeIds}
                  onPersonToggle={handlePersonToggle}
                  onuserTap={() => {
                    if (constellationData?.user) setPerson(constellationData.user);
                    else setShowuserModal(true);
                  }}
                />
            }

            {selectedNodeIds.size > 0 && (
              <div style={{ marginTop:10, background:"var(--space2)", borderRadius:16, padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <div style={{ fontSize:12, color:"rgba(255,255,255)", fontWeight:500 }}>
                    {selectedNodeIds.size === 1 ? "1 person selected" : `${selectedNodeIds.size} people selected`}
                  </div>
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                    {selectedNodes.map(n => (
                      <span key={n.id} style={{ fontSize:12, color:"#C9A84C", fontWeight:600 }}>{n.name}</span>
                    )).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`sep${i}`} style={{ color:"rgba(255,255,255)", fontSize:12 }}>·</span>, el], [])}
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => setSelectedNodeIds(new Set())}
                    style={{ padding:"8px 12px", borderRadius:10, border:"1px solid rgba(255,255,255)", background:"transparent", color:"rgba(255,255,255)", fontSize:12, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}>
                    Clear
                  </button>
                  <button onClick={() => setShowSharedPhotos(true)}
                    style={{ padding:"8px 16px", borderRadius:10, border:"none", background:"#C9A84C", color:"#1a1525", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"DM Sans,sans-serif" }}>
                    Next →
                  </button>
                </div>
              </div>
            )}

            {constellationData?.total_photos === 0 && !conLoading && (
              <div style={{ textAlign:"center", marginTop:12, fontSize:13, color:"rgba(255,255,255,.35)", background:"transparent" }}>
                No photos uploaded for {activeMonth.name} {selectedYear}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* On This Day */}
            <div className="section-header">
              <div className="section-title">Today's Memory</div>
            </div>
            {otd ? (
              <div className="otd-card" onClick={() => setPhoto(otd)} style={{ background: photoUrl(otd.filename) ? "transparent" : "linear-gradient(135deg,#B5651D,#C9A84C)", overflow:"hidden", padding:0 }}>
                {photoUrl(otd.filename) && (
                  <img src={photoUrl(otd.filename)} alt={otd.label}
                    style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", borderRadius:"var(--radius)" }} />
                )}
                <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(0,0,0,.55) 0%, rgba(0,0,0,.0) 50%)", borderRadius:"var(--radius)", pointerEvents:"none" }} />
                <div style={{ position:"relative", padding:10, height:"100%", display:"flex", flexDirection:"column", justifyContent:"flex-end", minHeight:250 }}>
                  {!photoUrl(otd.filename) && <div className="otd-emoji">{otd.emoji}</div>}
                  <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                    {Array.isArray(otd.people) && otd.people.length > 0 && (
                      <div style={{ fontSize:12, color:"rgba(255,255,255,.85)", borderRadius:8, padding:"3px 0px", alignSelf:"flex-start" }}>
                        {otd.people.join(", ")}
                      </div>
                    )}
                    {otd.formatted_date && (
                      <div style={{ fontSize:15, color:"rgba(255,255,255,.9)", fontWeight:500, letterSpacing:".2px" }}>
                        {otd.formatted_date}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ margin:"0 20px 16px", padding:20, background:"var(--parchment)", borderRadius:"var(--radius)", textAlign:"center", color:"var(--muted)", fontSize:14 }}>
                Import photos to see your memories here.
              </div>
            )}

            {/* Albums */}
            <div className="section-header">
              <div className="section-title">Albums</div>
            </div>
            {albums.length === 0 ? (
              <div style={{ padding:"0 20px 24px", color:"var(--muted)", fontSize:14, textAlign:"center" }}>
                Albums will appear after importing photos.
              </div>
            ) : (
              <div className="album-grid">
                {albums.map(a => {
                  const coverSrc = albumCovers[a.id];
                  return (
                    <div key={a.id} className="album-card"
                      style={{ background: coverSrc ? "transparent" : a.color, padding:0 }}
                      onClick={() => setAlbum(a)}>
                      {coverSrc && <img src={coverSrc} alt={a.emoji} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", borderRadius:"var(--radius)" }} />}
                      <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(0,0,0,.3) 30%, rgba(0,0,0,.05))", borderRadius:"var(--radius)" }} />
                      {!coverSrc && <div className="album-emoji">{a.emoji}</div>}
                      <div style={{ position:"relative", padding:"0 14px 18px" }}>
                        <div className="album-name">{a.emoji} {a.scene}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {selectedPhoto  && <PhotoModal  photo={selectedPhoto}  people={people} onClose={() => setPhoto(null)} />}
      {selectedPerson && (
        <PersonModal
          person={selectedPerson}
          people={people}
          onClose={() => setPerson(null)}
          onUpdated={updated => { onPeopleUpdate?.(updated); setPerson(updated); }}
        />
      )}
      {selectedAlbum  && <AlbumModal  album={selectedAlbum}  people={people} onClose={() => setAlbum(null)} />}

      {showSharedPhotos && (
        <SharedPhotosModal
          selectedNodes={selectedNodes}
          people={people}
          onClose={() => setShowSharedPhotos(false)}
          onPhotoTap={p => { setShowSharedPhotos(false); setPhoto(p); }}
        />
      )}

      {showuserModal && (
        <div className="modal-overlay" onClick={() => setShowuserModal(false)}>
          <div className="modal slide-up" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <button className="modal-close" onClick={() => setShowuserModal(false)}>✕</button>
            <div className="modal-title">Your Profile</div>
            <div className="modal-sub">Upload a profile photo in Settings to set up your star.</div>
            <button className="primary-btn" onClick={() => setShowuserModal(false)}>Got it</button>
          </div>
        </div>
      )}
    </>
  );
}

// Shows all the people recognised in photos
function PeopleTab({ people, setPeople }) {
  const [selectedPerson, setPerson] = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [name, setName]             = useState("");
  const [relationship, setRel]      = useState("");
  const [saving, setSaving]         = useState(false);
  const [uploadingPhotoId, setUploadingPhotoId] = useState(null);
  const photoInputRef = useRef(null);
  const [pendingUploadPersonId, setPendingUploadPersonId] = useState(null);

  const handleAdd = async () => {
    if (!name.trim() || !relationship) return;
    setSaving(true);
    try {
      const person = await apiFetch("/people", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ name:name.trim(), relationship, avatar:"👤", color:COLORS[name.length % COLORS.length], initials:name[0].toUpperCase() }),
      });
      setPeople(prev => [...prev, { ...person, photoCount: person.photoCount || 0 }]);
      setShowAdd(false); setName(""); setRel("");
    } catch(e) {
      alert("Failed to add person: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePersonUpdated = (updated) => {
    setPeople(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
    if (selectedPerson && selectedPerson.id === updated.id) setPerson(updated);
  };

  const handlePhotoFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !pendingUploadPersonId) return;
    setUploadingPhotoId(pendingUploadPersonId);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(`/people/${pendingUploadPersonId}/profile-photo`, { method:"POST", body:form });
      if (res.person) handlePersonUpdated(res.person);
    } catch(err) {
      alert("Photo upload failed: " + err.message);
    } finally {
      setUploadingPhotoId(null);
      setPendingUploadPersonId(null);
      e.target.value = "";
    }
  };

  const regularPeople = people.filter(p => !p.is_user);

  return (
    <>
      <div className="section-header">
        <div className="section-title">Your People</div>
        <div className="section-link" onClick={() => setShowAdd(true)}>+ Add</div>
      </div>

      <input ref={photoInputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handlePhotoFileChange} />

      <div className="scroll-area">
        {regularPeople.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">👥</span>
            <div className="empty-state-title">No people yet</div>
            <div className="empty-state-sub">Import photos and Synapse will detect and learn the faces of your loved ones.</div>
          </div>
        ) : (
          <div className="people-grid">
            {regularPeople.map(p => {
              const src = profileUrl(p.profile_photo);
              const isUploading = uploadingPhotoId === p.id;
              const count = p.photoCount ?? p.photo_count ?? 0;
              const rel = p.relationship || "Other";
              return (
                <div key={p.id} className="person-card" onClick={() => setPerson(p)}>
                  <div style={{ position:"relative", display:"inline-block" }}>
                    <div className="person-avatar" style={{ background:(p.color||"#87CEEB")+"25" }}>
                      {isUploading
                        ? <Loader />
                        : src ? <img src={src} alt={p.name} /> : <span style={{ fontSize:40 }}>{p.avatar || "👤"}</span>
                      }
                      <div className="person-avatar-ring" style={{ borderColor:p.color||"#87CEEB" }} />
                    </div>
                  </div>
                  <div className="person-name">{p.name}</div>
                  <div className="person-rel">{rel}</div>
                  <div style={{ fontSize:12, color:"var(--muted)" }}>{count} {count === 1 ? "memory" : "memories"}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedPerson && (
        <PersonModal
          person={selectedPerson}
          people={people}
          onClose={() => setPerson(null)}
          onUpdated={handlePersonUpdated}
        />
      )}

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal slide-up" onClick={e => e.stopPropagation()}>
            <div className="modal-handle" />
            <button className="modal-close" onClick={() => setShowAdd(false)}>✕</button>
            <div className="modal-title">Add Person</div>
            <div className="form-field">
              <label className="form-label">Name</label>
              <input className="form-input" placeholder="e.g. Margaret" value={name} onChange={e => setName(e.target.value)} maxLength={30} />
            </div>
            <div className="form-field">
              <label className="form-label">Relationship</label>
              <div className="rel-picker">
                {RELATIONSHIPS.map(r => (
                  <div key={r} className={`rel-opt ${relationship===r?"selected":""}`} onClick={() => setRel(r)}>{r}</div>
                ))}
              </div>
            </div>
            <button className="primary-btn" onClick={handleAdd} disabled={!name.trim() || !relationship || saving}>
              {saving ? "Adding…" : `Add ${name.trim() || "Person"}`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Displays photos and videos in a slideshow format for the Videos Tab
function SlideshowPlayer({ photos, isPlaying, onToggle }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [pipProgress, setPipProgress] = useState(0);
  const intervalRef = useRef(null);
  const pipRef = useRef(null);
  const SLIDE_DURATION = 3000;

  useEffect(() => {
    if (!isPlaying || photos.length === 0) {
      clearInterval(intervalRef.current);
      clearInterval(pipRef.current);
      return;
    }
    setCurrentIdx(0);
    setPipProgress(0);

    const startTime = Date.now();
    pipRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) % SLIDE_DURATION;
      setPipProgress((elapsed / SLIDE_DURATION) * 100);
    }, 50);

    intervalRef.current = setInterval(() => {
      setCurrentIdx(i => (i + 1) % photos.length);
    }, SLIDE_DURATION);

    return () => {
      clearInterval(intervalRef.current);
      clearInterval(pipRef.current);
    };
  }, [isPlaying, photos.length]);

  if (photos.length === 0) return null;

  return (
    <>
      {isPlaying && (
        <div className="slideshow-progress">
          {photos.slice(0, 8).map((_, i) => (
            <div key={i} className="slideshow-pip">
              <div className="slideshow-pip-fill"
                style={{ width: i < currentIdx ? "100%" : i === currentIdx ? `${pipProgress}%` : "0%" }} />
            </div>
          ))}
        </div>
      )}
      {photos.map((p, i) => {
        const src = photoUrl(p.filename);
        return (
          <div key={p.id} className={`slideshow-frame ${i === currentIdx ? "active" : ""}`}>
            {src
              ? <img src={src} alt={p.label} className="video-bg-img" />
              : <div className="video-gradient" style={{ background: p.color || "#333" }} />
            }
          </div>
        );
      })}
    </>
  );
}

// Videos Tab
function VideosTab({ people }) {
  const [albums, setAlbums]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [playing, setPlaying]     = useState(null);
  const [albumPhotos, setAlbumPhotos] = useState({});
  const [reactions, setReactions] = useState({});
  const [comments, setComments]   = useState({});
  const [commentInput, setCommentInput] = useState("");
  const [activeComments, setActiveComments] = useState(null);
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const containerRef = useRef(null);

  const REACTION_EMOJIS = ["❤️","😂","😋","😮","🥺"];

  useEffect(() => {
    apiFetch("/albums")
      .then(async (albs) => {
        setAlbums(albs);
        const covers = {};
        await Promise.all(albs.map(async (a) => {
          try {
            const photos = await apiFetch(`/albums/${a.id}/photos`);
            covers[a.id] = photos;
          } catch { covers[a.id] = []; }
        }));
        setAlbumPhotos(covers);
      })
      .catch(() => setAlbums([]))
      .finally(() => setLoading(false));
  }, []);

  const toggleReaction = (albumId, emoji) => {
    setReactions(prev => {
      const cur = prev[albumId] || {};
      const isOn = !!cur[emoji];
      return { ...prev, [albumId]: { ...cur, [emoji]: !isOn } };
    });
  };

  const addComment = (albumId) => {
    if (!commentInput.trim()) return;
    setComments(prev => {
      const cur = prev[albumId] || [];
      return { ...prev, [albumId]: [...cur, { text: commentInput.trim(), ts: new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) }] };
    });
    setCommentInput("");
  };

  const startRecording = async (albumId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = e => chunks.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setComments(prev => {
          const cur = prev[albumId] || [];
          return { ...prev, [albumId]: [...cur, { voice: url, ts: new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) }] };
        });
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setMediaRecorder(mr);
      setRecording(true);
    } catch { alert("Microphone access denied."); }
  };

  const stopRecording = () => {
    mediaRecorder?.stop();
    setRecording(false);
    setMediaRecorder(null);
  };

  if (loading) {
    return <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}><Loader /></div>;
  }

  if (albums.length === 0) {
    return (
      <div className="empty-state" style={{ flex:1, display:"flex", flexDirection:"column", justifyContent:"center" }}>
        <span className="empty-state-icon">🎬</span>
        <div className="empty-state-title">No albums yet</div>
        <div className="empty-state-sub">Import photos and Synapse will automatically create albums.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="video-snap-container">
      {albums.map((album, idx) => {
        const photos = albumPhotos[album.id] || [];
        const isPlaying = playing === album.id;
        const albumReactions = reactions[album.id] || {};
        const albumComments = comments[album.id] || [];
        const showComments = activeComments === album.id;

        const bg = `linear-gradient(160deg, ${album.color}dd 0%, ${album.color}88 100%)`;
        const coverSrc = photos[0] ? photoUrl(photos[0].filename) : null;

        const firstPhotoDate = photos[0]?.formatted_date || photos[0]?.taken_at || "";

        return (
          <div key={album.id} className="video-snap-item" style={{ height:"100%" }}>
            {!isPlaying && (
              coverSrc
                ? <img src={coverSrc} alt={album.label} className="video-bg-img" />
                : <div className="video-gradient" style={{ background:bg }} />
            )}

            {isPlaying && photos.length > 0 && (
              <SlideshowPlayer
                photos={photos}
                isPlaying={isPlaying}
                onToggle={() => setPlaying(null)}
              />
            )}

            <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.28)", pointerEvents:"none" }} />

            <div className="video-counter">{idx+1} / {albums.length}</div>
            <div className="video-duration">{photos.length} photo{photos.length !== 1 ? "s" : ""}</div>

            <div className="video-play-overlay"
              onClick={() => setPlaying(isPlaying ? null : album.id)}
              style={{ cursor:"pointer" }}>
              {isPlaying
                ? (
                  <div style={{
                    width:70, height:70, borderRadius:"50%",
                    background:"rgba(0,0,0,0)", border:"none",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:32, color:"rgba(255,255,255,0)", transition:"all .25s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background="rgba(0,0,0,.35)"; e.currentTarget.style.color="rgba(255,255,255,1)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background="rgba(0,0,0,0)"; e.currentTarget.style.color="rgba(255,255,255,0)"; }}>
                    ⏸
                  </div>
                )
                : <div className="video-play-btn">▶</div>
              }
            </div>

            <div className="video-meta">
              {firstPhotoDate && (
                <div className="video-date">{firstPhotoDate}</div>
              )}
              <div className="video-title">{album.emoji} {album.label}</div>

              <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:5 }}>
                <div className="reactions-row">
                  {REACTION_EMOJIS.map(emoji => {
                    const isOn = !!albumReactions[emoji];
                    return (
                      <button
                        key={emoji}
                        className={`reaction-btn ${isOn ? "reacted" : ""}`}
                        onClick={() => toggleReaction(album.id, emoji)}
                      >
                        <span className="reaction-emoji">{emoji}</span>
                      </button>
                    );
                  })}
                  <button
                    className={`reaction-btn ${showComments ? "reacted" : ""}`}
                    onClick={() => setActiveComments(showComments ? null : album.id)}
                  >
                    <span className="reaction-emoji">💬</span>
                    {albumComments.length > 0 && <span style={{ fontSize:9, color:"rgba(255,255,255,.7)" }}>{albumComments.length}</span>}
                  </button>
                </div>
              </div>
            </div>

            {showComments && (
              <div style={{ position:"absolute", inset:0, zIndex:10, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}
                onClick={e => { if (e.target === e.currentTarget) setActiveComments(null); }}>
                <div style={{ background:"rgba(20,18,30,.92)", backdropFilter:"blur(16px)", borderRadius:"20px 20px 0 0", padding:"16px 16px 32px", maxHeight:"60%", display:"flex", flexDirection:"column" }}>
                  <div style={{ width:36, height:4, background:"rgba(255,255,255,.2)", borderRadius:2, margin:"0 auto 14px" }} />
                  <div style={{ fontSize:14, fontWeight:600, color:"white", marginBottom:12 }}>
                    💬 Comments {albumComments.length > 0 ? `(${albumComments.length})` : ""}
                  </div>
                  <div style={{ flex:1, overflowY:"auto", marginBottom:12, display:"flex", flexDirection:"column", gap:8 }}>
                    {albumComments.length === 0
                      ? <div style={{ color:"rgba(255,255,255,.4)", fontSize:13, textAlign:"center", padding:"16px 0" }}>Be the first to comment…</div>
                      : albumComments.map((c, i) => (
                          <div key={i} style={{ background:"rgba(255,255,255,.08)", borderRadius:10, padding:"8px 12px" }}>
                            {c.voice
                              ? <audio controls src={c.voice} style={{ width:"100%", height:32 }} />
                              : <div style={{ fontSize:13, color:"white" }}>{c.text}</div>
                            }
                            <div style={{ fontSize:10, color:"rgba(255,255,255,.4)", marginTop:4 }}>{c.ts}</div>
                          </div>
                        ))
                    }
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <input
                      value={commentInput}
                      onChange={e => setCommentInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addComment(album.id)}
                      placeholder="Add a comment…"
                      style={{ flex:1, background:"rgba(255,255,255,.1)", border:"1px solid rgba(255,255,255,.2)", borderRadius:10, padding:"10px 14px", color:"white", fontSize:13, outline:"none" }}
                    />
                    <button onClick={() => addComment(album.id)}
                      style={{ padding:"10px 14px", background:"var(--accent)", border:"none", borderRadius:10, color:"white", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                      Send
                    </button>
                    <button
                      onClick={() => recording ? stopRecording() : startRecording(album.id)}
                      style={{ padding:"10px 12px", background: recording ? "#e74c3c" : "rgba(255,255,255,.15)", border:"none", borderRadius:10, color:"white", fontSize:16, cursor:"pointer" }}>
                      {recording ? "⏹" : "🎙"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Settings
function Section({ title, children }) {
  return (
    <div className="settings-section">
      <div className="settings-section-title">{title}</div>
      <div className="settings-group">{children}</div>
    </div>
  );
}

function Row({ icon, label, value, toggle, onToggle, onClick }) {
  return (
    <div className="settings-row" onClick={onClick}>
      <div className="settings-row-left">
        <div className="settings-icon">{icon}</div>
        <span className="settings-label">{label}</span>
      </div>
      {toggle !== undefined
        ? <ToggleSwitch on={toggle} onToggle={onToggle} />
        : value
          ? <span className="settings-value">{value}</span>
          : <span className="settings-chevron">›</span>
      }
    </div>
  );
}

function SettingsTab({ people, onImportDone }) {
  const [userPhoto, setuserPhoto]   = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [showImport, setImport]       = useState(false);
  const [otdReminder, setOtd]         = useState(true);
  const [nightMode, setNight]         = useState(false);
  const profileInputRef               = useRef(null);

  useEffect(() => {
    apiFetch("/settings").then(s => {
      if (s.user_profile_photo) setuserPhoto(s.user_profile_photo);
    }).catch(() => {});
  }, []);

  const handleProfileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", "You");
      const res = await apiFetch("/settings/profile-photo", { method:"POST", body:form });
      setuserPhoto(res.profile_photo);
    } catch(err) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="scroll-area">
        <Section title="Your Profile">
          <div className="settings-row" style={{ flexDirection:"column", alignItems:"flex-start", gap:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, width:"100%" }}>
              {userPhoto && (
                <img src={profileUrl(userPhoto)} alt="Profile"
                  style={{ width:40, height:40, borderRadius:"50%", objectFit: "cover", objectPosition: "center", border:"2px solid var(--accent)" }} />
              )}
              <input ref={profileInputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleProfileUpload} />
              <button
                onClick={() => profileInputRef.current?.click()}
                style={{ padding:"6px 14px", background:"var(--parchment)", border:"none", borderRadius:10, fontSize:15, fontWeight:500, color:"var(--accent)", cursor:"pointer" }}>
                {uploading ? "Uploading…" : userPhoto ? "Change" : "Upload"}
              </button>
            </div>
          </div>

          {!userPhoto && (
            <div style={{ padding:"10px 18px 14px", fontSize:14, color:"var(--muted)", lineHeight:1.5 }}>
              Upload your photo to appear as the central star in your Universe.
            </div>
          )}
        </Section>

        <Section title="Imports">
          <Row icon="📷" label="Import from Camera Roll" onClick={() => setImport(true)} />
        </Section>

        <Section title="Reminders">
          <Row icon="📅" label="On This Day Reminder" toggle={otdReminder} onToggle={() => setOtd(v => !v)} />
          <Row icon="⏰" label="Reminder Time" value="9:00 AM" />
        </Section>

        <Section title="Display">
          <Row icon="🌒" label="Night Mode" toggle={nightMode} onToggle={() => setNight(v => !v)} />
        </Section>

        <Section title="About">
          <Row icon="ℹ️" label="Synapse" value="v0.1.0" />
          <Row icon="❤️" label="Help & Support" />
        </Section>
      </div>

      {showImport && (
        <ImportModal onClose={() => setImport(false)} onImportDone={() => { onImportDone?.(); }} />
      )}
    </>
  );
}

// Root App
export default function App() {
  const [tab, setTab]         = useState("home");
  const [homeView, setHomeView] = useState("universe");
  const [people, setPeople]   = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadPeople = useCallback(() => {
    apiFetch("/people")
      .then(list => setPeople(list.map(p => ({ ...p, photoCount: p.photoCount ?? p.photo_count ?? 0 }))))
      .catch(() => {});
  }, []);

  useEffect(() => { loadPeople(); }, [loadPeople, refreshKey]);

  const handleImportDone = () => {
    setRefreshKey(k => k + 1);
    loadPeople();
  };

  const handlePersonUpdate = (updated) => {
    setPeople(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
  };

const TABS = [
  { id: "home",   icon: homeIcon,   label: "Home" },
  { id: "people", icon: peopleIcon, label: "People" },
  { id: "videos", icon: videoIcon, label: "Videos" },
  { id: "settings", icon: settingsIcon, label: "Settings" }
];

  return (
    <>
      <div className="app">

        {/* Header */}
        <div className="header">
          <div className="header-logo">Synapse</div>

          {tab === "home" && (
            <div style={{ display:"flex", background:"#290130", borderRadius:14, padding:4, gap:4 }}>
              {["universe","collections"].map(v => (
                <button key={v} onClick={() => setHomeView(v)} style={{
                  padding:"8px 16px", borderRadius:10, border:"none",
                  background: homeView===v ? "#8b7cf8" : "transparent",
                  color: homeView===v ? "#fff" : "#fff",
                  fontSize:14, fontWeight:600, cursor:"pointer",
                }}>
                  {v === "universe" ? "🌌 Universe" : "🗂 Collections"}
                </button>
              ))}
            </div>
          )}

          {tab !== "home" && (
            <div style={{ fontSize:14, color:"var(--muted)", fontWeight:500 }}>
              {tab === "people" && `${people.filter(p => !p.is_user).length} people`}
              {tab === "settings" && "v0.1.0"}
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
          {tab === "home"     && (
            <HomeTab
              people={people}
              homeView={homeView}
              onRefresh={refreshKey}
              onPeopleUpdate={handlePersonUpdate}
            />
          )}
          {tab === "people"   && <PeopleTab   people={people} setPeople={setPeople} />}
          {tab === "videos"   && <VideosTab   people={people} />}
          {tab === "settings" && <SettingsTab people={people} onImportDone={handleImportDone} />}
        </div>

      {/* Bottom tabs */}
      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <img
              src={t.icon}
              alt={t.label}
              style={{
                width: t.id === "home" ? 26 : 28,
                height: t.id === "home" ? 26 : 28,
                objectFit: "contain"
              }}
            />
            <span>{t.label}</span>
            <div className="tab-dot" />
          </button>
        ))}
      </div>
         
      </div>
    </>
  );
}