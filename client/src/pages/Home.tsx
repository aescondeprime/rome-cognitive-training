// ── ROME Home — Constellation Interface ──────────────────────────────────
// Full-screen node map. No AppShell wrapper — it has its own layout.
// Accessed at "/" in the router.

import ConstellationMenu from "@/components/ConstellationMenu";

export default function Home() {
  return (
    <div className="fixed inset-0 w-full h-full" style={{ zIndex: 0 }}>
      <ConstellationMenu />
    </div>
  );
}
