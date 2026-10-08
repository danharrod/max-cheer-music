const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { adminPassword, customerSecret, makeToken, validToken } = require("./auth");
const { normalizeOrder } = require("./orders");

function storeFile() {
  if (process.env.MAX_STORE_FILE) return process.env.MAX_STORE_FILE;
  return process.env.VERCEL
    ? path.join("/tmp", "max-store.json")
    : path.join(process.cwd(), "data", "store.json");
}

function useBlob() {
  return !process.env.MAX_TEST_STORE && !!process.env.BLOB_READ_WRITE_TOKEN;
}
const SEED = path.join(process.cwd(), "data", "store.json");
const SAMPLE_DIR = process.env.VERCEL
  ? path.join("/tmp", "samples")
  : path.join(process.cwd(), "assets", "samples");
const MIX_DIR = process.env.VERCEL
  ? path.join("/tmp", "mixes")
  : path.join(process.cwd(), "assets", "mixes");
const SHEET_DIR = process.env.VERCEL
  ? path.join("/tmp", "sheets")
  : path.join(process.cwd(), "assets", "sheets");

function dirFor(kind) {
  if (kind === "mixes") return MIX_DIR;
  if (kind === "sheets") return SHEET_DIR;
  return SAMPLE_DIR;
}

function seed() {
  try {
    const data = JSON.parse(fs.readFileSync(SEED, "utf8"));
    data.users = data.users || [];
    data.orders = data.orders || [];
    return data;
  } catch {
    return {
      settings: { paypalMe: "danharrod12", venmo: "daniel-harrod-3", email: "maxcheermusic@gmail.com" },
      products: [],
      users: [],
      orders: [],
    };
  }
}

function secret() {
  return customerSecret();
}

async function readBlobStore() {
  if (!useBlob()) return null;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const { list } = require("@vercel/blob");
  const { blobs } = await list({ prefix: "max-store.json", limit: 10, token });
  const blob = (blobs || []).find((b) => b.pathname === "max-store.json" || b.pathname.endsWith("/max-store.json"));
  if (!blob) return null;
  const file = await fetch(blob.url);
  if (!file.ok) return null;
  return file.json();
}

async function writeBlobStore(store) {
  if (!useBlob()) return false;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;
  const { put } = require("@vercel/blob");
  await put("max-store.json", JSON.stringify(store), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
  return true;
}

function readFileStore() {
  try {
    const file = storeFile();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      data.users = data.users || [];
      data.orders = data.orders || [];
      return data;
    }
  } catch {}
  return seed();
}

function writeFileStore(store) {
  const file = storeFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
}

function inferSampleKind(url, kind) {
  if (String(kind || "").toLowerCase() === "video") return "video";
  if (/\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(String(url || ""))) return "video";
  return "audio";
}

function clipFrom(raw, fallbackName = "") {
  const url = String(raw?.url || "").trim();
  if (!url) return null;
  const published = raw.published !== false;
  const sort = Number.isFinite(Number(raw.sort)) ? Number(raw.sort) : Date.now();
  return {
    id: String(raw.id || `s-${url}`).trim(),
    name: String(raw.name || fallbackName || "").trim(),
    url,
    kind: inferSampleKind(url, raw.kind),
    published,
    sort,
    createdAt: Number(raw.createdAt) || Date.now(),
  };
}

function originalSampleStem(url) {
  const base = decodeURIComponent(String(url || "").split("/").pop() || "");
  return base.replace(/^\d+-/, "").replace(/\.[^.]+$/, "").toLowerCase() || base.toLowerCase();
}

function normalizeProductSamples(product) {
  const clips = [];
  const seenUrl = new Set();
  const add = (raw) => {
    const clip = clipFrom(raw, product.sampleName || product.name || "");
    if (!clip || seenUrl.has(clip.url)) return;
    seenUrl.add(clip.url);
    clips.push(clip);
  };
  (Array.isArray(product.samples) ? product.samples : []).forEach(add);
  if (product.sampleUrl) add({ id: `s-legacy-${product.id}`, name: product.sampleName, url: product.sampleUrl, kind: product.sampleKind });
  const unique = [];
  const seenFile = new Set();
  for (let i = clips.length - 1; i >= 0; i -= 1) {
    const key = `${clips[i].kind}:${originalSampleStem(clips[i].url)}`;
    if (seenFile.has(key)) continue;
    seenFile.add(key);
    unique.unshift(clips[i]);
  }
  product.samples = unique;
  const audio = unique.find((s) => s.kind !== "video");
  const video = unique.find((s) => s.kind === "video");
  const last = unique[unique.length - 1];
  if (last) {
    product.sampleUrl = audio ? audio.url : last.url;
    product.sampleKind = video && !audio ? "video" : last.kind;
  }
  return product;
}

function hydrateSampleUrls(store) {
  (store.products || []).forEach(normalizeProductSamples);
  return store;
}

function preserveSampleFields(next, previous) {
  const prevById = new Map((previous?.products || []).map((p) => [p.id, p]));
  for (const product of next.products || []) {
    const prev = prevById.get(product.id);
    if (!prev) continue;
    if (Array.isArray(prev.samples) && prev.samples.length) {
      const have = new Set((product.samples || []).map((s) => s.url));
      product.samples = [...(product.samples || [])];
      for (const clip of prev.samples) {
        if (clip?.url && !have.has(clip.url)) product.samples.unshift(clip);
      }
    }
    if (!product.sampleUrl && prev.sampleUrl) product.sampleUrl = prev.sampleUrl;
    if (!product.sampleName && prev.sampleName) product.sampleName = prev.sampleName;
    if (!product.sampleKind && prev.sampleKind) product.sampleKind = prev.sampleKind;
    normalizeProductSamples(product);
  }
  return next;
}

function migrateClipsFromProducts(store) {
  store.clips = [];
  const seen = new Set();
  const add = (raw, fallback) => {
    const clip = clipFrom(raw, fallback);
    if (!clip || seen.has(clip.url)) return;
    seen.add(clip.url);
    store.clips.push({ ...clip, createdAt: Date.now() });
  };
  for (const product of store.products || []) {
    (product.samples || []).forEach((sample) => add(sample, product.sampleName || product.name));
    if (product.sampleUrl) {
      add({ url: product.sampleUrl, name: product.sampleName, kind: product.sampleKind }, product.name);
    }
  }
  return store;
}

function preserveClips(next, previous) {
  if (Array.isArray(next.clips)) return next;
  next.clips = Array.isArray(previous?.clips) ? previous.clips : [];
  return next;
}

async function getStore() {
  let fromBlob = null;
  try {
    fromBlob = await readBlobStore();
  } catch (err) {
    console.error("blob read failed", err);
    if (process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN && !process.env.MAX_TEST_STORE) throw err;
  }
  const store = fromBlob || readFileStore();
  store.users = store.users || [];
  store.orders = (store.orders || []).map(normalizeOrder);
  store.revision = Number(store.revision) || 0;
  hydrateSampleUrls(store);
  if (!Array.isArray(store.clips)) migrateClipsFromProducts(store);
  store.clips = (store.clips || []).map((c, i) => clipFrom(c, "") || { ...c, sort: i }).filter((c) => c.url);
  return store;
}

async function saveStore(store, opts = {}) {
  let existing = null;
  try {
    existing = await readBlobStore();
  } catch (err) {
    console.error("blob read before save failed", err);
    if (process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN && !process.env.MAX_TEST_STORE) return false;
  }
  if (existing) preserveClips(store, existing);
  else if (!Array.isArray(store.clips)) store.clips = [];
  if (existing && opts.mergeSamples !== false) preserveSampleFields(store, existing);
  hydrateSampleUrls(store);
  store.revision = Number(store.revision || existing?.revision || 0) + 1;
  store.updatedAt = new Date().toISOString();
  const blobOk = await writeBlobStore(store).catch((err) => {
    console.error("blob save failed", err);
    return false;
  });
  if (!process.env.VERCEL) writeFileStore(store);
  else if (!blobOk) writeFileStore(store);
  return blobOk || !process.env.VERCEL;
}

function publicCatalog(store) {
  return {
    settings: {
      paypalMe: store.settings?.paypalMe || "",
      venmo: store.settings?.venmo || "",
      email: store.settings?.email || "maxcheermusic@gmail.com",
    },
    products: (store.products || []).filter((p) => p.active !== false),
    clips: (store.clips || [])
      .filter((c) => c.published !== false && c.url)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map((c) => ({
        id: c.id,
        name: c.name || "",
        url: c.url,
        kind: inferSampleKind(c.url, c.kind),
      })),
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function customerToken(email, passwordHash) {
  return crypto.createHmac("sha256", secret()).update(`${email.toLowerCase()}:${passwordHash}`).digest("hex");
}

function validCustomer(store, email, token) {
  const user = (store.users || []).find((u) => u.email === String(email || "").toLowerCase());
  if (!user || !token) return null;
  const expected = customerToken(user.email, user.passwordHash);
  try {
    if (crypto.timingSafeEqual(Buffer.from(String(token)), Buffer.from(expected))) return user;
  } catch {}
  return null;
}

function publicUser(user) {
  return {
    email: user.email,
    coachFirst: user.coachFirst || "",
    coachLast: user.coachLast || "",
    gym: user.gym || "",
  };
}

function publicOrder(order) {
  return {
    id: order.id,
    status: order.status || "received",
    method: order.method,
    total: order.total,
    items: order.items || [],
    gym: order.gym,
    coachFirst: order.coachFirst,
    coachLast: order.coachLast,
    email: order.email,
    completionDate: order.completionDate,
    teamName: order.teamName,
    teamColors: order.teamColors,
    voiceover: order.voiceover,
    poNumber: order.poNumber || "",
    songs: Array.isArray(order.songs) ? order.songs.map((s) => String(s || "").trim()) : [],
    countSheet: order.countSheet
      ? { id: order.countSheet.id, name: order.countSheet.name }
      : null,
    createdAt: order.createdAt,
    files: (order.files || []).map((f) => ({ id: f.id, name: f.name })),
  };
}

const UPLOAD_RULES = {
  samples: { ext: /\.(mp3|wav|m4a|aac|ogg|mp4|mov|webm|m4v)$/i, max: 80 * 1024 * 1024 },
  clips: { ext: /\.(mp3|wav|m4a|aac|ogg|mp4|mov|webm|m4v)$/i, max: 80 * 1024 * 1024 },
  mixes: { ext: /\.(mp3|wav|m4a|zip)$/i, max: 80 * 1024 * 1024 },
  sheets: { ext: /\.pdf$/i, max: 12 * 1024 * 1024 },
};

function validateUpload(filename, buffer, kind = "samples") {
  const rules = UPLOAD_RULES[kind] || UPLOAD_RULES.samples;
  const name = String(filename || "");
  if (!rules.ext.test(name)) {
    const err = new Error("That file type is not allowed.");
    err.status = 400;
    throw err;
  }
  if (!buffer || !buffer.length) {
    const err = new Error("Missing file");
    err.status = 400;
    throw err;
  }
  if (buffer.length > rules.max) {
    const err = new Error("File is too large.");
    err.status = 400;
    throw err;
  }
}

async function saveUpload(filename, buffer, kind = "samples") {
  validateUpload(filename, buffer, kind);
  const safe = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  const token = useBlob() ? process.env.BLOB_READ_WRITE_TOKEN : "";
  if (token) {
    const { put } = require("@vercel/blob");
    const blob = await put(`${kind}/${safe}`, buffer, {
      access: "public",
      addRandomSuffix: false,
      token,
    });
    return { url: blob.url, path: blob.url, name: filename };
  }
  if (process.env.VERCEL) throw new Error("Upload failed");
  const dir = dirFor(kind);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, safe);
  fs.writeFileSync(dest, buffer);
  return { url: `/assets/${kind}/${safe}`, path: dest, name: filename, file: safe };
}

function readLocalFile(kind, file) {
  const dir = dirFor(kind);
  const full = path.join(dir, path.basename(file));
  if (!full.startsWith(dir) || !fs.existsSync(full)) return null;
  return fs.readFileSync(full);
}

module.exports = {
  getStore,
  saveStore,
  publicCatalog,
  adminPassword,
  makeToken,
  validToken,
  saveUpload,
  validateUpload,
  hashPassword,
  customerToken,
  validCustomer,
  publicUser,
  publicOrder,
  readLocalFile,
  MIX_DIR,
  SAMPLE_DIR,
  SHEET_DIR,
};
