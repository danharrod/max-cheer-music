const TOKEN_KEY = "max-admin-token";
let state = { settings: {}, products: [], orders: [], clips: [] };

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

function applyState(data) {
  state = data;
  state.clips = Array.isArray(data.clips) ? data.clips : [];
  renderProducts();
  renderClips();
  renderOrders();
  renderSettings();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function sampleFilename(file, kind) {
  let name = String(file?.name || (kind === "video" ? "sample.mp4" : "sample.mp3"));
  if (kind === "video" && !/\.(mp4|mov|webm|m4v|avi)$/i.test(name)) {
    name += String(file?.type || "").includes("quicktime") ? ".mov" : ".mp4";
  }
  if (kind === "audio" && !/\.(mp3|wav|m4a|aac|ogg)$/i.test(name)) name += ".mp3";
  return name;
}

function sampleKindFromFile(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  if (type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/.test(name)) return "video";
  return "audio";
}

function putBlobXHR(url, headers, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([key, value]) => {
      if (value) xhr.setRequestHeader(key, value);
    });
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {}
      const message = data.error?.message || data.error || data.message;
      if (xhr.status >= 200 && xhr.status < 300 && data.url) {
        resolve(data.url);
        return;
      }
      reject(new Error(typeof message === "string" && message ? message : "Upload failed"));
    };
    xhr.onerror = () => reject(new Error("Could not reach storage. Try an MP4 or MP3, or a smaller file."));
    xhr.send(file);
  });
}

async function uploadToBlob(file, action, filename) {
  const tokenRes = await api({
    action,
    filename: filename || file.name,
  });
  const params = new URLSearchParams({ pathname: tokenRes.pathname });
  const type = file.type || "application/octet-stream";
  const headers = {
    authorization: `Bearer ${tokenRes.clientToken}`,
    "x-api-version": "12",
    "x-vercel-blob-access": "public",
    "x-content-type": type,
  };
  if (tokenRes.storeId) headers["x-vercel-blob-store-id"] = tokenRes.storeId;
  if (file.size) headers["x-content-length"] = String(file.size);
  return putBlobXHR(`https://vercel.com/api/blob/?${params}`, headers, file, (loaded, total) => {
    setStatus(`Uploading… ${Math.round((loaded / total) * 100)}%`);
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function productById(id) {
  return state.products.find((p) => p.id === id);
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

const orderUi = { tab: "active", query: "", sort: "due", openId: "" };

const PRODUCTION_OPTIONS = [
  { value: "received", label: "Ordered" },
  { value: "in-progress", label: "In production" },
  { value: "review", label: "Ready for review" },
  { value: "ready", label: "Completed" },
];

function productionLabel(status) {
  return PRODUCTION_OPTIONS.find((option) => option.value === status)?.label || "Ordered";
}

function productionClass(status) {
  if (status === "ready" || status === "review" || status === "in-progress") return status;
  return "received";
}

function customerName(order) {
  return [order.coachFirst, order.coachLast].filter((part) => String(part || "").trim()).join(" ");
}

function packageName(order) {
  if (String(order.packageLabel || "").trim()) return order.packageLabel;
  const items = (order.items || []).map((item) => item.title || item.name).filter(Boolean);
  return items.join(", ");
}

function formatWhen(value, dateOnly) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = dateOnly || !text.includes("T") ? new Date(`${text.slice(0, 10)}T00:00:00`) : new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function dueFlag(order) {
  if (order.status === "ready" || !order.completionDate) return "";
  const due = new Date(`${order.completionDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 7);
  if (due < today) return "overdue";
  if (due <= soon) return "soon";
  return "";
}

function paymentLabel(order) {
  if (order.paymentStatus === "paid") return "Paid";
  if (order.paymentStatus === "school-po" || order.method === "School PO") return "School PO";
  return "Not paid";
}

function paymentClass(order) {
  return order.paymentStatus === "paid" ? "is-paid" : "is-unpaid";
}

function fact(label, value, wide) {
  return `<div class="order-fact${wide ? " is-wide" : ""}"><span class="order-fact-label">${esc(label)}</span><span class="order-fact-value">${value}</span></div>`;
}

function fileHref(orderId, fileId) {
  return `/api/download?admin=${encodeURIComponent(token())}&orderId=${encodeURIComponent(orderId)}&fileId=${encodeURIComponent(fileId)}`;
}

function isAudioName(name) {
  return /\.(mp3|wav|m4a|aac|ogg|mpeg)$/i.test(name || "");
}

function ordersInTab(tab) {
  return state.orders.filter((order) => {
    if (tab === "completed") return order.status === "ready";
    if (tab === "active") return order.status !== "ready";
    return true;
  });
}

function orderMatches(order, query) {
  if (!query) return true;
  const haystack = [order.id, order.gym, order.teamName, customerName(order), order.coachFirst, order.coachLast]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function sortOrders(list) {
  const rank = { received: 0, "in-progress": 1, review: 2, ready: 3 };
  return [...list].sort((a, b) => {
    if (orderUi.sort === "gym") return String(a.gym || "").localeCompare(String(b.gym || ""), undefined, { sensitivity: "base" });
    if (orderUi.sort === "status") return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(a.gym || "").localeCompare(String(b.gym || ""));
    if (orderUi.sort === "created") return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    return String(a.completionDate || "9999-99-99").localeCompare(String(b.completionDate || "9999-99-99"));
  });
}

function visibleOrders() {
  const query = orderUi.query.trim().toLowerCase();
  return sortOrders(ordersInTab(orderUi.tab).filter((order) => orderMatches(order, query)));
}

function youtubeIdFromUrl(raw) {
  const value = String(raw || "").trim();
  const match = value.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
  return match ? match[1] : "";
}

function isYoutubeClip(clip) {
  return clip.kind === "youtube" || !!youtubeIdFromUrl(clip.url);
}

function isVideoClip(clip) {
  if (isYoutubeClip(clip)) return false;
  return clip.kind === "video" || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(clip.url || "");
}

function renderProducts() {
  const el = document.querySelector('[data-panel="products"]');
  el.innerHTML =
    `<p class="hint">Name is the internal mix. Shop title is what customers see. Sample uploads are on the Samples tab.</p>` +
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
    </article>`
      )
      .join("") +
    `<p><button class="btn" type="button" data-save-products>Save products</button></p>`;
}

function renderClips() {
  const el = document.querySelector('[data-panel="samples"]');
  if (!el) return;
  const clips = [...(state.clips || [])].sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const list = clips.length
    ? `<div class="admin-sample-list">${clips
        .map((s) => {
          const youtube = isYoutubeClip(s);
          const video = isVideoClip(s);
          const yt = s.youtubeId || youtubeIdFromUrl(s.url);
          const preview = youtube
            ? `<iframe class="admin-sample-video" src="https://www.youtube-nocookie.com/embed/${esc(yt)}" title="${esc(s.name || "YouTube sample")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
            : video
              ? `<video class="admin-sample-video" controls playsinline src="${esc(s.url)}"></video>`
              : `<audio controls src="${esc(s.url)}"></audio>`;
          return `
        <div class="admin-sample-row">
          <p><strong>${esc(s.name || "Untitled sample")}</strong> · ${youtube ? "YouTube" : video ? "Video" : "Audio"}</p>
          ${preview}
          <p><button class="btn btn-outline" type="button" data-clip-delete="${esc(encodeURIComponent(s.id))}">Remove</button></p>
        </div>`;
        })
        .join("")}</div>`
    : `<p class="hint">No samples yet. Add a name and a music file, video file, or YouTube link below.</p>`;
  el.innerHTML = `
    <article class="product admin-card">
      <h2>Add a sample</h2>
      <p class="hint">Uploading or removing saves immediately. Add a music file, a video file, or a YouTube link. They show in this order on the Samples page.</p>
      <label for="clip-name">Sample name</label>
      <input id="clip-name" autocomplete="off" placeholder="e.g. Warhawks" />
      <label for="clip-file">Music or video file</label>
      <input id="clip-file" type="file" accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.mp4,.mov,.m4v,.webm" />
      <label for="clip-youtube">Or YouTube link</label>
      <input id="clip-youtube" type="text" inputmode="url" autocomplete="off" placeholder="https://www.youtube.com/watch?v=…" />
      <p><button class="btn" type="button" id="clip-add">Add sample</button></p>
    </article>
    ${list}`;
}

function statusSelect(order) {
  return `<select data-status="${esc(order.id)}" aria-label="Production status">
    ${PRODUCTION_OPTIONS.map(
      (option) => `<option value="${option.value}" ${order.status === option.value ? "selected" : ""}>${option.label}</option>`
    ).join("")}
  </select>`;
}

function orderRow(order) {
  const due = dueFlag(order);
  const dueText = due === "overdue" ? "Overdue" : due === "soon" ? "Due within 7 days" : "";
  const when = formatWhen(order.completionDate, true);
  return `
    <button class="order-row${due ? ` is-${due}` : ""}" type="button" data-open-order="${esc(order.id)}">
      <span class="order-cell" data-label="Order"><span class="order-id">${esc(order.id)}</span></span>
      <span class="order-cell" data-label="Gym"><strong>${blank(order.gym)}</strong></span>
      <span class="order-cell" data-label="Team">${blank(order.teamName)}</span>
      <span class="order-cell" data-label="Package">${blank(packageName(order))}</span>
      <span class="order-cell" data-label="Competition date">${when ? esc(when) : "—"}${dueText ? `<span class="order-due">${dueText}</span>` : ""}</span>
      <span class="order-cell" data-label="Production"><span class="order-status ${productionClass(order.status)}">${esc(productionLabel(order.status))}</span></span>
      <span class="order-cell" data-label="Payment"><span class="order-pay ${paymentClass(order)}">${esc(paymentLabel(order))}</span></span>
    </button>`;
}

function orderListHtml() {
  const counts = {
    active: ordersInTab("active").length,
    completed: ordersInTab("completed").length,
    all: state.orders.length,
  };
  const tabs = [
    ["active", "Active orders"],
    ["completed", "Completed orders"],
    ["all", "All orders"],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" class="btn ${orderUi.tab === id ? "is-on" : "btn-outline"}" data-order-tab="${id}">${label} (${counts[id]})</button>`
    )
    .join("");
  const rows = visibleOrders();
  const body = !state.orders.length
    ? `<p class="hint">No orders yet.</p>`
    : !rows.length
      ? `<p class="hint">No orders match that search.</p>`
      : `<div class="order-table">
          <div class="order-row-head">
            <span>Order</span><span>Gym</span><span>Team</span><span>Package</span><span>Competition date</span><span>Production</span><span>Payment</span>
          </div>
          ${rows.map(orderRow).join("")}
        </div>`;
  return `
    <div class="order-desk">
      <div class="order-desk-tabs">${tabs}</div>
      <div class="order-desk-tools">
        <input class="order-search" id="order-search" type="search" placeholder="Search gym, team, customer, or order number" value="${esc(orderUi.query)}" />
        <select class="order-sort" id="order-sort" aria-label="Sort orders">
          <option value="due" ${orderUi.sort === "due" ? "selected" : ""}>Competition date</option>
          <option value="created" ${orderUi.sort === "created" ? "selected" : ""}>Order date</option>
          <option value="gym" ${orderUi.sort === "gym" ? "selected" : ""}>Gym name</option>
          <option value="status" ${orderUi.sort === "status" ? "selected" : ""}>Production status</option>
        </select>
      </div>
      <p class="hint">Unfinished orders due within 7 days are marked. Overdue orders are marked in red. Active orders is the list to work from.</p>
      ${body}
    </div>`;
}

function fileBlock(order, file, label) {
  const href = fileHref(order.id, file.id);
  const audio = isAudioName(file.name) ? `<audio controls src="${esc(href)}"></audio>` : "";
  return `<div class="order-file"><p class="order-fact-label">${esc(label)}</p><p><a href="${esc(href)}">${esc(file.name)}</a></p>${audio}</div>`;
}

function orderDetailHtml(order) {
  const songs = (order.songs || []).map((song) => String(song || "").trim()).filter(Boolean);
  const songHtml = songs.length ? `<ol class="order-songs">${songs.map((song) => `<li>${esc(song)}</li>`).join("")}</ol>` : "—";
  const files = [...(order.files || [])].reverse();
  const fileHtml = files.length
    ? files.map((file) => fileBlock(order, file, "Finished mix")).join("")
    : `<p class="hint">No mix uploaded yet.</p>`;
  const sheetHtml = order.countSheet
    ? fileBlock(order, order.countSheet, "Count sheet")
    : `<p class="hint">No count sheet uploaded yet.</p>`;
  const payments = (order.payments || [])
    .map((payment) => `<li>${esc(payMethodLabel(payment.method))} · $${Number(payment.amount || 0).toLocaleString("en-US")}${payment.reference ? ` · ${esc(payment.reference)}` : ""}${payment.date ? ` · ${esc(payment.date)}` : ""}</li>`)
    .join("");
  const activity = (order.activity || [])
    .map((entry) => `<li>${esc(formatWhen(entry.at) || "")} · ${esc(entry.detail || entry.action || "")}</li>`)
    .join("");
  return `
    <article class="order-detail">
      <div class="order-detail-head">
        <div>
          <button class="btn btn-outline" type="button" data-order-back>Back to orders</button>
          <h2>${esc(order.teamName || order.gym || "Order")}</h2>
          <p class="hint">${esc(order.id)}</p>
        </div>
        <p class="order-flags">
          <span class="order-status ${productionClass(order.status)}">${esc(productionLabel(order.status))}</span>
          <span class="order-pay ${paymentClass(order)}">${esc(paymentLabel(order))}</span>
        </p>
      </div>
      <section class="order-section">
        <h3>Customer information</h3>
        <div class="order-facts">
          ${fact("Gym or school name", blank(order.gym))}
          ${fact("Customer name", blank(customerName(order)))}
          ${fact("Email", blank(order.email))}
          ${fact("Team name", blank(order.teamName))}
        </div>
      </section>
      <section class="order-section">
        <h3>Music order information</h3>
        <div class="order-facts">
          ${fact("Package ordered", blank(packageName(order)), true)}
          ${fact("Competition date", blank(formatWhen(order.completionDate, true)))}
          ${fact("Requested completion date", blank(order.completionDate))}
          ${fact("Team colors", blank(order.teamColors))}
          ${fact("Voiceover ideas", blank(order.voiceover), true)}
          ${fact("Song choices", songHtml, true)}
          ${fact("Payment method", esc(payMethodLabel(order.method)))}
          ${fact("PO number", blank(order.poNumber))}
          ${fact("Total", `$${Number(order.total || 0).toLocaleString("en-US")}`)}
        </div>
      </section>
      <section class="order-section">
        <h3>Files</h3>
        ${sheetHtml}
        ${fileHtml}
        <label for="mix-${esc(order.id)}">Upload or replace finished mix</label>
        <p class="hint">Uploading adds the file to this order and marks production Completed. Earlier files stay attached. The newest mix shows in the customer portal.</p>
        <input id="mix-${esc(order.id)}" data-attach="${esc(order.id)}" type="file" accept="audio/*,.zip,.mp3,.wav,.m4a,.mpeg" />
      </section>
      <section class="order-section">
        <h3>Order management</h3>
        <div class="order-facts">
          <div class="order-fact"><span class="order-fact-label">Production status</span>${statusSelect(order)}<p class="hint">Ordered, In production, Ready for review, and Completed show on the customer portal as soon as you change them. Completed orders move to the Completed tab.</p></div>
          <div class="order-fact"><span class="order-fact-label">Payment status</span>
            <select data-payment="${esc(order.id)}" aria-label="Payment status">
              <option value="unpaid" ${order.paymentStatus === "paid" ? "" : "selected"}>Not paid</option>
              <option value="paid" ${order.paymentStatus === "paid" ? "selected" : ""}>Paid</option>
            </select>
            <p class="hint">Payment stays separate from production. Paid or Not paid shows on the customer portal.</p>
          </div>
          ${fact("Order date", blank(formatWhen(order.createdAt)))}
        </div>
        ${payments ? `<p class="order-fact-label">Recorded payments</p><ul class="order-payments">${payments}</ul>` : ""}
        <label for="notes-${esc(order.id)}">Order notes</label>
        <textarea id="notes-${esc(order.id)}" data-notes="${esc(order.id)}">${esc(order.notes || "")}</textarea>
        ${activity ? `<details class="order-activity"><summary>Activity</summary><ul>${activity}</ul></details>` : ""}
      </section>
    </article>`;
}

function renderOrders() {
  const el = document.querySelector('[data-panel="orders"]');
  if (!el) return;
  const previous = document.activeElement;
  const focusId = previous && el.contains(previous) ? previous.id : "";
  const caret = previous && typeof previous.selectionStart === "number" ? previous.selectionStart : null;
  const open = orderUi.openId ? state.orders.find((order) => order.id === orderUi.openId) : null;
  if (orderUi.openId && !open) orderUi.openId = "";
  if (open && open.status === "ready" && orderUi.tab === "active") orderUi.tab = "completed";
  el.innerHTML = open ? orderDetailHtml(open) : orderListHtml();
  if (!focusId) return;
  const next = document.getElementById(focusId);
  if (!next) return;
  next.focus();
  if (caret != null && next.setSelectionRange) {
    try {
      next.setSelectionRange(caret, caret);
    } catch {}
  }
}

function renderSettings() {
  const s = state.settings || {};
  document.querySelector('[data-panel="settings"]').innerHTML = `
    <article class="product admin-card">
      <label>PayPal.me username</label>
      <input id="set-paypal" value="${esc(s.paypalMe || "")}" />
      <label>Venmo username</label>
      <input id="set-venmo" value="${esc(s.venmo || "")}" />
      <p><button class="btn" type="button" id="save-settings">Save settings</button></p>
    </article>`;
}

async function saveAll() {
  setStatus("Saving…");
  try {
    applyState(
      await api({
        action: "save",
        revision: state.revision,
        store: { settings: state.settings, products: state.products },
      })
    );
    setStatus("Saved.");
  } catch (err) {
    setStatus(err.message);
  }
}

function setStatus(msg) {
  const el = document.getElementById("admin-status");
  if (el) el.textContent = msg;
}

async function addClip() {
  const nameInput = document.getElementById("clip-name");
  const fileInput = document.getElementById("clip-file");
  const youtubeInput = document.getElementById("clip-youtube");
  const name = (nameInput?.value || "").trim();
  const file = fileInput?.files?.[0];
  const youtube = (youtubeInput?.value || "").trim();
  if (!name) {
    setStatus("Add a sample name first.");
    nameInput?.focus();
    return;
  }
  if (!file && !youtube) {
    setStatus("Choose a music or video file, or paste a YouTube link.");
    return;
  }
  try {
    if (file) {
      const kind = sampleKindFromFile(file);
      setStatus(kind === "video" ? "Uploading video…" : "Uploading sample…");
      let url;
      try {
        url = await uploadToBlob(file, "clip-token", sampleFilename(file, kind));
      } catch (err) {
        if (file.size > 3.2 * 1024 * 1024) throw err;
        const data = await fileToBase64(file);
        const saved = await api({ action: "upload", filename: sampleFilename(file, kind), data, kind: "clips" });
        url = saved.url;
        if (!url) throw err;
      }
      applyState(await api({ action: "clip-add", name, url, kind }));
    } else {
      if (!youtubeIdFromUrl(youtube)) {
        setStatus("That YouTube link is not valid.");
        youtubeInput?.focus();
        return;
      }
      setStatus("Adding YouTube sample…");
      applyState(await api({ action: "clip-add", name, url: youtube, kind: "youtube" }));
    }
    if (nameInput) nameInput.value = "";
    if (fileInput) fileInput.value = "";
    if (youtubeInput) youtubeInput.value = "";
    setStatus("Sample added. It is live on the Samples page.");
  } catch (err) {
    setStatus(err.message || "Could not add the sample.");
  }
}

async function loadApp() {
  applyState(await api({ action: "load" }));
  document.getElementById("login-card").hidden = true;
  document.getElementById("admin-app").hidden = false;
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
    if (e.target.id === "order-sort") {
      orderUi.sort = e.target.value;
      renderOrders();
      return;
    }
    const attach = e.target.closest("[data-attach]");
    if (attach && attach.files[0]) {
      const file = attach.files[0];
      const orderId = attach.dataset.attach;
      try {
        setStatus("Uploading mix…");
        let url;
        try {
          url = await uploadToBlob(file, "mix-token", file.name);
        } catch (err) {
          if (file.size > 3.2 * 1024 * 1024) throw err;
          const data = await fileToBase64(file);
          applyState(await api({ action: "attach", orderId, filename: file.name, data }));
          attach.value = "";
          setStatus("Mix uploaded. It now shows in the customer portal.");
          return;
        }
        applyState(await api({ action: "attach", orderId, filename: file.name, url }));
        attach.value = "";
        setStatus("Mix uploaded. It now shows in the customer portal.");
      } catch (err) {
        setStatus(err.message || "Could not upload the mix.");
      }
      return;
    }
    const status = e.target.closest("[data-status]");
    if (status) {
      try {
        if (status.value === "ready" && orderUi.tab === "active") orderUi.tab = "completed";
        applyState(await api({ action: "status", orderId: status.dataset.status, status: status.value }));
        setStatus(
          status.value === "ready"
            ? "Marked completed. This order is now under Completed orders."
            : "Order status updated. It now shows in the customer portal."
        );
      } catch (err) {
        setStatus(err.message);
      }
      return;
    }
    const payment = e.target.closest("[data-payment]");
    if (payment) {
      try {
        applyState(await api({ action: "order-payment-status", orderId: payment.dataset.payment, paymentStatus: payment.value }));
        setStatus("Payment updated. It now shows in the customer portal.");
      } catch (err) {
        setStatus(err.message);
      }
    }
  });

  document.body.addEventListener("input", (e) => {
    if (e.target.id === "order-search") {
      orderUi.query = e.target.value;
      renderOrders();
      return;
    }
    const input = e.target.closest("[data-id][data-k]");
    if (!input) return;
    const product = productById(input.dataset.id);
    if (!product) return;
    product[input.dataset.k] = input.dataset.k === "price" ? Number(input.value) : input.value;
  });

  document.body.addEventListener("focusout", async (e) => {
    const notes = e.target.closest("[data-notes]");
    if (!notes) return;
    const order = state.orders.find((item) => item.id === notes.dataset.notes);
    if (!order || (order.notes || "") === notes.value) return;
    try {
      applyState(await api({ action: "order-notes", orderId: notes.dataset.notes, notes: notes.value }));
      setStatus("Notes saved.");
    } catch (err) {
      setStatus(err.message);
    }
  });

  document.body.addEventListener("click", async (e) => {
    const orderTab = e.target.closest("[data-order-tab]");
    if (orderTab) {
      orderUi.tab = orderTab.dataset.orderTab;
      orderUi.openId = "";
      renderOrders();
      return;
    }
    if (e.target.closest("[data-order-back]")) {
      orderUi.openId = "";
      renderOrders();
      return;
    }
    const openOrder = e.target.closest("[data-open-order]");
    if (openOrder) {
      orderUi.openId = openOrder.dataset.openOrder;
      renderOrders();
      return;
    }
    if (e.target.id === "clip-add") {
      e.preventDefault();
      await addClip();
      return;
    }
    const remove = e.target.closest("[data-clip-delete]");
    if (remove) {
      e.preventDefault();
      try {
        setStatus("Removing sample…");
        let clipId = remove.dataset.clipDelete || "";
        try {
          clipId = decodeURIComponent(clipId);
        } catch {}
        applyState(await api({ action: "clip-delete", clipId }));
        setStatus("Sample removed.");
      } catch (err) {
        setStatus(err.message || "Could not remove the sample.");
      }
      return;
    }
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
