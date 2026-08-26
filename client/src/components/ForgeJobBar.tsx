/**
 * Knowledge Forge work, shown wherever you are.
 *
 * A read takes minutes, and the whole point of moving it out of the Academia
 * page was that you can go and do something else while it runs. That only works
 * if you can still see it — otherwise "is it still going?" is answered by
 * navigating back, which is the thing the queue was meant to stop mattering.
 *
 * It lives in the utility rail above the constellation because that is the one
 * piece of chrome present on every node, and it renders nothing at all when
 * there is nothing running, so a quiet ROME stays quiet.
 */

import { Ban, BookOpenCheck, TriangleAlert, X } from "lucide-react";
import { useForgeJobs } from "@/lib/forgeJobs";

export default function ForgeJobBar() {
  const { active, queued, jobs, cancel, dismiss } = useForgeJobs();
  const failed = jobs.filter(job => job.status === "failed");

  if (!active && !failed.length) return null;

  return (
    <div className="flex min-w-0 items-center gap-3">
      {active && (
        <div className="flex min-w-0 items-center gap-2">
          <BookOpenCheck className="h-3 w-3 shrink-0" style={{ color: "hsl(190 65% 60%)" }} />
          <div className="min-w-0">
            <p
              className="truncate text-[9px] tracking-widest uppercase"
              style={{ fontFamily: "DM Mono, monospace", color: "hsl(190 45% 52%)" }}
            >
              {active.label}
              {queued > 0 && <span style={{ color: "hsl(var(--accent-h) 20% 40%)" }}> +{queued}</span>}
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <div className="h-0.5 w-32 overflow-hidden rounded-full" style={{ background: "hsl(222 20% 12%)" }}>
                <div
                  className="h-full transition-[width] duration-300"
                  style={{
                    width: `${active.total ? Math.round((active.done / active.total) * 100) : 4}%`,
                    background: "hsl(190 65% 55%)",
                  }}
                />
              </div>
              <span
                className="text-[8px] tabular-nums"
                style={{ fontFamily: "DM Mono, monospace", color: "hsl(var(--accent-h) 20% 38%)" }}
              >
                {active.total ? `${active.done}/${active.total}` : "…"}
              </span>
            </div>
          </div>
          <button
            onClick={() => cancel(active.id)}
            title="Cancel this read"
            className="shrink-0 opacity-40 transition-opacity hover:opacity-90"
          >
            <Ban className="h-3 w-3" style={{ color: "hsl(350 55% 60%)" }} />
          </button>
        </div>
      )}

      {failed.map(job => (
        <div key={job.id} className="flex items-center gap-1.5" title={job.error}>
          <TriangleAlert className="h-3 w-3" style={{ color: "hsl(43 75% 60%)" }} />
          <span
            className="max-w-40 truncate text-[9px] tracking-widest uppercase"
            style={{ fontFamily: "DM Mono, monospace", color: "hsl(43 45% 55%)" }}
          >
            {job.label}
          </span>
          <button onClick={() => dismiss(job.id)} className="opacity-40 transition-opacity hover:opacity-90">
            <X className="h-3 w-3" style={{ color: "hsl(var(--accent-h) 30% 45%)" }} />
          </button>
        </div>
      ))}
    </div>
  );
}
