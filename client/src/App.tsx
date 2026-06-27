import { useState, useEffect } from "react";
import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { getToken, clearToken, authHeaders } from "@/lib/auth";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import AppShell from "@/components/AppShell";
import { ConstellationPortal } from "@/components/ConstellationOverlay";
import Login from "@/pages/Login";

// Pages
import Dashboard from "@/pages/Dashboard";
import TrainingMap from "@/pages/TrainingMap";
import Activity from "@/pages/Activity";
import MemoryVault from "@/pages/MemoryVault";
import CognitiveProfile from "@/pages/CognitiveProfile";
import ScenarioDeck from "@/pages/ScenarioDeck";
import Research from "@/pages/Research";
import PhilosophyChambers from "@/pages/PhilosophyChambers";
import Onboarding from "@/pages/Onboarding";
import ProfileManager from "@/pages/ProfileManager";
import LocalMemory from "@/pages/LocalMemory";
import Settings from "@/pages/Settings";
import Taskboard from "@/pages/Taskboard";
import NotFound from "@/pages/not-found";

function AuthGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = loading

  useEffect(() => {
    const token = getToken();
    if (!token) { setAuthed(false); return; }
    // Verify token is still valid
    fetch("/api/auth/me", { headers: authHeaders() })
      .then(r => {
        if (r.ok) setAuthed(true);
        else { clearToken(); setAuthed(false); }
      })
      .catch(() => { clearToken(); setAuthed(false); });
  }, []);

  if (authed === null) {
    // Loading — show blank cave background
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

  if (!authed) {
    return <Login onLogin={() => setAuthed(true)} />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthGate>
          {/* Global constellation overlay — toggled by Tab or the ⊕ button */}
          <ConstellationPortal />

          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/onboarding" component={Onboarding} />

              {/* "/" redirects to dashboard */}
              <Route path="/">
                <Redirect to="/dashboard" />
              </Route>

              {/* All main routes inside AppShell */}
              <Route>
                <AppShell>
                  <Switch>
                    <Route path="/dashboard"    component={Dashboard} />
                    <Route path="/training"     component={TrainingMap} />
                    <Route path="/activity/:id" component={Activity} />
                    <Route path="/scenarios"    component={ScenarioDeck} />
                    <Route path="/vault"        component={MemoryVault} />
                    <Route path="/profile"      component={CognitiveProfile} />
                    <Route path="/research"     component={Research} />
                    <Route path="/philosophy"   component={PhilosophyChambers} />
                    <Route path="/profiles"     component={ProfileManager} />
                    <Route path="/memory"       component={LocalMemory} />
                    <Route path="/taskboard"    component={Taskboard} />
                    <Route path="/settings"     component={Settings} />
                    <Route component={NotFound} />
                  </Switch>
                </AppShell>
              </Route>
            </Switch>
          </Router>
          <Toaster />
        </AuthGate>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
