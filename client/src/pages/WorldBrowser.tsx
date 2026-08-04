/**
 * WorldBrowser — Integrated web browser using server-side HTTP proxy.
 *
 * Architecture:
 *   iframe src="/api/proxy?url=<target>" — server fetches the page, rewrites
 *   links so they stay same-origin, injects a postMessage bridge for URL/title
 *   tracking. No external services. Works in any browser.
 *
 * States: idle | loading | loaded | error
 */

import {
  useState, useRef, useCallback, useEffect, KeyboardEvent,
} from "react";
import {
  Globe, ArrowLeft, ArrowRight, RotateCw, X, Plus,
  Home, Maximize2, Minimize2,
  AlertTriangle, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ── Constants ──────────────────────────────────────────────────────────────
const HOME_URL = "https://www.google.com";
const PROXY    = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;
const ACC      = "hsl(43 88% 60%)";  // gold accent

// ── Helpers ─────────────────────────────────────────────────────────────────
function normalise(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return HOME_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // search term?
  if (!trimmed.includes(".") || trimmed.includes(" ")) {
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }
  return "https://" + trimmed;
}

function displayUrl(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl, location.origin);
    const target = u.searchParams.get("url");
    return target ? decodeURIComponent(target) : proxyUrl;
  } catch { return proxyUrl; }
}

function faviconUrl(url: string) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`; }
  catch { return undefined; }
}

// ── Decorative corners ──────────────────────────────────────────────────────
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

// ── Btn helper ──────────────────────────────────────────────────────────────
function Btn({ children, onClick, disabled, title }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: "none", border: "none", cursor: disabled ? "default" : "pointer",
        color: disabled ? "hsl(220 8% 28%)" : "hsl(220 10% 55%)",
        padding: "4px 6px", borderRadius: 3, display: "flex", alignItems: "center",
        transition: "color 0.12s",
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.color = ACC; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = disabled ? "hsl(220 8% 28%)" : "hsl(220 10% 55%)"; }}
    >
      {children}
    </button>
  );
}

// ── Tab interface ───────────────────────────────────────────────────────────
interface Tab {
  id: number;
  url: string;        // real URL (not proxied)
  title: string;
}

// ── Main component ──────────────────────────────────────────────────────────
export default function WorldBrowser() {
  const [tabs,        setTabs]        = useState<Tab[]>([{ id: 0, url: HOME_URL, title: "New Tab" }]);
  const [activeTab,   setActiveTab]   = useState(0);
  const [addressBar,  setAddressBar]  = useState(HOME_URL);
  const [editingAddr, setEditingAddr] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [fullscreen,  setFullscreen]  = useState(false);
  const [error,       setError]       = useState("");
  const iframeRef  = useRef<HTMLIFrameElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const nextId     = useRef(1);

  const currentTab = tabs.find(t => t.id === activeTab) ?? tabs[0];

  // ── iframe src: proxy the current tab's URL ─────────────────────────────
  const iframeSrc = currentTab ? PROXY(currentTab.url) : PROXY(HOME_URL);

  // ── Update tab url/title ─────────────────────────────────────────────────
  const updateTab = useCallback((id: number, patch: Partial<Tab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  // ── Listen for postMessage from proxied page (URL/title changes) ─────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== "PROXY_NAV") return;
      const { url, title } = e.data;
      // url here will be /api/proxy?url=... — extract real URL
      const realUrl = (() => {
        try {
          const u = new URL(url, location.origin);
          return u.searchParams.get("url") ? decodeURIComponent(u.searchParams.get("url")!) : url;
        } catch { return url; }
      })();
      if (!editingAddr) setAddressBar(realUrl);
      updateTab(activeTab, { url: realUrl, title: title || realUrl });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [activeTab, editingAddr, updateTab]);

  // ── Navigate ─────────────────────────────────────────────────────────────
  const navigate = useCallback((raw: string) => {
    const url = normalise(raw);
    setEditingAddr(false);
    setLoading(true);
    setError("");
    updateTab(activeTab, { url, title: "Loading…" });
    setAddressBar(url);
  }, [activeTab, updateTab]);

  const onAddrKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter")  navigate(addressRef.current?.value ?? addressBar);
    if (e.key === "Escape") { setEditingAddr(false); addressRef.current?.blur(); }
  };

  // ── Tab management ────────────────────────────────────────────────────────
  const newTab = () => {
    const id = nextId.current++;
    setTabs(prev => [...prev, { id, url: HOME_URL, title: "New Tab" }]);
    setActiveTab(id);
    setAddressBar(HOME_URL);
    setLoading(true);
  };

  const closeTab = (id: number) => {
    if (tabs.length === 1) return; // keep at least one
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (id === activeTab) {
        const idx = Math.max(0, prev.findIndex(t => t.id === id) - 1);
        const newActive = next[idx]?.id ?? next[0]?.id;
        setActiveTab(newActive);
        setAddressBar(next.find(t => t.id === newActive)?.url ?? HOME_URL);
      }
      return next;
    });
  };

  const switchTab = (id: number) => {
    setActiveTab(id);
    setAddressBar(tabs.find(t => t.id === id)?.url ?? HOME_URL);
    setLoading(true);
  };

  // ── Nav controls ──────────────────────────────────────────────────────────
  const goBack    = () => { try { iframeRef.current?.contentWindow?.history.back();    } catch {} };
  const goForward = () => { try { iframeRef.current?.contentWindow?.history.forward(); } catch {} };
  const reload    = () => { setLoading(true); try { iframeRef.current?.contentWindow?.location.reload(); } catch { updateTab(activeTab, { url: currentTab.url }); } };
  const goHome    = () => navigate(HOME_URL);

  // ── iframe load events ────────────────────────────────────────────────────
  const onIframeLoad = () => {
    setLoading(false);
    setError("");
    try {
      const loc = iframeRef.current?.contentWindow?.location?.href ?? "";
      if (loc && loc !== "about:blank") {
        const real = displayUrl(loc);
        if (!editingAddr) setAddressBar(real);
        updateTab(activeTab, { url: real });
      }
    } catch {} // cross-origin; handled by postMessage bridge instead
  };

  const onIframeError = () => {
    setLoading(false);
    setError("Page failed to load");
  };

  // ── Tab label truncation ──────────────────────────────────────────────────
  function tabLabel(tab: Tab) {
    if (!tab.title || tab.title === "Loading…" || tab.title === "New Tab") {
      try { return new URL(tab.url).hostname || "New Tab"; } catch { return "New Tab"; }
    }
    return tab.title.length > 20 ? tab.title.slice(0, 19) + "…" : tab.title;
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const bg       = "hsl(222 14% 6%)";
  const surface  = "hsl(222 14% 9%)";
  const border   = "hsl(220 12% 14%)";
  const textDim  = "hsl(220 8% 35%)";

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: bg,
      display: "flex", flexDirection: "column",
      fontFamily: "DM Sans, sans-serif",
      overflow: "hidden",
    }}>
      <Corners />

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div style={{
        height: 36,
        background: surface,
        borderBottom: `1px solid ${border}`,
        display: "flex", alignItems: "center",
        paddingLeft: 8, paddingRight: 8, gap: 2,
        overflowX: "auto", overflowY: "hidden",
        flexShrink: 0,
      }}>
        {tabs.map(tab => (
          <div
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 4,
              background: tab.id === activeTab ? "hsl(220 12% 13%)" : "transparent",
              border: tab.id === activeTab ? `1px solid ${border}` : "1px solid transparent",
              cursor: "pointer", flexShrink: 0, maxWidth: 180,
              color: tab.id === activeTab ? "hsl(220 10% 72%)" : textDim,
              fontSize: 11, fontFamily: "DM Mono, monospace",
              transition: "all 0.12s",
            }}
          >
            {faviconUrl(tab.url) && (
              <img src={faviconUrl(tab.url)!} width={12} height={12}
                style={{ flexShrink: 0, opacity: 0.75 }}
                onError={e => (e.currentTarget.style.display = "none")} />
            )}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {tabLabel(tab)}
            </span>
            {tabs.length > 1 && (
              <X size={10} style={{ flexShrink: 0, opacity: 0.5 }}
                onClick={e => { e.stopPropagation(); closeTab(tab.id); }} />
            )}
          </div>
        ))}
        <Btn onClick={newTab} title="New tab"><Plus size={13} /></Btn>

        {/* Spacer + right controls */}
        <div style={{ flex: 1 }} />
        <Btn onClick={() => setFullscreen(f => !f)} title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </Btn>
      </div>

      {/* ── Nav bar ────────────────────────────────────────────────────── */}
      <div style={{
        height: 44,
        background: surface,
        borderBottom: `1px solid ${border}`,
        display: "flex", alignItems: "center",
        paddingLeft: 8, paddingRight: 8, gap: 4,
        flexShrink: 0,
      }}>
        <Btn onClick={goBack}    title="Back"><ArrowLeft  size={15} /></Btn>
        <Btn onClick={goForward} title="Forward"><ArrowRight size={15} /></Btn>
        <Btn onClick={reload}    title="Reload">
          {loading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <RotateCw size={15} />}
        </Btn>
        <Btn onClick={goHome}    title="Home"><Home size={14} /></Btn>

        {/* Address bar */}
        <div
          onClick={() => { setEditingAddr(true); setTimeout(() => { addressRef.current?.select(); }, 10); }}
          style={{
            flex: 1, height: 28,
            background: editingAddr ? "hsl(220 14% 11%)" : "hsl(220 12% 10%)",
            border: editingAddr ? `1px solid ${ACC}` : `1px solid ${border}`,
            borderRadius: 4, display: "flex", alignItems: "center",
            paddingLeft: 10, paddingRight: 6, gap: 6,
            cursor: "text", transition: "border 0.15s",
          }}
        >
          <Globe size={11} color={textDim} style={{ flexShrink: 0 }} />
          {editingAddr ? (
            <input
              ref={addressRef}
              defaultValue={addressBar}
              onKeyDown={onAddrKey}
              onBlur={() => setEditingAddr(false)}
              autoFocus
              style={{
                flex: 1, background: "none", border: "none", outline: "none",
                color: "hsl(220 10% 78%)", fontSize: 12,
                fontFamily: "DM Mono, monospace",
              }}
            />
          ) : (
            <span style={{
              flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              color: "hsl(220 10% 55%)", fontSize: 12,
              fontFamily: "DM Mono, monospace",
            }}>
              {addressBar}
            </span>
          )}
        </div>
      </div>

      {/* ── Error banner ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 32, opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            style={{
              background: "hsl(0 52% 22%)", borderBottom: `1px solid hsl(0 52% 30%)`,
              display: "flex", alignItems: "center", gap: 8,
              paddingLeft: 14, fontSize: 11,
              color: "hsl(0 60% 75%)", flexShrink: 0, overflow: "hidden",
            }}
          >
            <AlertTriangle size={12} />
            {error}
            <X size={12} style={{ marginLeft: "auto", marginRight: 10, cursor: "pointer" }} onClick={() => setError("")} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Loading bar ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ scaleX: 0, opacity: 1 }} animate={{ scaleX: 0.9 }} exit={{ scaleX: 1, opacity: 0 }}
            transition={{ duration: 1.8, ease: "easeOut" }}
            style={{
              height: 2, background: ACC, transformOrigin: "left",
              flexShrink: 0,
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Viewport ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Grid background when showing placeholder */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: `
            linear-gradient(hsl(195 40% 15% / 0.04) 1px, transparent 1px),
            linear-gradient(90deg, hsl(195 40% 15% / 0.04) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }} />

        {/* Proxy iframe — always same-origin, no CORS or X-Frame issues */}
        <iframe
          ref={iframeRef}
          key={`${activeTab}-${currentTab?.url}`}
          src={iframeSrc}
          onLoad={onIframeLoad}
          onError={onIframeError}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
          allow="clipboard-read; clipboard-write"
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            border: "none",
            background: "#fff",
          }}
          title="ROME World Browser"
        />
      </div>

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      <div style={{
        height: 20, flexShrink: 0,
        background: surface,
        borderTop: `1px solid ${border}`,
        display: "flex", alignItems: "center",
        paddingLeft: 12, paddingRight: 12, gap: 12,
      }}>
        <span style={{ fontSize: 9, letterSpacing: "0.14em", color: textDim, textTransform: "uppercase" }}>
          {loading ? "Loading…" : currentTab?.title && currentTab.title !== "New Tab" ? currentTab.title : "Ready"}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, letterSpacing: "0.1em", color: "hsl(220 8% 22%)", textTransform: "uppercase" }}>
          ROME World
        </span>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
