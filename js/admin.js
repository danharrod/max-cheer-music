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

function renderProducts() {
  const el = document.querySelector('[data-panel="products"]');
  el.innerHTML = state.products
    .map(
      (p, i) => `
    <article class="product admin-card">
      <label>Name</label>
      <input data-p="${i}" data-k="name" value="${p.name || ""}" />
      <label>Shop title</label>
      <input data-p="${i}" data-k="title" value="${p.title || ""}" />
      <label>Price</label>
      <input data-p="${i}" data-k="price" type="number" value="${p.price || 0}" />
      <label>Description</label>
      <textarea data-p="${i}" data-k="description">${p.description || ""}</textarea>
      <label>Sample audio</label>
      ${p.sampleUrl ? `<audio controls src="${p.sampleUrl}"></audio>` : `<p class="hint">No sample yet</p>`}
      <input data-sample="${i}" type="file" accept="audio/*" />
    </article>`
    )
    .join("") + `<p><button class="btn" type="button" id="save-products">Save products</button></p>`;
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
      <select data-status="${o.id}">
        <option ${o.status === "received" ? "selected" : ""}>received</option>
        <option ${o.status === "in-progress" ? "selected" : ""}>in-progress</option>
        <option ${o.status === "ready" ? "selected" : ""}>ready</option>
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

function bindFields() {
  document.querySelectorAll("[data-p]").forEach((input) => {
    input.addEventListener("input", () => {
      const i = Number(input.dataset.p);
      const k = input.dataset.k;
      state.products[i][k] = k === "price" ? Number(input.value) : input.value;
    });
  });
  document.querySelectorAll("[data-sample]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      const data = await fileToBase64(file);
      const saved = await api({ action: "upload", filename: file.name, data, kind: "samples" });
      state.products[Number(input.dataset.sample)].sampleUrl = saved.url;
      setStatus("Sample uploaded. Click Save products.");
      renderProducts();
      bindFields();
    });
  });
  document.getElementById("save-products")?.addEventListener("click", saveAll);
}

async function saveAll() {
  setStatus("Saving…");
  const data = await api({
    action: "save",
    store: { settings: state.settings, products: state.products },
  });
  state = data;
  setStatus("Saved.");
  renderProducts();
  renderOrders();
  renderSettings();
  bindFields();
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
  bindFields();
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
    const attach = e.target.closest("[data-attach]");
    if (attach && attach.files[0]) {
      const file = attach.files[0];
      const data = await fileToBase64(file);
      await api({ action: "attach", orderId: attach.dataset.attach, filename: file.name, data });
      await loadApp();
      setStatus("Mix uploaded. Customer can download it in the portal.");
    }
    const status = e.target.closest("[data-status]");
    if (status) {
      await api({ action: "status", orderId: status.dataset.status, status: status.value });
      setStatus("Order status updated.");
    }
  });

  document.body.addEventListener("click", async (e) => {
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
