import { useState, useRef } from "react";
import type { ActivityProps } from "./shared";
import { SessionProgress } from "./shared";
import { cn } from "@/lib/utils";

type Rule = "color" | "shape" | "number";
const RULES: Rule[] = ["color", "shape", "number"];
const COLORS_LIST = ["red", "blue", "green", "yellow"];
const SHAPES_LIST = ["circle", "triangle", "square", "diamond"];

function makeCard() {
  return {
    color: COLORS_LIST[Math.floor(Math.random() * 4)],
    shape: SHAPES_LIST[Math.floor(Math.random() * 4)],
    number: Math.floor(Math.random() * 4) + 1,
  };
}

// Guarantee exactly one correct option among 4, shuffled randomly.
function makeOptions(target: ReturnType<typeof makeCard>, rule: Rule) {
  // Build a correct card: copy target's matching attribute, randomise the rest.
  const correctCard = makeCard();
  if (rule === "color") correctCard.color = target.color;
  else if (rule === "shape") correctCard.shape = target.shape;
  else correctCard.number = target.number;

  // Build 3 distractors that explicitly do NOT match on the current rule.
  const distractors: ReturnType<typeof makeCard>[] = [];
  let attempts = 0;
  while (distractors.length < 3 && attempts < 200) {
    attempts++;
    const c = makeCard();
    if (rule === "color" && c.color === target.color) continue;
    if (rule === "shape" && c.shape === target.shape) continue;
    if (rule === "number" && c.number === target.number) continue;
    distractors.push(c);
  }

  // Shuffle correct card into random position.
  const cards = [...distractors, correctCard];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

const TOTAL_TRIALS = 20;

export function RuleShiftActivity({ onTrialComplete, onActivityEnd, difficulty }: ActivityProps) {
  const [rule, setRule] = useState<Rule>("color");
  const [rulesShifts, setRuleShifts] = useState(0);
  const [target] = useState(makeCard);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [trial, setTrial] = useState(0);
  const [ruleHint, setRuleHint] = useState(true);
  const startRef = useRef(Date.now());

  const [displayOptions, setDisplayOptions] = useState(() => makeOptions(target, "color"));
  const [displayTarget, setDisplayTarget] = useState(target);

  const getMatch = (card: typeof target, against: typeof target, r: Rule) => {
    if (r === "color") return card.color === against.color;
    if (r === "shape") return card.shape === against.shape;
    return card.number === against.number;
  };

  const handleSelect = (option: typeof target) => {
    const rt = Date.now() - startRef.current;
    const correct = getMatch(option, displayTarget, rule);
    setFeedback(correct ? "correct" : "wrong");

    const shiftThreshold = 5 - difficulty;
    const newShifts = rulesShifts + 1;
    let newRule = rule;
    if (newShifts % Math.max(2, shiftThreshold) === 0) {
      const availableRules = RULES.filter(r => r !== rule);
      newRule = availableRules[Math.floor(Math.random() * availableRules.length)];
      setRule(newRule);
      setRuleHint(false);
      setTimeout(() => setRuleHint(true), 1500);
    }
    setRuleShifts(newShifts);

    onTrialComplete({ correct, responseTimeMs: rt, confidence: 65, difficulty,
      errorType: !correct ? (rt < 600 ? "rushing" : "poor_retrieval") : undefined });

    setTimeout(() => {
      setFeedback(null);
      // new cards
      const newTarget = makeCard();
      setDisplayTarget(newTarget);
      setDisplayOptions(makeOptions(newTarget, newRule));
      startRef.current = Date.now();
      if (trial >= TOTAL_TRIALS - 1) { onActivityEnd(); return; }
      setTrial(t => t + 1);
    }, 700);
  };

  const shapeSymbol: Record<string, string> = { circle: "●", triangle: "▲", square: "■", diamond: "◆" };
  const colorHex: Record<string, string> = { red: "#ef4444", blue: "#3b82f6", green: "#22c55e", yellow: "#eab308" };

  const renderCard = (card: typeof target) => (
    <div className="text-center">
      <div style={{ color: colorHex[card.color] }} className="text-3xl">{shapeSymbol[card.shape]}</div>
      <div className="text-xs font-mono text-muted-foreground mt-1">{card.number}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <SessionProgress current={trial} total={TOTAL_TRIALS} label="Rule-shift sorting" />

      <div className="bg-card border border-border rounded-lg p-6 space-y-6">
        <div className="text-center space-y-1">
          {ruleHint ? (
            <p className="text-xs font-mono text-primary">CURRENT RULE: MATCH BY {rule.toUpperCase()}</p>
          ) : (
            <p className="text-xs font-mono text-amber-400 animate-pulse">⚠ RULE HAS CHANGED — DETECT THE NEW RULE</p>
          )}
        </div>

        {/* Target */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground mb-3">TARGET CARD</p>
          <div className="inline-flex items-center justify-center w-20 h-20 bg-muted/30 border-2 border-primary/40 rounded-xl">
            {renderCard(displayTarget)}
          </div>
        </div>

        {/* Options */}
        <div>
          <p className="text-xs text-muted-foreground text-center mb-3">SELECT THE MATCHING CARD</p>
          <div className="grid grid-cols-4 gap-3">
            {displayOptions.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleSelect(opt)}
                data-testid={`ruleshirt-option-${i}`}
                className={cn(
                  "h-20 bg-muted/30 border border-border rounded-xl flex items-center justify-center transition-all hover:border-primary/40 hover:bg-primary/10",
                  feedback === "correct" && "opacity-50",
                  feedback === "wrong" && "opacity-50"
                )}
              >
                {renderCard(opt)}
              </button>
            ))}
          </div>
        </div>

        {feedback && (
          <div className={cn("text-center font-bold text-sm animate-fade-in", feedback === "correct" ? "text-green-400" : "text-rose-400")}>
            {feedback === "correct" ? "✓ Correct!" : "✗ Incorrect"}
          </div>
        )}
      </div>
    </div>
  );
}
