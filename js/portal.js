const KEY = "max-portal";
let portalState = null;

function session() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

function isPreview() {
  return new URLSearchParams(location.search).has("preview");
}

function esc(value) {
  return String(value || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function blank(value) {
  const text = String(value || "").trim();
  return text ? esc(text) : "—";
}

function payMethodLabel(method) {
  if (method === "paypal") return "PayPal";
  if (method === "venmo") return "Venmo";
  if (method === "School PO") return "School PO";
  return String(method || "").trim() || "—";
}

function mixLine(order) {
  const items = (order.items || [])
    .map((i) => `${esc(i.title || i.name || "Mix")} ×${Number(i.qty) || 1}`)
    .join(", ");
  return items ? `${items} · $${Number(order.total || 0).toLocaleString("en-US")}` : "—";
}

function fact(label, value, wide) {
  return `<div class="order-fact${wide ? " is-wide" : ""}"><span class="order-fact-label">${esc(label)}</span><span class="order-fact-value">${value}</span></div>`;
}

function checkoutFacts(o) {
  const coach = [o.coachFirst, o.coachLast].filter((part) => String(part || "").trim()).join(" ");
  return `
    <div class="order-facts">
      ${fact("Gym or school", blank(o.gym))}
      ${fact("Coach", blank(coach))}
      ${fact("Email", blank(o.email))}
      ${fact("Requested date", blank(o.completionDate))}
      ${fact("Team name", blank(o.teamName))}
      ${fact("Team colors", blank(o.teamColors))}
      ${fact("Payment", esc(payMethodLabel(o.method)))}
      ${fact("PO number", blank(o.poNumber))}
      ${fact("Mix", mixLine(o), true)}
      ${fact("Voiceover ideas", blank(o.voiceover), true)}
    </div>`;
}

function statusLabel(status) {
  if (status === "ready") return "Completed";
  if (status === "review") return "Ready for review";
  if (status === "in-progress") return "In production";
  return "Ordered";
}

function statusClass(status) {
  if (status === "ready") return "ready";
  if (status === "review") return "review";
  if (status === "in-progress") return "in-progress";
  return "received";
}

function isPaid(order) {
  return order.paymentStatus === "paid";
}

function orderFingerprint(orders) {
  return (orders || [])
    .map((o) => `${o.id}:${o.status}:${o.paymentStatus || "unpaid"}:${(o.files || []).length}:${o.countSheet?.id || ""}`)
    .join("|");
}

function previewData() {
  return {
    auth: { email: "preview@maxcheermusic.com", token: "preview" },
    user: {
      email: "preview@maxcheermusic.com",
      coachFirst: "Jordan",
      coachLast: "Lee",
      gym: "MAX Athletics",
    },
    orders: [
      {
        id: "ord-preview-1",
        status: "ready",
        paymentStatus: "paid",
        total: 1100,
        email: "preview@maxcheermusic.com",
        method: "paypal",
        poNumber: "",
        teamName: "Senior Elite",
        gym: "MAX Athletics",
        coachFirst: "Jordan",
        coachLast: "Lee",
        completionDate: "2026-10-01",
        teamColors: "Black and chrome blue",
        items: [{ title: "Cheer mix allstar", qty: 1 }],
        voiceover: "Hit hard on the tumbling pass. Team name in the opening.",
        songs: ["Song one", "Song two", "Song three", "Song four", "Song five"],
        countSheet: { id: "sheet-preview", name: "senior-elite-counts.pdf" },
        createdAt: "2026-09-10T12:00:00.000Z",
        files: [{ id: "file-1", name: "senior-elite-mix.mp3" }],
      },
      {
        id: "ord-preview-2",
        status: "in-progress",
        paymentStatus: "unpaid",
        total: 750,
        email: "preview@maxcheermusic.com",
        method: "venmo",
        poNumber: "",
        teamName: "JV Gold",
        gym: "MAX Athletics",
        coachFirst: "Jordan",
        coachLast: "Lee",
        completionDate: "2026-10-15",
        teamColors: "Gold and white",
        items: [{ title: "Cheer mix school", qty: 1 }],
        voiceover: "School fight song in the last 8-counts.",
        songs: ["", "", "", "", ""],
        countSheet: null,
        createdAt: "2026-09-12T15:30:00.000Z",
        files: [],
      },
      {
        id: "ord-preview-3",
        status: "received",
        paymentStatus: "unpaid",
        total: 600,
        email: "preview@maxcheermusic.com",
        method: "School PO",
        poNumber: "PO-4412",
        teamName: "Novice White",
        gym: "MAX Athletics",
        coachFirst: "Jordan",
        coachLast: "Lee",
        completionDate: "2026-11-01",
        teamColors: "White",
        items: [{ title: "Cheer mix novice", qty: 1 }],
        voiceover: "",
        songs: ["", "", "", "", ""],
        countSheet: null,
        createdAt: "2026-09-14T10:00:00.000Z",
        files: [],
      },
    ],
  };
}

function downloadUrl(order, file, auth) {
  if (isPreview()) return "#preview-download";
  const q = new URLSearchParams({
    email: auth.email,
    token: auth.token,
    orderId: order.id,
    fileId: file.id,
  });
  return `/api/download?${q}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function songFields(order) {
  return `<div class="song-grid">${[0, 1, 2, 3, 4]
    .map((i) => {
      const value = esc((order.songs || [])[i] || "");
      return `<label class="song-field">Song ${i + 1}<input data-song="${order.id}" data-i="${i}" value="${value}" /></label>`;
    })
    .join("")}</div>`;
}

function render(data) {
  portalState = data;
  document.body.classList.add("portal-in");
  const app = document.getElementById("portal-app");
  const login = document.getElementById("portal-login");
  login.hidden = true;
  app.hidden = false;
  const u = data.user;
  const who = [u.coachFirst, u.coachLast].filter(Boolean).join(" ");
  app.innerHTML = `
    ${isPreview() ? `<p class="hint">Preview with sample data — not a real account.</p>` : ""}
    <p class="portal-toolbar">
      <span>${esc(who)}${who && u.email ? " · " : ""}${esc(u.email || "")}</span>
      <button class="btn btn-outline" type="button" id="portal-out">Log out</button>
    </p>
    ${(data.orders || [])
      .map(
        (o) => `
      <article class="product portal-order">
        <div class="portal-order-head">
          <h2>${esc(o.teamName || "Order")} · $${Number(o.total || 0).toLocaleString("en-US")}</h2>
          <div class="order-flags">
            <p class="order-status ${statusClass(o.status)}">${esc(statusLabel(o.status))}</p>
            <p class="order-pay ${isPaid(o) ? "is-paid" : "is-unpaid"}">${isPaid(o) ? "Paid" : "Not paid"}</p>
          </div>
        </div>
        ${checkoutFacts(o)}
        <div class="song-box portal-mix${(o.files || []).length ? " is-ready" : ""}">
          <p class="field-label">Finished mix</p>
          ${(o.files || []).length
            ? (o.files || [])
                .map((f) => `<p><a class="btn" href="${downloadUrl(o, f, data.auth)}">Download ${esc(f.name)}</a></p>`)
                .join("")
            : `<p class="hint">MAX will post the mix here when it is ready.</p>`}
        </div>
        <div class="song-box">
          <p class="field-label">Your 5 songs</p>
          <p class="hint">Type names from <a href="https://songsforcheer.com" target="_blank" rel="noreferrer">songsforcheer.com</a>.</p>
          ${songFields(o)}
          <p><button class="btn" type="button" data-save-songs="${o.id}">Save songs</button></p>
          <p class="hint" data-song-status="${o.id}"></p>
        </div>
        <div class="song-box">
          <p class="field-label">Count sheet PDF</p>
          <p class="hint">Fill and upload from <a href="sheets.html">8 Count Sheets</a>.</p>
          ${
            o.countSheet
              ? `<p><a class="btn btn-outline" href="${downloadUrl(o, o.countSheet, data.auth)}">Download ${esc(o.countSheet.name)}</a></p>`
              : `<p class="hint">No count sheet yet.</p>`
          }
          <input data-sheet="${o.id}" type="file" accept="application/pdf,.pdf" />
          <p class="hint" data-sheet-status="${o.id}"></p>
        </div>
      </article>`
      )
      .join("") || `<p class="hint">No orders on this account yet.</p>`}
  `;
}

async function api(body) {
  const auth = portalState?.auth || session();
  const res = await fetch("/api/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: auth.email, token: auth.token, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  data.auth = auth;
  return data;
}

async function login(email, password) {
  const res = await fetch("/api/portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Login failed");
  data.auth = { email, token: data.token };
  localStorage.setItem(KEY, JSON.stringify(data.auth));
  return data;
}

function readSongs(orderId) {
  return [...document.querySelectorAll(`[data-song="${orderId}"]`)]
    .sort((a, b) => Number(a.dataset.i) - Number(b.dataset.i))
    .map((input) => input.value.trim());
}

document.addEventListener("DOMContentLoaded", async () => {
  document.body.addEventListener("click", async (e) => {
    if (e.target.id === "portal-out") {
      localStorage.removeItem(KEY);
      if (isPreview()) location.href = "portal.html";
      else location.reload();
      return;
    }
    const save = e.target.closest("[data-save-songs]");
    if (!save) return;
    const orderId = save.dataset.saveSongs;
    const status = document.querySelector(`[data-song-status="${orderId}"]`);
    const songs = readSongs(orderId);
    try {
      if (isPreview()) {
        const order = portalState.orders.find((o) => o.id === orderId);
        if (order) order.songs = songs;
        status.textContent = "Songs saved in preview.";
        return;
      }
      status.textContent = "Saving…";
      render(await api({ action: "songs", orderId, songs }));
      const next = document.querySelector(`[data-song-status="${orderId}"]`);
      if (next) next.textContent = "Songs saved.";
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.body.addEventListener("change", async (e) => {
    const input = e.target.closest("[data-sheet]");
    if (!input || !input.files[0]) return;
    const file = input.files[0];
    const orderId = input.dataset.sheet;
    const status = document.querySelector(`[data-sheet-status="${orderId}"]`);
    if (!/\.pdf$/i.test(file.name)) {
      status.textContent = "Upload a PDF count sheet.";
      return;
    }
    try {
      if (isPreview()) {
        const order = portalState.orders.find((o) => o.id === orderId);
        if (order) order.countSheet = { id: `sheet-${Date.now()}`, name: file.name };
        render(portalState);
        const next = document.querySelector(`[data-sheet-status="${orderId}"]`);
        if (next) next.textContent = "Count sheet added in preview.";
        return;
      }
      status.textContent = "Uploading…";
      const data = await fileToBase64(file);
      render(await api({ action: "sheet", orderId, filename: file.name, data }));
      const next = document.querySelector(`[data-sheet-status="${orderId}"]`);
      if (next) next.textContent = "Count sheet uploaded.";
    } catch (err) {
      status.textContent = err.message;
    }
  });

  if (isPreview()) {
    render(previewData());
    return;
  }

  const form = document.getElementById("portal-login");
  const status = document.getElementById("portal-status");
  const requestForm = document.getElementById("portal-reset-request");
  const resetForm = document.getElementById("portal-reset");
  const params = new URLSearchParams(location.search);
  const resetToken = params.get("reset");

  function showLogin() {
    form.hidden = false;
    if (requestForm) requestForm.hidden = true;
    if (resetForm) resetForm.hidden = true;
  }

  document.getElementById("portal-forgot")?.addEventListener("click", () => {
    form.hidden = true;
    if (resetForm) resetForm.hidden = true;
    if (requestForm) {
      requestForm.hidden = false;
      requestForm.email?.focus();
    }
  });
  document.getElementById("portal-reset-back")?.addEventListener("click", showLogin);

  requestForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = document.getElementById("reset-request-status");
    note.textContent = "Sending…";
    try {
      const res = await fetch("/api/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request-reset", email: requestForm.email.value }),
      });
      const data = await res.json().catch(() => ({}));
      note.textContent = data.message || "If that email has a portal account, we sent a reset link.";
    } catch {
      note.textContent = "Could not send a reset link. Try again, or create access at checkout.";
    }
  });

  if (resetToken && resetForm) {
    form.hidden = true;
    if (requestForm) requestForm.hidden = true;
    resetForm.hidden = false;
    resetForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const note = document.getElementById("reset-status");
      note.textContent = "Updating…";
      try {
        const res = await fetch("/api/portal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reset-password",
            resetToken,
            password: resetForm.password.value,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not update password.");
        note.textContent = data.message || "Password updated.";
        history.replaceState({}, "", "portal.html");
        showLogin();
        status.textContent = "Password updated. Log in with your new password.";
      } catch (err) {
        note.textContent = err.message;
      }
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      render(await login(form.email.value, form.password.value));
    } catch (err) {
      status.textContent = err.message;
    }
  });

  const auth = session();
  if (auth) {
    try {
      portalState = { auth };
      render(await api({ action: "me" }));
    } catch {
      localStorage.removeItem(KEY);
      portalState = null;
    }
  }

  async function refreshPortal() {
    if (isPreview() || !portalState?.auth) return;
    if (document.activeElement?.matches?.("[data-song], [data-sheet], textarea, input")) return;
    try {
      const data = await api({ action: "me" });
      if (orderFingerprint(portalState.orders) === orderFingerprint(data.orders)) return;
      render(data);
    } catch {}
  }
  setInterval(refreshPortal, 8000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshPortal();
  });
});
