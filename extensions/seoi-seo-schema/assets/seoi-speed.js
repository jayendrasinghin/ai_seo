(() => {
  if (window.__seoiSpeedInit) return;
  window.__seoiSpeedInit = true;

  const cfg = window.__SEOI_SPEED__ || {
    lazyLoad: true,
    preload: true,
    deferThirdParty: true,
  };

  function enhanceImages() {
    if (!cfg.lazyLoad) return;
    const imgs = document.querySelectorAll("img:not([loading])");
    imgs.forEach((img, index) => {
      // Keep first couple of images eager for LCP.
      if (index < 2) {
        img.setAttribute("loading", "eager");
        img.setAttribute("fetchpriority", "high");
        return;
      }
      img.setAttribute("loading", "lazy");
      img.setAttribute("decoding", "async");
    });
  }

  function addPreloadHints() {
    if (!cfg.preload) return;
    const hero = document.querySelector(
      "img[fetchpriority='high'], .banner img, .hero img, .slideshow img",
    );
    if (!hero || !hero.getAttribute("src")) return;
    if (document.querySelector('link[data-seoi-preload="hero"]')) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = hero.getAttribute("src");
    link.setAttribute("data-seoi-preload", "hero");
    document.head.appendChild(link);
  }

  function deferNonCriticalScripts() {
    if (!cfg.deferThirdParty) return;
    const scripts = document.querySelectorAll(
      'script[src]:not([data-seoi-keep]):not([type="application/ld+json"])',
    );
    scripts.forEach((script) => {
      const src = script.getAttribute("src") || "";
      // Never touch Shopify core / app embed assets.
      if (
        src.includes("cdn.shopify.com/s/files") &&
        src.includes("seoi")
      ) {
        return;
      }
      if (
        src.includes("shopifycloud.com") ||
        src.includes("cdn.shopify.com/shopifycloud") ||
        src.includes("/assets/") ||
        script.hasAttribute("defer") ||
        script.hasAttribute("async") ||
        script.type === "module"
      ) {
        return;
      }
      // Soft-defer known analytics-ish hosts only.
      const deferHosts = [
        "googletagmanager.com",
        "google-analytics.com",
        "facebook.net",
        "hotjar.com",
        "clarity.ms",
      ];
      if (deferHosts.some((h) => src.includes(h))) {
        script.setAttribute("defer", "");
      }
    });
  }

  function dnsPrefetch() {
    if (!cfg.preload) return;
    const hosts = ["https://cdn.shopify.com"];
    hosts.forEach((href) => {
      if (document.querySelector(`link[rel="dns-prefetch"][href="${href}"]`)) {
        return;
      }
      const link = document.createElement("link");
      link.rel = "dns-prefetch";
      link.href = href;
      document.head.appendChild(link);
    });
  }

  function run() {
    dnsPrefetch();
    enhanceImages();
    addPreloadHints();
    deferNonCriticalScripts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
