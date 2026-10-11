const { getStore, validToken, validCustomer, readLocalFile } = require("../lib/store");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).end("Method not allowed");
  const url = new URL(req.url, `http://${req.headers.host}`);
  const email = String(url.searchParams.get("email") || "").toLowerCase();
  const token = url.searchParams.get("token") || "";
  const adminKey = url.searchParams.get("admin") || "";
  const orderId = url.searchParams.get("orderId") || "";
  const fileId = url.searchParams.get("fileId") || "";

  const store = await getStore();
  const isAdmin = validToken(adminKey);
  const user = validCustomer(store, email, token);
  if (!isAdmin && !user) return res.status(401).end("Unauthorized");

  if (url.searchParams.get("w9") === "1") {
    const w9 = store.settings?.w9;
    if (!w9?.name) return res.status(404).end("W-9 not found");
    return sendFile(res, w9, "docs", "inline");
  }

  const order = (store.orders || []).find((o) => o.id === orderId);
  if (!order) return res.status(404).end("Not found");
  if (!isAdmin && order.email !== user.email) return res.status(403).end("Forbidden");

  const file =
    (order.countSheet && order.countSheet.id === fileId && order.countSheet) ||
    (order.files || []).find((f) => f.id === fileId);
  if (!file) return res.status(404).end("File not found");

  const kind = file.kind || (order.countSheet && order.countSheet.id === fileId ? "sheets" : "mixes");
  return sendFile(res, file, kind);
};

function sendFile(res, file, kind, disposition) {
  if (file.url && String(file.url).startsWith("http")) {
    res.statusCode = 302;
    res.setHeader("Location", file.url);
    return res.end();
  }
  const data = readLocalFile(kind, file.file);
  if (!data) return res.status(404).end("File missing");
  const name = String(file.name || "download").replace(/"/g, "");
  const pdf = /\.pdf$/i.test(name);
  res.setHeader("Content-Type", pdf ? "application/pdf" : "application/octet-stream");
  res.setHeader("Content-Disposition", `${disposition === "inline" ? "inline" : "attachment"}; filename="${name}"`);
  res.end(data);
}
