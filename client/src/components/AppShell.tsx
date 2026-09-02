// AppShell — minimal chrome with no sidebar nav.
//
// Navigation is done through the Constellation overlay (Tab / ⊕ button) and,
// for the routes you reach for constantly, through the hidden navigator in the
// middle of the top bar — hover it and the constellation unfolds there. Drag a
// domain out of that menu and it becomes a pane; the main content area is a
// pane tree rather than a single page (see `PaneHost`).

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useHashLocation } from "wouter/use-hash-location";
import { Settings, LogOut, Columns2 } from "lucide-react";
import { Link } from "wouter";
import { ConstellationTrigger } from "./ConstellationOverlay";
import ForgeJobBar from "./ForgeJobBar";
import RecallStatusBar from "./RecallStatusBar";
import DueCardOverlay from "./DueCardOverlay";
import TopBarNav from "./TopBarNav";
import PaneHost from "./PaneHost";
import { clearToken } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { usePaneTree, setPaneTree } from "@/lib/paneState";
import { isSingle, leaves, resetPanes } from "@/lib/splitPanes";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useHashLocation();
  const { data: activeProfile } = useQuery<any>({ queryKey: ["/api/active-profile"] });
  const tree = usePaneTree();

  /**
   * Is a native `WebContentsView` on screen anywhere?
   *
   * With split panes the browser can be in a pane that is not the one the
   * address bar points at, so the question is no longer "is the route /world"
   * but "is /world on screen at all".
   *
   * This drives Akira's ambience, which falls back to an inset frame glow it
   * can draw around the native view. It no longer drives `RomeCursor` — see the
   * note on `enabled` there.
   */
  const desktopWorld = useMemo(() => {
    if (!window.romeDesktop?.isDesktop) return false;
    return leaves(tree).some(leaf => (leaf.path ?? location) === "/world");
  }, [tree, location]);

  const split = !isSingle(tree);

  useEffect(() => {
    document.documentElement.dataset.romeDesktopWorld = desktopWorld ? "true" : "false";
    return () => { delete document.documentElement.dataset.romeDesktopWorld; };
  }, [desktopWorld]);

  return (
    <div className="flex flex-col h-full">
      {/* A card whose interval has elapsed, over whatever node is open. It
          renders nothing when nothing is due. */}
      <DueCardOverlay />
      {/* ── Compact utility rail ───────────────────────────────────── */}
      <header
        className="shrink-0 flex items-center gap-4 px-6 py-1.5"
        style={{
          background: "hsl(222 20% 5% / 0.7)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid hsl(var(--accent-h) 20% 14% / 0.5)",
          zIndex: 10,
        }}
      >
        {/* Background Forge work and any live run, visible from every node.
            Both render nothing when there is nothing to say.

            The two flanking groups share a zero basis so the navigator sits on
            the true centre of the window whatever they happen to contain. It is
            *not* absolutely positioned, and the header is not `relative`, on
            purpose: that would make the header a stacking context and trap the
            navigator's flyout underneath the floating widgets. */}
        <div className="flex flex-1 basis-0 min-w-0 items-center gap-4">
          <ForgeJobBar />
          <RecallStatusBar />
        </div>

        <TopBarNav />

        {/* Profile and account controls remain globally accessible. */}
        <div className="flex flex-1 basis-0 items-center justify-end gap-3">
          {split && (
            <button
              onClick={() => setPaneTree(resetPanes())}
              title="Close all split panes"
              className="opacity-40 hover:opacity-80 transition-opacity"
              style={{ background: "none", border: 0, cursor: "pointer", lineHeight: 0 }}
            >
              <Columns2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--accent-h) 50% 50%)" }} />
            </button>
          )}
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

      {/* ── Main content ───────────────────────────────────────────────
          The scroll container and the `p-8` moved into the pane, because with
          two panes on screen there are two of each. Unsplit, `PaneHost` renders
          exactly what used to be here. */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <PaneHost>{children}</PaneHost>
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
