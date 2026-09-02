/**
 * WorldBrowser — adaptive ROME browser workspace.
 *
 * Architecture:
 *   Electron uses a main-process WebContentsView managed through the narrow
 *   romeDesktop bridge. The normal web/Vercel build keeps the Neko path below.
 *
 *   A Neko instance (https://github.com/m1k1o/neko) runs Firefox in a Docker
 *   container on a VPS. It streams the display via WebRTC to a standard
 *   <iframe> — works in any browser including Firefox/Zen since WebRTC is a
 *   universal web standard (no CDP dependency).
 *
 *   ROME's Vercel backend holds the Neko URL in the NEKO_URL environment
 *   variable. The frontend fetches it via /api/browser/neko-url so the URL
 *   is never hardcoded in client-side code.
 *
 * Setup:
 *   1. Deploy Neko on a VPS (docker run m1k1o/neko:firefox ...)
 *   2. Set NEKO_URL=https://your-neko-domain.com in Vercel env vars
 *   3. Done — this page will automatically embed it.
 */

import { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  Globe, Maximize2, Minimize2, ExternalLink,
  AlertTriangle, Loader2, RefreshCw,
  ArrowLeft, ArrowRight, X, Plus, Search, Home, Star,
  History, Download, Shield, ZoomIn, ZoomOut, FolderOpen,
  LockKeyhole, Square, Pin,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AmbientBackdrop from "@/components/AmbientBackdrop";
import { useConstellationLayout } from "@/lib/layoutStore";
import { WIDGET_KEYS, isWidgetPinned } from "@/lib/constellationLayout";

// ── Accent colour (matches ROME theme) ──────────────────────────────────────
// The constellation editor writes --accent-h/-s/-l onto documentElement.
// Reading them here rather than hard-coding gold means recolouring the
// constellation recolours the browser with it.
const ACC = "hsl(var(--accent-h) var(--accent-s) var(--accent-l))";

// The address bar shows a name, not a URL: hostname minus `www.` and minus the
// public suffix, leaving the registrable label — `en.wikipedia.org` → WIKIPEDIA,
// `docs.github.com` → GITHUB. Two-part suffixes are checked against a short list
// rather than the full public-suffix list; the whole list is 200KB and the cost
// of missing one is reading `co` for one session, not a bug.
const TWO_PART_SUFFIX = /\.(co|com|net|org|gov|edu|ac|or|ne)\.[a-z]{2}$/i;
function siteLabel(rawUrl: string): string {
  if (!rawUrl) return "";
  let host = "";
  try { host = new URL(rawUrl).hostname; } catch { return ""; }
  // An IP address has no name to show; give it back whole.
  if (!host || /^\d+(\.\d+){3}$/.test(host)) return host;
  host = host.replace(/^www\./i, "");
  const stripped = TWO_PART_SUFFIX.test(host)
    ? host.replace(TWO_PART_SUFFIX, "")
    : host.replace(/\.[^.]+$/, "");
  const parts = stripped.split(".").filter(Boolean);
  return parts[parts.length - 1] ?? host;
}

// ── Surface opacity ─────────────────────────────────────────────────────────
// How solid the browser is over the rest of ROME. The main process owns the
// live value (it is the only thing that can touch a native WebContentsView);
// this key is only so the setting survives a restart, since the view is rebuilt
// from scratch every launch.
const OPACITY_KEY = "rome_browser_opacity";
const TEXT_COLOR_KEY = "rome_browser_text_color";

// Zero, not a quarter.
//
// The floor was 25% while the implementation faded the whole page, because
// below that the text was unreadable. `guest-opacity` now puts the alpha on
// backgrounds only — text, images and video stay at full strength at every
// setting — so 0 is a real position: the page becomes its own words and
// pictures floating over the constellation.
const MIN_OPACITY = 0;

function readStoredOpacity(): number {
  try {
    const raw = Number(localStorage.getItem(OPACITY_KEY));
    if (!Number.isFinite(raw)) return 1;
    return Math.min(1, Math.max(MIN_OPACITY, raw));
  } catch {
    return 1;
  }
}

// Deliberately identical to `HEX_COLOR` in `electron/browser/guest-opacity.ts`,
// which is the copy that matters — the value is interpolated into a script
// injected into guest pages, and main validates it again on arrival. The
// renderer checks too so a bad stored value never reaches the slider's UI.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** A forced text colour for guest pages, or null for the page's own. */
function readStoredTextColor(): string | null {
  try {
    const raw = localStorage.getItem(TEXT_COLOR_KEY);
    return raw && HEX_COLOR.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Offered beside the swatch: enough to be useful, few enough to fit. */
const TEXT_PRESETS = ["#e8eef5", "#f2d492", "#8fd4e8", "#c7f0d0", "#f0b8c8", "#1a1d23"];

// ── Decorative corner marks ──────────────────────────────────────────────────
function Corners() {
  const c = "hsl(195 40% 30% / 0.35)";
  const S: React.CSSProperties = { position: "absolute", width: 14, height: 14, pointerEvents: "none" };
  return (
    <>
      <div style={{ ...S, top: 0, left: 0,  borderTop: `1px solid ${c}`, borderLeft:  `1px solid ${c}` }} />
      <div style={{ ...S, top: 0, right: 0, borderTop: `1px solid ${c}`, borderRight: `1px solid ${c}` }} />
      <div style={{ ...S, bottom: 0, left: 0,  borderBottom: `1px solid ${c}`, borderLeft:  `1px solid ${c}` }} />
      <div style={{ ...S, bottom: 0, right: 0, borderBottom: `1px solid ${c}`, borderRight: `1px solid ${c}` }} />
    </>
  );
}

// ── Setup instructions shown when NEKO_URL is not configured ────────────────
function SetupGuide() {
  const bg     = "hsl(222 14% 6%)";
  const border = "hsl(220 12% 14%)";
  const dim    = "hsl(220 10% 38%)";

  const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 18 }}>
      <div style={{
        width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
        border: `1px solid ${ACC}`, color: ACC,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontFamily: "DM Mono, monospace",
      }}>{n}</div>
      <div style={{ fontSize: 12, color: dim, lineHeight: 1.7, fontFamily: "DM Sans, sans-serif" }}>
        {children}
      </div>
    </div>
  );

  const Code = ({ children }: { children: React.ReactNode }) => (
    <code style={{
      display: "block", marginTop: 8,
      background: "hsl(222 16% 9%)",
      border: `1px solid ${border}`,
      borderRadius: 4, padding: "8px 12px",
      fontSize: 11, fontFamily: "DM Mono, monospace",
      color: "hsl(195 60% 65%)",
      whiteSpace: "pre-wrap", wordBreak: "break-all",
    }}>{children}</code>
  );

  return (
    <div style={{
      position: "absolute", inset: 0,
      background: bg,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "40px 24px",
      overflowY: "auto",
    }}>
      <Corners />

      {/* Grid */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: `
          linear-gradient(hsl(195 40% 15% / 0.04) 1px, transparent 1px),
          linear-gradient(90deg, hsl(195 40% 15% / 0.04) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 520, width: "100%" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <Globe size={28} color={ACC} style={{ margin: "0 auto 12px" }} />
          <div style={{
            fontFamily: "'Cinzel', serif", fontSize: 13,
            letterSpacing: "0.18em", color: ACC,
            textTransform: "uppercase", marginBottom: 8,
          }}>
            World Browser — Setup Required
          </div>
          <div style={{ fontSize: 12, color: dim, lineHeight: 1.7 }}>
            World Browser uses Neko — a self-hosted Firefox streamed over WebRTC.
            Follow the steps below to get it running.
          </div>
        </div>

        {/* Steps */}
        <div style={{
          background: "hsl(222 14% 8%)",
          border: `1px solid ${border}`,
          borderRadius: 8, padding: "24px 28px",
          marginBottom: 20,
        }}>
          <Step n={1}>
            <strong style={{ color: "hsl(220 10% 70%)" }}>Get a VPS</strong> — Hetzner CX22 (2 vCPU, 4GB RAM) is recommended at ~€3.29/mo.
            Choose Ubuntu 24.04. Note your server's public IP.
          </Step>

          <Step n={2}>
            <strong style={{ color: "hsl(220 10% 70%)" }}>Install Docker on the VPS</strong>
            <Code>{`ssh root@<your-vps-ip>
curl -fsSL https://get.docker.com | sh`}</Code>
          </Step>

          <Step n={3}>
            <strong style={{ color: "hsl(220 10% 70%)" }}>Run Neko (Firefox)</strong> — Your browser profile persists across restarts via the Docker volume.
            Replace the passwords and your VPS IP.
            <Code>{`docker run -d --name neko --restart=unless-stopped \\
  -p 8080:8080 \\
  -p 52000-52100:52000-52100/udp \\
  -e NEKO_SCREEN=1280x800@30 \\
  -e NEKO_PASSWORD=yourpassword \\
  -e NEKO_ADMIN_PASSWORD=youradminpassword \\
  -e NEKO_NAT1TO1=<your-vps-ip> \\
  -v neko-profile:/home/user/.mozilla \\
  m1k1o/neko:firefox`}</Code>
          </Step>

          <Step n={4}>
            <strong style={{ color: "hsl(220 10% 70%)" }}>Expose via Cloudflare Tunnel (free, no domain needed)</strong>
            <Code>{`# On the VPS:
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cf.deb
dpkg -i cf.deb
cloudflared tunnel --url http://localhost:8080`}</Code>
            Cloudflare will print a URL like{" "}
            <span style={{ color: "hsl(195 60% 65%)" }}>https://random-words.trycloudflare.com</span>.
            That's your Neko URL.
          </Step>

          <Step n={5}>
            <strong style={{ color: "hsl(220 10% 70%)" }}>Add to Vercel</strong> — In your Vercel project dashboard go to
            Settings → Environment Variables and add:
            <Code>{`NEKO_URL = https://random-words.trycloudflare.com`}</Code>
            Then redeploy. World Browser will automatically connect.
          </Step>
        </div>

        <div style={{ fontSize: 10, color: "hsl(220 8% 28%)", textAlign: "center", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          For a permanent URL, set up a Cloudflare named tunnel or point a subdomain at your VPS IP.
        </div>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
function WebWorldBrowser() {
  const [nekoUrl, setNekoUrl]     = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0); // bump to reload iframe
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const bg      = "hsl(222 14% 6%)";
  const surface = "hsl(222 14% 9%)";
  const border  = "hsl(220 12% 14%)";
  const dim     = "hsl(220 8% 35%)";

  // ── Fetch Neko URL from backend ──────────────────────────────────────────
  useEffect(() => {
    apiRequest("GET", "/api/browser/neko-url")
      .then(r => r.json())
      .then(d => {
        setNekoUrl(d.nekoUrl ?? null);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not reach server.");
        setLoading(false);
      });
  }, []);

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", gap: 16,
      }}>
        <Loader2 size={22} color={ACC} style={{ animation: "spin 1s linear infinite" }} />
        <div style={{ fontSize: 10, letterSpacing: "0.18em", color: dim, textTransform: "uppercase", fontFamily: "DM Mono, monospace" }}>
          Connecting…
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Not configured — show setup guide ───────────────────────────────────
  if (!nekoUrl) {
    return <SetupGuide />;
  }

  // ── Neko is configured — embed it ───────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: bg,
      display: "flex", flexDirection: "column",
      fontFamily: "DM Sans, sans-serif",
    }}>
      <Corners />

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div style={{
        height: 40, flexShrink: 0,
        background: surface,
        borderBottom: `1px solid ${border}`,
        display: "flex", alignItems: "center",
        paddingLeft: 14, paddingRight: 10, gap: 10,
      }}>
        <Globe size={13} color={ACC} />
        <span style={{
          fontFamily: "'Cinzel', serif", fontSize: 10,
          letterSpacing: "0.18em", color: ACC,
          textTransform: "uppercase", flex: 1,
        }}>
          World Browser
        </span>

        {/* Status dot */}
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "hsl(142 60% 45%)",
          boxShadow: "0 0 6px hsl(142 60% 45% / 0.7)",
        }} />
        <span style={{ fontSize: 9, letterSpacing: "0.12em", color: dim, textTransform: "uppercase", fontFamily: "DM Mono, monospace" }}>
          Live
        </span>

        {/* Controls */}
        <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
          {/* Reload */}
          <button
            onClick={() => setIframeKey(k => k + 1)}
            title="Reload browser session"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: dim, padding: "4px 6px", borderRadius: 3,
              display: "flex", alignItems: "center", transition: "color 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = ACC)}
            onMouseLeave={e => (e.currentTarget.style.color = dim)}
          >
            <RefreshCw size={13} />
          </button>

          {/* Open in new tab (fallback) */}
          <button
            onClick={() => window.open(nekoUrl, "_blank", "noopener")}
            title="Open in dedicated tab"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: dim, padding: "4px 6px", borderRadius: 3,
              display: "flex", alignItems: "center", transition: "color 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = ACC)}
            onMouseLeave={e => (e.currentTarget.style.color = dim)}
          >
            <ExternalLink size={13} />
          </button>

          {/* Fullscreen */}
          <button
            onClick={() => setFullscreen(f => !f)}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: dim, padding: "4px 6px", borderRadius: 3,
              display: "flex", alignItems: "center", transition: "color 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.color = ACC)}
            onMouseLeave={e => (e.currentTarget.style.color = dim)}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 30, opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            style={{
              background: "hsl(0 52% 22%)", borderBottom: `1px solid hsl(0 52% 30%)`,
              display: "flex", alignItems: "center", gap: 8,
              paddingLeft: 14, fontSize: 11, color: "hsl(0 60% 75%)",
              flexShrink: 0, overflow: "hidden",
              fontFamily: "DM Sans, sans-serif",
            }}
          >
            <AlertTriangle size={11} />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Neko iframe ──────────────────────────────────────────────── */}
      {/* Neko streams Firefox via WebRTC — works in all browsers.       */}
      {/* The allow attribute is required for WebRTC audio/video.        */}
      <iframe
        ref={iframeRef}
        key={iframeKey}
        src={nekoUrl}
        allow="camera; microphone; autoplay; clipboard-read; clipboard-write; fullscreen; display-capture"
        style={{
          flex: 1,
          border: "none",
          background: bg,
          display: "block",
        }}
        title="ROME World Browser — Neko Firefox"
        onError={() => setError("Neko failed to load. Check that your VPS is running.")}
      />

      {/* ── Status bar ───────────────────────────────────────────────── */}
      <div style={{
        height: 20, flexShrink: 0,
        background: surface,
        borderTop: `1px solid ${border}`,
        display: "flex", alignItems: "center",
        paddingLeft: 12, paddingRight: 12,
      }}>
        <span style={{ fontSize: 9, letterSpacing: "0.1em", color: "hsl(220 8% 22%)", textTransform: "uppercase", fontFamily: "DM Mono, monospace" }}>
          Neko · Firefox · WebRTC Stream
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, letterSpacing: "0.1em", color: "hsl(220 8% 18%)", textTransform: "uppercase", fontFamily: "DM Mono, monospace" }}>
          {nekoUrl.replace(/^https?:\/\//, "").split("/")[0]}
        </span>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Electron local Chromium shell ───────────────────────────────────────────
function DesktopWorldBrowser() {
  const bridge = window.romeDesktop!.browser;
  const viewportRef = useRef<HTMLDivElement>(null);
  const omniboxRef = useRef<HTMLInputElement>(null);
  const [tabs, setTabs] = useState<RomeBrowserTab[]>([]);
  const [omnibox, setOmnibox] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [history, setHistory] = useState<RomeBrowserHistoryEntry[]>([]);
  const [bookmarks, setBookmarks] = useState<RomeBrowserBookmark[]>([]);
  const [downloads, setDownloads] = useState<RomeBrowserDownload[]>([]);
  const [permission, setPermission] = useState<RomeBrowserPermissionRequest | null>(null);
  const [panel, setPanel] = useState<"history" | "bookmarks" | "downloads" | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [ready, setReady] = useState(false);
  const [bridgeError, setBridgeError] = useState("");
  const [opacity, setOpacity] = useState(readStoredOpacity);
  const [textColor, setTextColor] = useState<string | null>(readStoredTextColor);
  const [constellationOpen, setConstellationOpen] = useState(
    () => document.documentElement.dataset.romeConstellationOpen === "true",
  );
  const [akiraOpen, setAkiraOpen] = useState(
    () => document.documentElement.dataset.romeAkiraPanelOpen === "true",
  );
  /**
   * Let the pinned widgets through.
   *
   * A `WebContentsView` is composited above the React tree and swallows every
   * pointer event inside its rectangle, so a pinned widget over the page is
   * visible through a translucent one and completely dead to the touch. No
   * amount of z-index fixes that — the widget is not on the same surface.
   *
   * The only lever is the one the constellation already pulls: detach the view.
   * This is that lever, made explicit and reversible, so the widgets can be
   * moved, collapsed or unpinned and the page comes straight back. It joins
   * `overlayVisible` rather than living beside it, because "something in ROME
   * needs the screen" is one condition with several causes.
   */
  const [widgetsFront, setWidgetsFront] = useState(false);

  // Offered only when there is something to bring forward. A control that
  // hides the page to reveal nothing is worse than no control.
  const [layout] = useConstellationLayout();
  const hasPinnedWidgets = WIDGET_KEYS.some(key => isWidgetPinned(layout, key));

  const active = tabs.find(tab => tab.active) ?? null;
  const activeBookmarked = Boolean(active?.url && bookmarks.some(bookmark => bookmark.url === active.url));
  const overlayVisible = Boolean(widgetsFront || constellationOpen || akiraOpen || panel || permission || active?.error || active?.crashed || bridgeError);

  const measureViewport = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    void bridge.setViewport({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      visible: ready && !overlayVisible,
    }).catch(() => undefined);
  };

  // Restore the stored surface settings onto the native view. Runs on `ready`
  // rather than on mount because before initialize() resolves there is no view
  // to apply them to, and the calls would be silently dropped.
  useEffect(() => {
    if (!ready) return;
    void bridge.setOpacity(opacity).catch(() => undefined);
    void bridge.setTextColor?.(textColor).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const changeOpacity = (value: number) => {
    const next = Math.min(1, Math.max(MIN_OPACITY, value));
    setOpacity(next);
    try { localStorage.setItem(OPACITY_KEY, String(next)); } catch { /* private mode */ }
    void bridge.setOpacity(next).catch(() => undefined);
  };

  const changeTextColor = (value: string | null) => {
    const next = value && HEX_COLOR.test(value) ? value : null;
    setTextColor(next);
    try {
      if (next) localStorage.setItem(TEXT_COLOR_KEY, next);
      else localStorage.removeItem(TEXT_COLOR_KEY);
    } catch { /* private mode */ }
    void bridge.setTextColor?.(next).catch(() => undefined);
  };

  useEffect(() => {
    let disposed = false;
    const offTabs = bridge.onTabs(next => {
      if (!disposed) setTabs(next);
    });
    const offDownload = bridge.onDownload(download => {
      if (disposed) return;
      setDownloads(current => {
        const index = current.findIndex(item => item.id === download.id);
        if (index < 0) return [download, ...current];
        const next = [...current];
        next[index] = download;
        return next;
      });
    });
    const offPermission = bridge.onPermissionRequest(request => {
      if (!disposed) setPermission(request);
    });

    bridge.initialize()
      .then(initial => {
        if (disposed) return;
        setTabs(initial.tabs);
        setHistory(initial.history);
        setBookmarks(initial.bookmarks);
        setDownloads(initial.downloads);
        setFullscreen(initial.fullscreen);
        setReady(true);
      })
      .catch(error => {
        if (!disposed) setBridgeError(error instanceof Error ? error.message : "Local browser failed to initialize.");
      });

    return () => {
      disposed = true;
      offTabs();
      offDownload();
      offPermission();
      void bridge.setViewport({ x: 0, y: 0, width: 0, height: 0, visible: false }).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onAkiraVisibility = (event: Event) => {
      const visible = (event as CustomEvent<{ visible?: boolean }>).detail?.visible;
      setAkiraOpen(Boolean(visible));
    };
    window.addEventListener("rome:akira-panel-visibility", onAkiraVisibility);
    return () => window.removeEventListener("rome:akira-panel-visibility", onAkiraVisibility);
  }, []);

  useEffect(() => {
    const onConstellationVisibility = (event: Event) => {
      const visible = (event as CustomEvent<{ visible?: boolean }>).detail?.visible;
      setConstellationOpen(Boolean(visible));
    };
    window.addEventListener("rome:constellation-visibility", onConstellationVisibility);
    return () => window.removeEventListener("rome:constellation-visibility", onConstellationVisibility);
  }, []);

  useEffect(() => {
    return bridge.onRequestBounds(() => requestAnimationFrame(measureViewport));
  }, [ready, overlayVisible, active?.id]);

  useEffect(() => {
    if (!editingAddress) setOmnibox(active?.url ?? "");
  }, [active?.id, active?.url, editingAddress]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(measureViewport);
    observer.observe(element);
    window.addEventListener("resize", measureViewport);
    const frame = requestAnimationFrame(measureViewport);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measureViewport);
    };
  }, [ready, overlayVisible, active?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandOrControl = navigator.platform.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey;
      if (commandOrControl && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        run(bridge.createTab());
        return;
      }
      if (commandOrControl && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "w" && active) {
        event.preventDefault();
        run(bridge.closeTab(active.id));
        return;
      }
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Tab" && tabs.length > 1) {
        event.preventDefault();
        const currentIndex = Math.max(0, tabs.findIndex(tab => tab.active));
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
        run(bridge.activateTab(tabs[nextIndex].id));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active?.id, tabs]);

  const run = (action: Promise<unknown>) => {
    void action.catch(error => setBridgeError(error instanceof Error ? error.message : "Browser action failed."));
  };

  const submitAddress = (event: React.FormEvent) => {
    event.preventDefault();
    if (!active) return;
    run(bridge.navigate(active.id, omnibox));
    setEditingAddress(false);
    omniboxRef.current?.blur();
  };

  const openPanel = async (next: "history" | "bookmarks" | "downloads") => {
    setPanel(current => current === next ? null : next);
    try {
      if (next === "history") setHistory(await bridge.getHistory());
      if (next === "bookmarks") setBookmarks(await bridge.getBookmarks());
      if (next === "downloads") setDownloads(await bridge.getDownloads());
    } catch (error) {
      setBridgeError(error instanceof Error ? error.message : "Could not load browser data.");
    }
  };

  const navigateTo = (url: string) => {
    if (!active) return;
    run(bridge.navigate(active.id, url));
    setPanel(null);
  };

  const toggleBookmark = async () => {
    if (!active?.url) return;
    try {
      const result = await bridge.toggleBookmark(active.url, active.title);
      setBookmarks(result.bookmarks);
    } catch (error) {
      setBridgeError(error instanceof Error ? error.message : "Could not update bookmark.");
    }
  };

  const respondPermission = (allowed: boolean) => {
    if (!permission) return;
    run(bridge.respondToPermission(permission.id, allowed));
    setPermission(null);
  };

  const iconButton: React.CSSProperties = {
    width: 28, height: 28, border: "1px solid transparent", borderRadius: 4,
    background: "transparent", color: "hsl(220 8% 46%)", display: "grid",
    placeItems: "center", cursor: "pointer", flexShrink: 0,
  };
  const bg = "hsl(222 16% 5%)";
  const surface = "hsl(222 15% 8%)";
  const border = "hsl(215 15% 15%)";
  const cyan = "hsl(191 55% 55%)";
  const dim = "hsl(220 8% 40%)";

  // Below full opacity the browser is a window onto ROME rather than a panel
  // sitting on it, and three surfaces have to get out of the way: this page's
  // viewport fill, the native view's backdrop (`TabManager`) and the guest
  // page's own background (`guest-opacity`).
  const translucent = opacity < 0.999;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: bg, color: "hsl(210 10% 74%)", fontFamily: "DM Sans, sans-serif" }}>
      <Corners />

      {/* Tab lattice */}
      <div className="rome-browser-lattice" style={{ height: 42, flexShrink: 0, display: "flex", alignItems: "end", padding: "0 10px 0 12px", gap: 4, background: "hsl(222 18% 5.5%)", borderBottom: `1px solid ${border}`, position: "relative", isolation: "isolate" }}>
        <div style={{ height: 41, width: 34, display: "grid", placeItems: "center", flexShrink: 0, position: "relative" }} title="Local Chromium constellation">
          <span className="rome-browser-lattice-node" />
          <Globe size={13} color={ACC} style={{ position: "relative", zIndex: 1 }} />
        </div>
        <div className="rome-browser-tab-strip" style={{ display: "flex", flex: 1, minWidth: 0, gap: 2, overflowX: "auto", overflowY: "hidden", position: "relative", zIndex: 1 }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => run(bridge.activateTab(tab.id))}
              data-active={tab.active ? "true" : "false"}
              className="rome-browser-tab"
              style={{
                height: 33, minWidth: 120, maxWidth: 210, flex: "0 1 190px",
                // The trapezoid, its 1px outline and the active glow are all in
                // CSS: the shape is a clip-path, and a clip-path cannot be
                // expressed as a border. Only the type-dependent colour is here.
                color: tab.active ? "hsl(var(--accent-h) 26% 82%)" : dim,
                padding: "0 10px", display: "flex", position: "relative",
                alignItems: "center", gap: 7, cursor: "pointer", minInlineSize: 0,
              }}
              title={tab.title}
            >
              {/* The fill, inset 1px inside the clipped parent. The 1px of
                  parent showing around it IS the outline — a real border would
                  be clipped away with the corners it is meant to draw. */}
              <span className="rome-browser-tab-face" aria-hidden="true" />
              {tab.incognito ? <Shield size={11} color={cyan} /> : tab.favicon ? (
                <img src={tab.favicon} alt="" style={{ width: 12, height: 12, position: "relative", zIndex: 1 }} />
              ) : <Globe size={11} style={{ position: "relative", zIndex: 1 }} />}
              <span className="rome-browser-tab-trace" aria-hidden="true" />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, flex: 1, textAlign: "left", position: "relative", zIndex: 1 }}>
                {tab.title || "New Tab"}
              </span>
              {tab.loading && <Loader2 size={10} style={{ animation: "romeBrowserSpin 1s linear infinite", position: "relative", zIndex: 1 }} />}
              <span
                role="button"
                title="Close tab"
                className="rome-browser-tab-close"
                onClick={event => { event.stopPropagation(); run(bridge.closeTab(tab.id)); }}
                style={{ width: 16, height: 16, display: "grid", placeItems: "center", borderRadius: 0, position: "relative", zIndex: 1 }}
              ><X size={10} /></span>
            </button>
          ))}
          {/* Inside the strip, so the + always sits immediately right of the
              last tab — exactly where the tab it creates will appear. */}
          <button
            title="New tab (⌘/Ctrl+T)"
            onClick={() => run(bridge.createTab())}
            className="rome-browser-new-tab"
            style={{ width: 26, height: 33, flexShrink: 0, display: "grid", placeItems: "center", border: "1px solid transparent", borderRadius: 0, background: "transparent", color: ACC, cursor: "pointer" }}
          ><Plus size={13} /></button>
          {/* The rest of the strip is the new-tab target. It carries no visible
              affordance of its own; hovering it lights the + to its left, which
              is what names the action. Not a <button>: the + already is one, and
              a second focusable control for the same command is noise in the tab
              order. Aria-hidden for the same reason. */}
          <div
            className="rome-browser-tab-void"
            aria-hidden="true"
            title="New tab (⌘/Ctrl+T)"
            onClick={() => run(bridge.createTab())}
            style={{ flex: "1 1 auto", minWidth: 0, height: 33, cursor: "pointer" }}
          />
        </div>
        <button title="New incognito tab" onClick={() => run(bridge.createTab(undefined, "incognito"))} style={{ ...iconButton, height: 33, marginBottom: 0, position: "relative", zIndex: 1 }}><Shield size={12} /></button>
      </div>

      {/* Navigation console */}
      <div style={{ height: 46, flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "0 10px", background: surface, borderBottom: `1px solid ${border}`, position: "relative" }}>
        <button disabled={!active?.canGoBack} title="Back" onClick={() => active && run(bridge.back(active.id))} style={{ ...iconButton, opacity: active?.canGoBack ? 1 : 0.3 }}><ArrowLeft size={14} /></button>
        <button disabled={!active?.canGoForward} title="Forward" onClick={() => active && run(bridge.forward(active.id))} style={{ ...iconButton, opacity: active?.canGoForward ? 1 : 0.3 }}><ArrowRight size={14} /></button>
        <button title={active?.loading ? "Stop" : "Reload"} onClick={() => active && run(active.loading ? bridge.stop(active.id) : bridge.reload(active.id))} style={iconButton}>
          {active?.loading ? <Square size={10} /> : <RefreshCw size={13} />}
        </button>
        <button title="Home" onClick={() => active && run(bridge.home(active.id))} style={iconButton}><Home size={13} /></button>

        {/* Address bar. At rest: the site's name, centred, in the accent. The
            field itself only surfaces on hover or focus (see .rome-browser-omni). */}
        <form onSubmit={submitAddress} className="rome-browser-omni" data-open={editingAddress ? "true" : "false"} style={{ flex: 1, minWidth: 160, height: 30, position: "relative", display: "flex", alignItems: "center" }}>
          <span className="rome-browser-omni-name" aria-hidden="true">{siteLabel(active?.url ?? "") || "traverse"}</span>
          <div className="rome-browser-omni-chrome" style={{ position: "absolute", left: 10, zIndex: 2, color: active?.url.startsWith("https://") ? "hsl(142 45% 48%)" : dim, display: "grid" }}>
            {active?.url.startsWith("https://") ? <LockKeyhole size={11} /> : <Search size={11} />}
          </div>
          <input
            ref={omniboxRef}
            value={omnibox}
            onChange={event => setOmnibox(event.target.value)}
            onFocus={event => { setEditingAddress(true); event.currentTarget.select(); }}
            onBlur={() => setEditingAddress(false)}
            spellCheck={false}
            aria-label="Address or search"
            placeholder="Traverse the web…"
            className="rome-browser-omni-input"
            style={{ width: "100%", height: "100%", borderRadius: 0, border: `1px solid ${editingAddress ? "hsl(var(--accent-h) 88% 60% / .5)" : "hsl(var(--accent-h) 88% 60% / .18)"}`, background: "hsl(222 18% 5.5%)", color: "hsl(210 10% 68%)", outline: "none", padding: "0 34px 0 30px", fontSize: 11, fontFamily: "DM Mono, monospace", position: "relative", zIndex: 1 }}
          />
          <button type="button" onClick={() => void toggleBookmark()} title={activeBookmarked ? "Remove bookmark" : "Bookmark page"} className="rome-browser-omni-chrome" style={{ ...iconButton, position: "absolute", right: 1, width: 28, zIndex: 2, color: activeBookmarked ? ACC : dim }}>
            <Star size={12} fill={activeBookmarked ? ACC : "none"} />
          </button>
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: 1, padding: "0 4px", borderLeft: `1px solid ${border}` }}>
          <button title="Zoom out" onClick={() => active && run(bridge.setZoom(active.id, active.zoomFactor - 0.1))} style={iconButton}><ZoomOut size={12} /></button>
          <span style={{ width: 34, textAlign: "center", font: "9px DM Mono, monospace", color: dim }}>{Math.round((active?.zoomFactor ?? 1) * 100)}%</span>
          <button title="Zoom in" onClick={() => active && run(bridge.setZoom(active.id, active.zoomFactor + 0.1))} style={iconButton}><ZoomIn size={12} /></button>
        </div>
        <button title="Bookmarks" onClick={() => void openPanel("bookmarks")} style={{ ...iconButton, color: panel === "bookmarks" ? ACC : dim }}><Star size={12} /></button>
        <button title="History" onClick={() => void openPanel("history")} style={{ ...iconButton, color: panel === "history" ? ACC : dim }}><History size={13} /></button>
        <button title="Downloads" onClick={() => void openPanel("downloads")} style={{ ...iconButton, color: panel === "downloads" ? ACC : dim, position: "relative" }}>
          <Download size={13} />
          {downloads.some(item => item.state === "progressing") && <span style={{ position: "absolute", right: 3, top: 3, width: 5, height: 5, borderRadius: "50%", background: cyan, boxShadow: `0 0 5px ${cyan}` }} />}
        </button>
        <button title="Open in external browser" onClick={() => active && run(bridge.openExternal(active.id))} style={iconButton}><ExternalLink size={13} /></button>
        <button title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={async () => { try { setFullscreen(await bridge.setFullscreen(!fullscreen)); } catch { /* handled by window state */ } }} style={iconButton}>
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>

        {active?.loading && <div style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: 2, overflow: "hidden", zIndex: 2 }}><div style={{ width: "35%", height: "100%", background: `linear-gradient(90deg, transparent, ${ACC}, ${cyan})`, animation: "romeBrowserProgress 1.2s ease-in-out infinite" }} /></div>}
      </div>

      {/* This rectangle is deliberately empty while active: Electron places the
          native WebContentsView at these exact content coordinates. */}
      <div ref={viewportRef} style={{ flex: 1, minHeight: 0, position: "relative", background: translucent ? "transparent" : "hsl(222 15% 4%)", overflow: "hidden" }}>
        {/* ROME's sky, in exactly the rectangle the native view covers, and
            only while there is a gap to see it through. First child, so every
            panel and dialog in here paints over it by tree order alone. */}
        {translucent && <AmbientBackdrop strength={Math.min(1, 1.15 - opacity)} />}
        {!ready && !bridgeError && <BrowserCenterState icon={<Loader2 size={20} style={{ animation: "romeBrowserSpin 1s linear infinite" }} />} title="Initializing local Chromium" detail="Preparing an isolated browser surface…" />}
        {(active?.error || active?.crashed) && (
          <BrowserCenterState
            icon={<AlertTriangle size={22} color="hsl(12 65% 62%)" />}
            title={active.crashed ? "Renderer recovery required" : "Navigation interrupted"}
            detail={active.error ?? "The page renderer stopped unexpectedly."}
            actionLabel="Recover tab"
            onAction={() => run(bridge.recover(active.id))}
          />
        )}
        {bridgeError && <BrowserCenterState icon={<AlertTriangle size={22} color="hsl(12 65% 62%)" />} title="Local browser unavailable" detail={bridgeError} actionLabel="Dismiss" onAction={() => setBridgeError("")} />}

        {panel && <BrowserPanel kind={panel} history={history} bookmarks={bookmarks} downloads={downloads} onNavigate={navigateTo} onClearHistory={async () => { await bridge.clearHistory(); setHistory([]); }} onOpenDownload={id => run(bridge.openDownload(id))} onShowDownload={id => run(bridge.showDownload(id))} onClose={() => setPanel(null)} />}

        {permission && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "hsl(222 18% 4% / 0.92)", zIndex: 20 }}>
            <div style={{ width: 420, maxWidth: "calc(100% - 32px)", padding: 24, border: `1px solid hsl(var(--accent-h) 38% 24%)`, background: surface, position: "relative", boxShadow: "0 18px 60px #0009" }}>
              <Corners />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}><Shield size={16} color={ACC} /><span style={{ font: "11px Cinzel, serif", letterSpacing: ".13em", color: ACC, textTransform: "uppercase" }}>Site Permission</span></div>
              <div style={{ fontSize: 12, lineHeight: 1.7, color: "hsl(210 8% 65%)" }}><strong style={{ color: "hsl(210 10% 80%)" }}>{permission.origin}</strong> requests access to <strong style={{ color: cyan }}>{permission.permission}</strong>.</div>
              <div style={{ marginTop: 8, fontSize: 10, color: dim }}>Only allow this when you trust the site and expect the request.</div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
                <BrowserTextButton label="Block" onClick={() => respondPermission(false)} />
                <BrowserTextButton label="Allow once" accent onClick={() => respondPermission(true)} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ height: 20, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 11px", borderTop: `1px solid ${border}`, background: surface, font: "8px DM Mono, monospace", letterSpacing: ".11em", textTransform: "uppercase", color: "hsl(220 8% 28%)" }}>
        <span style={{ color: active?.incognito ? cyan : "hsl(142 40% 40%)" }}>●</span>&nbsp;&nbsp;Local Chromium · {active?.incognito ? "Ephemeral session" : "Persistent profile"}

        {/* Surface opacity. A hairline track rather than a labelled control:
            it lives in a 20px status strip and is reached perhaps twice a
            week. The percentage only appears once you are touching it. */}
        <span className="rome-browser-opacity" style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 14 }}>
          <span style={{ color: "hsl(220 8% 24%)" }}>Opacity</span>
          <input
            type="range"
            min={MIN_OPACITY * 100}
            max={100}
            step={1}
            value={Math.round(opacity * 100)}
            onChange={event => changeOpacity(Number(event.target.value) / 100)}
            onDoubleClick={() => changeOpacity(1)}
            title={`Browser opacity — ${Math.round(opacity * 100)}% · double-click to reset`}
            aria-label="Browser opacity"
          />
          <span className="rome-browser-opacity-value" style={{ width: 22, color: ACC }}>{Math.round(opacity * 100)}</span>
        </span>

        {/* Pinned widgets. See `widgetsFront` above: the page steps aside rather
            than the widget coming forward, because the page is a native view
            and cannot be painted over. */}
        {hasPinnedWidgets && (
          <button
            onClick={() => setWidgetsFront(value => !value)}
            title={widgetsFront
              ? "Show the page again"
              : "Hide the page so pinned widgets can be moved"}
            style={{
              marginLeft: 14,
              display: "flex", alignItems: "center", gap: 5,
              background: "none", border: 0, cursor: "pointer", padding: 0,
              font: "8px DM Mono, monospace", letterSpacing: ".11em", textTransform: "uppercase",
              color: widgetsFront ? ACC : "hsl(220 8% 24%)",
              transition: "color 140ms ease",
            }}
          >
            <Pin size={9} style={{ transform: widgetsFront ? undefined : "rotate(38deg)" }} />
            Widgets
          </button>
        )}

        {/* Text colour. The page keeps its own until you pick one — an override
            is occasionally necessary once the surfaces behind the text have
            gone translucent, and never wanted by default. */}
        <span className="rome-browser-textcolor" style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 14 }}>
          <span style={{ color: "hsl(220 8% 24%)" }}>Text</span>
          <span className="rome-browser-textcolor-presets">
            {TEXT_PRESETS.map(preset => (
              <button
                key={preset}
                onClick={() => changeTextColor(preset)}
                title={`Force page text to ${preset}`}
                aria-label={`Force page text to ${preset}`}
                data-on={textColor?.toLowerCase() === preset.toLowerCase() ? "true" : undefined}
                style={{ background: preset }}
              />
            ))}
          </span>
          <input
            type="color"
            value={textColor ?? "#e8eef5"}
            onChange={event => changeTextColor(event.target.value)}
            title="Force a custom colour on all page text"
            aria-label="Custom page text colour"
          />
          <button
            onClick={() => changeTextColor(null)}
            disabled={!textColor}
            title={textColor ? "Give pages their own colours back" : "Pages are using their own colours"}
            aria-label="Clear the text colour override"
            className="rome-browser-textcolor-clear"
          >
            ✕
          </button>
        </span>

        <span style={{ flex: 1 }} />
        <span>{active?.loading ? "Traversing" : "Ready"}</span>
      </div>

      <style>{`
        .rome-browser-lattice {
          background-image:
            radial-gradient(circle at 18px 18px, hsl(var(--accent-h) 70% 58% / .14) 0 1px, transparent 1.5px),
            linear-gradient(112deg, transparent 0 13%, hsl(191 50% 45% / .025) 13.1% 13.2%, transparent 13.3% 100%);
          background-size: 88px 42px, 100% 100%;
        }
        .rome-browser-lattice-node {
          position: absolute; width: 4px; height: 4px; border-radius: 50%;
          background: hsl(var(--accent-h) 72% 57% / .75); box-shadow: 0 0 8px hsl(var(--accent-h) 72% 55% / .3);
        }
        .rome-browser-tab-strip { scrollbar-width: none; }
        .rome-browser-tab-strip::-webkit-scrollbar { display: none; }
        .rome-browser-tab, .rome-browser-new-tab, .rome-browser-tab-face { transition: background 160ms ease, background-color 160ms ease, color 160ms ease, opacity 160ms ease, filter 160ms ease; }
        /* Trapezoid, drawn as two clipped layers. The parent is clipped to the
           silhouette and painted the outline colour; .rome-browser-tab-face is
           inset 1px and clipped to the same polygon, so the 1px of parent left
           showing around it is the outline. A real border cannot do this — the
           clip-path removes the corners the border is there to draw — and a
           box-shadow outline is clipped away with them.

           Slant is on the top edge only. Flaring the bottom instead would push
           each tab's base into its neighbour's, and the strip scrolls, so tabs
           cannot be given the negative margins that lets Chrome overlap them.

           The two rakes are deliberately unequal. A symmetric trapezoid reads as
           a shape someone drew; the near-vertical left edge with the raked right
           reads as a direction — the strip runs left to right and the tabs lean
           with it. It also keeps the favicon from being crowded by the taper. */
        .rome-browser-tab {
          --slant-l: 3px;
          --slant-r: 11px;
          border: 0; border-radius: 0;
          clip-path: polygon(var(--slant-l) 0, calc(100% - var(--slant-r)) 0, 100% 100%, 0 100%);
          background-color: hsl(var(--accent-h) var(--accent-s) 60% / .3);
        }
        /* Pin rail. Seven 1px ticks along the bottom edge, the same
           surface-mount-chip vocabulary .rome-widget-shell uses for its flanks,
           scaled to a 33px part. Painted as a background layer on the face so no
           tab needs markup for it, and inside the face so the clip keeps them
           off the slanted ends. */
        .rome-browser-tab-face {
          position: absolute; inset: 1px; z-index: 0; pointer-events: none;
          clip-path: polygon(var(--slant-l) 0, calc(100% - var(--slant-r)) 0, 100% 100%, 0 100%);
          background-color: hsl(222 16% 6% / .82);
          background-image: repeating-linear-gradient(90deg, hsl(var(--accent-h) var(--accent-s) 60% / .3) 0 1px, transparent 1px 6px);
          background-repeat: no-repeat;
          background-size: 41px 3px;
          background-position: 6px 100%;
        }
        /* A trace between the favicon and the title, rather than a rule: it
           fades at both ends like .rome-widget-rule, so it reads as something
           routed through the tab instead of a divider dropped on top of it. */
        .rome-browser-tab-trace {
          width: 1px; height: 13px; flex-shrink: 0; position: relative; z-index: 1;
          background: linear-gradient(180deg, transparent, hsl(var(--accent-h) var(--accent-s) 60% / .45), transparent);
        }
        .rome-browser-tab:hover:not([data-active="true"]) { background-color: hsl(var(--accent-h) var(--accent-s) 60% / .5); }
        .rome-browser-tab:hover:not([data-active="true"]) .rome-browser-tab-face { background-color: hsl(222 14% 8% / .86); }
        /* The glow says "this tab is the page you are looking at". drop-shadow,
           not box-shadow: box-shadow is painted on the border box and then
           clipped off with the corners, while drop-shadow follows the element's
           rendered alpha and so traces the trapezoid. It breathes rather than
           sitting still so it reads as live without being loud; the period is
           deliberately off the selected-node breath (3.8s) so the two never lock
           into a beat. */
        .rome-browser-tab[data-active="true"] {
          background-color: hsl(var(--accent-h) var(--accent-s) 62% / .7);
          animation: romeTabBreathe 3.6s ease-in-out infinite;
        }
        /* Active face: pins lit, plus a bus trace running off the top-left edge
           and fading out — the tab is the one carrying signal. Layer order is
           paint order, first on top: pins, trace, fill. */
        .rome-browser-tab[data-active="true"] .rome-browser-tab-face {
          background-color: hsl(var(--accent-h) 26% 10% / .96);
          background-image:
            repeating-linear-gradient(90deg, hsl(var(--accent-h) var(--accent-s) 66% / .8) 0 1px, transparent 1px 6px),
            linear-gradient(90deg, hsl(var(--accent-h) var(--accent-s) 72% / .9), hsl(var(--accent-h) var(--accent-s) 72% / 0)),
            linear-gradient(180deg, hsl(var(--accent-h) 26% 10% / .96), hsl(222 16% 6% / .9));
          background-size: 41px 3px, 64px 1px, 100% 100%;
          background-position: 6px 100%, 5px 0, 0 0;
        }
        @keyframes romeTabBreathe {
          0%, 100% { filter: drop-shadow(0 0 4px hsl(var(--accent-h) var(--accent-s) 58% / .26)); }
          50%      { filter: drop-shadow(0 0 10px hsl(var(--accent-h) var(--accent-s) 62% / .5)); }
        }
        .rome-browser-tab-close:hover { background: hsl(var(--accent-h) var(--accent-s) 60% / .2); color: ${ACC}; }
        /* New tab: nothing at rest, so the lattice is only tabs. The empty strip
           to its right is the click target (.rome-browser-tab-void), and hovering
           that is what lights the + — the affordance names the action without
           the pointer ever having to find a 26px button. :has() reaches back to
           an earlier sibling, which no combinator can do. */
        .rome-browser-new-tab { opacity: 0; }
        .rome-browser-tab-strip:hover .rome-browser-new-tab { opacity: .42; }
        .rome-browser-tab-strip:has(.rome-browser-tab-void:hover) .rome-browser-new-tab,
        .rome-browser-new-tab:hover, .rome-browser-new-tab:focus-visible {
          opacity: 1; color: ${ACC};
          filter: drop-shadow(0 0 7px hsl(var(--accent-h) var(--accent-s) 62% / .75));
        }
        /* Address bar. At rest it is only the site's name; the field, the URL
           and the controls are held at zero opacity. The name sits above the
           input with pointer-events off, so hovering anywhere in the row still
           reaches the input underneath. */
        .rome-browser-omni-name {
          position: absolute; inset: 0; z-index: 3; pointer-events: none;
          display: grid; place-items: center;
          font-family: 'Zen Dots', 'DM Mono', monospace;
          font-size: 11px; letter-spacing: .2em; text-transform: uppercase;
          color: hsl(var(--accent-h) 88% 60% / .84); text-shadow: 0 0 10px hsl(var(--accent-h) 85% 55% / .3);
          overflow: hidden; white-space: nowrap; padding: 0 12px;
          transition: opacity 170ms ease;
        }
        .rome-browser-omni-input, .rome-browser-omni-chrome { opacity: 0; transition: opacity 170ms ease; }
        .rome-browser-omni:hover .rome-browser-omni-input,
        .rome-browser-omni:focus-within .rome-browser-omni-input,
        .rome-browser-omni[data-open="true"] .rome-browser-omni-input,
        .rome-browser-omni:hover .rome-browser-omni-chrome,
        .rome-browser-omni:focus-within .rome-browser-omni-chrome,
        .rome-browser-omni[data-open="true"] .rome-browser-omni-chrome { opacity: 1; }
        .rome-browser-omni:hover .rome-browser-omni-name,
        .rome-browser-omni:focus-within .rome-browser-omni-name,
        .rome-browser-omni[data-open="true"] .rome-browser-omni-name { opacity: 0; }
        /* Opacity slider — a lit hairline with a small square handle. Native
           range styling would put a 16px pill in a 20px status bar. */
        .rome-browser-opacity input[type="range"] {
          -webkit-appearance: none; appearance: none;
          width: 64px; height: 10px; background: none; cursor: pointer; outline: none;
        }
        .rome-browser-opacity input[type="range"]::-webkit-slider-runnable-track {
          height: 1px; background: hsl(var(--accent-h) 30% 26%); box-shadow: 0 0 5px hsl(var(--accent-h) 60% 45% / .35);
        }
        .rome-browser-opacity input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 5px; height: 9px; margin-top: -4px; border-radius: 0;
          background: ${ACC}; box-shadow: 0 0 6px hsl(var(--accent-h) 85% 58% / .7);
        }
        .rome-browser-opacity input[type="range"]:hover::-webkit-slider-thumb { box-shadow: 0 0 9px hsl(var(--accent-h) 90% 62% / .9); }
        .rome-browser-opacity input[type="range"]::-moz-range-track { height: 1px; background: hsl(var(--accent-h) 30% 26%); }
        .rome-browser-opacity input[type="range"]::-moz-range-thumb {
          width: 5px; height: 9px; border: 0; border-radius: 0; background: ${ACC};
        }
        /* The readout is noise at rest and useful while dragging. */
        /* Text-colour control. Same manners as the slider: a hairline at rest,
           the presets only unfold when you are actually pointing at it. */
        .rome-browser-textcolor input[type="color"] {
          width: 11px; height: 11px; padding: 0; border: 0; background: none;
          cursor: pointer; appearance: none; -webkit-appearance: none;
        }
        .rome-browser-textcolor input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
        .rome-browser-textcolor input[type="color"]::-webkit-color-swatch {
          border: 1px solid hsl(var(--accent-h) 30% 30%); border-radius: 50%;
        }
        .rome-browser-textcolor-presets {
          display: flex; align-items: center; gap: 3; overflow: hidden;
          max-width: 0; opacity: 0; transition: max-width 160ms ease, opacity 140ms ease;
        }
        .rome-browser-textcolor:hover .rome-browser-textcolor-presets,
        .rome-browser-textcolor:focus-within .rome-browser-textcolor-presets {
          max-width: 90px; opacity: 1; margin-right: 3px;
        }
        .rome-browser-textcolor-presets button {
          width: 9px; height: 9px; margin-right: 3px; padding: 0; border-radius: 50%;
          border: 1px solid hsl(220 12% 22%); cursor: pointer;
        }
        .rome-browser-textcolor-presets button:hover { border-color: hsl(var(--accent-h) 60% 50%); }
        .rome-browser-textcolor-presets button[data-on="true"] {
          border-color: ${ACC}; box-shadow: 0 0 6px hsl(var(--accent-h) 90% 60% / .7);
        }
        .rome-browser-textcolor-clear {
          border: 0; background: none; padding: 0 1px; cursor: pointer;
          color: hsl(220 8% 30%); font: 8px "DM Mono", monospace; line-height: 1;
        }
        .rome-browser-textcolor-clear:disabled { opacity: .25; cursor: default; }
        .rome-browser-textcolor-clear:not(:disabled):hover { color: hsl(0 55% 58%); }

        .rome-browser-opacity-value { opacity: 0; transition: opacity 120ms ease; }
        .rome-browser-opacity:hover .rome-browser-opacity-value,
        .rome-browser-opacity input[type="range"]:focus ~ .rome-browser-opacity-value { opacity: .85; }
        @keyframes romeBrowserSpin { to { transform: rotate(360deg); } }
        @keyframes romeBrowserProgress { from { transform: translateX(-110%); } to { transform: translateX(330%); } }
        button:disabled { cursor: default !important; }
      `}</style>
    </div>
  );
}

function BrowserCenterState({ icon, title, detail, actionLabel, onAction }: { icon: React.ReactNode; title: string; detail: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", backgroundImage: "linear-gradient(hsl(195 40% 15% / .035) 1px, transparent 1px), linear-gradient(90deg, hsl(195 40% 15% / .035) 1px, transparent 1px)", backgroundSize: "36px 36px" }}>
      <div style={{ textAlign: "center", maxWidth: 520, padding: 28 }}>
        <div style={{ display: "grid", placeItems: "center", color: ACC, marginBottom: 12 }}>{icon}</div>
        <div style={{ font: "11px Cinzel, serif", letterSpacing: ".14em", color: ACC, textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 11, color: "hsl(220 8% 42%)", lineHeight: 1.6, wordBreak: "break-word" }}>{detail}</div>
        {actionLabel && onAction && <div style={{ marginTop: 18 }}><BrowserTextButton label={actionLabel} accent onClick={onAction} /></div>}
      </div>
    </div>
  );
}

function BrowserTextButton({ label, onClick, accent = false }: { label: string; onClick: () => void; accent?: boolean }) {
  return <button onClick={onClick} style={{ height: 30, padding: "0 13px", border: `1px solid ${accent ? "hsl(var(--accent-h) 45% 30%)" : "hsl(220 12% 18%)"}`, borderRadius: 3, background: accent ? "hsl(var(--accent-h) 40% 12%)" : "hsl(222 15% 7%)", color: accent ? ACC : "hsl(220 8% 55%)", cursor: "pointer", font: "9px DM Mono, monospace", letterSpacing: ".08em", textTransform: "uppercase" }}>{label}</button>;
}

function BrowserPanel({ kind, history, bookmarks, downloads, onNavigate, onClearHistory, onOpenDownload, onShowDownload, onClose }: {
  kind: "history" | "bookmarks" | "downloads";
  history: RomeBrowserHistoryEntry[];
  bookmarks: RomeBrowserBookmark[];
  downloads: RomeBrowserDownload[];
  onNavigate: (url: string) => void;
  onClearHistory: () => Promise<void>;
  onOpenDownload: (id: string) => void;
  onShowDownload: (id: string) => void;
  onClose: () => void;
}) {
  const title = kind === "history" ? "Traversal History" : kind === "bookmarks" ? "Saved Coordinates" : "Downloads";
  const entries = kind === "history" ? history : kind === "bookmarks" ? bookmarks : [];
  const border = "hsl(215 15% 15%)";
  return (
    <div style={{ position: "absolute", inset: 0, background: "hsl(222 16% 5%)", overflow: "auto", padding: "26px max(24px, 8vw)", zIndex: 10 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
          <div style={{ font: "11px Cinzel, serif", color: ACC, letterSpacing: ".16em", textTransform: "uppercase" }}>{title}</div>
          <div style={{ flex: 1 }} />
          {kind === "history" && history.length > 0 && <BrowserTextButton label="Clear history" onClick={() => void onClearHistory()} />}
          <button onClick={onClose} style={{ marginLeft: 8, background: "none", border: "none", color: "hsl(220 8% 45%)", cursor: "pointer", padding: 7 }}><X size={14} /></button>
        </div>

        {kind !== "downloads" && entries.length === 0 && <div style={{ padding: "50px 0", textAlign: "center", color: "hsl(220 8% 30%)", fontSize: 11 }}>No coordinates recorded.</div>}
        {kind !== "downloads" && entries.map(entry => (
          <button key={entry.id} onClick={() => onNavigate(entry.url)} style={{ width: "100%", minHeight: 48, display: "flex", alignItems: "center", gap: 12, textAlign: "left", background: "transparent", border: "none", borderBottom: `1px solid ${border}`, color: "inherit", cursor: "pointer", padding: "8px 5px" }}>
            {kind === "history" ? <History size={12} color="hsl(220 8% 35%)" /> : <Star size={12} color={ACC} />}
            <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 11, color: "hsl(210 8% 65%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title || entry.url}</div><div style={{ font: "9px DM Mono, monospace", color: "hsl(220 8% 31%)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.url}</div></div>
          </button>
        ))}

        {kind === "downloads" && downloads.length === 0 && <div style={{ padding: "50px 0", textAlign: "center", color: "hsl(220 8% 30%)", fontSize: 11 }}>No downloads this session.</div>}
        {kind === "downloads" && downloads.map(item => {
          const percent = item.totalBytes > 0 ? Math.min(100, Math.round(item.receivedBytes / item.totalBytes * 100)) : 0;
          return (
            <div key={item.id} style={{ minHeight: 62, display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${border}`, padding: "10px 5px" }}>
              <Download size={13} color={item.state === "completed" ? "hsl(142 45% 48%)" : ACC} />
              <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 11, color: "hsl(210 8% 65%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.filename}</div><div style={{ font: "9px DM Mono, monospace", color: "hsl(220 8% 31%)", marginTop: 4 }}>{item.state === "progressing" ? `${percent}% · ${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}` : item.state}</div>{item.state === "progressing" && <div style={{ height: 2, background: "hsl(220 10% 12%)", marginTop: 6 }}><div style={{ width: `${percent}%`, height: "100%", background: ACC }} /></div>}</div>
              <button disabled={item.state !== "completed"} title="Open" onClick={() => onOpenDownload(item.id)} style={{ background: "none", border: "none", color: "hsl(220 8% 45%)", padding: 7, cursor: "pointer" }}><ExternalLink size={12} /></button>
              <button title="Show in folder" onClick={() => onShowDownload(item.id)} style={{ background: "none", border: "none", color: "hsl(220 8% 45%)", padding: 7, cursor: "pointer" }}><FolderOpen size={13} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function WorldBrowser() {
  return window.romeDesktop?.isDesktop ? <DesktopWorldBrowser /> : <WebWorldBrowser />;
}
