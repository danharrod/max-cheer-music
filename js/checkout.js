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

async function sendOrderEmail(order) {
  try {
    const api = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    if (api.ok) return true;
  } catch {}

  const res = await fetch(`https://formsubmit.co/ajax/${ORDER_EMAIL}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      _subject: `New mix order — ${order.gym} / ${order.teamName}`,
      _replyto: order.email,
      name: `${order.coachFirst} ${order.coachLast}`,
      email: order.email,
      message: formatMessage(order),
    }),
  });
  return res.ok;
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

  async function pay(method) {
    if (!form.reportValidity()) return;
    const order = collectOrder(form, method);
    localStorage.setItem("max-music-last-order", JSON.stringify(order));
    status.textContent = "Sending your order…";

    const sent = await sendOrderEmail(order).catch(() => false);
    if (!sent) {
      status.textContent = "Could not send the order email. Check the form and try again.";
      return;
    }

    const note = encodeURIComponent(orderNote(order));
    if (method === "paypal") {
      const handle = (settings.paypalMe || "").replace(/^@/, "");
      if (!handle) {
        status.textContent = "Order emailed to MAX Cheer Music. Add your PayPal.me name in admin to enable PayPal checkout.";
        return;
      }
      window.open(`https://www.paypal.com/paypalme/${handle}/${amount}`, "_blank");
      status.textContent = "Order emailed. Complete PayPal, then log in to the Portal to enter your 5 songs and upload your count sheet.";
      return;
    }

    if (method === "School PO") {
      status.textContent = "Order emailed as a school PO. Log in to the Portal to enter your 5 songs and upload your count sheet. MAX will follow up on the purchase order.";
      return;
    }

    const handle = (settings.venmo || "").replace(/^@/, "");
    if (!handle) {
      status.textContent = "Order emailed to MAX Cheer Music. Add your Venmo name in admin to enable Venmo checkout.";
      return;
    }
    window.open(`https://venmo.com/${handle}?txn=pay&amount=${amount}&note=${note}`, "_blank");
    status.textContent = "Order emailed. Complete Venmo, then log in to the Portal to enter your 5 songs and upload your count sheet.";
  }

  document.getElementById("pay-paypal").addEventListener("click", () => pay("paypal"));
  document.getElementById("pay-venmo").addEventListener("click", () => pay("venmo"));
  document.getElementById("pay-po").addEventListener("click", () => pay("School PO"));
});
