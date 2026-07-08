// AppShell — minimal chrome with no sidebar nav.
// Navigation is done entirely through the Constellation overlay (Tab / ⊕ button).

import { useQuery } from "@tanstack/react-query";
import { useHashLocation } from "wouter/use-hash-location";
import { Settings, LogOut } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { ConstellationTrigger } from "./ConstellationOverlay";
import { clearToken } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";

// Map paths to page titles (used in top bar)
const PAGE_TITLES: Record<string, string> = {
  "/athena":              "Athena Trials",
  "/athena/dual-n-back":  "Dual N-Back",
  "/athena/cwm":          "Complex Working Memory",
  "/athena/mental-math":  "Mental Math",
  "/athena/corsi":        "Corsi Blocks",
  "/athena/memory-span":  "Memory Span",
  "/athena/pasat":        "PASAT",
  "/philosophy":          "Philosophy Chambers",
  "/strategic":           "Strategic",
  "/creative":            "Creative",
  "/investigative":       "Investigative",
  "/alchemy":             "Alchemy Lab",
  "/taskboard":           "Taskboard",
  "/settings":            "Settings",
};

function getTitle(path: string): string {
  if (path.startsWith("/athena/")) return PAGE_TITLES[path] ?? "Athena Trials";
  return PAGE_TITLES[path] ?? "ROME";
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useHashLocation();
  const { data: activeProfile } = useQuery<any>({ queryKey: ["/api/active-profile"] });

  const title = getTitle(location);

  return (
    <div className="flex flex-col h-full">
      {/* ── Top bar ────────────────────────────────────────────────── */}
      <header
        className="shrink-0 flex items-center justify-between px-6 py-3"
        style={{
          background: "hsl(222 20% 5% / 0.7)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid hsl(43 20% 14% / 0.5)",
          zIndex: 10,
        }}
      >
        {/* Left — current page label */}
        <div className="flex items-center gap-3">
          {/* ROME micro-logo */}
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <circle cx="14" cy="14" r="12" stroke="hsl(43,88%,55%)" strokeWidth="1.2" fill="none"/>
            <path d="M7 14 C5 11 6 8 9 8 C8 11 8 13 10 14"  stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <path d="M7 14 C5 16 6 19 9 19 C8 16 8 15 10 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <path d="M21 14 C23 11 22 8 19 8 C20 11 20 13 18 14"  stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <path d="M21 14 C23 16 22 19 19 19 C20 16 20 15 18 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <rect x="13" y="9" width="2" height="10" rx="1" fill="hsl(43,88%,55%)" opacity="0.7"/>
          </svg>
          <h1
            className="text-xs font-semibold tracking-widest uppercase"
            style={{
              fontFamily: "'Cinzel', serif",
              color: "hsl(43 70% 58%)",
              letterSpacing: "0.12em",
            }}
          >
            {title}
          </h1>
        </div>

        {/* Right — profile chip + settings */}
        <div className="flex items-center gap-3">
          {activeProfile && (
            <span
              className="text-[10px] tracking-widest uppercase"
              style={{ fontFamily: "DM Mono, monospace", color: "hsl(43 30% 42%)" }}
            >
              ◎ {activeProfile.name}
            </span>
          )}
          <Link href="/settings">
            <button className="opacity-30 hover:opacity-70 transition-opacity" title="Settings">
              <Settings className="w-3.5 h-3.5" style={{ color: "hsl(43 50% 50%)" }} />
            </button>
          </Link>
          <button
            className="opacity-30 hover:opacity-70 transition-opacity"
            title="Sign out"
            onClick={async () => {
              try { await apiRequest("POST", "/api/auth/logout"); } catch {}
              clearToken();
              queryClient.clear();
              window.location.reload();
            }}
          >
            <LogOut className="w-3.5 h-3.5" style={{ color: "hsl(43 50% 50%)" }} />
          </button>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────── */}
      <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="min-h-full p-8">
          {children}
        </div>
      </main>

      {/* ── Bottom bar — constellation trigger ─────────────────────── */}
      <footer
        className="shrink-0 flex items-center justify-center px-6 py-1"
        style={{
          background: "hsl(222 20% 4% / 0.6)",
          backdropFilter: "blur(12px)",
          borderTop: "1px solid hsl(43 15% 10% / 0.6)",
          zIndex: 10,
        }}
      >
        <ConstellationTrigger
          onOpen={() => (window as any).__romeOpenConstellation?.()}
        />
      </footer>
    </div>
  );
}
