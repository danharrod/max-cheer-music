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

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function earliestCompletionDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return isoDate(date);
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

function mixSlots(items) {
  const slots = [];
  for (const item of items || []) {
    const qty = Math.max(1, Math.min(20, Math.floor(Number(item.qty) || 1)));
    for (let n = 0; n < qty; n += 1) slots.push(item);
  }
  return slots;
}

function mixField(step, name) {
  return step.querySelector(`[data-mix-field="${name}"]`)?.value.trim() || "";
}

function collectMixes(form) {
  return [...form.querySelectorAll('[data-step="mix"]')].map((step) => ({
    teamName: mixField(step, "teamName"),
    teamColors: mixField(step, "teamColors"),
    voiceover: mixField(step, "voiceover"),
    completionDate: mixField(step, "completionDate"),
  }));
}

function collectOrder(form, method) {
  const mixes = collectMixes(form);
  const first = mixes[0] || {};
  return {
    method,
    items: MaxCart.items().map((i) => ({ id: i.id, qty: i.qty })),
    gym: form.gym.value.trim(),
    coachFirst: form.coachFirst.value.trim(),
    coachLast: form.coachLast.value.trim(),
    email: form.email.value.trim(),
    completionDate: first.completionDate || "",
    teamName: first.teamName || "",
    teamColors: first.teamColors || "",
    voiceover: first.voiceover || "",
    mixes,
    password: form.password.value,
    poNumber: form.poNumber.value.trim(),
    idempotencyKey: idempotencyKey(),
  };
}

function orderNote(order, items, total) {
  const names = (items || []).map((i) => `${i.title} x${i.qty}`).join(", ");
  const teams = (order.mixes || []).map((mix) => mix.teamName).filter(Boolean).join(", ");
  return [
    `MAX Cheer Music order`,
    names,
    `Gym: ${order.gym}`,
    `Coach: ${order.coachFirst} ${order.coachLast}`,
    `Teams: ${teams || order.teamName}`,
  ].join(" | ");
}

function renumberSteps(form) {
  [...form.querySelectorAll(".checkout-step")].forEach((step, index) => {
    const badge = step.querySelector(".step-index");
    if (badge) badge.textContent = String(index + 1);
  });
}

function buildMixSteps(form, items) {
  const template = document.getElementById("mix-step-template");
  const portal = form.querySelector('[data-step="portal"]');
  if (!template || !portal) return;
  const slots = mixSlots(items);
  const earliest = earliestCompletionDate();
  slots.forEach((slot, index) => {
    const step = template.content.firstElementChild.cloneNode(true);
    step.dataset.mixIndex = String(index);
    const label = step.querySelector(".mix-step-label");
    const hint = step.querySelector(".mix-step-hint");
    if (slots.length > 1) {
      if (label) label.textContent = slot.title || "Mix";
      if (hint) hint.textContent = `Mix ${index + 1} of ${slots.length}. These details are only for ${slot.title || "this mix"}. The next mix is a separate step.`;
    } else if (hint) {
      hint.textContent = "These details are for this mix.";
    }
    step.querySelectorAll("[data-mix-field]").forEach((field) => {
      const id = `mix-${index}-${field.dataset.mixField}`;
      field.id = id;
      const fieldLabel = step.querySelector(`label[data-for-field="${field.dataset.mixField}"]`);
      if (fieldLabel) fieldLabel.htmlFor = id;
    });
    const date = step.querySelector('[data-mix-field="completionDate"]');
    if (date) {
      date.min = earliest;
      date.value = earliest;
    }
    portal.before(step);
  });
  renumberSteps(form);
}

function stepFields(step) {
  return [...step.querySelectorAll(".step-body input, .step-body textarea, .step-body select")];
}

function showInvalid(field) {
  field.focus({ preventScroll: false });
  field.scrollIntoView({ block: "center", behavior: "smooth" });
  if (typeof field.reportValidity === "function") field.reportValidity();
}

function enforceMinLength(el) {
  el.setCustomValidity("");
  const min = el.minLength;
  if (min > 0 && el.value && el.value.length < min) {
    el.setCustomValidity(`Use at least ${min} characters.`);
  }
}

function sectionInvalid(step) {
  const field = stepFields(step).find((el) => {
    enforceMinLength(el);
    return !el.checkValidity();
  });
  if (!field) return false;
  showInvalid(field);
  return true;
}

function stepRecap(form, step) {
  if (step.dataset.step === "contact") {
    const coach = `${form.coachFirst.value.trim()} ${form.coachLast.value.trim()}`.trim();
    return [form.gym.value.trim(), coach, form.email.value.trim()].filter(Boolean).join(" · ");
  }
  if (step.dataset.step === "mix") {
    return [mixField(step, "teamName"), mixField(step, "completionDate"), mixField(step, "teamColors")].filter(Boolean).join(" · ");
  }
  if (step.dataset.step === "portal") return "Portal password is set";
  return "";
}

function initCheckoutSteps(form) {
  const steps = [...form.querySelectorAll(".checkout-step")];
  if (!steps.length) {
    return {
      openInvalid() {
        const field = [...form.querySelectorAll("input, textarea, select")].find((el) => {
          enforceMinLength(el);
          return !el.checkValidity();
        });
        if (!field) return false;
        showInvalid(field);
        return true;
      },
    };
  }

  let index = 0;

  function apply() {
    steps.forEach((step, i) => {
      const current = i === index;
      const done = i < index;
      step.classList.toggle("is-current", current);
      step.classList.toggle("is-done", done);
      step.classList.toggle("is-locked", i > index);
      stepFields(step).forEach((el) => {
        el.disabled = !current;
      });
      const body = step.querySelector(".step-body");
      const recapEl = step.querySelector(".step-recap");
      const edit = step.querySelector(".step-edit");
      if (body) body.hidden = !current;
      if (recapEl) {
        recapEl.hidden = !done;
        recapEl.textContent = done ? stepRecap(form, step) : "";
      }
      if (edit) edit.hidden = !done;
    });
    const onPayment = steps[index]?.dataset.step === "payment";
    const actions = document.querySelector(".checkout-actions");
    if (actions) actions.hidden = !onPayment;
    setPayEnabled(onPayment);
  }

  function open(next, { focus = true, scroll = true } = {}) {
    index = next;
    apply();
    const step = steps[index];
    if (!step) return;
    if (scroll) step.scrollIntoView({ block: "start", behavior: "smooth" });
    if (!focus) return;
    if (step.dataset.step === "payment") {
      document.getElementById("poNumber")?.focus({ preventScroll: true });
      return;
    }
    const field = stepFields(step).find((el) => el.required && !el.value.trim()) || stepFields(step)[0];
    field?.focus({ preventScroll: true });
  }

  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("click", (event) => {
    const nextBtn = event.target.closest(".step-next");
    if (nextBtn) {
      const step = nextBtn.closest(".checkout-step");
      if (steps.indexOf(step) !== index) return;
      if (sectionInvalid(step)) return;
      open(Math.min(steps.length - 1, index + 1));
      return;
    }
    const editBtn = event.target.closest(".step-edit");
    if (!editBtn) return;
    const i = steps.indexOf(editBtn.closest(".checkout-step"));
    if (i >= 0) open(i);
  });

  apply();

  return {
    openInvalid() {
      steps.forEach((step) => stepFields(step).forEach((el) => {
        el.disabled = false;
      }));
      const field = [...form.querySelectorAll("input, textarea, select")].find((el) => {
        enforceMinLength(el);
        return !el.checkValidity();
      });
      if (!field) {
        apply();
        return false;
      }
      const i = steps.indexOf(field.closest(".checkout-step"));
      if (i >= 0) index = i;
      apply();
      showInvalid(field);
      return true;
    },
  };
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

function applyCheckoutProfile(form) {
  if (!form) return;
  let profile = null;
  try {
    profile = JSON.parse(sessionStorage.getItem("max-checkout-profile") || "null");
  } catch {}
  if (!profile) return;
  ["gym", "coachFirst", "coachLast", "email"].forEach((name) => {
    const field = form.elements[name];
    if (field && !field.value && profile[name]) field.value = profile[name];
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const lines = document.getElementById("checkout-lines");
  const totalEl = document.getElementById("checkout-total");
  const form = document.getElementById("order-form");
  applyCheckoutProfile(form);
  const status = document.getElementById("pay-status");
  const items = MaxCart.items();
  if (items.length) buildMixSteps(form, items);
  else renumberSteps(form);
  const steps = initCheckoutSteps(form);
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
  async function pay(method) {
    if (submitting) return;
    if (steps.openInvalid()) {
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
        <p><strong>${esc(order.gym)}</strong> · ${esc((order.mixes || []).map((mix) => mix.teamName).filter(Boolean).join(" · ") || order.teamName)} · ${money(amount)}</p>
        <p class="hint">Log in to the Portal with this email and your portal password to enter your 5 songs and upload your count sheet. Mix work starts after those are in. The date you requested is not confirmed until MAX emails you.</p>
        <p><a class="btn" href="portal.html">Open portal</a> <a class="btn btn-outline" href="sheets.html">Fill 8-count sheet</a></p>
      </article>`;
  }

  document.getElementById("pay-paypal").addEventListener("click", () => pay("paypal"));
  document.getElementById("pay-venmo").addEventListener("click", () => pay("venmo"));
  document.getElementById("pay-po").addEventListener("click", () => pay("School PO"));
});
