import { useQuery } from "@tanstack/react-query";
import { Shield, Database, FolderOpen, RefreshCw, Info } from "lucide-react";

export default function Settings() {
  const { data: activeProfile } = useQuery<any>({ queryKey: ["/api/active-profile"] });

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-display text-gold-400 tracking-widest uppercase">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">App configuration and information</p>
      </div>

      {/* About / Version */}
      <div className="rome-card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <Info className="w-5 h-5 text-gold-400" />
          <h2 className="font-display text-sm tracking-widest uppercase text-gold-400">About</h2>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-gold-500/10">
            <span className="text-sm text-muted-foreground">App</span>
            <span className="text-sm font-display text-foreground tracking-wider">ROME</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-gold-500/10">
            <span className="text-sm text-muted-foreground">Release</span>
            <span className="text-sm font-display text-gold-400 tracking-wider">Mark II</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-gold-500/10">
            <span className="text-sm text-muted-foreground">Version</span>
            <span className="text-sm font-mono text-foreground">0.2.0</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-gold-500/10">
            <span className="text-sm text-muted-foreground">Architecture</span>
            <span className="text-sm text-foreground">Local-first · SQLite</span>
          </div>
          <div className="flex justify-between items-center py-2">
            <span className="text-sm text-muted-foreground">Active Profile</span>
            <span className="text-sm text-foreground">{activeProfile?.name ?? "—"}</span>
          </div>
        </div>

        {/* Mark II badge */}
        <div className="mt-4 pt-4 border-t border-gold-500/10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-gold-500/8 border border-gold-500/20">
            <Shield className="w-3.5 h-3.5 text-gold-400" />
            <span className="text-xs font-display tracking-widest text-gold-400 uppercase">ROME Mark II — v0.2.0</span>
          </div>
        </div>
      </div>

      {/* Data Storage */}
      <div className="rome-card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <Database className="w-5 h-5 text-gold-400" />
          <h2 className="font-display text-sm tracking-widest uppercase text-gold-400">Data Storage</h2>
        </div>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>All your data is stored locally on this device. No cloud account is required.</p>
          <div className="space-y-2 mt-3">
            <div className="flex items-start gap-2">
              <FolderOpen className="w-4 h-4 text-gold-400/60 mt-0.5 shrink-0" />
              <div>
                <p className="text-foreground font-medium text-xs uppercase tracking-wider mb-1">Web / Dev mode</p>
                <code className="text-xs font-mono text-gold-400/80">./data.db</code>
                <p className="text-xs mt-1">SQLite database in the project root directory.</p>
              </div>
            </div>
            <div className="flex items-start gap-2 mt-3">
              <FolderOpen className="w-4 h-4 text-gold-400/60 mt-0.5 shrink-0" />
              <div>
                <p className="text-foreground font-medium text-xs uppercase tracking-wider mb-1">Desktop (Windows)</p>
                <code className="text-xs font-mono text-gold-400/80">%APPDATA%\ROME\rome.db</code>
              </div>
            </div>
            <div className="flex items-start gap-2 mt-3">
              <FolderOpen className="w-4 h-4 text-gold-400/60 mt-0.5 shrink-0" />
              <div>
                <p className="text-foreground font-medium text-xs uppercase tracking-wider mb-1">Desktop (macOS)</p>
                <code className="text-xs font-mono text-gold-400/80">~/Library/Application Support/ROME/rome.db</code>
              </div>
            </div>
          </div>
          <p className="mt-4 text-xs border border-gold-500/15 rounded-md p-3 bg-gold-500/5">
            <strong className="text-gold-400">Update safety:</strong> Reinstalling or updating the app will never delete your database. 
            The database lives outside the app installation directory and persists across all updates.
          </p>
        </div>
      </div>

      {/* Updates */}
      <div className="rome-card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <RefreshCw className="w-5 h-5 text-gold-400" />
          <h2 className="font-display text-sm tracking-widest uppercase text-gold-400">Updates</h2>
        </div>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>ROME Mark II uses <strong className="text-foreground">manual installer updates</strong>. Auto-update will be added in a future release.</p>
          <p className="text-xs mt-2">To update: download the new installer from GitHub Releases and install over the existing version. Your data will be preserved automatically.</p>
          <a
            href="https://github.com/aescondeprime/rome-cognitive-training/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-gold-400 hover:text-gold-300 transition-colors mt-2"
          >
            View releases on GitHub →
          </a>
        </div>
      </div>
    </div>
  );
}
