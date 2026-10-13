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

const orderUi = { tab: "active", query: "", sort: "due", openId: "", section: "overview" };

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

function mixStatus(mix) {
  const value = mix && mix.status;
  if (value === "ready" || value === "review" || value === "in-progress" || value === "received") return value;
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

function orderMixes(order) {
  if (Array.isArray(order.mixes) && order.mixes.length) return order.mixes;
  return [{
    id: "mix-1",
    title: packageName(order) || "Mix",
    teamName: order.teamName || "",
    teamLevel: order.teamLevel || "",
    teamColors: order.teamColors || "",
    voiceover: order.voiceover || "",
    completionDate: order.completionDate || "",
    songs: order.songs || [],
    countSheet: order.countSheet || null,
    status: order.status || "received",
  }];
}

function dateFlag(dateValue) {
  const text = String(dateValue || "").trim();
  if (!text) return "";
  const due = new Date(`${text.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 7);
  if (due < today) return "overdue";
  if (due <= soon) return "soon";
  return "";
}

function dueFlag(order) {
  if (order.status === "ready") return "";
  const flags = orderMixes(order).map((mix) => dateFlag(mix.completionDate));
  if (flags.includes("overdue")) return "overdue";
  if (flags.includes("soon")) return "soon";
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

function mixNeedsAttention(mix) {
  const songs = (mix.songs || []).map((song) => String(song || "").trim()).filter(Boolean);
  return !String(mix.teamName || "").trim() || !String(mix.completionDate || "").trim() || songs.length < 5 || !mix.countSheet;
}

function teamEntries() {
  const entries = [];
  state.orders.forEach((order) => {
    orderMixes(order).forEach((mix, index) => {
      entries.push({ order, mix, index, status: mixStatus(mix, order) });
    });
  });
  return entries;
}

function entriesInTab(tab) {
  return teamEntries().filter((entry) => {
    if (tab === "completed") return entry.status === "ready";
    if (tab === "active") return entry.status !== "ready";
    if (tab === "attention") return entry.status !== "ready" && mixNeedsAttention(entry.mix);
    return true;
  });
}

function teamLabel(order) {
  const names = (Array.isArray(order.mixes) ? order.mixes : []).map((mix) => mix.teamName).filter(Boolean);
  if (names.length) return names.join(" · ");
  return order.teamName || "";
}

function orderMatches(order, query) {
  if (!query) return true;
  const mixText = (order.mixes || []).map((mix) => `${mix.teamName || ""} ${mix.title || ""}`).join(" ");
  const haystack = [order.id, order.gym, order.teamName, teamLabel(order), mixText, customerName(order), order.coachFirst, order.coachLast]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function sortEntries(list) {
  const rank = { received: 0, "in-progress": 1, review: 2, ready: 3 };
  return [...list].sort((a, b) => {
    if (orderUi.sort === "gym") return String(a.order.gym || "").localeCompare(String(b.order.gym || ""), undefined, { sensitivity: "base" });
    if (orderUi.sort === "status") return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(a.mix.teamName || "").localeCompare(String(b.mix.teamName || ""));
    if (orderUi.sort === "created") return String(b.order.createdAt || "").localeCompare(String(a.order.createdAt || ""));
    return String(a.mix.completionDate || "9999-99-99").localeCompare(String(b.mix.completionDate || "9999-99-99"));
  });
}

function visibleEntries() {
  const query = orderUi.query.trim().toLowerCase();
  return sortEntries(entriesInTab(orderUi.tab).filter((entry) => orderMatches(entry.order, query)));
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

function statusSelect(order, mix) {
  const current = mixStatus(mix);
  const who = mix.teamName || mix.title || "this team";
  const options = PRODUCTION_OPTIONS.map((option) => {
    const on = current === option.value ? " is-on" : "";
    return `<button type="button" class="order-status-option${on}" data-set-status="${esc(order.id)}" data-mix="${esc(mix.id)}" data-value="${option.value}">${option.label}</button>`;
  }).join("");
  return `<div class="order-status-menu">
    <button type="button" class="order-status-current" data-status-toggle aria-haspopup="listbox" aria-expanded="false" aria-label="Production status for ${esc(who)}">${esc(productionLabel(current))}</button>
    <div class="order-status-options" role="listbox" hidden>${options}</div>
  </div>`;
}

function mixLine(mix, index, order) {
  const flag = order.status === "ready" ? "" : dateFlag(mix.completionDate);
  const dueText = flag === "overdue" ? "Overdue" : flag === "soon" ? "Due within 7 days" : "";
  const when = formatWhen(mix.completionDate, true);
  return `<span class="order-mix-line">
    <strong>${index + 1}. ${esc(mix.title || "Mix")} · ${blank(mix.teamName)}</strong>
    <span>${esc(mix.teamColors || "No colors")} · ${when ? esc(when) : "No date"}${dueText ? `<span class="order-due">${dueText}</span>` : ""}</span>
  </span>`;
}

function orderRow(entry) {
  const order = entry.order;
  const mix = entry.mix;
  const due = entry.status === "ready" ? "" : dateFlag(mix.completionDate);
  const team = String(mix.teamName || "").trim() || mix.title || "Team";
  return `
    <div class="order-row${due ? ` is-${due}` : ""}">
      <span class="order-cell" data-label="Order"><button class="order-id-btn" type="button" data-open-order="${esc(order.id)}"><span class="order-id">${esc(order.id)}</span></button></span>
      <span class="order-cell" data-label="Gym"><strong>${blank(order.gym)}</strong></span>
      <span class="order-cell" data-label="Team"><button class="order-id-btn" type="button" data-open-order="${esc(order.id)}"><strong>${esc(team)}</strong><span>${esc(mix.title || "Mix")}${due ? `<span class="order-due">${due === "overdue" ? "Overdue" : "Due within 7 days"}</span>` : ""}</span></button></span>
      <span class="order-cell" data-label="Production">${statusSelect(order, mix)}</span>
      <span class="order-cell" data-label="Payment"><span class="order-pay ${paymentClass(order)}">${esc(paymentLabel(order))}</span></span>
    </div>`;
}

function orderListHtml() {
  const counts = {
    active: entriesInTab("active").length,
    attention: entriesInTab("attention").length,
    completed: entriesInTab("completed").length,
    all: teamEntries().length,
  };
  const stats = [
    ["active", "In progress", counts.active],
    ["attention", "Needs attention", counts.attention],
    ["completed", "Completed", counts.completed],
    ["all", "All teams", counts.all],
  ]
    .map(
      ([id, label, count]) =>
        `<button type="button" class="admin-stat${orderUi.tab === id ? " is-on" : ""}" data-order-tab="${id}"><strong>${count}</strong><span>${label}</span></button>`
    )
    .join("");
  const tabs = [
    ["active", "Active teams"],
    ["attention", "Needs attention"],
    ["completed", "Completed teams"],
    ["all", "All teams"],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" class="btn ${orderUi.tab === id ? "is-on" : "btn-outline"}" data-order-tab="${id}">${label} (${counts[id]})</button>`
    )
    .join("");
  const rows = visibleEntries();
  const body = !state.orders.length
    ? `<p class="hint">No orders yet.</p>`
    : !rows.length
      ? `<p class="hint">No teams match that search.</p>`
      : `<div class="order-table">
          <div class="order-row-head">
            <span>Order</span><span>Gym</span><span>Team</span><span>Production</span><span>Payment</span>
          </div>
          ${rows.map(orderRow).join("")}
        </div>`;
  return `
    <div class="order-desk">
      <div class="admin-stats">${stats}</div>
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
      <p class="hint">Each team is its own row. Set that team's status here. Unfinished teams due within 7 days are marked. Overdue teams are marked in red.</p>
      ${body}
    </div>`;
}

function fileBlock(order, file, label) {
  const href = fileHref(order.id, file.id);
  const audio = isAudioName(file.name) ? `<audio controls src="${esc(href)}"></audio>` : "";
  return `<div class="order-file"><p class="order-fact-label">${esc(label)}</p><p><a href="${esc(href)}">${esc(file.name)}</a></p>${audio}</div>`;
}

function mixDetailHtml(mix, index, total) {
  return `
    <section class="order-mix-block">
      <h4>Mix ${index + 1} of ${total} · ${esc(mix.title || "Mix")}</h4>
      <p class="order-mix-who">${blank(mix.teamName)}</p>
      <div class="order-facts">
        ${fact("Requested completion date", blank(formatWhen(mix.completionDate, true) || mix.completionDate))}
        ${fact("Team name", blank(mix.teamName))}
        ${fact("Team type and level", blank(mix.teamLevel))}
        ${fact("Team colors", blank(mix.teamColors))}
        ${fact("Voiceover ideas", blank(mix.voiceover), true)}
      </div>
    </section>`;
}

function songBlock(mix, index, total) {
  const songs = (mix.songs || []).map((song) => String(song || "").trim());
  const filled = songs.filter(Boolean).length;
  const songHtml = filled ? `<ol class="order-songs">${[0, 1, 2, 3, 4].map((i) => `<li>${esc(songs[i] || "—")}</li>`).join("")}</ol>` : `<p class="hint">No songs yet.</p>`;
  return `
    <section class="order-mix-block">
      <h4>Mix ${index + 1} of ${total} · ${esc(mix.title || "Mix")}</h4>
      <p class="hint">${esc(mix.teamName || "No team name")} · ${filled} of 5 songs</p>
      ${songHtml}
    </section>`;
}

function orderDetailHtml(order) {
  const mixes = orderMixes(order);
  const files = [...(order.files || [])].reverse();
  const fileHtml = files.length
    ? files.map((file) => fileBlock(order, file, "Finished mix")).join("")
    : `<p class="hint">No mix uploaded yet.</p>`;
  const payments = (order.payments || [])
    .map((payment) => `<li>${esc(payMethodLabel(payment.method))} · $${Number(payment.amount || 0).toLocaleString("en-US")}${payment.reference ? ` · ${esc(payment.reference)}` : ""}${payment.date ? ` · ${esc(payment.date)}` : ""}</li>`)
    .join("");
  const activity = (order.activity || [])
    .map((entry) => `<li>${esc(formatWhen(entry.at) || "")} · ${esc(entry.detail || entry.action || "")}</li>`)
    .join("");
  const sections = [
    ["overview", "Overview"],
    ["mixes", "Mix details"],
    ["songs", "Songs"],
    ["files", "Files"],
    ["manage", "Production & payment"],
  ];
  const section = sections.some(([id]) => id === orderUi.section) ? orderUi.section : "overview";
  const tabs = sections
    .map(
      ([id, label]) =>
        `<button type="button" class="btn ${section === id ? "is-on" : "btn-outline"}" data-admin-section="${id}">${label}</button>`
    )
    .join("");
  const gaps = mixes.flatMap((mix, index) => {
    const items = [];
    if (!String(mix.teamName || "").trim()) items.push(`Mix ${index + 1} needs a team name`);
    if ((mix.songs || []).map((song) => String(song || "").trim()).filter(Boolean).length < 5) items.push(`Mix ${index + 1} needs 5 songs`);
    if (!mix.countSheet) items.push(`Mix ${index + 1} needs a count sheet`);
    return items;
  });
  let panel = "";
  if (section === "overview") {
    panel = `
      <section class="order-section">
        <h3>Customer</h3>
        <div class="order-facts">
          ${fact("Gym or school name", blank(order.gym))}
          ${fact("Customer name", blank(customerName(order)))}
          ${fact("Email", blank(order.email))}
          ${fact("Package ordered", blank(packageName(order)), true)}
          ${fact("Payment method", esc(payMethodLabel(order.method)))}
          ${fact("PO number", blank(order.poNumber))}
          ${fact("Total", `$${Number(order.total || 0).toLocaleString("en-US")}`)}
          ${fact("Order date", blank(formatWhen(order.createdAt)))}
        </div>
        ${
          gaps.length
            ? `<p class="field-label">Still needed</p><ul class="order-gaps">${gaps.map((gap) => `<li>${esc(gap)}</li>`).join("")}</ul>`
            : `<p class="hint">Team details, songs, and count sheets are in for every mix.</p>`
        }
        <div class="order-mix-lines">${mixes
          .map(
            (mix, index) =>
              `<button type="button" class="order-mix-jump" data-admin-section="mixes">${index + 1}. ${esc(mix.title || "Mix")} · ${esc(mix.teamName || "No team")} · ${esc(productionLabel(mixStatus(mix)))} · ${esc(formatWhen(mix.completionDate, true) || "No date")}</button>`
          )
          .join("")}</div>
      </section>`;
  } else if (section === "mixes") {
    panel = `
      <section class="order-section">
        <h3>Mix details</h3>
        <p class="hint">Same order as checkout. Each mix keeps its own team, date, colors, and voiceover.</p>
        ${mixes.map((mix, index) => mixDetailHtml(mix, index, mixes.length)).join("")}
      </section>`;
  } else if (section === "songs") {
    panel = `
      <section class="order-section">
        <h3>Songs</h3>
        ${mixes.map((mix, index) => songBlock(mix, index, mixes.length)).join("")}
      </section>`;
  } else if (section === "files") {
    const sheets = mixes
      .map((mix, index) =>
        mix.countSheet
          ? fileBlock(order, mix.countSheet, `Mix ${index + 1} · ${mix.teamName || mix.title || "Mix"} count sheet`)
          : `<p class="hint">Mix ${index + 1} · ${esc(mix.teamName || mix.title || "Mix")} has no count sheet yet.</p>`
      )
      .join("");
    panel = `
      <section class="order-section">
        <h3>Files</h3>
        ${sheets}
        ${fileHtml}
        <label for="mix-${esc(order.id)}">Upload or replace finished mix</label>
        <p class="hint">Uploading adds the file to this order. Each team keeps its own status. Earlier files stay attached. The newest mix shows in the customer portal.</p>
        <input id="mix-${esc(order.id)}" data-attach="${esc(order.id)}" type="file" accept="audio/*,.zip,.mp3,.wav,.m4a,.mpeg" />
      </section>`;
  } else {
    panel = `
      <section class="order-section">
        <h3>Production and payment</h3>
        <div class="order-facts">
          ${mixes
            .map(
              (mix, index) =>
                `<div class="order-fact"><span class="order-fact-label">Mix ${index + 1} · ${esc(mix.teamName || mix.title || "Mix")}</span>${statusSelect(order, mix)}<p class="hint">This status is only for this team. Ordered, In production, Ready for review, and Completed show on the customer dashboard.</p></div>`
            )
            .join("")}
          <div class="order-fact"><span class="order-fact-label">Payment status</span>
            <select data-payment="${esc(order.id)}" aria-label="Payment status">
              <option value="unpaid" ${order.paymentStatus === "paid" ? "" : "selected"}>Not paid</option>
              <option value="paid" ${order.paymentStatus === "paid" ? "selected" : ""}>Paid</option>
            </select>
            <p class="hint">Payment stays separate from production. Paid or Not paid shows on the customer portal.</p>
          </div>
        </div>
        ${payments ? `<p class="order-fact-label">Recorded payments</p><ul class="order-payments">${payments}</ul>` : ""}
        <label for="notes-${esc(order.id)}">Order notes</label>
        <textarea id="notes-${esc(order.id)}" data-notes="${esc(order.id)}">${esc(order.notes || "")}</textarea>
        ${activity ? `<details class="order-activity"><summary>Activity</summary><ul>${activity}</ul></details>` : ""}
        <div class="order-danger">
          <button class="btn btn-outline is-danger" type="button" data-delete-order="${esc(order.id)}">Delete order</button>
          ${
            order.email
              ? `<button class="btn btn-outline is-danger" type="button" data-delete-customer="${esc(order.email)}">Delete customer</button>`
              : ""
          }
          <p class="hint">Delete order removes only this order. Delete customer removes the portal login and every order on this email.</p>
        </div>
      </section>`;
  }
  return `
    <article class="order-detail">
      <div class="order-detail-head">
        <div>
          <button class="btn btn-outline" type="button" data-order-back>Back to orders</button>
          <h2>${esc(order.gym || teamLabel(order) || "Order")}</h2>
          <p class="hint">${esc(order.id)} · ${esc(teamLabel(order) || "No team yet")}</p>
        </div>
        <p class="order-flags">
          ${
            mixes.every((mix) => mixStatus(mix) === mixStatus(mixes[0]))
              ? `<span class="order-status ${productionClass(mixStatus(mixes[0]))}">${esc(productionLabel(mixStatus(mixes[0])))}</span>`
              : ""
          }
          <span class="order-pay ${paymentClass(order)}">${esc(paymentLabel(order))}</span>
        </p>
      </div>
      <div class="desk-tabs">${tabs}</div>
      ${panel}
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
  const w9Href = s.w9?.name ? `/api/download?admin=${encodeURIComponent(token())}&w9=1` : "";
  document.querySelector('[data-panel="settings"]').innerHTML = `
    <article class="product admin-card">
      <label>PayPal.me username</label>
      <input id="set-paypal" value="${esc(s.paypalMe || "")}" />
      <label>Venmo username</label>
      <input id="set-venmo" value="${esc(s.venmo || "")}" />
      <p><button class="btn" type="button" id="save-settings">Save settings</button></p>
      <label>W-9 for customers</label>
      <p class="hint">Upload a PDF. Customers can download it from the portal for taxes. A new file replaces the current W-9.</p>
      ${w9Href ? `<p><a class="btn btn-outline" href="${w9Href}">${esc(s.w9.name)}</a></p>` : `<p class="hint">No W-9 uploaded yet.</p>`}
      <input id="set-w9" type="file" accept="application/pdf,.pdf" />
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
    if (e.target.id === "set-w9" && e.target.files[0]) {
      const file = e.target.files[0];
      if (!/\.pdf$/i.test(file.name)) {
        setStatus("Upload the W-9 as a PDF.");
        e.target.value = "";
        return;
      }
      try {
        setStatus("Uploading W-9…");
        const data = await fileToBase64(file);
        applyState(await api({ action: "w9", filename: file.name, data }));
        setStatus("W-9 saved. Customers can download it in the portal.");
      } catch (err) {
        setStatus(err.message || "Could not upload the W-9.");
      }
      return;
    }
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

  function closeStatusMenus() {
    document.querySelectorAll(".order-status-options").forEach((panel) => {
      panel.hidden = true;
    });
    document.querySelectorAll("[data-status-toggle]").forEach((btn) => btn.setAttribute("aria-expanded", "false"));
    document.querySelectorAll(".order-status-menu.is-open").forEach((menu) => menu.classList.remove("is-open"));
  }

  document.body.addEventListener("click", async (e) => {
    const setStatusBtn = e.target.closest("[data-set-status]");
    if (setStatusBtn) {
      const mixId = String(setStatusBtn.dataset.mix || "").trim();
      const next = setStatusBtn.dataset.value;
      if (!mixId || !next) {
        setStatus("Choose one team.");
        return;
      }
      try {
        applyState(await api({ action: "status", orderId: setStatusBtn.dataset.setStatus, mixId, status: next }));
        setStatus("Team status updated. It now shows on that team's row in the customer portal.");
      } catch (err) {
        setStatus(err.message);
      }
      return;
    }
    const statusToggle = e.target.closest("[data-status-toggle]");
    if (statusToggle) {
      const menu = statusToggle.closest(".order-status-menu");
      const panel = menu?.querySelector(".order-status-options");
      const willOpen = panel?.hidden !== false;
      closeStatusMenus();
      if (willOpen && panel && menu) {
        panel.hidden = false;
        statusToggle.setAttribute("aria-expanded", "true");
        menu.classList.add("is-open");
      }
      return;
    }
    if (!e.target.closest(".order-status-menu")) closeStatusMenus();
    const orderTab = e.target.closest("[data-order-tab]");
    if (orderTab) {
      orderUi.tab = orderTab.dataset.orderTab;
      orderUi.openId = "";
      renderOrders();
      return;
    }
    const section = e.target.closest("[data-admin-section]");
    if (section) {
      orderUi.section = section.dataset.adminSection || "overview";
      renderOrders();
      return;
    }
    if (e.target.closest("[data-order-back]")) {
      orderUi.openId = "";
      renderOrders();
      return;
    }
    const deleteOrder = e.target.closest("[data-delete-order]");
    if (deleteOrder) {
      const order = state.orders.find((item) => item.id === deleteOrder.dataset.deleteOrder);
      const label = order?.teamName || order?.gym || "this order";
      if (!window.confirm(`Delete the order for ${label}? This removes only this order.`)) return;
      try {
        orderUi.openId = "";
        applyState(await api({ action: "delete-order", orderId: deleteOrder.dataset.deleteOrder }));
        setStatus("Order deleted.");
      } catch (err) {
        setStatus(err.message || "Could not delete the order.");
      }
      return;
    }
    const deleteCustomer = e.target.closest("[data-delete-customer]");
    if (deleteCustomer) {
      const email = deleteCustomer.dataset.deleteCustomer;
      const matches = state.orders.filter((item) => String(item.email || "").toLowerCase() === String(email || "").toLowerCase());
      const name = customerName(matches[0] || {}) || email;
      const count = matches.length;
      if (!window.confirm(`Delete ${name} (${email})? This removes their portal login and ${count} order${count === 1 ? "" : "s"}. This cannot be undone.`)) return;
      try {
        orderUi.openId = "";
        applyState(await api({ action: "delete-customer", email }));
        setStatus("Customer deleted.");
      } catch (err) {
        setStatus(err.message || "Could not delete the customer.");
      }
      return;
    }
    const openOrder = e.target.closest("[data-open-order]");
    if (openOrder) {
      orderUi.openId = openOrder.dataset.openOrder;
      orderUi.section = "overview";
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
