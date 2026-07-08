import { useState, useEffect } from "react";
import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getToken, clearToken, authHeaders } from "@/lib/auth";
import { Toaster } from "@/components/ui/toaster";
import LightRay from "@/components/LightRay";
import { ThemeProvider } from "@/components/ThemeProvider";
import AppShell from "@/components/AppShell";
import { ConstellationPortal } from "@/components/ConstellationOverlay";
import Login from "@/pages/Login";

// Core pages kept
import PhilosophyChambers from "@/pages/PhilosophyChambers";
import Settings from "@/pages/Settings";
import Taskboard from "@/pages/Taskboard";
import AlchemyLab from "@/pages/AlchemyLab";
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

export default function App() {
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

                    {/* Strategic — has Taskboard */}
                    <Route path="/strategic">
                      <PlaceholderNode title="Strategic" symbol="♛" accent="hsl(43 88% 60%)" description="Planning and execution intelligence. Taskboard is accessible below." />
                    </Route>
                    <Route path="/taskboard" component={Taskboard} />

                    {/* Creative */}
                    <Route path="/creative">
                      <PlaceholderNode title="Creative" symbol="✦" accent="hsl(270 60% 65%)" description="Divergent thinking and ideation. Open your Idea Workshop below." subRoute={{ label: "Idea Workshop", path: "/idea-workshop" }} />
                    </Route>
                    <Route path="/idea-workshop" component={IdeaWorkshop} />

                    {/* Investigative */}
                    <Route path="/investigative">
                      <PlaceholderNode title="Investigative" symbol="◉" accent="hsl(175 55% 48%)" description="Pattern recognition and deep inquiry. Open your Component Board below." subRoute={{ label: "Component Board", path: "/component-board" }} />
                    </Route>
                    <Route path="/component-board" component={ComponentBoard} />

                    {/* Alchemy Lab */}
                    <Route path="/alchemy">
                      <PlaceholderNode title="Alchemy Lab" symbol="⚗" accent="hsl(270 55% 62%)" description="Experimental features and cognitive transmutations." subRoute={{ label: "Nootropics", path: "/alchemy-lab" }} />
                    </Route>
                    <Route path="/alchemy-lab" component={AlchemyLab} />

                    {/* Profiles + Settings */}
                    <Route path="/settings"  component={Settings} />

                    <Route component={NotFound} />
                  </Switch>
                </AppShell>
              </Route>
            </Switch>
          </Router>
          <LightRay zIndex={1} />
          <Toaster />
        </AuthGate>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
