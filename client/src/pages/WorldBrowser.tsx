/**
 * WorldBrowser — Integrated remote Chromium workspace.
 *
 * Architecture:
 *   Frontend (this file) ─→ /api/browser/* ─→ Browserbase REST + live-view iframe
 *   Each authenticated user gets an isolated session.
 *   Provider credentials never reach the browser.
 *
 * States: unconfigured | no-session | starting | connected | reconnecting | expired | error
 */

import {
  useState, useRef, useCallback, useEffect, KeyboardEvent,
} from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  Globe, ArrowLeft, ArrowRight, RotateCw, X, Plus,
  Home, Wifi, WifiOff, Maximize2, Minimize2,
  RefreshCw, AlertTriangle, StopCircle, Power, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────
interface Tab {
  id: number;
  url: string;
  title: string;
  loading: boolean;
}

type SessionState =
  | "unconfigured"   // BROWSERBASE_API_KEY not set
  | "idle"           // no session yet
  | "starting"       // creating session
  | "connected"      // live
  | "loading-page"   // page navigating
  | "reconnecting"   // lost + retrying
  | "expired"        // 2h timeout
  | "error";         // unrecoverable

interface Session {
  sessionId: string;
  connectUrl: string;   // wss:// for live-view iframe src
  tabs: Tab[];
  activeTabIdx: number;
  status: string;
}

// ── Constants ──────────────────────────────────────────────────────────────
const HOME_URL = "https://www.google.com";
const POLL_MS  = 4_000;

// ── Accent utilities ───────────────────────────────────────────────────────
const ACC = "hsl(195 70% 52%)";   // world-node teal — used for active accents

// ── Small sub-components ──────────────────────────────────────────────────

function Btn({
  onClick, disabled, title, children, active = false, danger = false,
}: {
  onClick?: () => void; disabled?: boolean; title?: string;
  children: React.ReactNode; active?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center justify-center rounded-sm transition-all duration-150",
        "w-7 h-7 flex-shrink-0",
        active  ? "bg-[hsl(195_50%_18%)] text-[hsl(195_70%_62%)]" :
        danger  ? "text-[hsl(0_55%_52%)] hover:bg-[hsl(0_30%_12%)]" :
                  "text-[hsl(220_15%_45%)] hover:text-[hsl(220_10%_75%)] hover:bg-[hsl(222_14%_11%)]",
        disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
      )}
      style={{ border: "none", background: active ? undefined : "none" }}
    >
      {children}
    </button>
  );
}

// ── Corner brackets (ROME style) ───────────────────────────────────────────
function Corners({ color = ACC }: { color?: string }) {
  const L = 10;
  const corners = [
    { style: { top: 0, left: 0 },             rot: 0 },
    { style: { top: 0, right: 0 },             rot: 90 },
    { style: { bottom: 0, right: 0 },          rot: 180 },
    { style: { bottom: 0, left: 0 },           rot: 270 },
  ];
  return (
    <>
      {corners.map(({ style, rot }, i) => (
        <svg key={i} width={L} height={L} viewBox="0 0 10 10" fill="none"
          style={{ position: "absolute", opacity: 0.6, ...style }}>
          <path d={`M1 ${L-1} L1 1 L${L-1} 1`} stroke={color} strokeWidth="1.4"
            transform={`rotate(${rot} 5 5)`} />
        </svg>
      ))}
    </>
  );
}

// ── Loading spinner strip ──────────────────────────────────────────────────
function LoadBar({ active }: { active: boolean }) {
  return (
    <div style={{ height: 2, background: "transparent", overflow: "hidden", flexShrink: 0 }}>
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            exit={{ opacity: 0 }}
            transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
            style={{ height: "100%", width: "40%", background: `linear-gradient(90deg, transparent, ${ACC}, transparent)` }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── State-specific full-screen overlays ────────────────────────────────────
function StateOverlay({
  state, error, onStart, onRestart,
}: {
  state: SessionState; error: string;
  onStart: () => void; onRestart: () => void;
}) {
  const configs: Record<string, { icon: React.ReactNode; heading: string; sub: string; action?: { label: string; fn: () => void } }> = {
    unconfigured: {
      icon: <AlertTriangle size={28} color="hsl(43 88% 55%)" />,
      heading: "Provider Not Configured",
      sub: "Add BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to your Vercel environment variables, then redeploy.",
      action: { label: "Learn how →", fn: () => window.open("https://docs.browserbase.com/reference/introduction", "_blank") },
    },
    idle: {
      icon: <Globe size={28} color={ACC} />,
      heading: "World Browser",
      sub: "Launch a secure isolated Chromium session. Sessions are ephemeral and expire after 2 hours of inactivity.",
      action: { label: "Start Session", fn: onStart },
    },
    starting: {
      icon: <Loader2 size={28} color={ACC} className="animate-spin" />,
      heading: "Starting Session",
      sub: "Allocating your remote Chromium instance…",
    },
    reconnecting: {
      icon: <WifiOff size={28} color="hsl(43 70% 52%)" />,
      heading: "Reconnecting",
      sub: "Connection lost. Attempting to restore your session…",
    },
    expired: {
      icon: <Power size={28} color="hsl(0 55% 52%)" />,
      heading: "Session Expired",
      sub: "Your browser session expired after 2 hours of inactivity.",
      action: { label: "Start New Session", fn: onStart },
    },
    error: {
      icon: <AlertTriangle size={28} color="hsl(0 55% 52%)" />,
      heading: "Session Error",
      sub: error || "An unexpected error occurred.",
      action: { label: "Restart Session", fn: onRestart },
    },
  };

  const cfg = configs[state];
  if (!cfg) return null;

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 10,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18,
      background: "hsl(222 14% 6% / 0.96)", backdropFilter: "blur(6px)",
    }}>
      <Corners />
      <div>{cfg.icon}</div>
      <div style={{ textAlign: "center", maxWidth: 340 }}>
        <div style={{ fontFamily: "'Cinzel', serif", fontSize: 14, letterSpacing: "0.12em", color: "hsl(220 15% 82%)", marginBottom: 8 }}>
          {cfg.heading}
        </div>
        <div style={{ fontFamily: "DM Sans, sans-serif", fontSize: 12, color: "hsl(220 10% 50%)", lineHeight: 1.6 }}>
          {cfg.sub}
        </div>
      </div>
      {cfg.action && (
        <button onClick={cfg.action.fn} style={{
          fontFamily: "DM Mono, monospace", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase",
          padding: "7px 20px", borderRadius: 2, cursor: "pointer",
          background: "hsl(195 40% 14% / 0.9)", border: `1px solid ${ACC}`,
          color: ACC, transition: "all 0.15s",
        }}
          onMouseEnter={e => { (e.currentTarget.style.background = "hsl(195 40% 22% / 0.9)"); }}
          onMouseLeave={e => { (e.currentTarget.style.background = "hsl(195 40% 14% / 0.9)"); }}
        >{cfg.action.label}</button>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function WorldBrowser() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [session,    setSession]    = useState<Session | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [tabs,       setTabs]       = useState<Tab[]>([]);
  const [activeTab,  setActiveTab]  = useState(0);
  const [addressBar, setAddressBar] = useState("");
  const [editingAddr, setEditingAddr] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error,      setError]      = useState("");
  const iframeRef   = useRef<HTMLIFrameElement>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const addressRef  = useRef<HTMLInputElement>(null);

  // ── Check provider config on mount ────────────────────────────────────
  useEffect(() => {
    apiRequest("GET", "/api/browser/config")
      .then(r => r.json())
      .then(d => {
        setConfigured(d.configured);
        if (!d.configured) setSessionState("unconfigured");
      })
      .catch(() => { setConfigured(false); setSessionState("unconfigured"); });
  }, []);

  // ── Create session ─────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setSessionState("starting");
    setError("");
    try {
      const r = await apiRequest("POST", "/api/browser/sessions");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to create session");
      setSession(d);
      setTabs(d.tabs ?? []);
      setActiveTab(d.activeTabIdx ?? 0);
      setAddressBar(d.tabs?.[0]?.url ?? HOME_URL);
      setSessionState("connected");
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
      setSessionState("error");
    }
  }, []);

  // ── End session ────────────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    if (!session) return;
    if (pollRef.current) clearInterval(pollRef.current);
    await apiRequest("DELETE", `/api/browser/sessions/${session.sessionId}`).catch(() => {});
    setSession(null);
    setTabs([]);
    setSessionState("idle");
  }, [session]);

  // ── Send action ────────────────────────────────────────────────────────
  const sendAction = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (!session) return;
    try {
      const r = await apiRequest("POST", `/api/browser/sessions/${session.sessionId}/action`, { action, ...extra });
      const d = await r.json();
      if (r.status === 403 && d.error === "DANGEROUS_URL") {
        setError(`Navigation blocked: internal or dangerous URL`);
        return;
      }
      if (!r.ok) { setError(d.error ?? "Action failed"); return; }
      if (d.tabs) setTabs(typeof d.tabs === "string" ? JSON.parse(d.tabs) : d.tabs);
      if (d.activeTabIdx !== undefined) setActiveTab(d.activeTabIdx);
      if (d.currentUrl) setAddressBar(d.currentUrl);
    } catch (e: any) {
      setError(e.message ?? "Network error");
    }
  }, [session]);

  // ── Address bar submit ─────────────────────────────────────────────────
  const navigate = useCallback((raw: string) => {
    setEditingAddr(false);
    setLoading(true);
    setAddressBar(raw);
    sendAction("navigate", { url: raw }).finally(() => setLoading(false));
  }, [sendAction]);

  const onAddrKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter")  navigate(addressRef.current?.value ?? addressBar);
    if (e.key === "Escape") { setEditingAddr(false); addressRef.current?.blur(); }
  };

  // ── New / close / switch tabs ──────────────────────────────────────────
  const newTab    = () => sendAction("newtab");
  const closeTab  = (i: number) => sendAction("closetab", { tabIdx: i });
  const switchTab = (i: number) => { setActiveTab(i); sendAction("switchtab", { tabIdx: i }); };

  const goBack    = () => sendAction("back");
  const goForward = () => sendAction("forward");
  const reload    = () => { setLoading(true); sendAction("reload").finally(() => setTimeout(() => setLoading(false), 800)); };
  const stop      = () => { setLoading(false); sendAction("stop"); };

  // ── Live-view iframe src (Browserbase provides a hosted viewer) ────────
  const liveViewSrc = session?.connectUrl
    ? `https://live.browserbase.com/devtools/inspector.html?wss=${encodeURIComponent(session.connectUrl.replace("wss://", ""))}`
    : undefined;

  // Alternatively Browserbase provides a direct debug live view URL
  // We use: https://www.browserbase.com/sessions/<bbId>/live
  // — but the safest universal approach is the devtools viewer above.

  // ── Poll session status ────────────────────────────────────────────────
  useEffect(() => {
    if (!session || sessionState !== "connected") return;
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiRequest("GET", `/api/browser/sessions/${session.sessionId}`);
        const d = await r.json();
        if (d.status === "disconnected" || d.status === "expired") {
          setSessionState(d.status === "expired" ? "expired" : "expired");
          if (pollRef.current) clearInterval(pollRef.current);
        }
        if (d.tabs) setTabs(typeof d.tabs === "string" ? JSON.parse(d.tabs) : d.tabs);
        if (d.currentUrl && !editingAddr) setAddressBar(d.currentUrl);
      } catch {}
    }, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [session, sessionState, editingAddr]);

  // ── Show overlay? ──────────────────────────────────────────────────────
  const showOverlay = !["connected", "loading-page"].includes(sessionState);

  // ── Tab label truncation ───────────────────────────────────────────────
  function tabLabel(tab: Tab) {
    if (!tab.title || tab.title === "Loading…" || tab.title === "New Tab") {
      try { return new URL(tab.url).hostname || "New Tab"; } catch { return "New Tab"; }
    }
    return tab.title.length > 18 ? tab.title.slice(0, 17) + "…" : tab.title;
  }

  // ── Favicon ────────────────────────────────────────────────────────────
  function faviconUrl(url: string) {
    try {
      const origin = new URL(url).origin;
      return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`;
    } catch { return null; }
  }

  const currentTab = tabs[activeTab];

  return (
    <div style={{
      position: fullscreen ? "fixed" : "relative",
      inset: fullscreen ? 0 : undefined,
      zIndex: fullscreen ? 500 : undefined,
      width: "100%",
      height: fullscreen ? "100vh" : "calc(100vh - 56px)",
      display: "flex",
      flexDirection: "column",
      background: "hsl(222 14% 7%)",
      fontFamily: "DM Mono, monospace",
      overflow: "hidden",
    }}>

      {/* ── Tab strip ─────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "stretch",
        background: "hsl(222 16% 5%)",
        borderBottom: "1px solid hsl(222 12% 11%)",
        height: 34, paddingLeft: 8, paddingRight: 8,
        gap: 2, overflowX: "auto", flexShrink: 0,
      }}>
        {tabs.map((tab, i) => (
          <div key={tab.id}
            onClick={() => switchTab(i)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "0 10px 0 8px", height: "100%",
              minWidth: 100, maxWidth: 160, flexShrink: 0,
              cursor: "pointer",
              background: i === activeTab ? "hsl(222 14% 9%)" : "transparent",
              borderTop: i === activeTab ? `1px solid ${ACC}` : "1px solid transparent",
              borderLeft: "1px solid transparent",
              borderRight: "1px solid transparent",
              transition: "all 0.12s",
              position: "relative",
            }}
          >
            {/* Favicon */}
            {faviconUrl(tab.url)
              ? <img src={faviconUrl(tab.url)!} width={12} height={12} style={{ flexShrink: 0, opacity: 0.75 }} onError={e => (e.currentTarget.style.display = "none")} />
              : <Globe size={11} style={{ flexShrink: 0, opacity: 0.4, color: ACC }} />}
            {/* Title */}
            <span style={{ flex: 1, fontSize: 9, letterSpacing: "0.06em", color: i === activeTab ? "hsl(220 12% 75%)" : "hsl(220 8% 40%)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
              {tabLabel(tab)}
            </span>
            {/* Loading indicator */}
            {tab.loading && <Loader2 size={9} style={{ color: ACC, flexShrink: 0, animation: "spin 1s linear infinite" }} />}
            {/* Close */}
            {tabs.length > 1 && (
              <button onClick={e => { e.stopPropagation(); closeTab(i); }}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", flexShrink: 0, opacity: 0.4, color: "currentColor" }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "0.4")}>
                <X size={9} />
              </button>
            )}
          </div>
        ))}

        {/* New tab button */}
        <button onClick={newTab} title="New tab"
          style={{
            alignSelf: "center", marginLeft: 2,
            background: "none", border: "none", cursor: "pointer",
            color: "hsl(220 12% 38%)", display: "flex", alignItems: "center",
            padding: "3px 5px", borderRadius: 2, transition: "color 0.12s",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = ACC)}
          onMouseLeave={e => (e.currentTarget.style.color = "hsl(220 12% 38%)")}>
          <Plus size={13} />
        </button>

        {/* Spacer + session controls */}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 2, paddingRight: 4 }}>
          {/* Connection status */}
          <div title={sessionState === "connected" ? "Connected" : "Disconnected"}
            style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {sessionState === "connected"
              ? <Wifi size={11} color={ACC} style={{ opacity: 0.75 }} />
              : <WifiOff size={11} color="hsl(0 55% 48%)" style={{ opacity: 0.75 }} />}
          </div>
          {/* End session */}
          {session && (
            <Btn onClick={endSession} title="End session" danger>
              <Power size={13} />
            </Btn>
          )}
          {/* Fullscreen */}
          <Btn onClick={() => setFullscreen(f => !f)} title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </Btn>
        </div>
      </div>

      {/* ── Navigation bar ───────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "0 10px",
        height: 38, flexShrink: 0,
        background: "hsl(222 14% 8%)",
        borderBottom: "1px solid hsl(222 12% 11%)",
      }}>
        {/* Back */}
        <Btn onClick={goBack} disabled={!session || sessionState !== "connected"} title="Back">
          <ArrowLeft size={14} />
        </Btn>
        {/* Forward */}
        <Btn onClick={goForward} disabled={!session || sessionState !== "connected"} title="Forward">
          <ArrowRight size={14} />
        </Btn>
        {/* Reload / Stop */}
        {loading
          ? <Btn onClick={stop} title="Stop"><StopCircle size={14} /></Btn>
          : <Btn onClick={reload} disabled={!session || sessionState !== "connected"} title="Reload"><RotateCw size={13} /></Btn>}
        {/* Home */}
        <Btn onClick={() => navigate(HOME_URL)} disabled={!session || sessionState !== "connected"} title="Home">
          <Home size={13} />
        </Btn>

        {/* Address bar */}
        <div style={{
          flex: 1, position: "relative", display: "flex", alignItems: "center",
          background: "hsl(222 18% 5%)",
          border: `1px solid ${editingAddr ? ACC : "hsl(222 12% 13%)"}`,
          borderRadius: 2, height: 26, padding: "0 10px",
          transition: "border-color 0.15s",
          gap: 6,
        }}>
          {/* Lock / globe icon */}
          {currentTab?.url?.startsWith("https://")
            ? <svg width="9" height="11" viewBox="0 0 9 11" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}><rect x="1.5" y="5" width="6" height="5.5" rx="0.8" stroke={ACC} strokeWidth="1.1"/><path d="M3 5 V3.5 A1.5 1.5 0 0 1 6 3.5 V5" stroke={ACC} strokeWidth="1.1" strokeLinecap="round"/></svg>
            : <Globe size={10} style={{ flexShrink: 0, opacity: 0.4, color: ACC }} />}
          <input
            ref={addressRef}
            value={editingAddr ? undefined : addressBar}
            defaultValue={addressBar}
            onFocus={() => { setEditingAddr(true); setTimeout(() => addressRef.current?.select(), 10); }}
            onBlur={() => setEditingAddr(false)}
            onKeyDown={onAddrKey}
            placeholder="Search or enter URL…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontFamily: "DM Mono, monospace", fontSize: 10,
              color: "hsl(220 10% 72%)", letterSpacing: "0.04em",
            }}
          />
          {/* Loading spinner inline */}
          {loading && <Loader2 size={11} style={{ flexShrink: 0, color: ACC, animation: "spin 0.8s linear infinite" }} />}
          {/* Clear */}
          {editingAddr && (
            <button onClick={() => { if (addressRef.current) addressRef.current.value = ""; }}
              style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", opacity: 0.45, padding: 0, color: "currentColor" }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "0.45")}>
              <X size={10} />
            </button>
          )}
        </div>

        {/* Restart session */}
        {session && (
          <Btn onClick={() => { endSession().then(startSession); }} title="Restart session">
            <RefreshCw size={13} />
          </Btn>
        )}
      </div>

      {/* ── Loading bar ───────────────────────────────────────────────── */}
      <LoadBar active={loading || sessionState === "starting"} />

      {/* ── Error banner ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 28, opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "0 12px", fontSize: 9, letterSpacing: "0.1em",
              background: "hsl(0 25% 8%)", borderBottom: "1px solid hsl(0 30% 18%)",
              color: "hsl(0 55% 60%)", flexShrink: 0, overflow: "hidden",
            }}>
            <AlertTriangle size={11} />
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => setError("")}
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.5 }}>
              <X size={10} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Viewport ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {/* State overlays */}
        <AnimatePresence>
          {showOverlay && (
            <motion.div key="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ position: "absolute", inset: 0, zIndex: 10 }}>
              <StateOverlay
                state={sessionState}
                error={error}
                onStart={startSession}
                onRestart={() => { endSession().then(startSession); }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Live view iframe — Browserbase provides a hosted debug viewer */}
        {session && liveViewSrc && (
          <iframe
            ref={iframeRef}
            src={liveViewSrc}
            allow="fullscreen"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            style={{
              width: "100%", height: "100%",
              border: "none",
              background: "hsl(222 14% 6%)",
              opacity: showOverlay ? 0 : 1,
              transition: "opacity 0.3s",
            }}
          />
        )}

        {/* Placeholder grid when no iframe */}
        {!session && (
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: `
              linear-gradient(hsl(195 40% 15% / 0.04) 1px, transparent 1px),
              linear-gradient(90deg, hsl(195 40% 15% / 0.04) 1px, transparent 1px)
            `,
            backgroundSize: "40px 40px",
          }} />
        )}
      </div>

      {/* ── Bottom status bar ─────────────────────────────────────────── */}
      <div style={{
        height: 20, display: "flex", alignItems: "center", gap: 12,
        padding: "0 12px", flexShrink: 0,
        background: "hsl(222 16% 5%)", borderTop: "1px solid hsl(222 12% 10%)",
        fontSize: 8, letterSpacing: "0.14em", color: "hsl(220 8% 32%)",
      }}>
        <span style={{ textTransform: "uppercase" }}>
          {sessionState === "connected" ? "SECURE — Browserbase" :
           sessionState === "starting"  ? "INITIALISING…" :
           sessionState === "expired"   ? "SESSION EXPIRED" :
           sessionState === "unconfigured" ? "PROVIDER NOT CONFIGURED" : "IDLE"}
        </span>
        <div style={{ flex: 1 }} />
        {session && (
          <span style={{ color: "hsl(220 8% 25%)" }}>
            SESSION · {session.sessionId.slice(0, 8).toUpperCase()}
          </span>
        )}
        {/* Limitations notice */}
        <span style={{ color: "hsl(220 8% 22%)" }}>
          DRM · CAPTCHA · HW AUTH MAY BE LIMITED
        </span>
      </div>
    </div>
  );
}
