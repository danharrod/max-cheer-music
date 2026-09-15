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

  const order = (store.orders || []).find((o) => o.id === orderId);
  if (!order) return res.status(404).end("Not found");
  if (!isAdmin && order.email !== user.email) return res.status(403).end("Forbidden");

  const file =
    (order.countSheet && order.countSheet.id === fileId && order.countSheet) ||
    (order.files || []).find((f) => f.id === fileId);
  if (!file) return res.status(404).end("File not found");

  if (file.url && file.url.startsWith("http")) {
    res.statusCode = 302;
    res.setHeader("Location", file.url);
    return res.end();
  }

  const kind = file.kind || (order.countSheet && order.countSheet.id === fileId ? "sheets" : "mixes");
  const data = readLocalFile(kind, file.file);
  if (!data) return res.status(404).end("File missing");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${file.name.replace(/"/g, "")}"`);
  res.end(data);
};
