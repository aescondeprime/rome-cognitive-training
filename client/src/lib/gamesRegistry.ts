/**
 * The catalogue of Athena drills.
 *
 * One list, used by the solo routes, the Arena's panel pickers and blitz mode's
 * random draw. `input` is documentation for the player rather than something the
 * router reads — the router learns which keys a drill wants from the drill
 * itself, at the moment it wants them — but it is what the Arena shows so you
 * can see at a glance which two drills will be fighting over the keyboard.
 */

import type { ComponentType } from "react";
import type { GameProps } from "@/lib/gameKit";
import CWM from "@/pages/games/CWM";
import CorsiBlocks from "@/pages/games/CorsiBlocks";
import DualNBack from "@/pages/games/DualNBack";
import Flux from "@/pages/games/Flux";
import MemorySpan from "@/pages/games/MemorySpan";
import MentalMath from "@/pages/games/MentalMath";
import PASAT from "@/pages/games/PASAT";

export type InputKind = "digits" | "letters" | "click" | "mixed";

export interface GameMeta {
  id: string;
  name: string;
  glyph: string;
  accent: string;
  path: string;
  blurb: string;
  input: InputKind;
  Component: ComponentType<GameProps>;
}

export const GAMES: GameMeta[] = [
  { id: "dual-n-back", name: "Dual N-Back",  glyph: "⟁", accent: "hsl(210 80% 62%)",            path: "/athena/dual-n-back", input: "letters", blurb: "Audio and position, N steps back", Component: DualNBack },
  { id: "cwm",         name: "Complex WM",   glyph: "◈", accent: "hsl(270 60% 65%)",            path: "/athena/cwm",         input: "letters", blurb: "Hold items across a processing task", Component: CWM },
  { id: "mental-math", name: "Mental Math",  glyph: "∑", accent: "hsl(var(--accent-h) 88% 60%)", path: "/athena/mental-math", input: "digits",  blurb: "Progressive arithmetic against a clock", Component: MentalMath },
  { id: "corsi",       name: "Corsi Blocks", glyph: "⊞", accent: "hsl(165 55% 48%)",            path: "/athena/corsi",       input: "click",   blurb: "Spatial span on a board that moves", Component: CorsiBlocks },
  { id: "memory-span", name: "Memory Span",  glyph: "◎", accent: "hsl(35 90% 62%)",             path: "/athena/memory-span", input: "mixed",   blurb: "Digits or letters, forward, back or sorted", Component: MemorySpan },
  { id: "pasat",       name: "PASAT",        glyph: "⊕", accent: "hsl(345 60% 62%)",            path: "/athena/pasat",       input: "digits",  blurb: "Paced addition N places back", Component: PASAT },
  { id: "flux",        name: "Flux",         glyph: "⧉", accent: "hsl(190 75% 55%)",            path: "/athena/flux",        input: "letters", blurb: "Reaction speed under shifting rules", Component: Flux },
];

export function gameById(id: string): GameMeta | undefined {
  return GAMES.find(g => g.id === id);
}

export const INPUT_LABEL: Record<InputKind, string> = {
  digits: "digits",
  letters: "letter keys",
  click: "mouse only",
  mixed: "digits or letters",
};
