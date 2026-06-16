import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import AppShell from "@/components/AppShell";
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
import NotFound from "@/pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router hook={useHashLocation}>
          <Switch>
            <Route path="/onboarding" component={Onboarding} />
            <Route>
              <AppShell>
                <Switch>
                  <Route path="/" component={Dashboard} />
                  <Route path="/training" component={TrainingMap} />
                  <Route path="/activity/:id" component={Activity} />
                  <Route path="/scenarios" component={ScenarioDeck} />
                  <Route path="/vault" component={MemoryVault} />
                  <Route path="/profile" component={CognitiveProfile} />
                  <Route path="/research" component={Research} />
                  <Route path="/philosophy" component={PhilosophyChambers} />
                  <Route path="/profiles" component={ProfileManager} />
                  <Route path="/memory" component={LocalMemory} />
                  <Route path="/settings" component={Settings} />
                  <Route component={NotFound} />
                </Switch>
              </AppShell>
            </Route>
          </Switch>
        </Router>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
