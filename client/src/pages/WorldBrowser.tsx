/**
 * WorldBrowser — Neko-powered embedded browser.
 *
 * Architecture:
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
export default function WorldBrowser() {
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
