const KEY = "max-portal";
const BILLING = {
  legalName: "A&H Athletics LLC",
  dba: "MAX Cheer",
  line1: "7495 Wall Triana Hwy",
  city: "Madison",
  state: "AL",
  zip: "35757",
  payableTo: "MAX Cheer",
  email: "maxcheermusic@gmail.com",
  paypalMe: "danharrod12",
  venmo: "daniel-harrod-3",
  w9: null,
};
let portalState = null;
let docView = null;
const portalUi = { screen: "dashboard", filter: "all", query: "", orderId: "", tab: "overview" };

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
      ${fact("Payment", esc(payMethodLabel(o.method)))}
      ${fact("PO number", blank(o.poNumber))}
      ${fact("Mixes", mixLine(o), true)}
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

function money(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatStamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayFromIso(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDay(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!match) return "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function invoiceDay(order) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(order.invoiceDate || "")) ? order.invoiceDate : dayFromIso(order.createdAt);
}

function billingOf(data) {
  return { ...BILLING, ...(data?.billing || {}) };
}

function w9Href(data) {
  if (!data?.billing?.w9?.name) return "";
  if (isPreview()) return "#preview-w9";
  const auth = data.auth || {};
  const q = new URLSearchParams({ email: auth.email || "", token: auth.token || "", w9: "1" });
  return `/api/download?${q}`;
}

function lineRows(order) {
  const items = Array.isArray(order.items) && order.items.length ? order.items : [{ title: "Cheer music mix", qty: 1, price: order.total }];
  return items
    .map((item) => {
      const qty = Number(item.qty) || 1;
      const price = Number(item.price);
      const rate = Number.isFinite(price) ? price : (Number(order.total) || 0) / qty;
      const amount = rate * qty;
      return `<tr><td>${esc(item.title || item.name || "Cheer music mix")}</td><td>${qty}</td><td>${money(rate)}</td><td>${money(amount)}</td></tr>`;
    })
    .join("");
}

function orderFingerprint(orders) {
  return (orders || [])
    .map((o) => {
      const mixes = orderMixes(o)
        .map((mix) => `${mix.id}:${mix.teamName}:${(mix.songs || []).join(",")}:${mix.countSheet?.id || ""}`)
        .join(";");
      return `${o.id}:${o.status}:${o.paymentStatus || "unpaid"}:${(o.files || []).length}:${mixes}`;
    })
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
    billing: { ...BILLING, w9: { name: "W-9.pdf" } },
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

function songFields(order, mix) {
  return `<div class="song-grid">${[0, 1, 2, 3, 4]
    .map((i) => {
      const value = esc((mix.songs || [])[i] || "");
      return `<label class="song-field">Song ${i + 1}<input data-song="${esc(order.id)}" data-mix="${esc(mix.id)}" data-i="${i}" value="${value}" /></label>`;
    })
    .join("")}</div>`;
}

function accountBar(data) {
  const u = data.user || {};
  const who = [u.coachFirst, u.coachLast].filter(Boolean).join(" ");
  const w9 = w9Href(data);
  return `
    ${isPreview() ? `<p class="hint doc-screen-only">Preview with sample data — not a real account.</p>` : ""}
    <p class="portal-toolbar doc-screen-only">
      <span>${esc(who)}${who && u.email ? " · " : ""}${esc(u.email || "")}</span>
      <span class="portal-toolbar-actions">
        ${w9 ? `<a class="btn btn-outline" href="${esc(w9)}">Download W-9</a>` : ""}
        <button class="btn btn-outline" type="button" id="portal-out">Log out</button>
      </span>
    </p>`;
}

function seasonLabel(iso) {
  const date = new Date(iso || Date.now());
  const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
  const start = !Number.isNaN(date.getTime()) && date.getMonth() < 5 ? year - 1 : year;
  return `${start}-${start + 1}`;
}

function orderMixes(order) {
  if (Array.isArray(order.mixes) && order.mixes.length) return order.mixes;
  const items = Array.isArray(order.items) ? order.items : [];
  const units = [];
  items.forEach((item) => {
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    for (let i = 0; i < qty; i += 1) units.push(item);
  });
  const base = units.length ? units : [{ title: "Mix" }];
  return base.map((item, index) => ({
    id: `mix-${index + 1}`,
    title: item.title || item.name || "Mix",
    teamName: index === 0 ? order.teamName || "" : "",
    teamColors: index === 0 ? order.teamColors || "" : "",
    voiceover: index === 0 ? order.voiceover || "" : "",
    completionDate: order.completionDate || "",
    songs: index === 0 ? order.songs || [] : [],
    countSheet: index === 0 ? order.countSheet || null : null,
  }));
}

function mixKey(orderId, mixId) {
  return `${orderId}--${mixId}`;
}

function teamTitle(order) {
  const names = orderMixes(order).map((mix) => String(mix.teamName || "").trim()).filter(Boolean);
  if (names.length) return names.join(" · ");
  return order.teamName || "Order";
}

function licenseHtml(order, mix, data) {
  const coach = [order.coachFirst, order.coachLast].filter((part) => String(part || "").trim()).join(" ") || "—";
  const rows = [
    ["Organization", order.gym || "—"],
    ["Coach name", coach],
    ["Team name", mix.teamName || "—"],
    ["Mix", mix.title || "Cheer music mix"],
  ];
  return `
    ${accountBar(data)}
    <p class="doc-toolbar doc-screen-only">
      <button class="btn btn-outline" type="button" data-doc-back>Back</button>
      <button class="btn" type="button" id="doc-print">Print</button>
    </p>
    <article class="license-sheet" id="doc-sheet">
      <p class="license-watermark" aria-hidden="true">MAX</p>
      <div class="license-body">
      <header class="license-top">
        <div>
          <p class="license-season">${esc(seasonLabel(order.createdAt))}</p>
          <p class="license-season">Music Performance License</p>
        </div>
        <img class="license-logo" src="assets/max-logo.png" alt="MAX Cheer Music" />
      </header>
      <p class="license-title">Proof of License</p>
      <section class="license-rights">
        <p class="license-label">Licensing Rights</p>
        <p>The Licensor grants rights to the Licensee for the use of this track. The track is licensed for performance and synchronization purposes only. This license becomes void if any person or company alters the track in any way. The Licensee may not sell, distribute, or reproduce the track in any form.</p>
        <p>This document serves as proof of license for the Licensee listed below. The license is valid for 364 days from the date of receipt of the track.</p>
        <p>Music is intended for practice, performance, and enjoyment purposes only and may not be used in any other manner. MAX Cheer Music certifies that all content in this track is either 100% original or properly licensed.</p>
      </section>
      <section class="license-who">
        ${rows
          .map(
            ([label, value]) =>
              `<p><span>${esc(label)}</span>${esc(value)}</p>`
          )
          .join("")}
      </section>
      </div>
    </article>`;
}

function documentHtml(order, kind, data) {
  const billing = billingOf(data);
  const quote = kind === "quote";
  const coach = [order.coachFirst, order.coachLast].filter((part) => String(part || "").trim()).join(" ");
  const total = Number(order.total) || 0;
  const paid = isPaid(order) ? total : 0;
  const due = Math.max(0, total - paid);
  const day = invoiceDay(order);
  const address = `${billing.line1}, ${billing.city}, ${billing.state} ${billing.zip}`;
  const paypal = billing.paypalMe ? `https://paypal.me/${billing.paypalMe}` : "";
  const venmo = billing.venmo ? `https://venmo.com/${billing.venmo}` : "";
  const w9 = w9Href(data);
  return `
    ${accountBar(data)}
    <p class="doc-toolbar doc-screen-only">
      <button class="btn btn-outline" type="button" data-doc-back>Back</button>
      <button class="btn" type="button" id="doc-print">Print</button>
      ${
        quote
          ? `<button class="btn btn-outline" type="button" data-doc="invoice" data-order="${esc(order.id)}">Invoice</button>`
          : `<button class="btn btn-outline" type="button" data-doc="quote" data-order="${esc(order.id)}">Quote</button>`
      }
      ${w9 ? `<a class="btn btn-outline" href="${esc(w9)}">Download W-9</a>` : ""}
    </p>
    <article class="doc-sheet" id="doc-sheet">
      <header class="doc-head">
        <div>
          <p class="doc-brand">MAX CHEER</p>
          <p>${esc(billing.legalName)}</p>
          <p>DBA ${esc(billing.dba)}</p>
          <p>${esc(billing.line1)}</p>
          <p>${esc(billing.city)}, ${esc(billing.state)} ${esc(billing.zip)}</p>
          <p><a href="mailto:${esc(billing.email)}">${esc(billing.email)}</a></p>
        </div>
        <div class="doc-meta">
          <p class="doc-kind">${quote ? "Quote" : "Invoice"}</p>
          <p><span>Number</span> ${esc(order.id)}</p>
          <p><span>Order submitted</span> ${esc(formatStamp(order.createdAt))}</p>
          ${
            quote
              ? `<p><span>Quote date</span> ${esc(formatStamp(order.createdAt))}</p>`
              : `<p class="doc-date-edit"><span>Invoice date</span> <input id="invoice-date" data-invoice-date="${esc(order.id)}" type="date" value="${esc(day)}" /></p>
                 <p class="doc-date-print"><span>Invoice date</span> <strong data-doc-date>${esc(formatDay(day))}</strong></p>
                 <p class="hint doc-screen-only" data-invoice-status="${esc(order.id)}">Starts as the order date. Change it if you need a different invoice date.</p>`
          }
        </div>
      </header>
      <section class="doc-bill">
        <p class="doc-label">Bill to</p>
        <p>${esc(order.gym || "—")}</p>
        <p>${esc(coach || "—")}</p>
        <p>${esc(order.email || "")}</p>
        <p>${esc(orderMixes(order).map((mix) => mix.teamName).filter(Boolean).join(", "))}</p>
        ${order.poNumber ? `<p>PO number ${esc(order.poNumber)}</p>` : ""}
      </section>
      <table class="doc-lines">
        <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>${lineRows(order)}</tbody>
      </table>
      <div class="doc-totals">
        <p><span>${quote ? "Quoted total" : "Total"}</span><strong>${money(total)}</strong></p>
        ${quote ? "" : `<p><span>Paid</span><strong>${money(paid)}</strong></p><p><span>Balance due</span><strong>${money(due)}</strong></p>`}
      </div>
      <section class="doc-pay">
        <p class="doc-label">How to pay</p>
        <p>Check payable to ${esc(billing.payableTo)}</p>
        <p>Mail checks to ${esc(address)}</p>
        ${paypal ? `<p>PayPal: <a href="${esc(paypal)}">${esc(paypal)}</a></p>` : ""}
        ${venmo ? `<p>Venmo: <a href="${esc(venmo)}">@${esc(billing.venmo)}</a></p>` : ""}
        <p>Payment method on this order: ${esc(payMethodLabel(order.method))}${isPaid(order) ? " · Paid" : " · Not paid"}</p>
        ${order.completionDate ? `<p>Requested completion: ${/^\d{4}-\d{2}-\d{2}$/.test(order.completionDate) ? esc(formatDay(order.completionDate)) : esc(order.completionDate)}</p>` : ""}
        ${w9 ? `<p>W-9 for taxes: download it from your customer portal.</p>` : ""}
      </section>
    </article>`;
}

function customerLabel(data) {
  const user = data.user || {};
  return [user.coachFirst, user.coachLast].filter((part) => String(part || "").trim()).join(" ");
}

function sortedOrders(data) {
  return [...(data.orders || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function matchesQuery(order) {
  const query = portalUi.query.trim().toLowerCase();
  if (!query) return true;
  return [order.id, teamTitle(order), order.gym, packageName(order)].join(" ").toLowerCase().includes(query);
}

function packageName(order) {
  const items = order.items || [];
  if (!items.length) return "Cheer music mix";
  return items.map((item) => `${item.title || item.name || "Mix"}${Number(item.qty) > 1 ? ` ×${Number(item.qty)}` : ""}`).join(", ");
}

function listedOrders(data) {
  return sortedOrders(data).filter((order) => {
    if (portalUi.filter === "active") return order.status !== "ready";
    if (portalUi.filter === "completed") return order.status === "ready";
    return true;
  }).filter(matchesQuery);
}

function navKey() {
  if (portalUi.screen === "order" || portalUi.screen === "orders") return "orders";
  if (portalUi.screen === "quotes") return "quotes";
  if (portalUi.screen === "account") return "account";
  return "dashboard";
}

function boardTop() {
  const links = [
    ["dashboard", "Dashboard"],
    ["orders", "My Orders"],
    ["quotes", "Invoices"],
    ["account", "Account"],
  ];
  const current = navKey();
  return `
    <header class="portal-board-top">
      <p class="portal-brand">MAX Cheer Music</p>
      <span class="portal-badge">Customer Portal</span>
    </header>
    <nav class="portal-links">
      ${links
        .map(
          ([id, label]) =>
            `<button type="button" class="${current === id ? "is-on" : ""}" data-portal-nav="${id}">${label}</button>`
        )
        .join("")}
    </nav>`;
}

function board(body) {
  return `<section class="portal-board">${boardTop()}${body}</section>`;
}

function orderRow(order) {
  return `
    <div class="portal-table-row">
      <div class="portal-team">
        <strong>${esc(teamTitle(order))}</strong>
        <small>${esc(order.id)}</small>
      </div>
      <div><span class="portal-pill ${statusClass(order.status)}">${esc(statusLabel(order.status))}</span></div>
      <div><button type="button" data-open-order="${esc(order.id)}">View →</button></div>
    </div>`;
}

function listBody(data) {
  const orders = data.orders || [];
  const inProgress = orders.filter((order) => order.status !== "ready").length;
  const completed = orders.filter((order) => order.status === "ready").length;
  const rows = listedOrders(data);
  const title = portalUi.screen === "orders" ? "My Orders" : "My Music Orders";
  return `
    <div class="portal-title-row">
      <div>
        <h2>${title}</h2>
        <p>Manage your teams and music projects</p>
      </div>
      <button class="btn portal-new" type="button" data-new-order>New music order</button>
    </div>
    <div class="portal-stats">
      <button type="button" data-portal-filter="all" class="${portalUi.filter === "all" ? "is-on" : ""}"><strong>${orders.length}</strong><span>Total orders</span></button>
      <button type="button" data-portal-filter="active" class="${portalUi.filter === "active" ? "is-on" : ""}"><strong>${inProgress}</strong><span>In progress</span></button>
      <button type="button" data-portal-filter="completed" class="${portalUi.filter === "completed" ? "is-on" : ""}"><strong>${completed}</strong><span>Completed</span></button>
    </div>
    <label class="portal-search-label" for="portal-search">Search orders</label>
    <input id="portal-search" class="portal-search" type="search" placeholder="Search orders..." value="${esc(portalUi.query)}" />
    <div class="portal-table">
      <div class="portal-table-head"><span>Team</span><span>Status</span><span>Action</span></div>
      ${
        rows.length
          ? rows.map(orderRow).join("")
          : `<p class="hint portal-empty">${orders.length ? "No orders match that search." : "No orders on this account yet."}</p>`
      }
    </div>`;
}

function quotesBody(data) {
  const orders = sortedOrders(data);
  return `
    <div class="portal-title-row">
      <div>
        <h2>Invoices</h2>
        <p>Quotes, invoices, and proof of license</p>
      </div>
    </div>
    ${
      orders.length
        ? orders
            .map((order) => {
              const licenses = isPaid(order)
                ? orderMixes(order)
                    .map(
                      (mix) =>
                        `<button type="button" data-doc="license" data-order="${esc(order.id)}" data-mix="${esc(mix.id)}">Proof of license${orderMixes(order).length > 1 ? ` · ${esc(mix.teamName || mix.title || "Mix")}` : ""}</button>`
                    )
                    .join("")
                : `<span class="hint">Proof of license is available after the order is paid.</span>`;
              return `
                <article class="portal-doc-row">
                  <div class="portal-team">
                    <strong>${esc(teamTitle(order))}</strong>
                    <small>${esc(order.id)} · ${isPaid(order) ? "Paid" : "Not paid"}</small>
                  </div>
                  <p class="portal-doc-links">
                    <button type="button" data-doc="quote" data-order="${esc(order.id)}">Quote</button>
                    <button type="button" data-doc="invoice" data-order="${esc(order.id)}">Invoice</button>
                    ${licenses}
                  </p>
                </article>`;
            })
            .join("")
        : `<p class="hint">No orders on this account yet.</p>`
    }`;
}

function accountBody(data) {
  const user = data.user || {};
  const w9 = w9Href(data);
  return `
    <div class="portal-title-row">
      <div>
        <h2>Account</h2>
        <p>${esc(user.email || "")}</p>
      </div>
    </div>
    <div class="order-facts">
      ${fact("Name", blank(customerLabel(data)))}
      ${fact("Gym or school", blank(user.gym))}
      ${fact("Email", blank(user.email))}
    </div>
    ${w9 ? `<p><a class="btn btn-outline" href="${esc(w9)}">Download W-9</a></p>` : `<p class="hint">A W-9 appears here after MAX uploads one.</p>`}
    <p><button class="btn btn-outline" type="button" id="portal-out">Log out</button></p>`;
}

function teamPanel(order) {
  return orderMixes(order)
    .map((mix, index, list) => {
      const key = mixKey(order.id, mix.id);
      return `
        <section class="portal-mix-card" data-mix-card="${esc(key)}">
          <h3>${esc(mix.title || "Mix")}${list.length > 1 ? ` <span class="hint">Mix ${index + 1} of ${list.length}</span>` : ""}</h3>
          <div class="mix-fields">
            <label>Team name<input data-mix-field="teamName" value="${esc(mix.teamName || "")}" /></label>
            <label>Team colors<input data-mix-field="teamColors" value="${esc(mix.teamColors || "")}" /></label>
            <label>Requested date<input data-mix-field="completionDate" type="date" value="${esc(mix.completionDate || "")}" /></label>
            <label>Voiceover ideas<textarea data-mix-field="voiceover">${esc(mix.voiceover || "")}</textarea></label>
          </div>
          <p><button class="btn" type="button" data-save-mix="${esc(order.id)}" data-mix="${esc(mix.id)}">Save mix details</button></p>
          <p class="hint" data-mix-status="${esc(key)}"></p>
        </section>`;
    })
    .join("");
}

function songsPanel(order) {
  return orderMixes(order)
    .map((mix, index, list) => {
      const key = mixKey(order.id, mix.id);
      return `
        <section class="portal-mix-card">
          <h3>${esc(mix.title || "Mix")}${list.length > 1 ? ` <span class="hint">Mix ${index + 1} of ${list.length}</span>` : ""}</h3>
          <p class="hint">${esc(mix.teamName || "No team name yet")}. Type names from <a href="https://songsforcheer.com" target="_blank" rel="noreferrer">songsforcheer.com</a>.</p>
          ${songFields(order, mix)}
          <p><button class="btn" type="button" data-save-songs="${esc(order.id)}" data-mix="${esc(mix.id)}">Save songs</button></p>
          <p class="hint" data-song-status="${esc(key)}"></p>
        </section>`;
    })
    .join("");
}

function filesPanel(order, data) {
  const sheets = orderMixes(order)
    .map((mix, index) => {
      const key = mixKey(order.id, mix.id);
      return `
        <section class="portal-mix-card">
          <h3>Mix ${index + 1}${mix.teamName ? ` · ${esc(mix.teamName)}` : ""}</h3>
          <p class="hint">Fill and upload from <a href="sheets.html">8 Count Sheets</a>.</p>
          ${
            mix.countSheet
              ? `<p><a class="btn btn-outline" href="${downloadUrl(order, mix.countSheet, data.auth)}">Download ${esc(mix.countSheet.name)}</a></p>`
              : `<p class="hint">No count sheet yet.</p>`
          }
          <input data-sheet="${esc(order.id)}" data-mix="${esc(mix.id)}" type="file" accept="application/pdf,.pdf" />
          <p class="hint" data-sheet-status="${esc(key)}"></p>
        </section>`;
    })
    .join("");
  const files = (order.files || [])
    .map((file) => `<p><a class="btn" href="${downloadUrl(order, file, data.auth)}">Download ${esc(file.name)}</a></p>`)
    .join("");
  return `
    ${sheets}
    <section class="portal-mix-card">
      <h3>Finished mix</h3>
      ${files || `<p class="hint">MAX will post the mix here when it is ready.</p>`}
    </section>`;
}

function payPanel(order) {
  const licenses = orderMixes(order)
    .map((mix, index) =>
      isPaid(order)
        ? `<button type="button" data-doc="license" data-order="${esc(order.id)}" data-mix="${esc(mix.id)}">Proof of license${orderMixes(order).length > 1 ? ` · Mix ${index + 1}` : ""}</button>`
        : ""
    )
    .join("");
  return `
    ${checkoutFacts(order)}
    <p class="order-pay ${isPaid(order) ? "is-paid" : "is-unpaid"}">${isPaid(order) ? "Paid" : "Not paid"}</p>
    <p class="portal-doc-links">
      <button type="button" data-doc="quote" data-order="${esc(order.id)}">Quote</button>
      <button type="button" data-doc="invoice" data-order="${esc(order.id)}">Invoice</button>
      ${licenses || `<span class="hint">Proof of license for this mix is available after the order is paid.</span>`}
    </p>`;
}

function orderBody(data) {
  const order = (data.orders || []).find((item) => item.id === portalUi.orderId);
  if (!order) return listBody(data);
  const tabs = [
    ["overview", "Overview"],
    ["team", "Team details"],
    ["songs", "Songs"],
    ["files", "Counts & files"],
    ["pay", "Quotes & payments"],
  ];
  const tab = tabs.some(([id]) => id === portalUi.tab) ? portalUi.tab : "overview";
  const tabLabel = tabs.find(([id]) => id === tab)[1];
  const missing = orderMixes(order).flatMap((mix, index) => {
    const items = [];
    const songs = (mix.songs || []).map((song) => String(song || "").trim()).filter(Boolean);
    if (!String(mix.teamName || "").trim()) items.push(`Mix ${index + 1} needs a team name`);
    if (songs.length < 5) items.push(`Mix ${index + 1} needs 5 songs`);
    if (!mix.countSheet) items.push(`Mix ${index + 1} needs a count sheet`);
    return items;
  });
  let panel = checkoutFacts(order);
  if (tab === "overview") {
    panel += missing.length
      ? `<p class="field-label">Still needed</p><ul class="order-gaps">${missing.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
      : `<p class="hint">Team details, songs, and count sheets are in for every mix.</p>`;
  } else if (tab === "team") panel = teamPanel(order);
  else if (tab === "songs") panel = songsPanel(order);
  else if (tab === "files") panel = filesPanel(order, data);
  else panel = payPanel(order);
  return `
    <p class="portal-crumbs">
      <button type="button" data-portal-nav="orders">My Orders</button>
      <span>${esc(teamTitle(order))}</span>
      <span>${esc(tabLabel)}</span>
    </p>
    <div class="portal-title-row">
      <div>
        <h2>${esc(teamTitle(order))}</h2>
        <p>${esc(order.id)} · ${esc(packageName(order))}</p>
      </div>
      <span class="portal-pill ${statusClass(order.status)}">${esc(statusLabel(order.status))}</span>
    </div>
    <nav class="portal-links portal-tabs">
      ${tabs
        .map(
          ([id, label]) =>
            `<button type="button" class="${tab === id ? "is-on" : ""}" data-portal-tab="${id}">${label}</button>`
        )
        .join("")}
    </nav>
    ${panel}`;
}

function render(data, opts = {}) {
  portalState = data;
  document.body.classList.add("portal-in");
  const app = document.getElementById("portal-app");
  const login = document.getElementById("portal-login");
  login.hidden = true;
  app.hidden = false;
  const open = docView ? (data.orders || []).find((order) => order.id === docView.orderId) : null;
  const licenseMix = open && docView?.kind === "license"
    ? orderMixes(open).find((mix) => mix.id === docView.mixId)
    : null;
  if (!open || (docView?.kind === "license" && (!isPaid(open) || !licenseMix))) docView = null;
  if (open && docView?.kind === "license" && licenseMix) {
    app.innerHTML = licenseHtml(open, licenseMix, data);
    return;
  }
  if (open && docView) {
    app.innerHTML = documentHtml(open, docView.kind, data);
    return;
  }
  const screen = portalUi.screen;
  const body = screen === "quotes" ? quotesBody(data) : screen === "account" ? accountBody(data) : screen === "order" ? orderBody(data) : listBody(data);
  app.innerHTML = board(body);
  if (opts.focusSearch) {
    const search = document.getElementById("portal-search");
    if (search) {
      search.focus();
      const end = search.value.length;
      search.setSelectionRange(end, end);
    }
  }
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

function readSongs(orderId, mixId) {
  return [...document.querySelectorAll(`[data-song="${orderId}"][data-mix="${mixId}"]`)]
    .sort((a, b) => Number(a.dataset.i) - Number(b.dataset.i))
    .map((input) => input.value.trim());
}

function readMix(orderId, mixId) {
  const card = document.querySelector(`[data-mix-card="${mixKey(orderId, mixId)}"]`);
  const value = (name) => card?.querySelector(`[data-mix-field="${name}"]`)?.value.trim() || "";
  return {
    teamName: value("teamName"),
    teamColors: value("teamColors"),
    voiceover: value("voiceover"),
    completionDate: value("completionDate"),
  };
}

function previewMix(orderId, mixId) {
  const order = (portalState?.orders || []).find((item) => item.id === orderId);
  if (!order) return null;
  if (!Array.isArray(order.mixes) || !order.mixes.length) order.mixes = orderMixes(order);
  return order.mixes.find((mix) => mix.id === mixId) || null;
}

document.addEventListener("DOMContentLoaded", async () => {
  document.body.addEventListener("click", async (e) => {
    if (e.target.id === "portal-out") {
      localStorage.removeItem(KEY);
      docView = null;
      if (isPreview()) location.href = "portal.html";
      else location.reload();
      return;
    }
    const nav = e.target.closest("[data-portal-nav]");
    if (nav) {
      portalUi.screen = nav.dataset.portalNav || "dashboard";
      if (portalUi.screen !== "order") portalUi.orderId = "";
      render(portalState);
      return;
    }
    const filter = e.target.closest("[data-portal-filter]");
    if (filter) {
      portalUi.filter = filter.dataset.portalFilter || "all";
      if (portalUi.screen === "order") portalUi.screen = "dashboard";
      render(portalState);
      return;
    }
    const tab = e.target.closest("[data-portal-tab]");
    if (tab) {
      portalUi.tab = tab.dataset.portalTab || "overview";
      render(portalState);
      return;
    }
    const openOrder = e.target.closest("[data-open-order]");
    if (openOrder) {
      portalUi.orderId = openOrder.dataset.openOrder;
      portalUi.screen = "order";
      portalUi.tab = "overview";
      render(portalState);
      return;
    }
    if (e.target.closest("[data-new-order]")) {
      const user = portalState?.user || {};
      const sample = (portalState?.orders || [])[0] || {};
      sessionStorage.setItem(
        "max-checkout-profile",
        JSON.stringify({
          email: user.email || sample.email || "",
          coachFirst: user.coachFirst || sample.coachFirst || "",
          coachLast: user.coachLast || sample.coachLast || "",
          gym: user.gym || sample.gym || "",
        })
      );
      location.href = "shop.html";
      return;
    }
    if (e.target.id === "doc-print") {
      window.print();
      return;
    }
    if (e.target.closest("[data-doc-back]")) {
      docView = null;
      render(portalState);
      return;
    }
    const doc = e.target.closest("[data-doc]");
    if (doc) {
      const kind = doc.dataset.doc === "invoice" ? "invoice" : doc.dataset.doc === "license" ? "license" : "quote";
      const order = (portalState?.orders || []).find((item) => item.id === doc.dataset.order);
      if (kind === "license" && !isPaid(order || {})) return;
      if (kind === "license" && !doc.dataset.mix) return;
      docView = { orderId: doc.dataset.order, kind, mixId: doc.dataset.mix || "" };
      render(portalState);
      return;
    }
    const saveMix = e.target.closest("[data-save-mix]");
    if (saveMix) {
      const orderId = saveMix.dataset.saveMix;
      const mixId = saveMix.dataset.mix;
      const key = mixKey(orderId, mixId);
      const status = document.querySelector(`[data-mix-status="${key}"]`);
      const details = readMix(orderId, mixId);
      try {
        if (isPreview()) {
          const mix = previewMix(orderId, mixId);
          if (mix) Object.assign(mix, details);
          if (status) status.textContent = "Mix details saved in preview.";
          return;
        }
        if (status) status.textContent = "Saving…";
        render(await api({ action: "mix", orderId, mixId, ...details }));
        const next = document.querySelector(`[data-mix-status="${key}"]`);
        if (next) next.textContent = "Mix details saved.";
      } catch (err) {
        if (status) status.textContent = err.message;
      }
      return;
    }
    const save = e.target.closest("[data-save-songs]");
    if (!save) return;
    const orderId = save.dataset.saveSongs;
    const mixId = save.dataset.mix;
    const key = mixKey(orderId, mixId);
    const status = document.querySelector(`[data-song-status="${key}"]`);
    const songs = readSongs(orderId, mixId);
    try {
      if (isPreview()) {
        const mix = previewMix(orderId, mixId);
        if (mix) mix.songs = songs;
        if (status) status.textContent = "Songs saved in preview.";
        return;
      }
      if (status) status.textContent = "Saving…";
      render(await api({ action: "songs", orderId, mixId, songs }));
      const next = document.querySelector(`[data-song-status="${key}"]`);
      if (next) next.textContent = "Songs saved.";
    } catch (err) {
      if (status) status.textContent = err.message;
    }
  });

  document.body.addEventListener("input", (e) => {
    if (e.target.id !== "portal-search" || !portalState) return;
    portalUi.query = e.target.value;
    render(portalState, { focusSearch: true });
  });

  document.body.addEventListener("change", async (e) => {
    const invoiceDate = e.target.closest("[data-invoice-date]");
    if (invoiceDate) {
      const orderId = invoiceDate.dataset.invoiceDate;
      const day = invoiceDate.value;
      const order = (portalState?.orders || []).find((item) => item.id === orderId);
      const nextDay = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : dayFromIso(order?.createdAt);
      if (order) order.invoiceDate = nextDay === dayFromIso(order.createdAt) ? "" : nextDay;
      const printed = document.querySelector("[data-doc-date]");
      if (printed) printed.textContent = formatDay(nextDay);
      if (!invoiceDate.value) invoiceDate.value = nextDay;
      const note = document.querySelector(`[data-invoice-status="${orderId}"]`);
      if (isPreview()) {
        if (note) note.textContent = "Invoice date updated in preview.";
        return;
      }
      try {
        if (note) note.textContent = "Saving…";
        const data = await api({ action: "invoice-date", orderId, invoiceDate: order?.invoiceDate || "" });
        portalState = data;
        if (note) note.textContent = "Invoice date saved.";
      } catch (err) {
        if (note) note.textContent = err.message;
      }
      return;
    }
    const input = e.target.closest("[data-sheet]");
    if (!input || !input.files[0]) return;
    const file = input.files[0];
    const orderId = input.dataset.sheet;
    const mixId = input.dataset.mix;
    const key = mixKey(orderId, mixId);
    const status = document.querySelector(`[data-sheet-status="${key}"]`);
    if (!/\.pdf$/i.test(file.name)) {
      if (status) status.textContent = "Upload a PDF count sheet.";
      return;
    }
    try {
      if (isPreview()) {
        const mix = previewMix(orderId, mixId);
        if (mix) mix.countSheet = { id: `sheet-${Date.now()}`, name: file.name };
        render(portalState);
        const next = document.querySelector(`[data-sheet-status="${key}"]`);
        if (next) next.textContent = "Count sheet added in preview.";
        return;
      }
      if (status) status.textContent = "Uploading…";
      const data = await fileToBase64(file);
      render(await api({ action: "sheet", orderId, mixId, filename: file.name, data }));
      const next = document.querySelector(`[data-sheet-status="${key}"]`);
      if (next) next.textContent = "Count sheet uploaded.";
    } catch (err) {
      if (status) status.textContent = err.message;
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
    if (docView) return;
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
