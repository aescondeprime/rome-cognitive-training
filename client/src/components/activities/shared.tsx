// Shared types and utilities for all activity components
import type { TrialResult } from "@/pages/Activity";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export type ActivityProps = {
  onTrialComplete: (result: TrialResult) => void;
  onActivityEnd: () => void;
  difficulty: number;
};

// Confidence slider component
export function ConfidenceSlider({ value, onChange, label = "How confident are you?" }: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  const color = value < 40 ? "text-rose-400" : value < 70 ? "text-amber-400" : "text-green-400";
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={cn("text-xs font-mono font-bold", color)}>{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-primary h-1.5 cursor-pointer"
        data-testid="confidence-slider"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Guessing</span>
        <span>Certain</span>
      </div>
    </div>
  );
}

// Session progress bar
export function SessionProgress({ current, total, label }: { current: number; total: number; label?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label || "Progress"}</span>
        <span>{current}/{total}</span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

// Trial timer hook
export function useTimer(onExpire?: () => void) {
  const [elapsed, setElapsed] = useState(0);
  const [startTime] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);
    return () => clearInterval(interval);
  }, [startTime]);

  return { elapsed, startTime };
}

// Generic question bank
export const GENERAL_QUESTIONS = [
  { q: "What is the primary function of mitochondria?", a: "Energy production (ATP synthesis via cellular respiration)", domain: "biology" },
  { q: "What does SBAR stand for in clinical communication?", a: "Situation, Background, Assessment, Recommendation", domain: "clinical" },
  { q: "What is the normal range for SpO2 in a healthy adult?", a: "95-100%", domain: "clinical" },
  { q: "Name three early signs of sepsis.", a: "Fever/hypothermia, tachycardia, tachypnea, altered mental status, elevated lactate", domain: "clinical" },
  { q: "What is 'retrieval practice' and why does it work?", a: "Actively recalling information from memory; works because retrieval strengthens memory traces and identifies gaps", domain: "learning" },
  { q: "What is the spacing effect in learning?", a: "Information is better retained when practice is distributed over time rather than massed", domain: "learning" },
  { q: "What is cognitive load theory?", a: "Learning is limited by working memory capacity; intrinsic, extraneous, and germane load", domain: "learning" },
  { q: "Define 'first-principles thinking'.", a: "Breaking a problem down to its most fundamental truths and reasoning up from there", domain: "reasoning" },
  { q: "What is Fermi estimation?", a: "Order-of-magnitude estimation using known quantities and logical decomposition when exact data is unavailable", domain: "reasoning" },
  { q: "What is the Stroop effect?", a: "Interference caused when the automatic processing of one stimulus attribute (e.g. color name) conflicts with intentional processing of another", domain: "cognition" },
  { q: "What is 'interleaving' in learning science?", a: "Mixing different types of problems or topics during practice, which improves discrimination and long-term retention compared to blocked practice", domain: "learning" },
  { q: "Name three heuristics that lead to cognitive bias.", a: "Availability heuristic, representativeness heuristic, anchoring heuristic", domain: "reasoning" },
  { q: "What is a 'desirable difficulty' in learning?", a: "A challenge that impedes short-term performance but enhances long-term retention and transfer", domain: "learning" },
  { q: "What does PEEP stand for in ventilator settings?", a: "Positive End-Expiratory Pressure", domain: "clinical" },
  { q: "What is the difference between near and far transfer?", a: "Near transfer: performance improvement on tasks similar to training; far transfer: improvement on dissimilar tasks", domain: "cognition" },
];

export const STROOP_STIMULI = [
  { word: "RED", color: "#ef4444", correct: "red" },
  { word: "BLUE", color: "#3b82f6", correct: "blue" },
  { word: "GREEN", color: "#22c55e", correct: "green" },
  { word: "YELLOW", color: "#eab308", correct: "yellow" },
  { word: "RED", color: "#3b82f6", correct: "blue" },   // incongruent
  { word: "GREEN", color: "#ef4444", correct: "red" },
  { word: "BLUE", color: "#eab308", correct: "yellow" },
  { word: "YELLOW", color: "#22c55e", correct: "green" },
  { word: "GREEN", color: "#3b82f6", correct: "blue" },
  { word: "RED", color: "#22c55e", correct: "green" },
];

export const COLORS = ["red", "blue", "green", "yellow"] as const;
