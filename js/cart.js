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
    document.body.classList.add("cart-open");
  },
  close() {
    document.body.classList.remove("cart-open");
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
      <aside class="cart-drawer" aria-label="Cart">
        <div class="cart-drawer-head">
          <h2>Cart</h2>
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
      if (play) {
        const audio = document.querySelector(`[data-audio="${play.dataset.play}"]`);
        if (!audio) return;
        document.querySelectorAll("audio[data-audio]").forEach((a) => {
          if (a !== audio) {
            a.pause();
            a.currentTime = 0;
          }
        });
        document.querySelectorAll("[data-play]").forEach((b) => {
          if (b !== play) b.textContent = "▶";
        });
        if (audio.paused) {
          audio.play();
          play.textContent = "❚❚";
        } else {
          audio.pause();
          play.textContent = "▶";
        }
        audio.onended = () => {
          play.textContent = "▶";
        };
      }
    });
    document.body.addEventListener("change", (e) => {
      const qty = e.target.closest("[data-qty]");
      if (qty) MaxCart.setQty(qty.dataset.qty, qty.value);
    });
    MaxCart.render();
    MaxCart.loadCatalog();
  },
  async loadCatalog() {
    try {
      const res = await fetch(`/api/catalog?t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      (data.products || []).forEach((p) => {
        PRODUCTS[p.id] = { ...PRODUCTS[p.id], ...p };
      });
      window.SETTINGS = data.settings || {};
      hydrateFromCatalog();
      MaxCart.render();
    } catch {}
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
          <input data-qty="${i.id}" type="number" min="1" value="${i.qty}" />
          <button type="button" data-remove="${i.id}">Remove</button>
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
        <p><button class="btn" type="button" data-add="${p.id}">Add to cart</button></p>
      </article>`
      )
      .join("");
  }

  const samples = document.querySelector(".samples");
  if (samples) {
    samples.innerHTML = productList()
      .map(
        (p) => `
      <article class="sample">
        ${p.sampleUrl ? `<audio data-audio="${p.id}" src="${p.sampleUrl}" preload="none"></audio>` : ""}
        <button class="play" type="button" data-play="${p.id}" ${p.sampleUrl ? "" : "disabled"} aria-label="Play">▶</button>
        <div>
          <h3>${p.sampleName || p.name}</h3>
          <p>${p.sampleUrl ? "Sample clip" : "Sample coming soon"}</p>
        </div>
        <button class="btn" type="button" data-add="${p.id}">Add to cart</button>
      </article>`
      )
      .join("");
  }
}

window.MaxCart = MaxCart;
window.PRODUCTS = PRODUCTS;
window.money = money;
