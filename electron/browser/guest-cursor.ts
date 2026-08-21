/**
 * The ROME cursor, injected into World Browser pages.
 *
 * `RomeCursor` in the renderer cannot help here. A `WebContentsView` is a native
 * view composited above the React tree regardless of z-index, so a DOM cursor
 * drawn by ROME is simply not on screen while the browser is — which is why the
 * component switches itself off on `/world` and hands the native pointer back.
 *
 * The only way a custom cursor can appear over a web page is for that page to
 * draw it. So the main process injects one: `insertCSS` for the styling and
 * `executeJavaScript` for the behaviour, both of which originate outside the
 * page and are therefore not subject to its Content-Security-Policy. The
 * injection is cosmetic — it reads no page content and sends nothing back.
 *
 * The result is deliberately the same object as the renderer's cursor: dot
 * under the hotspot, ring trailing at the same rate, same open-on-interactive,
 * same press and ripple. Anything else and crossing into the browser would feel
 * like crossing into a different application.
 *
 * Two differences forced by the environment:
 *
 * • Interactivity is matched by selector rather than by computed style. Once
 *   `cursor: none !important` is applied, `getComputedStyle` reports `none` for
 *   everything, so the page can no longer be asked what it thinks is clickable.
 * • Cross-origin iframes are their own documents and keep the native cursor.
 *   Injecting into subframes would mean touching third-party contexts for a
 *   cosmetic gain, which is not a trade worth making.
 */

/** Interactive targets. Mirrors the renderer's list, plus web-page conventions. */
const INTERACTIVE = [
  "a[href]", "button", "summary", "select", "label", "[onclick]",
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
  '[role="switch"]', '[role="option"]', '[role="checkbox"]', '[role="radio"]',
  'input[type="checkbox"]', 'input[type="radio"]', 'input[type="range"]',
  'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]',
].join(",");

const TEXTUAL = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"])'
    + ':not([type="button"]):not([type="submit"]):not([type="reset"])'
    + ':not([type="color"]):not([type="file"]):not([type="image"])',
  "textarea",
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(",");

/**
 * Styles for the injected cursor.
 *
 * The accent is baked in rather than referenced through a custom property: the
 * guest document has no `--accent-*` on its root, and giving it one would mean
 * writing into a page we do not own more than we already are.
 */
export function guestCursorCss(hue: string, sat: string): string {
  const h = hue || "43";
  const s = sat || "88%";
  return `
html.rome-guest-cursor, html.rome-guest-cursor * { cursor: none !important; }
html.rome-guest-cursor ${TEXTUAL.split(",").map(x => x.trim()).join(", html.rome-guest-cursor ")} {
  cursor: text !important;
}

#rome-guest-cursor {
  position: fixed; inset: 0; z-index: 2147483647;
  pointer-events: none; opacity: 0;
  transition: opacity .18s ease;
}
#rome-guest-cursor.is-live { opacity: 1; }
#rome-guest-cursor.is-text { opacity: 0; }

#rome-guest-cursor .rc-dot,
#rome-guest-cursor .rc-ring {
  position: absolute; top: 0; left: 0; will-change: transform;
}
#rome-guest-cursor .rc-dot > i,
#rome-guest-cursor .rc-ring > i {
  position: absolute; display: block; border-radius: 50%;
  transform: translate(-50%, -50%);
  transition: width .16s cubic-bezier(.4,0,.2,1), height .16s cubic-bezier(.4,0,.2,1),
              border-color .16s ease, background-color .16s ease;
}
#rome-guest-cursor .rc-dot > i {
  width: 5px; height: 5px;
  background: hsl(${h} 90% 72%);
  box-shadow: 0 0 6px hsla(${h}, 90%, 60%, .55);
}
#rome-guest-cursor .rc-ring > i {
  width: 26px; height: 26px;
  border: 1px solid hsla(${h}, 60%, 58%, .45);
  background: hsla(${h}, 70%, 60%, .04);
}
#rome-guest-cursor.is-hot .rc-ring > i {
  width: 40px; height: 40px;
  border-color: hsla(${h}, 85%, 65%, .8);
  background: hsla(${h}, 80%, 60%, .07);
}
#rome-guest-cursor.is-hot .rc-dot > i { width: 3px; height: 3px; }
#rome-guest-cursor.is-down .rc-ring > i {
  width: 15px; height: 15px;
  border-color: hsla(${h}, 95%, 72%, .95);
  background: hsla(${h}, 85%, 62%, .16);
}
#rome-guest-cursor.is-down .rc-dot > i { width: 7px; height: 7px; }

#rome-guest-cursor .rc-ripple {
  position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px;
  border-radius: 50%; border: 1px solid hsla(${h}, 90%, 68%, .7);
  animation: romeGuestRipple .52s cubic-bezier(.15,.6,.3,1) forwards;
}
@keyframes romeGuestRipple {
  from { transform: scale(1);   opacity: .75; }
  to   { transform: scale(5.4); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  #rome-guest-cursor .rc-dot > i,
  #rome-guest-cursor .rc-ring > i { transition-duration: .08s; }
  #rome-guest-cursor .rc-ripple { display: none; }
}
${"" /* saturation is carried for parity with the renderer even though the
        palette above is fixed-saturation by design — a page's own colours are
        already competing, and a fully saturated ring reads as page chrome. */}
/* accent-s: ${s} */
`;
}

/**
 * Behaviour, as a self-contained expression.
 *
 * Re-runs on every navigation, so it guards on a global. It also re-attaches
 * itself if the page tears the layer out — single-page apps that replace large
 * parts of the DOM will do that, and a cursor that vanishes on a route change
 * inside a site would be worse than no cursor at all.
 */
export const GUEST_CURSOR_JS = `(() => {
  if (window.__romeGuestCursor) { window.__romeGuestCursor.attach(); return true; }

  var INTERACTIVE = ${JSON.stringify(INTERACTIVE)};
  var TEXTUAL = ${JSON.stringify(TEXTUAL)};
  var RING_LERP = 0.24;
  var MAX_RIPPLES = 6;

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var layer = document.createElement("div");
  layer.id = "rome-guest-cursor";
  layer.setAttribute("aria-hidden", "true");
  var ring = document.createElement("div"); ring.className = "rc-ring"; ring.appendChild(document.createElement("i"));
  var dot  = document.createElement("div"); dot.className  = "rc-dot";  dot.appendChild(document.createElement("i"));
  layer.appendChild(ring); layer.appendChild(dot);

  function attach() {
    document.documentElement.classList.add("rome-guest-cursor");
    if (!layer.isConnected) document.documentElement.appendChild(layer);
  }
  attach();

  var px = window.innerWidth / 2, py = window.innerHeight / 2;
  var rx = px, ry = py, seen = false;

  function frame() {
    var k = reduced ? 1 : RING_LERP;
    rx += (px - rx) * k;
    ry += (py - ry) * k;
    dot.style.transform  = "translate3d(" + px + "px," + py + "px,0)";
    ring.style.transform = "translate3d(" + rx.toFixed(2) + "px," + ry.toFixed(2) + "px,0)";
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function climb(el, test) {
    for (var i = 0, n = el; n && i < 8; i++, n = n.parentElement) {
      try { if (test(n)) return true; } catch (e) {}
    }
    return false;
  }

  document.addEventListener("mousemove", function (e) {
    px = e.clientX; py = e.clientY;
    if (!layer.isConnected) attach();
    if (!seen) { seen = true; layer.classList.add("is-live"); }
  }, true);

  document.addEventListener("mouseover", function (e) {
    var t = e.target;
    var textual = climb(t, function (n) { return n.matches && n.matches(TEXTUAL); });
    layer.classList.toggle("is-text", textual);
    layer.classList.toggle("is-hot", !textual && climb(t, function (n) {
      return n.matches && n.matches(INTERACTIVE);
    }));
  }, true);

  document.addEventListener("mousedown", function () { layer.classList.add("is-down"); }, true);

  document.addEventListener("mouseup", function (e) {
    layer.classList.remove("is-down");
    if (reduced) return;
    if (layer.querySelectorAll(".rc-ripple").length >= MAX_RIPPLES) return;
    var r = document.createElement("span");
    r.className = "rc-ripple";
    r.style.left = e.clientX + "px";
    r.style.top  = e.clientY + "px";
    r.addEventListener("animationend", function () { r.remove(); }, { once: true });
    layer.appendChild(r);
  }, true);

  document.addEventListener("mouseleave", function () {
    seen = false;
    layer.classList.remove("is-live", "is-down");
  });

  window.__romeGuestCursor = { attach: attach };
  return true;
})()`;
