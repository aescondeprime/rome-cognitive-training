/**
 * The controls a board card wears while you are working on it.
 *
 * Shared by the Idea Workshop and the Case Board, which edit cards the same
 * way: no permanent chrome, hold-drag to move, double-click to edit, corners to
 * pin a size, right-click for everything else. The two boards differ in what a
 * card *is*, not in how one is handled, so this is the part that is genuinely
 * the same and is kept in one place.
 */

import { Bold, Italic, Underline } from "lucide-react";

/**
 * Text colours offered by the format bar.
 *
 * Deliberately not either board's card palette: these have to stay readable on
 * every one of those backgrounds.
 */
export const TEXT_COLORS = [
  "hsl(210 20% 92%)", "hsl(192 90% 68%)", "hsl(270 80% 74%)",
  "hsl(38 90% 66%)",  "hsl(150 65% 62%)", "hsl(345 85% 70%)",
];

/**
 * Bold, italic, underline and colour, over the current selection.
 *
 * `execCommand` is deprecated and still the only thing that formats a selection
 * inside a contenteditable without hand-writing a range editor. `styleWithCSS`
 * makes `foreColor` emit a span the sanitiser keeps instead of a `<font>`.
 */
export function FormatBar({ accent }: { accent: string }) {
  const run = (command: string, value?: string) => {
    try {
      if (command === "foreColor") document.execCommand("styleWithCSS", false, "true");
      document.execCommand(command, false, value);
    } catch { /* selection went away; nothing to format */ }
  };

  return (
    <div
      // Losing the selection would make every button a no-op.
      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
      className="absolute -top-8 left-0 z-[120] flex items-center gap-1 border px-1.5 py-1"
      style={{ background: "hsl(222 26% 7% / 0.96)", borderColor: accent, backdropFilter: "blur(8px)" }}
    >
      {([["bold", Bold], ["italic", Italic], ["underline", Underline]] as const).map(([command, Icon]) => (
        <button
          key={command}
          onClick={() => run(command)}
          className="p-1 text-muted-foreground transition-colors hover:text-foreground"
          title={command[0].toUpperCase() + command.slice(1)}
        >
          <Icon className="h-3 w-3" />
        </button>
      ))}
      <span className="mx-0.5 h-3.5 w-px" style={{ background: accent, opacity: 0.4 }} />
      {TEXT_COLORS.map(color => (
        <button
          key={color}
          onClick={() => run("foreColor", color)}
          className="h-3 w-3 border border-black/40 transition-transform hover:scale-125"
          style={{ background: color }}
          title="Text colour"
        />
      ))}
    </div>
  );
}

export type Corner = "nw" | "ne" | "sw" | "se";

const CORNER_POS: Record<Corner, React.CSSProperties> = {
  nw: { top: -4,    left: -4,  cursor: "nw-resize" },
  ne: { top: -4,    right: -4, cursor: "ne-resize" },
  sw: { bottom: -4, left: -4,  cursor: "sw-resize" },
  se: { bottom: -4, right: -4, cursor: "se-resize" },
};

export function ResizeHandles({ onStart, color }: { onStart: (corner: Corner, e: React.MouseEvent) => void; color: string }) {
  return (
    <>
      {(["nw", "ne", "sw", "se"] as Corner[]).map(corner => (
        <div
          key={corner}
          className="absolute h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ ...CORNER_POS[corner], background: "hsl(222 22% 10%)", border: `1.5px solid ${color}`, zIndex: 60 }}
          onMouseDown={e => { e.stopPropagation(); onStart(corner, e); }}
        />
      ))}
    </>
  );
}
