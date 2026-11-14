/* ===== Motion layer (GSAP) — progressive enhancement, non-blocking ===== */
(function () {
  function loadScript(src, cb) {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = cb;
    s.onerror = cb;
    document.head.appendChild(s);
  }

  function init() {
    if (typeof gsap === "undefined") return;
    try { gsap.registerPlugin(ScrollTrigger); } catch (e) { /* scrolltrigger optional */ }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    // Card hover lift (visible)
    document.querySelectorAll(".card").forEach(card => {
      card.addEventListener("mouseenter", () => {
        gsap.to(card, { y: -8, duration: 0.35, ease: "power2.out" });
        gsap.to(card, { boxShadow: "0 12px 32px rgba(44,34,24,0.14)", duration: 0.35, ease: "power2.out" });
      });
      card.addEventListener("mouseleave", () => {
        gsap.to(card, { y: 0, duration: 0.35, ease: "power2.out" });
        gsap.to(card, { boxShadow: "0 0 0 rgba(44,34,24,0)", duration: 0.35, ease: "power2.out" });
      });
    });

    // Hero featured card float
    const featured = document.querySelector(".hero-featured");
    if (featured) {
      gsap.to(featured, { y: "-=10", duration: 2.4, ease: "sine.inOut", yoyo: true, repeat: -1 });
    }
  }

  loadScript("https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js", () => {
    if (typeof gsap === "undefined") return;
    loadScript("https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js", init);
  });
})();