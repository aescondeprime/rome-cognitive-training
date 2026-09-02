/**
 * RomeRoutes — the route table, lifted out of `App` so it can be rendered more
 * than once.
 *
 * Split screen is the reason. Each pane renders this same `Switch` inside its
 * own wouter `Router`, whose location hook points at that pane's path rather
 * than the window's hash. Two panes showing two routes is then just two
 * instances of the table, and adding a route stays a single edit here instead
 * of one per surface that can show it.
 */
import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";

// Core pages kept
import PhilosophyChambers from "@/pages/PhilosophyChambers";
import Settings from "@/pages/Settings";
import ContingencyGarden from "@/pages/ContingencyGarden";
import ResearchLab from "@/pages/ResearchLab";
import KronosKeep from "@/pages/KronosKeep";
import CommandCenter from "@/pages/CommandCenter";
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
const RecallState = lazy(() => import("@/pages/RecallState"));
const FlashcardArchive = lazy(() => import("@/pages/FlashcardArchive"));

export default function RomeRoutes() {
  return (
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

        {/* Strategic — Command Center + Contingency Garden + Kronos Keep */}
        <Route path="/strategic">
          <PlaceholderNode
            title="Strategic"
            symbol="♛"
            accent="hsl(var(--accent-h) 88% 60%)"
            description="Planning and execution intelligence. Track threats and objectives in the Command Center, grow a plan in the Contingency Garden, then schedule it in Kronos Keep."
            subRoutes={[
              { label: "Command Center", path: "/command-center" },
              { label: "Contingency Garden", path: "/taskboard" },
              { label: "Kronos Keep", path: "/kronos-keep" },
            ]}
          />
        </Route>
        <Route path="/command-center" component={CommandCenter} />
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
        {/* Its own route rather than a sub-state: linkable, survives a
            reload, and gives Akira somewhere to navigate to. */}
        <Route path="/academia/recall">
          <Suspense fallback={<div className="flex h-64 items-center justify-center font-mono text-[9px] tracking-[.18em] text-muted-foreground/40">ENTERING RECALL STATE…</div>}>
            <RecallState />
          </Suspense>
        </Route>
        {/* The Archive outlives runs — cards are written in one and
            drilled, foldered and scheduled outside it. */}
        <Route path="/academia/flashcards">
          <Suspense fallback={<div className="flex h-64 items-center justify-center font-mono text-[9px] tracking-[.18em] text-muted-foreground/40">OPENING THE ARCHIVE…</div>}>
            <FlashcardArchive />
          </Suspense>
        </Route>

        {/* Profiles + Settings */}
        <Route path="/settings"  component={Settings} />

        <Route component={NotFound} />
      </Switch>
  );
}
