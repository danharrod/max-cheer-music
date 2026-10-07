const TOKEN_KEY = "max-admin-token";
let state = { settings: {}, products: [], orders: [] };

function token() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

async function api(body) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token(), ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadSampleToBlob(file, productId) {
  const tokenRes = await api({
    action: "sample-token",
    productId,
    filename: file.name,
  });
  const params = new URLSearchParams({ pathname: tokenRes.pathname });
  const headers = {
    authorization: `Bearer ${tokenRes.clientToken}`,
    "x-api-version": "12",
  };
  if (tokenRes.storeId) headers["x-vercel-blob-store-id"] = tokenRes.storeId;
  if (file.type) headers["content-type"] = file.type;
  const putRes = await fetch(`https://vercel.com/api/blob/?${params}`, {
    method: "PUT",
    headers,
    body: file,
  });
  const putData = await putRes.json().catch(() => ({}));
  if (!putRes.ok || !putData.url) {
    throw new Error(putData.error?.message || putData.error || "Upload failed");
  }
  return putData.url;
}

async function saveSample(productId, { url, sampleName } = {}) {
  const payload = { action: "sample-save", productId };
  if (url) payload.url = url;
  if (sampleName != null) payload.sampleName = sampleName;
  const data = await api(payload);
  state = data;
  if (!url) return;
  renderProducts();
  renderOrders();
  renderSettings();
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function productById(id) {
  return state.products.find((p) => p.id === id);
}

function renderProducts() {
  const el = document.querySelector('[data-panel="products"]');
  el.innerHTML =
    `<p><button class="btn" type="button" data-save-products>Save products</button></p>` +
    state.products
      .map(
        (p) => `
    <article class="product admin-card" data-product="${esc(p.id)}">
      <h2>${esc(p.name || p.id)}</h2>
      <label>Name</label>
      <input data-id="${esc(p.id)}" data-k="name" value="${esc(p.name)}" autocomplete="off" />
      <label>Shop title</label>
      <input data-id="${esc(p.id)}" data-k="title" value="${esc(p.title)}" autocomplete="off" />
      <label>Price</label>
      <input data-id="${esc(p.id)}" data-k="price" type="number" min="0" step="1" value="${Number(p.price) || 0}" />
      <label>Description</label>
      <textarea data-id="${esc(p.id)}" data-k="description">${esc(p.description)}</textarea>
      <label>Sample name</label>
      <input data-id="${esc(p.id)}" data-k="sampleName" value="${esc(p.sampleName || "")}" placeholder="Name that shows on the Samples page" autocomplete="off" />
      <label>Sample audio</label>
      ${p.sampleUrl ? `<audio controls src="${esc(p.sampleUrl)}"></audio>` : `<p class="hint">No sample yet</p>`}
      <p class="hint">Pick an audio file. It goes live on Samples as soon as it finishes.</p>
      <input data-sample="${esc(p.id)}" type="file" accept="audio/*" />
    </article>`
      )
      .join("") +
    `<p><button class="btn" type="button" data-save-products>Save products</button></p>`;
}

function renderOrders() {
  const el = document.querySelector('[data-panel="orders"]');
  if (!state.orders.length) {
    el.innerHTML = `<p class="hint">No orders yet.</p>`;
    return;
  }
  el.innerHTML = state.orders
    .map(
      (o) => `
    <article class="product admin-card">
      <h2>${o.teamName || o.gym} · $${Number(o.total || 0).toLocaleString("en-US")}</h2>
      <p class="hint">${o.status} · ${o.email} · ${o.method || ""}${o.poNumber ? ` · PO ${o.poNumber}` : ""} · ${o.createdAt || ""}</p>
      <p>${o.gym} · Coach ${o.coachFirst || ""} ${o.coachLast || ""}</p>
      <p>Due ${o.completionDate || ""} · Colors ${o.teamColors || ""}</p>
      <p>${(o.items || []).map((i) => `${i.title} x${i.qty}`).join(", ")}</p>
      <p>${o.voiceover || ""}</p>
      <p class="field-label">Songs</p>
      <p>${(o.songs || []).filter(Boolean).map((s, i) => `${i + 1}. ${s}`).join("<br>") || "Not entered yet"}</p>
      <p class="field-label">Count sheet</p>
      <p>${
        o.countSheet
          ? `<a href="/api/download?admin=${token()}&orderId=${o.id}&fileId=${o.countSheet.id}">${o.countSheet.name}</a>`
          : "Not uploaded yet"
      }</p>
      <p>${(o.files || []).map((f) => f.name).join(", ") || "No mix uploaded"}</p>
      <label>Status</label>
      <p class="hint">This status shows in the customer portal as soon as you change it.</p>
      <select data-status="${esc(o.id)}">
        <option value="received" ${o.status === "received" ? "selected" : ""}>Order received</option>
        <option value="in-progress" ${o.status === "in-progress" ? "selected" : ""}>Mix in progress</option>
        <option value="ready" ${o.status === "ready" ? "selected" : ""}>Ready to download</option>
      </select>
      <label>Upload finished mix</label>
      <input data-attach="${o.id}" type="file" accept="audio/*,.zip,.mp3,.wav,.m4a" />
    </article>`
    )
    .join("");
}

function renderSettings() {
  const s = state.settings || {};
  document.querySelector('[data-panel="settings"]').innerHTML = `
    <article class="product admin-card">
      <label>PayPal.me username</label>
      <input id="set-paypal" value="${s.paypalMe || ""}" />
      <label>Venmo username</label>
      <input id="set-venmo" value="${s.venmo || ""}" />
      <p><button class="btn" type="button" id="save-settings">Save settings</button></p>
    </article>`;
}

async function saveAll() {
  setStatus("Saving…");
  try {
    const data = await api({
      action: "save",
      store: { settings: state.settings, products: state.products },
    });
    state = data;
    setStatus("Saved.");
    renderProducts();
    renderOrders();
    renderSettings();
  } catch (err) {
    setStatus(err.message);
  }
}

function setStatus(msg) {
  const el = document.getElementById("admin-status");
  if (el) el.textContent = msg;
}

async function loadApp() {
  const data = await api({ action: "load" });
  state = data;
  document.getElementById("login-card").hidden = true;
  document.getElementById("admin-app").hidden = false;
  renderProducts();
  renderOrders();
  renderSettings();
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("login-card").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("login-status");
    status.textContent = "Signing in…";
    try {
      const data = await api({ action: "login", password: document.getElementById("admin-pass").value, token: "" });
      localStorage.setItem(TOKEN_KEY, data.token);
      await loadApp();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById("admin-logout")?.addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-tab]").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("btn-outline", !on);
        b.classList.toggle("is-on", on);
      });
      document.querySelectorAll("[data-panel]").forEach((p) => {
        p.hidden = p.dataset.panel !== btn.dataset.tab;
      });
    });
  });

  document.body.addEventListener("change", async (e) => {
    const sample = e.target.closest("[data-sample]");
    if (sample && sample.files[0]) {
      const file = sample.files[0];
      const product = productById(sample.dataset.sample);
      if (!product) return;
      setStatus("Uploading sample…");
      try {
        let url;
        try {
          url = await uploadSampleToBlob(file, product.id);
        } catch {
          if (file.size > 3.2 * 1024 * 1024) {
            throw new Error("That file is too large. Use a shorter clip (under 3 MB) or an MP3.");
          }
          const data = await fileToBase64(file);
          const saved = await api({ action: "upload", filename: file.name, data, kind: "samples" });
          url = saved.url;
        }
        await saveSample(product.id, { url, sampleName: product.sampleName || "" });
        setStatus("Sample is live on the Samples page.");
      } catch (err) {
        setStatus(err.message || "Could not upload the sample.");
      }
      return;
    }
    const attach = e.target.closest("[data-attach]");
    if (attach && attach.files[0]) {
      const file = attach.files[0];
      const data = await fileToBase64(file);
      await api({ action: "attach", orderId: attach.dataset.attach, filename: file.name, data });
      await loadApp();
      setStatus("Mix uploaded. Customer can download it in the portal.");
      return;
    }
    const status = e.target.closest("[data-status]");
    if (status) {
      try {
        await api({ action: "status", orderId: status.dataset.status, status: status.value });
        const order = state.orders.find((o) => o.id === status.dataset.status);
        if (order) order.status = status.value;
        renderOrders();
        setStatus("Order status updated. It now shows in the customer portal.");
      } catch (err) {
        setStatus(err.message);
      }
    }
  });

  let sampleNameTimer;
  document.body.addEventListener("input", (e) => {
    const input = e.target.closest("[data-id][data-k]");
    if (!input) return;
    const product = productById(input.dataset.id);
    if (!product) return;
    product[input.dataset.k] = input.dataset.k === "price" ? Number(input.value) : input.value;
    if (input.dataset.k !== "sampleName") return;
    clearTimeout(sampleNameTimer);
    sampleNameTimer = setTimeout(async () => {
      try {
        await saveSample(product.id, { sampleName: product.sampleName || "" });
        setStatus("Sample name saved. It shows on the Samples page.");
      } catch (err) {
        setStatus(err.message || "Could not save the sample name.");
      }
    }, 400);
  });

  document.body.addEventListener("click", async (e) => {
    if (e.target.closest("[data-save-products]")) {
      e.preventDefault();
      await saveAll();
      return;
    }
    if (e.target.id === "save-settings") {
      state.settings.paypalMe = document.getElementById("set-paypal").value;
      state.settings.venmo = document.getElementById("set-venmo").value;
      await saveAll();
    }
  });

  if (token()) {
    try {
      await loadApp();
    } catch {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
});
