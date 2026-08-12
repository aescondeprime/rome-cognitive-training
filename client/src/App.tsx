import { lazy, Suspense, useState, useEffect } from "react";
import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getToken, clearToken, authHeaders } from "@/lib/auth";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import AppShell from "@/components/AppShell";
import { ConstellationPortal } from "@/components/ConstellationOverlay";
import LightRay from "@/components/LightRay";
import { setAccentColor } from "@/lib/lightRayState";
import { loadLayout } from "@/lib/constellationLayout";
import Login from "@/pages/Login";

// Core pages kept
import PhilosophyChambers from "@/pages/PhilosophyChambers";
import Settings from "@/pages/Settings";
import Taskboard from "@/pages/Taskboard";
import ResearchLab from "@/pages/ResearchLab";
import KronosKeep from "@/pages/KronosKeep";
import IdeaWorkshop from "@/pages/IdeaWorkshop";
import ComponentBoard from "@/pages/ComponentBoard";
import NotFound from "@/pages/not-found";

// Athena Trials
import AthenaTrials from "@/pages/AthenaTrials";
import DualNBack from "@/pages/games/DualNBack";
import CWM from "@/pages/games/CWM";
import MentalMath from "@/pages/games/MentalMath";
import CorsiBlocks from "@/pages/games/CorsiBlocks";
import MemorySpan from "@/pages/games/MemorySpan";
import PASAT from "@/pages/games/PASAT";

// Placeholder nodes
import PlaceholderNode from "@/pages/PlaceholderNode";
import WorldBrowser from "@/pages/WorldBrowser";
import FundingDashboard from "@/pages/FundingDashboard";

const Academia = lazy(() => import("@/pages/Academia"));

function AuthGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) { setAuthed(false); return; }
    fetch("/api/auth/me", { headers: authHeaders() })
      .then(r => {
        if (r.ok) setAuthed(true);
        else { clearToken(); setAuthed(false); }
      })
      .catch(() => { clearToken(); setAuthed(false); });
  }, []);

  if (authed === null) {
    return (
      <div style={{
        position: "fixed", inset: 0,
        background: "hsl(222 16% 6%)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          fontFamily: "DM Mono, monospace", fontSize: 9,
          color: "hsl(214 15% 28%)", letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return <>{children}</>;
}

// Apply saved accent colour immediately on boot (module-eval time)
(() => {
  try {
    const layout = loadLayout();
    if (layout.accentColor) setAccentColor(layout.accentColor);
  } catch {}
})();

export default function App() {
  // Also apply inside a useEffect so it fires after React hydration,
  // which can reset documentElement inline styles on first mount.
  useEffect(() => {
    try {
      const layout = loadLayout();
      if (layout.accentColor) setAccentColor(layout.accentColor);
    } catch {}
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthGate>
          <ConstellationPortal />
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/">
                <Redirect to="/athena" />
              </Route>
              <Route>
                <AppShell>
                  <Switch>
                    {/* Athena Trials */}
                    <Route path="/athena"             component={AthenaTrials} />
                    <Route path="/athena/dual-n-back"  component={DualNBack} />
                    <Route path="/athena/cwm"          component={CWM} />
                    <Route path="/athena/mental-math"  component={MentalMath} />
                    <Route path="/athena/corsi"        component={CorsiBlocks} />
                    <Route path="/athena/memory-span"  component={MemorySpan} />
                    <Route path="/athena/pasat"        component={PASAT} />

                    {/* Philosophy */}
                    <Route path="/philosophy" component={PhilosophyChambers} />

                    {/* Strategic — Taskboard + Kronos Keep */}
                    <Route path="/strategic">
                      <PlaceholderNode
                        title="Strategic"
                        symbol="♛"
                        accent="hsl(var(--accent-h) 88% 60%)"
                        description="Planning and execution intelligence. Taskboard and Kronos Keep are accessible below."
                        subRoutes={[
                          { label: "Taskboard", path: "/taskboard" },
                          { label: "Kronos Keep", path: "/kronos-keep" },
                        ]}
                      />
                    </Route>
                    <Route path="/taskboard"    component={Taskboard} />
                    <Route path="/kronos-keep"  component={KronosKeep} />

                    {/* Creative */}
                    <Route path="/creative">
                      <PlaceholderNode title="Creative" symbol="✦" accent="hsl(270 60% 65%)" description="Divergent thinking and ideation. Open your Idea Workshop below." subRoutes={[{ label: "Idea Workshop", path: "/idea-workshop" }]} />
                    </Route>
                    <Route path="/idea-workshop" component={IdeaWorkshop} />

                    {/* Investigative */}
                    <Route path="/investigative">
                      <PlaceholderNode
                        title="Investigative"
                        symbol="◉"
                        accent="hsl(175 55% 48%)"
                        description="Pattern recognition and deep inquiry. Open your investigation tools below."
                        subRoutes={[
                          { label: "Component Board", path: "/component-board" },
                          { label: "Research Lab", path: "/research-lab" },
                        ]}
                      />
                    </Route>
                    <Route path="/component-board" component={ComponentBoard} />
                    <Route path="/research-lab" component={ResearchLab} />

                    {/* World Browser */}
                    <Route path="/world" component={WorldBrowser} />

                    {/* Financial */}
                    <Route path="/funding" component={FundingDashboard} />

                    {/* Academia */}
                    <Route path="/academia">
                      <Suspense fallback={<div className="flex h-64 items-center justify-center font-mono text-[9px] tracking-[.18em] text-muted-foreground/40">INITIALIZING ACADEMIA…</div>}>
                        <Academia />
                      </Suspense>
                    </Route>

                    {/* Profiles + Settings */}
                    <Route path="/settings"  component={Settings} />

                    <Route component={NotFound} />
                  </Switch>
                </AppShell>
              </Route>
            </Switch>
          </Router>
          <LightRay zIndex={201} />
          <Toaster />
        </AuthGate>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
