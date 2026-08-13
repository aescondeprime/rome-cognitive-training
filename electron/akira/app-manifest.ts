import type { AkiraCapabilityDescriptor } from "../../shared/akira";

export const AKIRA_SURFACES = [
  { route: "/athena", title: "Athena Trials", kind: "training" },
  { route: "/philosophy", title: "Philosophy Chambers", kind: "reflection" },
  { route: "/taskboard", title: "Taskboard", kind: "workspace" },
  { route: "/kronos-keep", title: "Kronos Keep", kind: "schedule" },
  { route: "/idea-workshop", title: "Idea Workshop", kind: "workspace" },
  { route: "/component-board", title: "Component Board", kind: "workspace" },
  { route: "/research-lab", title: "Research Lab", kind: "workspace" },
  { route: "/world", title: "World Browser", kind: "browser" },
  { route: "/funding", title: "Funding Dashboard", kind: "financial-planning" },
  { route: "/academia", title: "Academia", kind: "learning" },
  { route: "/settings", title: "Settings", kind: "settings" },
] as const;

export function createAkiraAppManifest(capabilities: AkiraCapabilityDescriptor[]) {
  return {
    schemaVersion: 1,
    application: "ROME",
    assistant: "Akira",
    generatedAt: Date.now(),
    guarantees: {
      liveDataAuthoritative: true,
      requiresNamedCapabilities: true,
      shellAccess: false,
      filesystemAccess: false,
      genericBrowserAutomation: false,
      destructiveApproval: "always",
      financialApproval: "always",
      bulkThreshold: 20,
    },
    surfaces: AKIRA_SURFACES,
    capabilities,
  };
}

