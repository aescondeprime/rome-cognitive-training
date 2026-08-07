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
  LockKeyhole, Square,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Accent colour (matches ROME theme) ──────────────────────────────────────
const ACC = "hsl(43 88% 60%)";

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
  const [constellationOpen, setConstellationOpen] = useState(
    () => document.documentElement.dataset.romeConstellationOpen === "true",
  );

  const active = tabs.find(tab => tab.active) ?? null;
  const activeBookmarked = Boolean(active?.url && bookmarks.some(bookmark => bookmark.url === active.url));
  const overlayVisible = Boolean(constellationOpen || panel || permission || active?.error || active?.crashed || bridgeError);

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

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: bg, color: "hsl(210 10% 74%)", fontFamily: "DM Sans, sans-serif" }}>
      <Corners />

      {/* Tab lattice */}
      <div style={{ height: 38, flexShrink: 0, display: "flex", alignItems: "end", padding: "0 10px 0 12px", gap: 3, background: "hsl(222 17% 6%)", borderBottom: `1px solid ${border}` }}>
        <div style={{ height: 37, width: 26, display: "grid", placeItems: "center", flexShrink: 0 }} title="Local Chromium">
          <Globe size={13} color={ACC} />
        </div>
        <div style={{ display: "flex", flex: 1, minWidth: 0, gap: 3, overflow: "hidden" }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => run(bridge.activateTab(tab.id))}
              style={{
                height: 32, minWidth: 108, maxWidth: 210, flex: "1 1 170px",
                border: `1px solid ${tab.active ? "hsl(43 50% 25%)" : border}`,
                borderBottom: tab.active ? `1px solid ${surface}` : undefined,
                background: tab.active ? surface : "hsl(222 15% 6.8%)",
                color: tab.active ? "hsl(210 10% 76%)" : dim,
                borderRadius: "5px 5px 0 0", padding: "0 7px", display: "flex",
                alignItems: "center", gap: 7, cursor: "pointer", minInlineSize: 0,
              }}
              title={tab.title}
            >
              {tab.incognito ? <Shield size={11} color={cyan} /> : tab.favicon ? (
                <img src={tab.favicon} alt="" style={{ width: 12, height: 12 }} />
              ) : <Globe size={11} />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, flex: 1, textAlign: "left" }}>
                {tab.title || "New Tab"}
              </span>
              {tab.loading && <Loader2 size={10} style={{ animation: "romeBrowserSpin 1s linear infinite" }} />}
              <span
                role="button"
                title="Close tab"
                onClick={event => { event.stopPropagation(); run(bridge.closeTab(tab.id)); }}
                style={{ width: 16, height: 16, display: "grid", placeItems: "center", borderRadius: 3 }}
              ><X size={10} /></span>
            </button>
          ))}
        </div>
        <button title="New tab" onClick={() => run(bridge.createTab())} style={iconButton}><Plus size={13} /></button>
        <button title="New incognito tab" onClick={() => run(bridge.createTab(undefined, "incognito"))} style={iconButton}><Shield size={12} /></button>
      </div>

      {/* Navigation console */}
      <div style={{ height: 46, flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "0 10px", background: surface, borderBottom: `1px solid ${border}`, position: "relative" }}>
        <button disabled={!active?.canGoBack} title="Back" onClick={() => active && run(bridge.back(active.id))} style={{ ...iconButton, opacity: active?.canGoBack ? 1 : 0.3 }}><ArrowLeft size={14} /></button>
        <button disabled={!active?.canGoForward} title="Forward" onClick={() => active && run(bridge.forward(active.id))} style={{ ...iconButton, opacity: active?.canGoForward ? 1 : 0.3 }}><ArrowRight size={14} /></button>
        <button title={active?.loading ? "Stop" : "Reload"} onClick={() => active && run(active.loading ? bridge.stop(active.id) : bridge.reload(active.id))} style={iconButton}>
          {active?.loading ? <Square size={10} /> : <RefreshCw size={13} />}
        </button>
        <button title="Home" onClick={() => active && run(bridge.home(active.id))} style={iconButton}><Home size={13} /></button>

        <form onSubmit={submitAddress} style={{ flex: 1, minWidth: 160, height: 30, position: "relative", display: "flex", alignItems: "center" }}>
          <div style={{ position: "absolute", left: 10, zIndex: 1, color: active?.url.startsWith("https://") ? "hsl(142 45% 48%)" : dim, display: "grid" }}>
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
            style={{ width: "100%", height: "100%", borderRadius: 4, border: `1px solid ${editingAddress ? "hsl(43 45% 28%)" : border}`, background: "hsl(222 18% 5.5%)", color: "hsl(210 10% 68%)", outline: "none", padding: "0 34px 0 30px", fontSize: 11, fontFamily: "DM Mono, monospace" }}
          />
          <button type="button" onClick={() => void toggleBookmark()} title={activeBookmarked ? "Remove bookmark" : "Bookmark page"} style={{ ...iconButton, position: "absolute", right: 1, width: 28, color: activeBookmarked ? ACC : dim }}>
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
      <div ref={viewportRef} style={{ flex: 1, minHeight: 0, position: "relative", background: "hsl(222 15% 4%)", overflow: "hidden" }}>
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
            <div style={{ width: 420, maxWidth: "calc(100% - 32px)", padding: 24, border: `1px solid hsl(43 38% 24%)`, background: surface, position: "relative", boxShadow: "0 18px 60px #0009" }}>
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
        <span style={{ flex: 1 }} />
        <span>{active?.loading ? "Traversing" : "Ready"}</span>
      </div>

      <style>{`
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
  return <button onClick={onClick} style={{ height: 30, padding: "0 13px", border: `1px solid ${accent ? "hsl(43 45% 30%)" : "hsl(220 12% 18%)"}`, borderRadius: 3, background: accent ? "hsl(43 40% 12%)" : "hsl(222 15% 7%)", color: accent ? ACC : "hsl(220 8% 55%)", cursor: "pointer", font: "9px DM Mono, monospace", letterSpacing: ".08em", textTransform: "uppercase" }}>{label}</button>;
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
