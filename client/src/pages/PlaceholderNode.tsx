// Generic placeholder for nodes that are empty until further features are added
import { Link, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { ArrowLeft, ExternalLink } from "lucide-react";

interface Props {
  title: string;
  symbol: string;
  accent: string;
  description?: string;
  /** If provided, renders a CTA button linking to this route within the app */
  subRoute?: { label: string; path: string };
}

export default function PlaceholderNode({ title, symbol, accent, description, subRoute }: Props) {
  const [, navigate] = useHashLocation();

  return (
    <div className="max-w-lg mx-auto py-4">
      <div className="flex items-center gap-3 mb-10">
        <button className="opacity-40 hover:opacity-80 transition-opacity" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4" style={{ color: accent }} />
        </button>
        <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: accent }}>
          {title}
        </h1>
      </div>

      <div className="flex flex-col items-center justify-center py-20 gap-5">
        <span className="text-6xl" style={{ color: accent, filter: `drop-shadow(0 0 20px ${accent}60)`, opacity: 0.6 }}>
          {symbol}
        </span>
        <p className="text-[11px] tracking-widest uppercase text-center" style={{ color: "hsl(214 20% 35%)", fontFamily: "DM Mono, monospace", maxWidth: 300, lineHeight: 1.8 }}>
          {description ?? "This node is reserved for future features."}
        </p>
        <div className="w-12 h-px" style={{ background: `${accent}30` }} />

        {subRoute ? (
          <button
            onClick={() => navigate(subRoute.path)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-mono tracking-widest uppercase transition-all hover:scale-105"
            style={{
              background: `${accent}18`,
              border: `1px solid ${accent}40`,
              color: accent,
              boxShadow: `0 0 20px ${accent}20`,
            }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {subRoute.label}
          </button>
        ) : (
          <p className="text-[10px]" style={{ color: "hsl(214 20% 25%)", fontFamily: "DM Mono, monospace" }}>
            Coming soon
          </p>
        )}
      </div>
    </div>
  );
}
