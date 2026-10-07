const ORDER_EMAIL = "maxcheermusic@gmail.com";

async function loadPaySettings() {
  const defaults = { paypalMe: "danharrod12", venmo: "daniel-harrod-3" };
  try {
    const res = await fetch("/api/catalog");
    if (res.ok) {
      const data = await res.json();
      return {
        paypalMe: data.settings?.paypalMe || defaults.paypalMe,
        venmo: data.settings?.venmo || defaults.venmo,
      };
    }
  } catch {}
  try {
    const res = await fetch("/data/store.json");
    if (res.ok) {
      const data = await res.json();
      return {
        paypalMe: data.settings?.paypalMe || defaults.paypalMe,
        venmo: data.settings?.venmo || defaults.venmo,
      };
    }
  } catch {}
  return defaults;
}

function esc(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function collectOrder(form, method) {
  return {
    method,
    total: MaxCart.total(),
    items: MaxCart.items(),
    gym: form.gym.value.trim(),
    coachFirst: form.coachFirst.value.trim(),
    coachLast: form.coachLast.value.trim(),
    email: form.email.value.trim(),
    completionDate: form.completionDate.value,
    teamName: form.teamName.value.trim(),
    teamColors: form.teamColors.value.trim(),
    voiceover: form.voiceover.value.trim(),
    password: form.password.value,
    poNumber: form.poNumber.value.trim(),
    createdAt: new Date().toISOString(),
  };
}

function orderNote(order) {
  const items = (order.items || []).map((i) => `${i.title} x${i.qty}`).join(", ");
  return [
    `MAX Cheer Music order`,
    items,
    `Gym: ${order.gym}`,
    `Coach: ${order.coachFirst} ${order.coachLast}`,
    `Team: ${order.teamName}`,
    `Colors: ${order.teamColors}`,
    `Due: ${order.completionDate}`,
  ].join(" | ");
}

function formatMessage(order) {
  const items = (order.items || [])
    .map((i) => `- ${i.title} x${i.qty} — $${Number(i.price * i.qty).toLocaleString("en-US")}`)
    .join("\n");
  return [
    "NEW MAX CHEER MUSIC ORDER",
    "",
    `Payment method: ${order.method}`,
    order.poNumber ? `PO number: ${order.poNumber}` : "",
    `Total: $${Number(order.total || 0).toLocaleString("en-US")}`,
    "",
    "ITEMS",
    items,
    "",
    "CUSTOMER",
    `Gym or school: ${order.gym}`,
    `Coach: ${order.coachFirst} ${order.coachLast}`,
    `Email: ${order.email}`,
    `Desired completion date: ${order.completionDate}`,
    `Team name: ${order.teamName}`,
    `Team colors: ${order.teamColors}`,
    "",
    "VOICEOVER IDEAS",
    order.voiceover,
    "",
    "Next step: customer will enter 5 songs and upload a count sheet PDF in the portal.",
  ].join("\n");
}

async function sendViaFormSubmit(order) {
  const fallback = await fetch(`https://formsubmit.co/ajax/${ORDER_EMAIL}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      _captcha: false,
      _subject: `New mix order — ${order.gym} / ${order.teamName}`,
      _replyto: order.email,
      name: `${order.coachFirst} ${order.coachLast}`,
      email: order.email,
      message: formatMessage(order),
    }),
  });
  const fallbackData = await fallback.json().catch(() => ({}));
  const success = fallbackData.success === true || fallbackData.success === "true";
  if (fallback.ok && success) return { ok: true, emailed: true };
  throw new Error(fallbackData.message || "Could not send the order email.");
}

async function sendOrderEmail(order) {
  const res = await fetch("/api/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.emailed) return data;
  try {
    const emailed = await sendViaFormSubmit(order);
    if (emailed) return { ok: true, orderId: data.orderId, emailed: true };
  } catch {}
  if (res.ok) return data;
  throw new Error(data.error || "Could not send the order.");
}

document.addEventListener("DOMContentLoaded", async () => {
  const lines = document.getElementById("checkout-lines");
  const totalEl = document.getElementById("checkout-total");
  const form = document.getElementById("order-form");
  const status = document.getElementById("pay-status");
  const items = MaxCart.items();

  if (!items.length) {
    lines.innerHTML = `<p class="cart-empty">Your cart is empty.</p><p><a class="btn" href="shop.html">Shop mixes</a></p>`;
    totalEl.textContent = "";
    document.getElementById("pay-paypal").disabled = true;
    document.getElementById("pay-venmo").disabled = true;
    document.getElementById("pay-po").disabled = true;
    return;
  }

  lines.innerHTML = items
    .map((i) => `<div class="cart-line"><div><strong>${i.title}</strong><p>Qty ${i.qty}</p></div><p>${money(i.price * i.qty)}</p></div>`)
    .join("");
  totalEl.textContent = `Total ${money(MaxCart.total())}`;

  const settings = await loadPaySettings();
  const amount = MaxCart.total();
  if (form.completionDate) form.completionDate.min = new Date().toISOString().slice(0, 10);

  async function pay(method) {
    if (!form.reportValidity()) return;
    document.getElementById("pay-paypal").disabled = true;
    document.getElementById("pay-venmo").disabled = true;
    document.getElementById("pay-po").disabled = true;
    const order = collectOrder(form, method);
    localStorage.setItem("max-music-last-order", JSON.stringify(order));
    status.textContent = "Sending your order…";

    let result;
    try {
      result = await sendOrderEmail(order);
    } catch {
      status.textContent = "Could not send the order. Check the form and try again.";
      document.getElementById("pay-paypal").disabled = false;
      document.getElementById("pay-venmo").disabled = false;
      document.getElementById("pay-po").disabled = false;
      return;
    }

    MaxCart.clear();
    const portalNote = "Log in to the Portal with this email and password to enter your 5 songs and upload your count sheet.";
    const mailNote = result.emailed
      ? "MAX Cheer Music has the order."
      : "The order is saved. If email is delayed, MAX still has it in admin.";
    const payNote =
      method === "paypal"
        ? "Complete PayPal in the new tab."
        : method === "School PO"
          ? "This was marked as a school PO. MAX will follow up."
          : "Complete Venmo in the new tab.";

    const note = encodeURIComponent(orderNote(order));
    if (method === "paypal") {
      const handle = (settings.paypalMe || "").replace(/^@/, "");
      if (handle) window.open(`https://www.paypal.com/paypalme/${handle}/${amount}`, "_blank");
    } else if (method !== "School PO") {
      const handle = (settings.venmo || "").replace(/^@/, "");
      if (handle) window.open(`https://venmo.com/${handle}?txn=pay&amount=${amount}&note=${note}`, "_blank");
    }

    document.querySelector(".checkout-grid").innerHTML = `
      <article class="checkout-thanks">
        <h2>Order received</h2>
        <p>${mailNote} ${payNote}</p>
        <p><strong>${esc(order.gym)}</strong> · ${esc(order.teamName)} · ${money(order.total)}</p>
        <p class="hint">${portalNote}</p>
        <p><a class="btn" href="portal.html">Open portal</a> <a class="btn btn-outline" href="sheets.html">Fill 8-count sheet</a></p>
      </article>`;
  }

  document.getElementById("pay-paypal").addEventListener("click", () => pay("paypal"));
  document.getElementById("pay-venmo").addEventListener("click", () => pay("venmo"));
  document.getElementById("pay-po").addEventListener("click", () => pay("School PO"));
});
