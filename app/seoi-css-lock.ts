/**
 * Shopify App Bridge / Polaris inject styles into <head> after hydration,
 * which overrides our Vite CSS (looks good ~1s, then reverts).
 *
 * Fix: keep a client-owned <style> as the last child of <body>. Body styles
 * win over earlier <head> sheets. Re-append whenever anything else lands after us.
 */
import { useLayoutEffect } from "react";
import modernCss from "./modern-ui.css?inline";
import supportCss from "./support-ui.css?inline";

const LOCK_ID = "seoi-css-lock";

function ensureLockAtEndOfBody() {
  if (typeof document === "undefined") return;

  let el = document.getElementById(LOCK_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = LOCK_ID;
    el.setAttribute("data-seoi-css", "1");
    el.textContent = `${modernCss}\n${supportCss}`;
  } else if (!el.textContent) {
    el.textContent = `${modernCss}\n${supportCss}`;
  }

  if (document.body.lastChild !== el) {
    document.body.appendChild(el);
  }
}

export function useSeoiCssLock() {
  useLayoutEffect(() => {
    ensureLockAtEndOfBody();

    // Polaris / App Bridge often inject a bit later than first paint.
    const timers = [0, 50, 200, 600, 1500, 3000].map((ms) =>
      window.setTimeout(ensureLockAtEndOfBody, ms),
    );

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        ensureLockAtEndOfBody();
      });
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.head, { childList: true });
    observer.observe(document.body, { childList: true });

    return () => {
      timers.forEach(clearTimeout);
      observer.disconnect();
    };
  }, []);
}
