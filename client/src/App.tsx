import { useState, useEffect, useRef } from "react";
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
import { ForgeJobProvider } from "@/lib/forgeJobs";
import { RecallSessionProvider } from "@/lib/recallSession";
import AkiraAmbience from "@/akira/AkiraAmbience";
import AkiraConsole from "@/akira/AkiraConsole";
import RomeCursor from "@/components/RomeCursor";
// The route table lives on its own so a split pane can render a second copy of
// it; the widgets live at the app root so a pinned one outlives the map.
import RomeRoutes from "@/routes";
import WidgetLayer from "@/components/WidgetLayer";

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
          <ForgeJobProvider>
          {/* Above the router on purpose: a run outlives the page that shows it. */}
          <RecallSessionProvider>
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
                  <RomeRoutes />
                </AppShell>
              </Route>
              </Switch>
            </Router>
            <AkiraConsole />
            {/* Widgets are app furniture now, not map furniture: the pinned
                ones stay on screen on every page. Mounted above the router so
                a route change never unmounts one mid-drag. */}
            <WidgetLayer />
            <LightRay zIndex={201} />
            {/* Above everything, and self-disabling on touch input and on the
                World Browser, where a native view paints over the DOM. */}
            <RomeCursor />
            <Toaster />
          </AkiraProvider>
          </RecallSessionProvider>
          </ForgeJobProvider>
        </AuthGate>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
