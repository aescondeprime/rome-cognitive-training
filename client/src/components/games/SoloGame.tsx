/**
 * A single drill on its own route.
 *
 * The drills are written to fill whatever box they are handed, so solo play is
 * just the Arena with one panel and no chrome: give it most of the viewport and
 * let the scale factor do the rest. This is what fixed the "everything is tiny
 * on a large screen" complaint — the old pages were pinned to `max-w-lg`
 * regardless of how much room they had.
 */

import { GameInputProvider, GamePanel } from "@/lib/gameKit";
import { gameById } from "@/lib/gamesRegistry";

export default function SoloGame({ gameId }: { gameId: string }) {
  const meta = gameById(gameId);
  if (!meta) return null;
  const Game = meta.Component;

  return (
    <GameInputProvider>
      <GamePanel
        id="solo"
        className="mx-auto w-full rounded-2xl"
        style={{
          maxWidth: 980,
          height: "min(880px, max(560px, calc(100vh - 190px)))",
        }}
      >
        <Game />
      </GamePanel>
    </GameInputProvider>
  );
}
