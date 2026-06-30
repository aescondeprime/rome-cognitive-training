// Generic placeholder for nodes that are empty until further features are added
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

interface Props {
  title: string;
  symbol: string;
  accent: string;
  description?: string;
}

export default function PlaceholderNode({ title, symbol, accent, description }: Props) {
  return (
    <div className="max-w-lg mx-auto py-4">
      <div className="flex items-center gap-3 mb-10">
        <Link href="/">
          <button className="opacity-40 hover:opacity-80 transition-opacity">
            <ArrowLeft className="w-4 h-4" style={{ color: accent }} />
          </button>
        </Link>
        <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif", color: accent }}>
          {title}
        </h1>
      </div>

      <div className="flex flex-col items-center justify-center py-24 gap-5">
        <span className="text-6xl" style={{ color: accent, filter: `drop-shadow(0 0 20px ${accent}60)`, opacity: 0.6 }}>
          {symbol}
        </span>
        <p className="text-[11px] tracking-widest uppercase text-center" style={{ color: "hsl(214 20% 35%)", fontFamily: "DM Mono, monospace", maxWidth: 280, lineHeight: 1.8 }}>
          {description ?? "This node is reserved for future features."}
        </p>
        <div className="w-12 h-px" style={{ background: `${accent}30` }} />
        <p className="text-[10px]" style={{ color: "hsl(214 20% 25%)", fontFamily: "DM Mono, monospace" }}>
          Coming soon
        </p>
      </div>
    </div>
  );
}
