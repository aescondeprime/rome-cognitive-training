// Athena Trials — hub page listing the 6 cognitive games
import { Link } from "wouter";
import { Swords, ChevronRight } from "lucide-react";

const TRIALS = [
  {
    href: "/athena/dual-n-back",
    name: "Dual N-Back",
    symbol: "⟁",
    accent: "hsl(210 80% 62%)",
    desc: "Match visual positions and audio letters to signals shown N steps back. The gold standard for working memory training.",
  },
  {
    href: "/athena/cwm",
    name: "Complex Working Memory",
    symbol: "◈",
    accent: "hsl(270 60% 65%)",
    desc: "Interleave decision-making with memorization across spatial or verbal formats. Dual-task span training.",
  },
  {
    href: "/athena/mental-math",
    name: "Mental Math",
    symbol: "∑",
    accent: "hsl(43 88% 60%)",
    desc: "Progressive arithmetic problems solved without pen or paper. Scales from single-digit addition to multi-step mixed operations.",
  },
  {
    href: "/athena/corsi",
    name: "Corsi Block Tapping",
    symbol: "⊞",
    accent: "hsl(165 55% 48%)",
    desc: "Replicate spatial sequences across randomized block grids. Classic, reverse, and sticky variants.",
  },
  {
    href: "/athena/memory-span",
    name: "Memory Span",
    symbol: "◎",
    accent: "hsl(35 90% 62%)",
    desc: "Remember and recall sequences of digits or letters — forward, reverse, or sorted. Adaptive span length.",
  },
  {
    href: "/athena/pasat",
    name: "PASAT",
    symbol: "⊕",
    accent: "hsl(345 60% 62%)",
    desc: "Paced Auditory Serial Addition Task. Add each new number to the one before it under strict time pressure.",
  },
];

export default function AthenaTrials() {
  return (
    <div className="max-w-2xl mx-auto py-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Swords className="w-5 h-5" style={{ color: "hsl(210 80% 62%)" }} />
        <div>
          <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: "hsl(210 80% 62%)" }}>
            Athena Trials
          </h1>
          <p className="text-[11px] mt-0.5" style={{ color: "hsl(214 20% 42%)", fontFamily: "DM Mono, monospace" }}>
            Six adaptive cognitive trials — select a game to begin
          </p>
        </div>
      </div>

      {/* Trial list */}
      <div className="space-y-2">
        {TRIALS.map(t => (
          <Link key={t.href} href={t.href}>
            <div
              className="group flex items-center gap-4 px-5 py-4 rounded-xl border cursor-pointer transition-all"
              style={{
                background: "hsl(222 20% 5% / 0.6)",
                borderColor: "hsl(43 15% 12%)",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = `${t.accent}40`;
                (e.currentTarget as HTMLDivElement).style.background = `${t.accent}08`;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = "hsl(43 15% 12%)";
                (e.currentTarget as HTMLDivElement).style.background = "hsl(222 20% 5% / 0.6)";
              }}
            >
              <span className="text-2xl w-8 text-center shrink-0" style={{ color: t.accent, filter: `drop-shadow(0 0 6px ${t.accent}80)` }}>
                {t.symbol}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold tracking-wide" style={{ fontFamily: "'Cinzel', serif", color: t.accent }}>
                  {t.name}
                </p>
                <p className="text-[11px] mt-0.5 leading-snug" style={{ color: "hsl(214 20% 46%)" }}>
                  {t.desc}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0 opacity-30 group-hover:opacity-70 transition-opacity" style={{ color: t.accent }} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
