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
  return defaults;
}

function esc(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function idempotencyKey() {
  const keyName = "max-order-key";
  let key = sessionStorage.getItem(keyName);
  if (!key) {
    key = `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(keyName, key);
  }
  return key;
}

function collectOrder(form, method) {
  return {
    method,
    items: MaxCart.items().map((i) => ({ id: i.id, qty: i.qty })),
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
    idempotencyKey: idempotencyKey(),
  };
}

function orderNote(order, items, total) {
  const names = (items || []).map((i) => `${i.title} x${i.qty}`).join(", ");
  return [
    `MAX Cheer Music order`,
    names,
    `Gym: ${order.gym}`,
    `Coach: ${order.coachFirst} ${order.coachLast}`,
    `Team: ${order.teamName}`,
    `Colors: ${order.teamColors}`,
    `Requested date: ${order.completionDate}`,
  ].join(" | ");
}

function firstInvalid(form) {
  const field = [...form.querySelectorAll("input, textarea, select")].find((el) => !el.checkValidity());
  if (!field) return false;
  field.focus({ preventScroll: false });
  field.scrollIntoView({ block: "center", behavior: "smooth" });
  if (typeof field.reportValidity === "function") field.reportValidity();
  return true;
}

function setPayEnabled(on) {
  ["pay-paypal", "pay-venmo", "pay-po"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !on;
  });
}

async function placeOrder(order) {
  const res = await fetch("/api/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not save the order.");
  return data;
}

document.addEventListener("DOMContentLoaded", async () => {
  const lines = document.getElementById("checkout-lines");
  const totalEl = document.getElementById("checkout-total");
  const form = document.getElementById("order-form");
  const status = document.getElementById("pay-status");
  const items = MaxCart.items();
  let submitting = false;

  if (!items.length) {
    lines.innerHTML = `<p class="cart-empty">Your cart is empty.</p><p><a class="btn" href="shop.html">Shop mixes</a></p>`;
    totalEl.textContent = "";
    setPayEnabled(false);
    return;
  }

  lines.innerHTML = items
    .map((i) => `<div class="cart-line"><div><strong>${esc(i.title)}</strong><p>Qty ${i.qty}</p></div><p>${money(i.price * i.qty)}</p></div>`)
    .join("");
  totalEl.textContent = `Total ${money(MaxCart.total())}`;

  const settings = await loadPaySettings();
  const amount = MaxCart.total();
  if (form.completionDate) form.completionDate.min = new Date().toISOString().slice(0, 10);

  async function pay(method) {
    if (submitting) return;
    if (firstInvalid(form)) {
      status.textContent = "Check the highlighted field, then try again. Your answers stay on this page.";
      return;
    }
    submitting = true;
    setPayEnabled(false);
    const order = collectOrder(form, method);
    status.textContent = "Saving your order…";

    let result;
    try {
      result = await placeOrder(order);
    } catch (err) {
      status.textContent = err.message || "Could not save the order. Check the form and try again.";
      submitting = false;
      setPayEnabled(true);
      return;
    }

    sessionStorage.removeItem("max-order-key");
    MaxCart.clear();
    const mailNote = result.emailed
      ? "MAX Cheer Music has the order."
      : "The order is saved. If email is delayed, MAX still has it in admin.";
    const payNote =
      method === "paypal"
        ? "PayPal opened in a new tab so you can send payment. That click does not mark the order paid."
        : method === "School PO"
          ? "This was saved as a school PO. MAX will follow up. No payment was taken on this page."
          : "Venmo opened in a new tab so you can send payment. That click does not mark the order paid.";

    const note = encodeURIComponent(orderNote(order, items, amount));
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
        <p><strong>${esc(order.gym)}</strong> · ${esc(order.teamName)} · ${money(amount)}</p>
        <p class="hint">Log in to the Portal with this email and your portal password to enter your 5 songs and upload your count sheet. Mix work starts after those are in. The date you requested is not confirmed until MAX emails you.</p>
        <p><a class="btn" href="portal.html">Open portal</a> <a class="btn btn-outline" href="sheets.html">Fill 8-count sheet</a></p>
      </article>`;
  }

  document.getElementById("pay-paypal").addEventListener("click", () => pay("paypal"));
  document.getElementById("pay-venmo").addEventListener("click", () => pay("venmo"));
  document.getElementById("pay-po").addEventListener("click", () => pay("School PO"));
});
