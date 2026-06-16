import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DOMAIN_META } from "@/lib/cognitiveData";
import { ExternalLink, ChevronDown, ChevronUp } from "lucide-react";

const RESEARCH_SECTIONS = [
  {
    title: "What Actually Works",
    evidenceLevel: "strong",
    content: `
**Retrieval practice (testing effect)**: Actively recalling information from memory is consistently more effective for long-term retention than re-reading or re-studying. Effect sizes are large and replicated across many domains. The variable retrieval effect (Butowska et al., PNAS 2024) extends this — varying the context slightly on each retrieval attempt further boosts retention.

**Spaced repetition**: Distributing practice over time is one of the most reliable learning interventions. The SM-2 algorithm (underlying Anki and similar tools) is well-validated. Optimal intervals depend on individual forgetting rates.

**Interleaving**: Mixing different types of problems during practice impairs short-term performance but significantly improves long-term retention and discrimination ability.

**Metacognitive monitoring**: Teaching learners to predict their performance, check their understanding, and reflect on errors produces reliable improvements in learning efficiency (Fleming et al., adaptive calibration training, 2018).
    `,
    sources: [
      { label: "Butowska et al. (PNAS 2024) — Variable retrieval", url: "https://www.pnas.org/doi/pdf/10.1073/pnas.2413511121" },
      { label: "Seth & Lau (2018) — Metacognitive calibration training", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6390881/" },
    ],
  },
  {
    title: "Working Memory Training — Nuanced",
    evidenceLevel: "moderate",
    content: `
**Near transfer is reliable**: Training on n-back or working memory tasks reliably improves performance on similar (untrained) working memory tasks.

**Far transfer is controversial**: Many meta-analyses (including Gobet & Sala, 2022) find near-zero effect of WM training on fluid intelligence or real-world functioning. However, Pahor et al. (Nature Human Behaviour, 2022) showed that near transfer mediates far transfer — individuals who don't improve on near-transfer tasks don't show far transfer either.

**Real-world stimuli**: Using ecologically valid stimuli (medication names, patient details, instructions) likely improves ecological validity of training even if the fundamental transfer limits remain.

**This app's approach**: WM training is framed as a tool for improving attentional control strategies, not a "make you smarter" hack. The real-world n-back uses domain-relevant stimuli and is one component of a broader cognitive training system.
    `,
    sources: [
      { label: "Pahor et al. (Nature Human Behaviour, 2022) — Near/far transfer mediation", url: "https://www.nature.com/articles/s41562-022-01384-w" },
      { label: "Gobet & Sala (2022) — Critical review of cognitive training", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9903001/" },
    ],
  },
  {
    title: "Executive Function Training",
    evidenceLevel: "moderate",
    content: `
**What transfers**: Inhibitory control (Stroop, Go/No-Go) shows reliable near-transfer. Cognitive flexibility training (rule-shifting paradigms) improves task-switching. Near-transfer effects are consistent; far transfer is weaker and less consistent.

**Serious games**: A 2026 systematic review (Frontiers, Tommasi et al.) found that serious games improve attention, WM, cognitive flexibility, and inhibition with near-transfer effects. Far-transfer to academic outcomes was limited but present for some interventions.

**Key design principle**: Training tasks should have increasing difficulty (adaptive), involve real-world-relevant cognitive demands, and be combined with metacognitive reflection for best results.
    `,
    sources: [
      { label: "Tommasi et al. (Frontiers, 2026) — Serious games and executive functions", url: "https://www.frontiersin.org/articles/10.3389/frcha.2026.1801077/full" },
    ],
  },
  {
    title: "Creativity Training",
    evidenceLevel: "moderate",
    content: `
**Divergent thinking is trainable**: SCAMPER, analogy generation, and constraint manipulation reliably improve divergent thinking scores. Critical thinking education improves both divergent thinking and academic enthusiasm (Mohkam Kar et al., 2023).

**Constraints paradox**: Research consistently shows that appropriate constraints enhance creative output by forcing exploration of unconventional solution paths (Ward, 1994, structured imagination).

**Convergent-divergent funnel**: Effective creative training moves through phases: divergent generation → evaluation → convergent refinement → execution. Apps that skip the evaluation phase see lower quality output.

**Speculative note**: The degree to which creativity training transfers to novel real-world creative performance is not well-established. Creative performance depends heavily on domain knowledge and motivation.
    `,
    sources: [],
  },
  {
    title: "Simulation-Based Training & Transfer",
    evidenceLevel: "strong",
    content: `
**Simulation > passive instruction**: Simulation-based training with feedback produces superior transfer compared to lecture-based instruction across medical, military, and professional contexts. This is one of the strongest findings in applied learning science.

**Deliberate practice requirements**: Effective simulation requires clearly defined objectives, appropriate challenge level, immediate feedback, and repetition. Ericsson's deliberate practice framework remains the gold standard for skill acquisition.

**Scenario-based training**: Integrating multiple cognitive demands into a realistic scenario (as in the Scenario Deck) mirrors the demands of real performance environments and promotes contextual encoding that supports transfer.
    `,
    sources: [
      { label: "Medical simulation and knowledge transfer (2024)", url: "https://journals.viamedica.pl/disaster_and_emergency_medicine/article/view/101945" },
    ],
  },
  {
    title: "Physical-Cognitive Integration",
    evidenceLevel: "moderate",
    content: `
**Exercise enhances cognition**: Meta-analyses consistently find that aerobic exercise improves executive function, attention, and processing speed with modest-to-moderate effect sizes. MICT (moderate-intensity continuous training) shows greater cognitive benefits than HIIT in some RCTs.

**Embodied cognition**: Learning while moving or incorporating relevant body movements can enhance learning outcomes (Castro-Alonso et al., 2024 review). The mechanism involves physical activity directly boosting hippocampal BDNF and visuospatial processing.

**This app's approach**: The Embodied Mode includes walking recall, breath-regulated focus sessions, and physical prompts. These are evidence-adjacent — the direct effects on cognitive training outcomes specifically require more research.
    `,
    sources: [
      { label: "Effects of aerobic exercise on cognitive function — Frontiers Neurology (2025)", url: "https://www.frontiersin.org/journals/neurology/articles/10.3389/fneur.2025.1693052/full" },
      { label: "Embodied cognition in learning — Educational Psychology Review (2024)", url: "https://pure.eur.nl/ws/portalfiles/portal/194102690/s10648-025-10027-1.pdf" },
    ],
  },
  {
    title: "Honest Limitations",
    evidenceLevel: "speculative",
    content: `
**Far transfer remains the hard problem**: Despite decades of research, reliably training a cognitive skill that transfers broadly to untrained tasks remains elusive. Near-transfer (improvement on similar tasks) is well-established; far transfer is not.

**Publication bias**: The cognitive training literature has documented publication bias — studies showing positive effects are more likely to be published. Effect sizes in meta-analyses including unpublished studies tend to be smaller.

**Individual differences**: Training effects vary enormously between individuals. Baseline cognitive level, age, training adherence, and motivation all moderate outcomes. There is no one-size-fits-all protocol.

**Placebo effects**: Parong et al. (2022, PNAS) showed that expectations and motivation can independently improve performance, separate from training itself. Active control groups are essential for valid inference.

**This app's honest position**: The strongest components are retrieval practice, spaced repetition, and metacognitive reflection. WM and EF training are included because they have near-transfer value and may support attentional strategies. No component of this app is claimed to "make you smarter" broadly — it trains specific, measurable cognitive behaviors.
    `,
    sources: [
      { label: "Parong et al. (PNAS 2022) — Placebo and WM training", url: "https://pnas.org/doi/10.1073/pnas.2214268119" },
    ],
  },
];

const levelColors: Record<string, string> = {
  strong: "border-green-400/40 text-green-400",
  moderate: "border-amber-400/40 text-amber-400",
  speculative: "border-blue-400/40 text-blue-400",
};

export default function Research() {
  const [expanded, setExpanded] = useState<number | null>(0);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display text-xl font-bold text-foreground">Research Brief</h1>
        <p className="text-sm text-muted-foreground mt-0.5">What the evidence says about cognitive training · Updated to 2024-2026</p>
      </div>

      <div className="rome-card rome-border-top rome-border-bottom rounded-lg px-4 py-4 pt-7 pb-6 bg-primary/5 border border-primary/20">
        <p className="text-xs font-mono text-primary mb-1">SCIENTIFIC INTEGRITY STATEMENT</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          ROME is built on evidence, not marketing. This page summarizes the honest state of the science — including what doesn't work, what's uncertain, and where individual results will vary. We distinguish clearly between strong RCT evidence, moderate preliminary evidence, and speculative features. This transparency is itself a core design principle.
        </p>
      </div>

      <div className="flex gap-3 text-xs flex-wrap">
        {[["strong", "Strong RCT support"], ["moderate", "Moderate evidence"], ["speculative", "Speculative / limited"]].map(([level, label]) => (
          <div key={level} className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full border", levelColors[level])}>
            <div className={cn("w-1.5 h-1.5 rounded-full", level === "strong" ? "bg-green-400" : level === "moderate" ? "bg-amber-400" : "bg-blue-400")} />
            {label}
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {RESEARCH_SECTIONS.map((section, i) => (
          <div key={i} className="rome-card rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === i ? null : i)}
              className="w-full flex items-center justify-between p-5 text-left hover:bg-muted/30 transition-colors"
              data-testid={`research-section-${i}`}
            >
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={cn("text-xs shrink-0", levelColors[section.evidenceLevel])}>
                  {section.evidenceLevel}
                </Badge>
                <span className="font-display font-semibold text-sm text-foreground">{section.title}</span>
              </div>
              {expanded === i ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>

            {expanded === i && (
              <div className="px-5 pb-5 space-y-4 animate-fade-in border-t border-border">
                <div className="prose prose-sm prose-invert max-w-none pt-4">
                  {section.content.split("\n").filter(Boolean).map((line, j) => {
                    if (line.startsWith("**") && line.includes("**:")) {
                      const [term, ...rest] = line.replace(/\*\*/g, "").split(":");
                      return (
                        <p key={j} className="text-sm text-foreground leading-relaxed mb-2">
                          <strong className="text-foreground">{term}:</strong>
                          <span className="text-muted-foreground">{rest.join(":")}</span>
                        </p>
                      );
                    }
                    return <p key={j} className="text-sm text-muted-foreground leading-relaxed mb-2">{line}</p>;
                  })}
                </div>
                {section.sources.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border">
                    <p className="text-xs text-muted-foreground font-mono">KEY SOURCES</p>
                    {section.sources.map((s, j) => (
                      <a
                        key={j}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
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
        ))}
      </div>
    </div>
  );
}
