const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

process.env.VERCEL = "1";

const { getStore, saveStore } = require("../lib/store");

const DEFAULTS = {
  school: { name: "School team", title: "School Mix", price: 750 },
  novice: { name: "Allstar novice", title: "Novice Mix", price: 600 },
  prep: { name: "Allstar prep", title: "Prep Mix", price: 700 },
  allstar: { name: "Allstar", title: "Allstar Mix", price: 1100 },
};

(async () => {
  const store = await getStore();
  store.products = (store.products || []).map((p) => {
    const next = DEFAULTS[p.id];
    if (!next) return p;
    return { ...p, ...next, sampleUrl: p.sampleUrl || "", active: p.active !== false };
  });
  const ok = await saveStore(store);
  if (!ok) {
    console.error("Could not save catalog");
    process.exit(1);
  }
  console.log(
    store.products.map((p) => `${p.id} $${p.price} ${p.title}`).join("\n")
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
