function header(active) {
  const item = (href, label, key) =>
    `<a href="${href}" class="${active === key ? "is-active" : ""}">${label}</a>`;

  return `
    <div class="announce">Custom mixes for all-star · school · prep · novice</div>
    <header class="site-header">
      <div class="header-row">
        <a class="logo" href="index.html" aria-label="MAX Cheer Music">
          <img src="assets/max-logo.png" alt="MAX" />
        </a>
        <nav class="nav" aria-label="Primary">
          ${item("sheets.html", "8 Count Sheets", "sheets")}
          ${item("shop.html", "Shop", "shop")}
          ${item("about.html", "About", "about")}
          ${item("contact.html", "Contact", "contact")}
          ${item("samples.html", "Samples", "samples")}
          ${item("portal.html", "Portal", "portal")}
        </nav>
        <div class="header-actions">
          <a class="ghost cart-count" href="checkout.html" data-cart-open data-cart-count>Cart</a>
          <a class="btn" href="shop.html">Order now</a>
          <button class="menu-toggle" type="button" aria-label="Open menu">
            <span></span><span></span><span></span>
          </button>
        </div>
      </div>
    </header>
  `;
}

function footer() {
  return `
    <footer class="site-footer">
      <div class="wrap footer-grid">
        <div>
          <p class="footer-brand">MAX Cheer Music</p>
          <p>Custom cheer mixes that hit hard and keep the crowd hyped.</p>
        </div>
        <div>
          <h4>Contact</h4>
          <p><a href="mailto:maxcheermusic@gmail.com">maxcheermusic@gmail.com</a></p>
        </div>
      </div>
    </footer>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector("link[rel='icon']")) {
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = "assets/max-logo.png";
    document.head.appendChild(icon);
  }
  const page = document.body.dataset.page || "";
  document.body.insertAdjacentHTML("afterbegin", header(page));
  document.body.insertAdjacentHTML("beforeend", footer());
  document.querySelector(".menu-toggle")?.addEventListener("click", () => {
    document.body.classList.toggle("nav-open");
  });
  if (window.MaxCart) MaxCart.mount();
});
