/**
 * Browser translucency, injected into World Browser pages.
 *
 * Lowering the slider should let ROME's own sky — the cave gradient, the
 * starfield, the light ray — show through the page, **without taking the page's
 * text and images with it**. That last clause is the whole design, and it is
 * why this file no longer does the obvious thing.
 *
 * ── Why not `html { opacity }` ──────────────────────────────────────────────
 *
 * The obvious implementation fades the root element. It is also incapable of
 * doing what is asked here: CSS opacity composites an entire subtree as one
 * layer, and it multiplies downward. A descendant cannot be *more* opaque than
 * its ancestor — there is no property, no `!important`, no stacking trick that
 * exempts a child. Fade the root and the text fades with it, full stop.
 *
 * So the alpha moves off the elements and onto their **backgrounds**:
 *
 *   • every element that paints an opaque `background-color` gets that colour
 *     rewritten with `alpha × slider`;
 *   • text, `<img>`, `<video>`, `<canvas>` and SVG are never touched and stay
 *     at full strength at every setting, including zero.
 *
 * At 0% the page is its own text and pictures floating over ROME, which is why
 * the slider's floor could drop from 25% to nothing.
 *
 * ── The three things that have to be true ───────────────────────────────────
 *
 * 1. The native view must not paint an opaque backdrop.
 *    `WebContentsView` is composited above the React tree, so nothing in ROME's
 *    CSS can reach it. `view.setBackgroundColor("#00000000")` in `TabManager`
 *    is what makes the view itself capable of transparency.
 *
 * 2. ROME must draw something behind it — `AmbientBackdrop` in the renderer.
 *
 * 3. The page's root background must fade, and by default it cannot.
 *    The root element's background is propagated to the *viewport canvas*, and
 *    the canvas is painted outside the root's own rendering, so it is not an
 *    element whose colour we can rewrite. Worse, clearing `html`'s background
 *    just promotes `body`'s to the canvas in its place.
 *
 *    So the payload captures whatever background the page actually has, clears
 *    it off BOTH `html` and `body`, and re-lays it as an ordinary fixed element
 *    at the very back of the document — where it is a normal descendant and can
 *    simply be faded. It has no text or images inside it, so `opacity` on *that*
 *    element is safe and handles a background image as well as a colour.
 *
 * Pages that put their background on a wrapper `div` (most React apps do) need
 * none of that; the wrapper is an ordinary surface and gets alpha'd like any
 * other. The capture is harmless there — it finds nothing opaque and lays down
 * nothing.
 *
 * ── Staleness, the cache, and the `refresh` flag ────────────────────────────
 *
 * The original colour of each surface is cached, because reading it back after
 * we have written to it would read our own value and the page would bleach a
 * little more on every pass.
 *
 * That cache has to be dropped when the page changes its own colours — a theme
 * toggle, a route change — but emphatically *not* on every tick of the slider.
 * Dragging fires a change per pixel, and re-reading a twelve-thousand element
 * page seventy-five times in a drag is a frozen window.
 *
 * So the caller says which it is. `refresh` re-reads everything from scratch
 * and is what `dom-ready` passes; without it a new value is written straight
 * from the cache, which is a loop over the elements already known to paint
 * something and no style resolution at all.
 *
 * Injected with `executeJavaScript`, which originates outside the page and is
 * therefore not subject to its Content-Security-Policy. CSSOM writes and
 * constructed stylesheets are not governed by `style-src` either, so no
 * `<style>` element is ever created. The payload reads only its own computed
 * styles and sends nothing back.
 */

/**
 * Idempotent. Re-running installs nothing twice — it restores, then re-applies
 * the values it was given, which is what makes calling it from every
 * `dom-ready` correct.
 *
 * @param value      0–1. Background alpha multiplier. 1 restores the page.
 * @param textColor  A CSS colour to force on all text, or null to leave the
 *                   page's own colours alone.
 * @param refresh    Re-read every surface instead of writing from the cache.
 *                   True on navigation, false when only the value moved.
 *
 * Call as `executeJavaScript(guestOpacityJs(value, color, refresh))`.
 */
/**
 * A CSS hex colour: 3, 4, 6 or 8 digits. Five and seven are not colours, and a
 * looser pattern here is a hole rather than a convenience — this value is
 * concatenated into a script that runs inside every page you browse.
 */
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** The one place a text colour is validated. Anything else becomes null. */
export function normalizeTextColor(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return HEX_COLOR.test(text) ? text : null;
}

export function guestOpacityJs(value: number, textColor: string | null = null, refresh = false): string {
  const safe = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
  // Only ever a colour, and only ever from ROME's own picker — but this is
  // string-concatenated into a script, so anything that could close the literal
  // or start a statement is refused rather than escaped.
  const color = normalizeTextColor(textColor);

  return `(() => {
  const LAYER_ID = "__romeOpacityBackdrop";
  const MAX_ELEMENTS = 12000;
  const api = window.__romeOpacity || (window.__romeOpacity = {});

  api.originals = api.originals || new WeakMap();
  api.touched = api.touched || new Set();

  const SKIP_TAGS = new Set([
    "SCRIPT","STYLE","LINK","META","TITLE","BASE","NOSCRIPT","TEMPLATE",
    "IMG","VIDEO","AUDIO","CANVAS","IFRAME","OBJECT","EMBED","PICTURE","SOURCE","TRACK",
  ]);

  const isPaint = (c) =>
    Boolean(c) && c !== "transparent" && !/^rgba\\(\\s*0,\\s*0,\\s*0,\\s*0\\s*\\)$/.test(c);

  /**
   * Computed background colours come back as rgb()/rgba(). Anything else — a
   * color(srgb …) from a page using wide-gamut syntax — is left alone rather
   * than guessed at: a surface that stays solid is a cosmetic miss, a surface
   * painted the wrong colour is a bug.
   */
  function parseRgb(text) {
    const m = /^rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)(?:[,\\s/]+([\\d.]+))?\\s*\\)$/.exec(String(text || "").trim());
    if (!m) return null;
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (!(a > 0)) return null;                       // fully transparent: nothing painted
    return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a };
  }

  // ── The root background, moved into the document ─────────────────────────

  function capture() {
    if (api.base) return api.base;
    const de = document.documentElement;
    const body = document.body;
    const deStyle = getComputedStyle(de);
    const bodyStyle = body ? getComputedStyle(body) : null;
    // body wins over html: html's background reaches the canvas first and
    // body's paints over it, so body is what the page actually looks like.
    const color =
      (bodyStyle && isPaint(bodyStyle.backgroundColor) && bodyStyle.backgroundColor) ||
      (isPaint(deStyle.backgroundColor) && deStyle.backgroundColor) ||
      "";
    const image =
      (bodyStyle && bodyStyle.backgroundImage !== "none" && bodyStyle.backgroundImage) ||
      (deStyle.backgroundImage !== "none" && deStyle.backgroundImage) ||
      "";
    api.base = { color, image };
    return api.base;
  }

  function clearRoots() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      el.style.setProperty("background-color", "transparent", "important");
      el.style.setProperty("background-image", "none", "important");
    }
  }

  function restoreRoots() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      el.style.removeProperty("background-color");
      el.style.removeProperty("background-image");
    }
  }

  function layer() {
    const host = document.body || document.documentElement;
    if (!host) return null;
    let el = document.getElementById(LAYER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = LAYER_ID;
      el.setAttribute("aria-hidden", "true");
    }
    // First child, and re-inserted if the page threw it away. Single-page apps
    // replace large parts of the DOM on a route change, and a page that
    // suddenly lost its background mid-navigation would look broken.
    if (el.parentNode !== host || host.firstChild !== el) host.insertBefore(el, host.firstChild);
    return el;
  }

  function removeLayer() {
    const el = document.getElementById(LAYER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function paintLayer(base, value) {
    const el = layer();
    if (!el) return;
    const s = el.style;
    s.setProperty("position", "fixed", "important");
    s.setProperty("inset", "0", "important");
    s.setProperty("z-index", "-2147483647", "important");
    s.setProperty("pointer-events", "none", "important");
    s.setProperty("background-color", base.color || "transparent", "important");
    s.setProperty("background-image", base.image || "none", "important");
    if (base.image) {
      s.setProperty("background-size", "cover", "important");
      s.setProperty("background-position", "center", "important");
    }
    // Safe here and nowhere else: this element has no text and no images of the
    // page's own, so fading it as a unit costs nothing we were asked to keep.
    s.setProperty("opacity", String(value), "important");
  }

  // ── Every other surface ──────────────────────────────────────────────────

  function paintOne(el, value) {
    if (SKIP_TAGS.has(el.tagName)) return;
    if (el.id === LAYER_ID) return;
    if (el === document.documentElement || el === document.body) return;   // the layer's job

    let original = api.originals.get(el);
    if (original === undefined) {
      original = parseRgb(getComputedStyle(el).backgroundColor);
      api.originals.set(el, original);     // null caches "paints nothing"
    }
    if (!original) return;

    // Painted implies restorable. Painting past the cap without tracking the
    // element would leave it holding a transparent background forever, because
    // the restore pass only walks what is in the set.
    if (api.touched.size >= MAX_ELEMENTS && !api.touched.has(el)) return;

    el.style.setProperty(
      "background-color",
      "rgba(" + original.r + ", " + original.g + ", " + original.b + ", " + (original.a * value) + ")",
      "important",
    );
    api.touched.add(el);
  }

  function paintTree(root, value) {
    if (root.nodeType === 1) paintOne(root, value);
    const all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    let seen = 0;
    for (const el of all) {
      if (++seen > MAX_ELEMENTS) break;
      paintOne(el, value);
    }
  }

  /**
   * Put every surface back and forget what we knew about it.
   *
   * Dropping the cache is the point: the next read then sees the page's real
   * colour rather than ours, which is what keeps a theme toggle or a route
   * change from getting frozen at whatever it looked like when we first ran.
   */
  /**
   * Re-alpha the surfaces we already know about, without touching the cascade.
   *
   * This is the slider-drag path: no getComputedStyle, no querySelectorAll,
   * just arithmetic over the elements already known to paint something.
   */
  function repaintCached(value) {
    for (const el of api.touched) {
      const o = api.originals.get(el);
      if (!o || !el.isConnected) continue;
      el.style.setProperty(
        "background-color",
        "rgba(" + o.r + ", " + o.g + ", " + o.b + ", " + (o.a * value) + ")",
        "important",
      );
    }
  }

  function restoreSurfaces() {
    for (const el of api.touched) {
      try { el.style.removeProperty("background-color"); } catch {}
    }
    api.touched.clear();
    api.originals = new WeakMap();
  }

  // ── Text colour ──────────────────────────────────────────────────────────

  function applyText(color) {
    if (typeof CSSStyleSheet !== "function" || !("adoptedStyleSheets" in document)) return;
    try {
      const sheet = api.sheet || (api.sheet = new CSSStyleSheet());
      // The :not(#_rome_never_) carries id-level specificity without ever
      // matching, so this outranks a page's own !important declarations. Plain
      // \`html *\` loses to any class rule and the override would be ignored on
      // roughly every real site.
      //
      // -webkit-text-fill-color matters as much as color: gradient text is
      // drawn with background-clip and a transparent fill, and setting only
      // \`color\` on it leaves the text invisible.
      const rule = color
        ? ":root:not(#_rome_never_) body, :root:not(#_rome_never_) body *" +
          "{ color: " + color + " !important; -webkit-text-fill-color: " + color + " !important; }" +
          ":root:not(#_rome_never_) ::placeholder" +
          "{ color: " + color + " !important; opacity: .55 !important; }" +
          // Forcing a text fill also freezes the colour the UA paints selected
          // text in, which is how you end up unable to read your own selection.
          // Handing the fill back to currentColor inside ::selection restores it.
          ":root:not(#_rome_never_) ::selection" +
          "{ -webkit-text-fill-color: currentColor !important; }"
        : "";
      sheet.replaceSync(rule);
      if (!document.adoptedStyleSheets.includes(sheet)) {
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
    } catch {
      // A document that refuses constructed stylesheets keeps its own colours.
    }
  }

  // ── Apply ────────────────────────────────────────────────────────────────

  function apply(value, color, refresh) {
    const first = api.value == null;
    api.value = value;
    api.color = color;
    applyText(color);

    if (value >= 0.999) {
      restoreSurfaces();
      restoreRoots();
      removeLayer();
      return;
    }

    if (refresh || first) {
      // Order matters: put the page back before reading it, or capture()
      // reads the transparent values we wrote last time, and the page goes
      // clear at every setting.
      restoreSurfaces();
      restoreRoots();
      api.base = null;
    }

    const base = capture();
    clearRoots();
    paintLayer(base, value);

    if (refresh || first) paintTree(document.documentElement, value);
    else repaintCached(value);
  }

  api.apply = apply;

  if (!api.observer && typeof MutationObserver === "function") {
    // Two jobs: re-seat the backdrop if the page threw it away, and paint
    // whatever the page just added. Batched to one frame so a chatty SPA does
    // not turn every insertion into a layout pass.
    let pending = null;
    api.observer = new MutationObserver((records) => {
      if (api.value == null || api.value >= 0.999) return;
      const roots = [];
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && node.id !== LAYER_ID) roots.push(node);
        }
      }
      if (!document.getElementById(LAYER_ID)) roots.length = 0;   // full re-apply covers it
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = null;
        if (api.value == null || api.value >= 0.999) return;
        if (!document.getElementById(LAYER_ID)) { apply(api.value, api.color, false); return; }
        for (const root of roots) {
          if (root.isConnected) paintTree(root, api.value);
        }
      });
    });
    const host = document.documentElement;
    if (host) api.observer.observe(host, { childList: true, subtree: true });
  }

  apply(${safe}, ${color ? JSON.stringify(color) : "null"}, ${refresh ? "true" : "false"});
})()`;
}
