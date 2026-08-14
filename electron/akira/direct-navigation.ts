export interface DirectNavigation {
  route: string;
  label: string;
}

const TARGETS: Record<string, DirectNavigation> = {
  "project": { route: "/idea-workshop", label: "Idea Workshop" },
  "projects": { route: "/idea-workshop", label: "Idea Workshop" },
  "my project": { route: "/idea-workshop", label: "Idea Workshop" },
  "my projects": { route: "/idea-workshop", label: "Idea Workshop" },
  "idea workshop": { route: "/idea-workshop", label: "Idea Workshop" },
  "workshop": { route: "/idea-workshop", label: "Idea Workshop" },
  "taskboard": { route: "/taskboard", label: "Taskboard" },
  "tasks": { route: "/taskboard", label: "Taskboard" },
  "calendar": { route: "/kronos-keep", label: "Kronos Keep" },
  "schedule": { route: "/kronos-keep", label: "Kronos Keep" },
  "kronos keep": { route: "/kronos-keep", label: "Kronos Keep" },
  "philosophy": { route: "/philosophy", label: "Philosophy Chambers" },
  "philosophy chambers": { route: "/philosophy", label: "Philosophy Chambers" },
  "research": { route: "/research-lab", label: "Research Lab" },
  "research lab": { route: "/research-lab", label: "Research Lab" },
  "component board": { route: "/component-board", label: "Component Board" },
  "case board": { route: "/component-board", label: "Component Board" },
  "browser": { route: "/world", label: "World Browser" },
  "world": { route: "/world", label: "World Browser" },
  "world browser": { route: "/world", label: "World Browser" },
  "funding": { route: "/funding", label: "Financial Node" },
  "finances": { route: "/funding", label: "Financial Node" },
  "financial node": { route: "/funding", label: "Financial Node" },
  "academia": { route: "/academia", label: "Academia" },
  "settings": { route: "/settings", label: "Settings" },
};

export function resolveDirectNavigation(value: string): DirectNavigation | null {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^akira\s+/, "")
    .replace(/^please\s+/, "")
    .replace(/^(?:could|can|would) you\s+/, "")
    .replace(/^please\s+/, "");
  const match = normalized.match(/^(?:open(?: up)?|show|go to|take me to|pull up|navigate to)\s+(?:my\s+)?(.+?)(?:\s+(?:page|screen|tab))?$/);
  if (!match) return null;
  const target = match[1].replace(/^the\s+/, "").trim();
  return TARGETS[target] ?? TARGETS[`my ${target}`] ?? null;
}
