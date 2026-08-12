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

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useHashLocation();
  const { data: activeProfile } = useQuery<any>({ queryKey: ["/api/active-profile"] });

  const desktopWorld = location === "/world" && Boolean(window.romeDesktop?.isDesktop);

  return (
    <div className="flex flex-col h-full">
      {/* ── Compact utility rail ───────────────────────────────────── */}
      <header
        className="shrink-0 flex items-center justify-end px-6 py-1.5"
        style={{
          background: "hsl(222 20% 5% / 0.7)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid hsl(var(--accent-h) 20% 14% / 0.5)",
          zIndex: 10,
        }}
      >
        {/* Profile and account controls remain globally accessible. */}
        <div className="flex items-center gap-3">
          {activeProfile && (
            <span
              className="text-[10px] tracking-widest uppercase"
              style={{ fontFamily: "DM Mono, monospace", color: "hsl(var(--accent-h) 30% 42%)" }}
            >
              ◎ {activeProfile.name}
            </span>
          )}
          <Link href="/settings">
            <button className="opacity-30 hover:opacity-70 transition-opacity" title="Settings">
              <Settings className="w-3.5 h-3.5" style={{ color: "hsl(var(--accent-h) 50% 50%)" }} />
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
            <LogOut className="w-3.5 h-3.5" style={{ color: "hsl(var(--accent-h) 50% 50%)" }} />
          </button>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────── */}
      <main className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden", desktopWorld && "overflow-hidden")}>
        <div className={cn("min-h-full p-8", desktopWorld && "h-full min-h-0 p-0")}>
          {children}
        </div>
      </main>

      {/* ── Bottom bar — constellation trigger ─────────────────────── */}
      <footer
        className="shrink-0 flex items-center justify-center px-6 py-1"
        style={{
          background: "hsl(222 20% 4% / 0.6)",
          backdropFilter: "blur(12px)",
          borderTop: "1px solid hsl(var(--accent-h) 15% 10% / 0.6)",
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
