const http = require("http");
const fs = require("fs");
const path = require("path");
const catalog = require("./api/catalog");
const admin = require("./api/admin");
const order = require("./api/order");
const portal = require("./api/portal");
const download = require("./api/download");
const contact = require("./api/contact");

const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".zip": "application/zip",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function wrap(handler, req, res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(data));
  };
  return handler(req, res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/catalog") return wrap(catalog, req, res);
  if (url.pathname === "/api/admin") return wrap(admin, req, res);
  if (url.pathname === "/api/order") return wrap(order, req, res);
  if (url.pathname === "/api/portal") return wrap(portal, req, res);
  if (url.pathname === "/api/download") return wrap(download, req, res);
  if (url.pathname === "/api/contact") return wrap(contact, req, res);

  let filePath = decodeURIComponent(url.pathname);
  if (filePath === "/") filePath = "/index.html";
  const full = path.normalize(path.join(ROOT, filePath));
  if (!full.startsWith(ROOT)) return send(res, 403, "Forbidden");
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, "Not found");
    send(res, 200, data, { "Content-Type": TYPES[path.extname(full)] || "application/octet-stream" });
  });
});

server.listen(PORT, () => {
  console.log(`MAX Cheer Music running at http://127.0.0.1:${PORT}`);
  console.log("Admin: http://127.0.0.1:" + PORT + "/admin.html  (password: maxmusic)");
});
