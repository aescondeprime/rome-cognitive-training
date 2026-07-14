/**
 * ResearchLab — Evidence-based cognitive training research brief.
 * Investigative node — styled to match the ROME dark aesthetic.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ExternalLink, ChevronDown, ChevronRight, FlaskConical, BookOpen } from "lucide-react";

// ── Data ───────────────────────────────────────────────────────────────────
const RESEARCH_SECTIONS = [
  {
    title: "What Actually Works",
    evidenceLevel: "strong",
    content: [
      {
        term: "Retrieval practice (testing effect)",
        body: "Actively recalling information from memory is consistently more effective for long-term retention than re-reading or re-studying. Effect sizes are large and replicated across many domains. The variable retrieval effect (Butowska et al., PNAS 2024) extends this — varying the context slightly on each retrieval attempt further boosts retention.",
      },
      {
        term: "Spaced repetition",
        body: "Distributing practice over time is one of the most reliable learning interventions. The SM-2 algorithm (underlying Anki and similar tools) is well-validated. Optimal intervals depend on individual forgetting rates.",
      },
      {
        term: "Interleaving",
        body: "Mixing different types of problems during practice impairs short-term performance but significantly improves long-term retention and discrimination ability.",
      },
      {
        term: "Metacognitive monitoring",
        body: "Teaching learners to predict their performance, check their understanding, and reflect on errors produces reliable improvements in learning efficiency (Fleming et al., adaptive calibration training, 2018).",
      },
    ],
    sources: [
      { label: "Butowska et al. (PNAS 2024) — Variable retrieval", url: "https://www.pnas.org/doi/pdf/10.1073/pnas.2413511121" },
      { label: "Seth & Lau (2018) — Metacognitive calibration training", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6390881/" },
    ],
  },
  {
    title: "Working Memory Training — Nuanced",
    evidenceLevel: "moderate",
    content: [
      {
        term: "Near transfer is reliable",
        body: "Training on n-back or working memory tasks reliably improves performance on similar (untrained) working memory tasks.",
      },
      {
        term: "Far transfer is controversial",
        body: "Many meta-analyses (including Gobet & Sala, 2022) find near-zero effect of WM training on fluid intelligence or real-world functioning. However, Pahor et al. (Nature Human Behaviour, 2022) showed that near transfer mediates far transfer — individuals who don't improve on near-transfer tasks don't show far transfer either.",
      },
      {
        term: "Real-world stimuli",
        body: "Using ecologically valid stimuli (medication names, patient details, instructions) likely improves ecological validity of training even if the fundamental transfer limits remain.",
      },
      {
        term: "This app's approach",
        body: "WM training is framed as a tool for improving attentional control strategies, not a 'make you smarter' hack. The real-world n-back uses domain-relevant stimuli and is one component of a broader cognitive training system.",
      },
    ],
    sources: [
      { label: "Pahor et al. (Nature Human Behaviour, 2022) — Near/far transfer mediation", url: "https://www.nature.com/articles/s41562-022-01384-w" },
      { label: "Gobet & Sala (2022) — Critical review of cognitive training", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9903001/" },
    ],
  },
  {
    title: "Executive Function Training",
    evidenceLevel: "moderate",
    content: [
      {
        term: "What transfers",
        body: "Inhibitory control (Stroop, Go/No-Go) shows reliable near-transfer. Cognitive flexibility training (rule-shifting paradigms) improves task-switching. Near-transfer effects are consistent; far transfer is weaker and less consistent.",
      },
      {
        term: "Serious games",
        body: "A 2026 systematic review (Frontiers, Tommasi et al.) found that serious games improve attention, WM, cognitive flexibility, and inhibition with near-transfer effects. Far-transfer to academic outcomes was limited but present for some interventions.",
      },
      {
        term: "Key design principle",
        body: "Training tasks should have increasing difficulty (adaptive), involve real-world-relevant cognitive demands, and be combined with metacognitive reflection for best results.",
      },
    ],
    sources: [
      { label: "Tommasi et al. (Frontiers, 2026) — Serious games and executive functions", url: "https://www.frontiersin.org/articles/10.3389/frcha.2026.1801077/full" },
    ],
  },
  {
    title: "Creativity Training",
    evidenceLevel: "moderate",
    content: [
      {
        term: "Divergent thinking is trainable",
        body: "SCAMPER, analogy generation, and constraint manipulation reliably improve divergent thinking scores. Critical thinking education improves both divergent thinking and academic enthusiasm (Mohkam Kar et al., 2023).",
      },
      {
        term: "Constraints paradox",
        body: "Research consistently shows that appropriate constraints enhance creative output by forcing exploration of unconventional solution paths (Ward, 1994, structured imagination).",
      },
      {
        term: "Convergent-divergent funnel",
        body: "Effective creative training moves through phases: divergent generation → evaluation → convergent refinement → execution. Apps that skip the evaluation phase see lower quality output.",
      },
      {
        term: "Speculative note",
        body: "The degree to which creativity training transfers to novel real-world creative performance is not well-established. Creative performance depends heavily on domain knowledge and motivation.",
      },
    ],
    sources: [],
  },
  {
    title: "Simulation-Based Training & Transfer",
    evidenceLevel: "strong",
    content: [
      {
        term: "Simulation > passive instruction",
        body: "Simulation-based training with feedback produces superior transfer compared to lecture-based instruction across medical, military, and professional contexts. This is one of the strongest findings in applied learning science.",
      },
      {
        term: "Deliberate practice requirements",
        body: "Effective simulation requires clearly defined objectives, appropriate challenge level, immediate feedback, and repetition. Ericsson's deliberate practice framework remains the gold standard for skill acquisition.",
      },
      {
        term: "Scenario-based training",
        body: "Integrating multiple cognitive demands into a realistic scenario mirrors the demands of real performance environments and promotes contextual encoding that supports transfer.",
      },
    ],
    sources: [
      { label: "Medical simulation and knowledge transfer (2024)", url: "https://journals.viamedica.pl/disaster_and_emergency_medicine/article/view/101945" },
    ],
  },
  {
    title: "Physical-Cognitive Integration",
    evidenceLevel: "moderate",
    content: [
      {
        term: "Exercise enhances cognition",
        body: "Meta-analyses consistently find that aerobic exercise improves executive function, attention, and processing speed with modest-to-moderate effect sizes. MICT (moderate-intensity continuous training) shows greater cognitive benefits than HIIT in some RCTs.",
      },
      {
        term: "Embodied cognition",
        body: "Learning while moving or incorporating relevant body movements can enhance learning outcomes (Castro-Alonso et al., 2024 review). The mechanism involves physical activity directly boosting hippocampal BDNF and visuospatial processing.",
      },
    ],
    sources: [
      { label: "Effects of aerobic exercise on cognitive function — Frontiers Neurology (2025)", url: "https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2025.1693052/full" },
      { label: "Embodied cognition in learning — Educational Psychology Review (2024)", url: "https://pure.eur.nl/ws/portalfiles/portal/194102690/s10648-025-10027-1.pdf" },
    ],
  },
  {
    title: "Honest Limitations",
    evidenceLevel: "speculative",
    content: [
      {
        term: "Far transfer remains the hard problem",
        body: "Despite decades of research, reliably training a cognitive skill that transfers broadly to untrained tasks remains elusive. Near-transfer (improvement on similar tasks) is well-established; far transfer is not.",
      },
      {
        term: "Publication bias",
        body: "The cognitive training literature has documented publication bias — studies showing positive effects are more likely to be published. Effect sizes in meta-analyses including unpublished studies tend to be smaller.",
      },
      {
        term: "Individual differences",
        body: "Training effects vary enormously between individuals. Baseline cognitive level, age, training adherence, and motivation all moderate outcomes. There is no one-size-fits-all protocol.",
      },
      {
        term: "Placebo effects",
        body: "Parong et al. (2022, PNAS) showed that expectations and motivation can independently improve performance, separate from training itself. Active control groups are essential for valid inference.",
      },
      {
        term: "This app's honest position",
        body: "The strongest components are retrieval practice, spaced repetition, and metacognitive reflection. WM and EF training are included because they have near-transfer value and may support attentional strategies. No component of this app is claimed to 'make you smarter' broadly — it trains specific, measurable cognitive behaviors.",
      },
    ],
    sources: [
      { label: "Parong et al. (PNAS 2022) — Placebo and WM training", url: "https://pnas.org/doi/10.1073/pnas.2214268119" },
    ],
  },
];

// ── Evidence level config ──────────────────────────────────────────────────
const LEVELS: Record<string, { label: string; color: string; dot: string; border: string; bg: string }> = {
  strong:     { label: "Strong RCT Support",     color: "hsl(145 55% 55%)", dot: "hsl(145 55% 55%)", border: "hsl(145 35% 20%)", bg: "hsl(145 30% 7%)"  },
  moderate:   { label: "Moderate Evidence",       color: "hsl(38 75% 58%)",  dot: "hsl(38 75% 58%)",  border: "hsl(38 40% 20%)",  bg: "hsl(38 35% 7%)"   },
  speculative:{ label: "Speculative / Limited",   color: "hsl(210 65% 62%)", dot: "hsl(210 65% 62%)", border: "hsl(210 35% 20%)", bg: "hsl(210 30% 7%)"  },
};

// ── Page ───────────────────────────────────────────────────────────────────
export default function ResearchLab() {
  const [expanded, setExpanded] = useState<number | null>(0);

  const ACCENT = "hsl(175 55% 48%)";

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <BookOpen className="w-5 h-5 shrink-0" style={{ color: ACCENT }} />
        <div>
          <h1
            className="text-base font-bold tracking-widest uppercase"
            style={{ fontFamily: "Cinzel, serif", color: ACCENT }}
          >
            Research Lab
          </h1>
          <p className="text-[10px] font-mono text-muted-foreground tracking-widest">
            Evidence-based cognitive training · Updated 2024–2026
          </p>
        </div>
      </div>

      {/* Integrity statement */}
      <div
        className="rounded-xl px-4 py-4 text-xs leading-relaxed"
        style={{
          background: `${ACCENT}0e`,
          border: `1px solid ${ACCENT}30`,
          color: "hsl(175 30% 55%)",
        }}
      >
        <p className="font-mono tracking-widest uppercase mb-1.5" style={{ color: ACCENT, fontSize: "9px" }}>
          Scientific Integrity Statement
        </p>
        ROME is built on evidence, not marketing. This page summarizes the honest state of the science — including what doesn't work, what's uncertain, and where individual results will vary. We distinguish clearly between strong RCT evidence, moderate preliminary evidence, and speculative features.
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(LEVELS).map(([key, val]) => (
          <div
            key={key}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono"
            style={{ color: val.color, background: val.bg, border: `1px solid ${val.border}` }}
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: val.dot }} />
            {val.label}
          </div>
        ))}
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {RESEARCH_SECTIONS.map((section, i) => {
          const lv   = LEVELS[section.evidenceLevel] ?? LEVELS.speculative;
          const open = expanded === i;

          return (
            <div
              key={i}
              className="rounded-xl overflow-hidden border transition-colors"
              style={{
                background: open ? "hsl(220 15% 7%)" : "hsl(220 15% 6%)",
                borderColor: open ? lv.border : "hsl(220 15% 12%)",
              }}
            >
              {/* Row header */}
              <button
                onClick={() => setExpanded(open ? null : i)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[hsl(220_15%_9%)]"
              >
                {open
                  ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                }

                {/* Evidence badge */}
                <span
                  className="shrink-0 px-2 py-0.5 rounded text-[9px] font-mono tracking-wide"
                  style={{ color: lv.color, background: lv.bg, border: `1px solid ${lv.border}` }}
                >
                  {section.evidenceLevel}
                </span>

                <span
                  className="text-sm font-semibold flex-1 truncate"
                  style={{ fontFamily: "Cinzel, serif", color: "hsl(220 25% 82%)" }}
                >
                  {section.title}
                </span>
              </button>

              {/* Expanded body */}
              {open && (
                <div
                  className="px-4 pb-5 space-y-4 border-t"
                  style={{ borderColor: lv.border + "60", paddingTop: "16px" }}
                >
                  {/* Content items */}
                  <div className="space-y-3">
                    {section.content.map((item, j) => (
                      <div key={j}>
                        <p className="text-xs leading-relaxed" style={{ color: "hsl(220 20% 70%)" }}>
                          <span
                            className="font-semibold mr-1"
                            style={{ color: lv.color }}
                          >
                            {item.term}:
                          </span>
                          {item.body}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Sources */}
                  {section.sources.length > 0 && (
                    <div
                      className="pt-3 space-y-2 border-t"
                      style={{ borderColor: "hsl(220 15% 13%)" }}
                    >
                      <p className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground">
                        Key Sources
                      </p>
                      {section.sources.map((s, j) => (
                        <a
                          key={j}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-[11px] font-mono transition-opacity hover:opacity-100 opacity-60"
                          style={{ color: ACCENT }}
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          {s.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
