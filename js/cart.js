const CART_KEY = "max-music-cart";
const PRODUCT_ORDER = ["allstar", "school", "prep", "novice"];

const PRODUCTS = {
  school: { id: "school", name: "School team", title: "Cheer mix school", price: 750 },
  novice: { id: "novice", name: "Allstar novice", title: "Cheer mix novice", price: 600 },
  prep: { id: "prep", name: "Allstar prep", title: "Cheer mix prep", price: 700 },
  allstar: { id: "allstar", name: "Allstar", title: "Cheer mix allstar", price: 1100 },
};

function productList() {
  const extra = Object.keys(PRODUCTS).filter((id) => !PRODUCT_ORDER.includes(id));
  return [...PRODUCT_ORDER, ...extra].map((id) => PRODUCTS[id]).filter(Boolean);
}

function money(n) {
  return `$${Number(n).toLocaleString("en-US")}`;
}

function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  MaxCart.render();
}

function count() {
  return readCart().reduce((n, i) => n + i.qty, 0);
}

function total() {
  return readCart().reduce((n, i) => n + i.price * i.qty, 0);
}

const MaxCart = {
  add(id) {
    const product = PRODUCTS[id];
    if (!product) return;
    const items = readCart();
    const existing = items.find((i) => i.id === id);
    if (existing) existing.qty += 1;
    else items.push({ ...product, qty: 1 });
    writeCart(items);
    MaxCart.open();
  },
  remove(id) {
    writeCart(readCart().filter((i) => i.id !== id));
  },
  clear() {
    writeCart([]);
  },
  setQty(id, qty) {
    const items = readCart();
    const item = items.find((i) => i.id === id);
    if (!item) return;
    item.qty = Math.max(1, Number(qty) || 1);
    writeCart(items);
  },
  items: readCart,
  total,
  count,
  open() {
    this._lastFocus = document.activeElement;
    document.body.classList.add("cart-open");
    const drawer = document.querySelector(".cart-drawer");
    if (drawer) {
      drawer.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => document.querySelector(".cart-x")?.focus());
    }
  },
  close() {
    document.body.classList.remove("cart-open");
    document.querySelector(".cart-drawer")?.setAttribute("aria-hidden", "true");
    if (this._lastFocus && typeof this._lastFocus.focus === "function") this._lastFocus.focus();
  },
  mount() {
    if (document.querySelector(".cart-drawer")) {
      MaxCart.render();
      return;
    }
    document.body.insertAdjacentHTML(
      "beforeend",
      `
      <div class="cart-scrim" data-cart-close></div>
      <aside id="cart-drawer" class="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" aria-hidden="true">
        <div class="cart-drawer-head">
          <h2 id="cart-title">Cart</h2>
          <button type="button" class="cart-x" data-cart-close aria-label="Close cart">×</button>
        </div>
        <div class="cart-drawer-body"></div>
        <div class="cart-drawer-foot"></div>
      </aside>
    `
    );
    document.body.addEventListener("click", (e) => {
      if (e.target.closest("[data-cart-close]")) MaxCart.close();
      if (e.target.closest("[data-cart-open]")) {
        e.preventDefault();
        MaxCart.open();
      }
      const add = e.target.closest("[data-add]");
      if (add) {
        e.preventDefault();
        MaxCart.add(add.dataset.add);
      }
      const remove = e.target.closest("[data-remove]");
      if (remove) MaxCart.remove(remove.dataset.remove);
      const play = e.target.closest("[data-play]");
      if (play) toggleSample(play.dataset.play);
    });
    document.body.addEventListener("change", (e) => {
      const qty = e.target.closest("[data-qty]");
      if (qty) MaxCart.setQty(qty.dataset.qty, qty.value);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && document.body.classList.contains("cart-open")) {
        e.preventDefault();
        MaxCart.close();
        return;
      }
      if (e.key !== "Tab" || !document.body.classList.contains("cart-open")) return;
      const drawer = document.querySelector(".cart-drawer");
      if (!drawer) return;
      const items = [...drawer.querySelectorAll("a, button, input, select, textarea")].filter((el) => !el.disabled);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    MaxCart.render();
    hydrateFromCatalog();
    MaxCart.loadCatalog();
  },
  async loadCatalog() {
    try {
      const res = await fetch(`/api/catalog?t=${Date.now()}`);
      if (!res.ok) {
        hydrateFromCatalog();
        return;
      }
      const data = await res.json();
      (data.products || []).forEach((p) => {
        PRODUCTS[p.id] = { ...PRODUCTS[p.id], ...p };
      });
      window.SETTINGS = data.settings || {};
      window.MAX_CLIPS = Array.isArray(data.clips) ? data.clips : [];
      hydrateFromCatalog();
      MaxCart.render();
    } catch {
      hydrateFromCatalog();
    }
  },
  render() {
    const items = readCart();
    const n = count();
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = n ? `Cart (${n})` : "Cart";
    });
    const body = document.querySelector(".cart-drawer-body");
    const foot = document.querySelector(".cart-drawer-foot");
    if (!body || !foot) return;
    if (!items.length) {
      body.innerHTML = `<p class="cart-empty">Your cart is empty.</p>`;
      foot.innerHTML = `<a class="btn" href="shop.html">Shop mixes</a>`;
      return;
    }
    body.innerHTML = items
      .map(
        (i) => `
      <div class="cart-line">
        <div>
          <strong>${i.title}</strong>
          <p>${money(i.price)}</p>
        </div>
        <div class="cart-line-actions">
          <input data-qty="${i.id}" type="number" min="1" value="${i.qty}" aria-label="Quantity for ${i.title}" />
          <button type="button" data-remove="${i.id}">Remove ${i.title}</button>
        </div>
      </div>`
      )
      .join("");
    foot.innerHTML = `
      <p class="cart-total">Total ${money(total())}</p>
      <a class="btn" href="checkout.html">Checkout</a>
    `;
  },
};

function hydrateFromCatalog() {
  document.querySelectorAll(".mix-card").forEach((card) => {
    const id = card.querySelector("[data-add]")?.dataset.add;
    const p = PRODUCTS[id];
    if (!p) return;
    const name = card.querySelector("h3");
    const price = card.querySelector(".price");
    if (name) name.textContent = p.name;
    if (price) price.textContent = money(p.price);
  });

  const shop = document.querySelector(".shop-grid");
  if (shop) {
    shop.innerHTML = productList()
      .map(
        (p) => `
      <article class="product">
        <h2>${p.title}</h2>
        <p class="price">${money(p.price)}</p>
        <p>${p.description || ""}</p>
        <ul class="package-meta">
          <li>Custom ${p.name || "team"} mix</li>
          <li>5 songs from songsforcheer.com, entered in the Portal</li>
          <li>Count sheet PDF uploaded in the Portal before mix work starts</li>
        </ul>
        <p><button class="btn" type="button" data-add="${p.id}">Add to cart</button></p>
      </article>`
      )
      .join("");
  }

  const samples = document.querySelector(".samples");
  if (samples) {
    const clips = collectSampleClips();
    samples.innerHTML = clips.length
      ? clips
          .map((s) => {
            const media =
              s.kind === "video"
                ? `<video class="sample-video" data-audio="${s.id}" src="${s.url}" preload="metadata" playsinline webkit-playsinline></video>`
                : `<audio data-audio="${s.id}" src="${s.url}" preload="metadata" crossorigin="anonymous"></audio>`;
            return `
      <article class="sample${s.kind === "video" ? " has-video" : ""}" data-sample-row="${s.id}">
        <button class="play" type="button" data-play="${s.id}" aria-label="Play ${s.name}">Play</button>
        <div class="sample-meta">
          <h3>${s.name}</h3>
          ${s.kind === "video" ? "" : `<canvas class="wave" data-wave="${s.id}" aria-hidden="true"></canvas>`}
          <div class="sample-time">
            <span data-elapsed="${s.id}">0:00</span>
            <input class="sample-seek" data-seek="${s.id}" type="range" min="0" max="0" value="0" step="0.1" aria-label="Seek ${s.name}" disabled />
            <span data-duration="${s.id}">0:00</span>
          </div>
          <p class="sample-status" data-sample-status="${s.id}">Loading…</p>
        </div>
        ${media}
      </article>`;
          })
          .join("")
      : `<p class="hint">Sample clips will show here after MAX uploads them.</p>`;
    bindSamplePlayers();
  }
}

function collectSampleClips() {
  const fromCatalog = (window.MAX_CLIPS || []).filter((s) => s && s.url);
  if (fromCatalog.length) {
    return fromCatalog.map((s, i) => ({
      id: s.id || `clip-${i}`,
      name: s.name || "Sample",
      url: s.url,
      kind: s.kind === "video" || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(s.url || "") ? "video" : "audio",
    }));
  }
  const clips = [];
  productList().forEach((p) => {
    const list = Array.isArray(p.samples) && p.samples.length
      ? p.samples
      : p.sampleUrl
        ? [{ id: p.id, name: p.sampleName || p.name, url: p.sampleUrl, kind: p.sampleKind }]
        : [];
    list.forEach((s, i) => {
      if (!s.url) return;
      clips.push({
        id: s.id || `${p.id}-${i}`,
        name: s.name || p.sampleName || p.name,
        url: s.url,
        kind: s.kind === "video" || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(s.url || "") ? "video" : "audio",
      });
    });
  });
  return clips;
}

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const m = Math.floor(value / 60);
  const s = Math.floor(value % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function setPlayButton(id, playing, name) {
  const play = document.querySelector(`[data-play="${id}"]`);
  if (!play) return;
  play.textContent = playing ? "Pause" : "Play";
  play.setAttribute("aria-label", `${playing ? "Pause" : "Play"} ${name || ""}`.trim());
}

function pauseOtherSamples(id) {
  document.querySelectorAll("[data-audio]").forEach((el) => {
    if (el.getAttribute("data-audio") === id) return;
    el.pause();
    const otherId = el.getAttribute("data-audio");
    setPlayButton(otherId, false, document.querySelector(`[data-sample-row="${otherId}"] h3`)?.textContent);
    stopWave(otherId);
  });
}

function toggleSample(id) {
  const media = document.querySelector(`[data-audio="${id}"]`);
  const play = document.querySelector(`[data-play="${id}"]`);
  const status = document.querySelector(`[data-sample-status="${id}"]`);
  const name = document.querySelector(`[data-sample-row="${id}"] h3`)?.textContent || "sample";
  if (!media || !play) return;
  if (play.disabled) return;
  pauseOtherSamples(id);
  stopAllWaves(id);
  if (media.paused) {
    media.play().then(() => {
      setPlayButton(id, true, name);
      startWave(id, media);
      if (status && !status.classList.contains("is-error")) status.textContent = "";
    }).catch(() => {
      setPlayButton(id, false, name);
      if (status) {
        status.classList.add("is-error");
        status.textContent = "Could not play this sample.";
      }
    });
  } else {
    media.pause();
    setPlayButton(id, false, name);
    stopWave(id);
  }
}

function bindSamplePlayers() {
  document.querySelectorAll("[data-audio]").forEach((media) => {
    const id = media.getAttribute("data-audio");
    const seek = document.querySelector(`[data-seek="${id}"]`);
    const elapsed = document.querySelector(`[data-elapsed="${id}"]`);
    const duration = document.querySelector(`[data-duration="${id}"]`);
    const status = document.querySelector(`[data-sample-status="${id}"]`);
    const play = document.querySelector(`[data-play="${id}"]`);
    const name = document.querySelector(`[data-sample-row="${id}"] h3`)?.textContent || "sample";

    const stamp = () => {
      if (elapsed) elapsed.textContent = formatTime(media.currentTime);
      if (duration) duration.textContent = formatTime(media.duration);
      if (seek && Number.isFinite(media.duration)) {
        seek.max = String(media.duration);
        if (!seek.matches(":active")) seek.value = String(media.currentTime || 0);
      }
    };

    media.addEventListener("loadedmetadata", () => {
      if (seek) {
        seek.disabled = false;
        seek.max = String(media.duration || 0);
      }
      stamp();
      if (status && !status.classList.contains("is-error")) status.textContent = "";
    });
    media.addEventListener("timeupdate", stamp);
    media.addEventListener("waiting", () => {
      if (status && !status.classList.contains("is-error")) status.textContent = "Loading…";
    });
    media.addEventListener("playing", () => {
      if (status && !status.classList.contains("is-error")) status.textContent = "";
    });
    media.addEventListener("error", () => {
      if (play) play.disabled = true;
      if (status) {
        status.classList.add("is-error");
        status.textContent = "Could not load this sample.";
      }
    });
    media.addEventListener("ended", () => {
      setPlayButton(id, false, name);
      stopWave(id);
      stamp();
    });
    seek?.addEventListener("input", () => {
      const next = Number(seek.value);
      if (Number.isFinite(next)) media.currentTime = next;
      stamp();
    });
  });
}

let audioCtx = null;
const audioTaps = new Map();
const waveRafs = new Map();

function getAudioTap(audio) {
  if (audioTaps.has(audio)) return audioTaps.get(audio);
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(audio);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    const tap = { analyser, freq: new Uint8Array(analyser.frequencyBinCount) };
    audioTaps.set(audio, tap);
    return tap;
  } catch {
    const tap = { analyser: null, freq: null };
    audioTaps.set(audio, tap);
    return tap;
  }
}

function paintWave(canvas, tap, playing, t) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  const gap = Math.max(1.5 * dpr, 3);
  const bars = Math.max(24, Math.floor(w / (4 * dpr)));
  const bw = Math.max(1.5 * dpr, w / bars - gap);
  const mid = h / 2;
  if (playing && tap.analyser) tap.analyser.getByteFrequencyData(tap.freq);
  const hasLive = playing && tap.freq && tap.freq.some((v) => v > 8);
  for (let i = 0; i < bars; i++) {
    const idx = Math.floor((i / bars) * ((tap.freq && tap.freq.length) || 64) * 0.62);
    const live = hasLive ? tap.freq[idx] / 255 : 0;
    const idle = 0.1 + 0.06 * Math.sin(t / 420 + i * 0.28);
    const fake = 0.18 + 0.62 * Math.abs(Math.sin(t / 95 + i * 0.38)) * (0.45 + 0.55 * Math.sin(t / 160 + i * 0.05));
    const amp = playing ? (hasLive ? Math.max(0.12, Math.pow(live, 1.15) * 0.92 + idle * 0.2) : fake) : idle;
    const bh = Math.max(2 * dpr, amp * (h * 0.9));
    const x = i * (w / bars) + gap / 2;
    const y = mid - bh / 2;
    const g = ctx.createLinearGradient(0, y, 0, y + bh);
    g.addColorStop(0, "#8ec2ff");
    g.addColorStop(0.45, "#4d86ff");
    g.addColorStop(1, "#1636c9");
    ctx.fillStyle = g;
    ctx.globalAlpha = playing ? 0.95 : 0.28;
    const r = Math.min(bw / 2, 2 * dpr);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, r);
    else ctx.rect(x, y, bw, bh);
    ctx.fill();
  }
}

function startWave(id, audio) {
  const canvas = document.querySelector(`[data-wave="${id}"]`);
  const row = document.querySelector(`[data-sample-row="${id}"]`);
  if (!canvas) return;
  row?.classList.add("is-playing");
  const tap = getAudioTap(audio);
  audioCtx?.resume?.();
  cancelAnimationFrame(waveRafs.get(id) || 0);
  const tick = (t) => {
    paintWave(canvas, tap, !audio.paused, t);
    if (!audio.paused) waveRafs.set(id, requestAnimationFrame(tick));
    else stopWave(id);
  };
  waveRafs.set(id, requestAnimationFrame(tick));
}

function stopWave(id) {
  cancelAnimationFrame(waveRafs.get(id) || 0);
  waveRafs.delete(id);
  const canvas = document.querySelector(`[data-wave="${id}"]`);
  const row = document.querySelector(`[data-sample-row="${id}"]`);
  row?.classList.remove("is-playing");
  if (canvas) paintWave(canvas, { analyser: null, freq: null }, false, 0);
}

function stopAllWaves(exceptId) {
  document.querySelectorAll("[data-wave]").forEach((el) => {
    if (el.dataset.wave === exceptId) return;
    stopWave(el.dataset.wave);
  });
}

function idleWaves() {
  document.querySelectorAll("[data-wave]").forEach((canvas) => {
    paintWave(canvas, { analyser: null, freq: null }, false, 0);
  });
}

const _hydrate = hydrateFromCatalog;
hydrateFromCatalog = function () {
  _hydrate();
  requestAnimationFrame(idleWaves);
};

window.MaxCart = MaxCart;
window.PRODUCTS = PRODUCTS;
window.money = money;
