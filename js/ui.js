/* ===== UI helpers: nav, reveal, contact links ===== */
function setupNav() {
  const menuBtn = document.getElementById("menuBtn");
  const mobileMenu = document.getElementById("mobileMenu");
  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener("click", () => {
      const open = mobileMenu.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", open);
    });
    document.querySelectorAll(".m-link").forEach(a => a.addEventListener("click", () => {
      mobileMenu.classList.remove("open");
      menuBtn.setAttribute("aria-expanded", "false");
    }));
  }
  // cart badge
  if (typeof updateCartBadge === "function") updateCartBadge();
}

function setupReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add("is-in");
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  window.__revealObserve = (el) => io.observe(el);
  document.querySelectorAll(".reveal").forEach(el => io.observe(el));
}

function setupHeroReady() {
  const hero = document.getElementById("hero");
  if (!hero) return;
  const ready = () => hero.classList.add("is-ready");
  window.addEventListener("load", ready);
  if (document.readyState === "complete") ready();
}

function setupContactLinks() {
  const STORE = window.STORE || {};
  const waUrl = "https://wa.me/" + (STORE.whatsapp || "") + "?text=" + encodeURIComponent("Hi, I'd like to inquire about your collection.");
  const mailUrl = "mailto:" + (STORE.email || "") + "?subject=" + encodeURIComponent("Inquiry — Forma collection");
  ["waBtn","footerWa"].forEach(id => { const el = document.getElementById(id); if (el) el.href = waUrl; });
  ["emailBtn","footerEmail"].forEach(id => { const el = document.getElementById(id); if (el) el.href = mailUrl; });
}

function setupContactForm() {
  const form = document.getElementById("contactForm");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const STORE = window.STORE || {};
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const message = document.getElementById("message").value.trim();
    const subject = encodeURIComponent("Inquiry from " + name);
    const body = encodeURIComponent("Name: " + name + "\nEmail: " + email + "\n\n" + message);
    window.location.href = "mailto:" + (STORE.email || "") + "?subject=" + subject + "&body=" + body;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  setupReveal();
  setupHeroReady();
  setupContactLinks();
  setupContactForm();
});