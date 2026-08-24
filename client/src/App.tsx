import { lazy, Suspense, useState, useEffect, useRef } from "react";
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
import { loadLayout } from "@/lib/constellationLayout";
import { applyLayout } from "@/lib/applyLayout";
import { playCue, primeAudio } from "@/lib/sound";
import Login from "@/pages/Login";
import { AkiraProvider } from "@/akira/AkiraProvider";
import AkiraAmbience from "@/akira/AkiraAmbience";
import AkiraConsole from "@/akira/AkiraConsole";
import RomeCursor from "@/components/RomeCursor";

// Core pages kept
import PhilosophyChambers from "@/pages/PhilosophyChambers";
import Settings from "@/pages/Settings";
import ContingencyGarden from "@/pages/ContingencyGarden";
import ResearchLab from "@/pages/ResearchLab";
import KronosKeep from "@/pages/KronosKeep";
import IdeaWorkshop from "@/pages/IdeaWorkshop";
import ComponentBoard from "@/pages/ComponentBoard";
import NotFound from "@/pages/not-found";

// Athena Trials
import MidasDashboard from "@/pages/MidasDashboard";
import Arena from "@/pages/Arena";
import SoloGame from "@/components/games/SoloGame";
import { GAMES } from "@/lib/gamesRegistry";

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

// Apply the saved layout at module-eval time, before the first paint.
//
// This used to set only the accent colour, which is why a cold start showed the
// prototype's drifting gold ray until you opened the Constellation — the menu's
// effect was the only thing that had ever applied the rest.
(() => {
  try { applyLayout(loadLayout()); } catch {}
})();

export default function App() {
  // Applied again after hydration: React can reset documentElement inline
  // styles on first mount, which would drop the CSS custom properties the
  // module-eval pass just wrote.
  useEffect(() => {
    try { applyLayout(loadLayout()); } catch {}
  }, []);

  // An AudioContext built before the first gesture starts suspended, so the
  // first cue would pay its start-up cost and land late enough to feel detached
  // from the click that caused it. Warm it once, on whatever is touched first.
  useEffect(() => {
    const prime = () => primeAudio();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  // The arrival cue is driven by the route, not by any one control. Every path
  // into a domain — a constellation branch, a placeholder sub-link, Akira, the
  // back button — passes through here, so the sound can never disagree with
  // where you actually ended up. Staying inside the same domain gets the
  // lighter cue; crossing into a new one gets the full arrival.
  const [location] = useHashLocation();
  const previousLocation = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousLocation.current;
    previousLocation.current = location;
    if (previous === null || previous === location) return; // first paint is not an arrival
    const domainOf = (path: string) => path.split("/")[1] ?? "";
    playCue(domainOf(previous) === domainOf(location) ? "domainShift" : "domainEnter");
  }, [location]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthGate>
          <AkiraProvider>
            {/* Akira's only always-mounted surface. Renders nothing while dormant. */}
            <AkiraAmbience />
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
                    <Route path="/athena"       component={MidasDashboard} />
                    <Route path="/athena/arena" component={Arena} />
                    {/* One route per drill, generated from the catalogue, so
                        adding a drill is a single edit in `gamesRegistry`. */}
                    {GAMES.map(g => (
                      <Route key={g.id} path={g.path}>
                        <SoloGame gameId={g.id} />
                      </Route>
                    ))}

                    {/* Philosophy */}
                    <Route path="/philosophy" component={PhilosophyChambers} />

                    {/* Strategic — Contingency Garden + Kronos Keep */}
                    <Route path="/strategic">
                      <PlaceholderNode
                        title="Strategic"
                        symbol="♛"
                        accent="hsl(var(--accent-h) 88% 60%)"
                        description="Planning and execution intelligence. Grow a plan in the Contingency Garden, then schedule it in Kronos Keep."
                        subRoutes={[
                          { label: "Contingency Garden", path: "/taskboard" },
                          { label: "Kronos Keep", path: "/kronos-keep" },
                        ]}
                      />
                    </Route>
                    <Route path="/taskboard"    component={ContingencyGarden} />
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
            <AkiraConsole />
            <LightRay zIndex={201} />
            {/* Above everything, and self-disabling on touch input and on the
                World Browser, where a native view paints over the DOM. */}
            <RomeCursor />
            <Toaster />
          </AkiraProvider>
        </AuthGate>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
