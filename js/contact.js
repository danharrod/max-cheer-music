const CONTACT_EMAIL = "maxcheermusic@gmail.com";

async function sendContact(payload) {
  const api = await fetch("/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await api.json().catch(() => ({}));
  if (api.ok) return data;

  const fallback = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      _captcha: false,
      _subject: `Website contact — ${payload.first} ${payload.last}`,
      _replyto: payload.email,
      name: `${payload.first} ${payload.last}`.trim(),
      email: payload.email,
      message: payload.message,
    }),
  });
  const fallbackData = await fallback.json().catch(() => ({}));
  const success = fallbackData.success === true || fallbackData.success === "true";
  if (fallback.ok && success) return { ok: true, emailed: true };
  throw new Error(data.error || "Could not send the message.");
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("form[data-contact]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const status = form.querySelector("[data-contact-status]");
      const button = form.querySelector("button[type=submit]");
      const payload = {
        first: form.first.value.trim(),
        last: form.last.value.trim(),
        email: form.email.value.trim(),
        message: form.message.value.trim(),
      };
      if (button) button.disabled = true;
      if (status) status.textContent = "Sending…";
      try {
        await sendContact(payload);
        form.reset();
        if (status) status.textContent = "Message sent. MAX will get back to you shortly.";
      } catch {
        if (status) status.textContent = "Could not send. Email maxcheermusic@gmail.com instead.";
        if (button) button.disabled = false;
      }
    });
  });
});
