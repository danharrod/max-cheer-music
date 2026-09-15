const { getStore, publicCatalog } = require("../lib/store");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const store = await getStore();
  res.status(200).json(publicCatalog(store));
};
