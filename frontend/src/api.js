const API = "https://44444hearts-synapse.hf.space";

// Core fetch helpers
async function get(url) {
  const res = await fetch(`${API}${url}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post(url, body, isForm = false) {
  const res = await fetch(`${API}${url}`, {
    method: "POST",
    body: isForm ? body : JSON.stringify(body),
    headers: isForm ? undefined : { "Content-Type": "application/json" },
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function del(url) {
  const res = await fetch(`${API}${url}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// People
export const createPerson = (data) => post("/people", data);
export const getPeople = () => get("/people");
export const deletePerson = (id) => del(`/people/${id}`);

export const enrollFace = (personId, file) => {
  const form = new FormData();
  form.append("file", file);
  return post(`/people/${personId}/enroll`, form, true);
};

// Photos
export const analyzePhoto = (file, takenAt, monthLabel) => {
  const form = new FormData();
  form.append("file", file);
  if (takenAt) form.append("taken_at", takenAt);
  if (monthLabel) form.append("month_label", monthLabel);

  return post("/photos/analyze", form, true);
};

export const batchAnalyze = (files) => {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  return post("/photos/batch-analyze", form, true);
};

export const getPhotos = (personId) =>
  get(personId ? `/photos?person_id=${personId}` : "/photos");

export const getPhoto = (id) => get(`/photos/${id}`);

export const rescorePhoto = (id) => post(`/photos/${id}/rescore`);

// Albums
export const clusterAlbums = () => post("/albums/cluster");
export const getAlbums = () => get("/albums");
export const getAlbumPhotos = (id) => get(`/albums/${id}/photos`);

// Constellation
export const getConstellation = (month) =>
  get(`/constellation/${month}`);

// On This Day
export const getOnThisDay = () => get("/on-this-day");

// Health
export const health = () => get("/health");