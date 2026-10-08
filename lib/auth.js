const crypto = require("crypto");

const TOKEN_HOURS = 12;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 8;
const attempts = new Map();

function adminPassword() {
  return process.env.ADMIN_PASSWORD || (process.env.VERCEL ? "" : "maxmusic");
}

function customerSecret() {
  return process.env.ADMIN_PASSWORD || "maxmusic-secret";
}

function clientIp(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || String(req.socket?.remoteAddress || "local");
}

function loginGate(ip) {
  const rec = attempts.get(ip);
  if (!rec) return { ok: true };
  if (Date.now() - rec.start > LOGIN_WINDOW_MS) {
    attempts.delete(ip);
    return { ok: true };
  }
  if (rec.n >= LOGIN_MAX) {
    return { ok: false, retryAfter: Math.ceil((LOGIN_WINDOW_MS - (Date.now() - rec.start)) / 1000) };
  }
  return { ok: true };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.start > LOGIN_WINDOW_MS) {
    attempts.set(ip, { n: 1, start: now });
    return;
  }
  rec.n += 1;
}

function clearLoginFailures(ip) {
  attempts.delete(ip);
}

function passwordsMatch(provided, expected) {
  const left = crypto.createHash("sha256").update(String(provided || "")).digest();
  const right = crypto.createHash("sha256").update(String(expected || "")).digest();
  return crypto.timingSafeEqual(left, right);
}

function sign(payload, key) {
  return crypto.createHmac("sha256", key).update(payload).digest("hex");
}

function makeToken() {
  const password = adminPassword();
  if (!password) return "";
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_HOURS * 60 * 60 * 1000 })).toString("base64url");
  return `${payload}.${sign(payload, password)}`;
}

function validToken(token) {
  const password = adminPassword();
  const raw = String(token || "");
  if (!password || !raw) return false;
  const parts = raw.split(".");
  if (parts.length === 2) {
    const [payload, sig] = parts;
    const expected = sign(payload, password);
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    } catch {
      return false;
    }
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return Number(data.exp) > Date.now();
    } catch {
      return false;
    }
  }
  const legacy = crypto.createHmac("sha256", password).update("max-cheer-music-admin").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(raw), Buffer.from(legacy));
  } catch {
    return false;
  }
}

function makeDownloadTicket({ orderId, fileId }) {
  const password = adminPassword();
  if (!password) return "";
  const payload = Buffer.from(
    JSON.stringify({ orderId, fileId, exp: Date.now() + 10 * 60 * 1000 })
  ).toString("base64url");
  return `${payload}.${sign(payload, password)}`;
}

function readDownloadTicket(ticket) {
  const password = adminPassword();
  const raw = String(ticket || "");
  const parts = raw.split(".");
  if (!password || parts.length !== 2) return null;
  const [payload, sig] = parts;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload, password)))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Number(data.exp) <= Date.now()) return null;
    return { orderId: String(data.orderId || ""), fileId: String(data.fileId || "") };
  } catch {
    return null;
  }
}

module.exports = {
  adminPassword,
  customerSecret,
  clientIp,
  loginGate,
  recordLoginFailure,
  clearLoginFailures,
  passwordsMatch,
  makeToken,
  validToken,
  makeDownloadTicket,
  readDownloadTicket,
};
