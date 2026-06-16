import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import {
  UserPlus, Users, Trash2, Edit2, Check, X,
  Download, Upload, Crown, Shield,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface ProfileWithStats {
  id: number;
  name: string;
  createdAt: number | null;
  isActive: boolean;
  sessionsCompleted: number;
  minutesTrained: number;
  baselineCompleted: boolean | null;
  currentMode: string | null;
}

function formatDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ProfileManager() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProfileWithStats | null>(null);

  const { data: profiles = [], isLoading } = useQuery<ProfileWithStats[]>({
    queryKey: ["/api/profiles"],
  });

  const { data: activeProfile } = useQuery<{ id: number; name: string }>({
    queryKey: ["/api/active-profile"],
  });

  // Invalidate everything on profile switch
  const invalidateAll = () => queryClient.invalidateQueries();

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      apiRequest("POST", "/api/profiles", { name }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      setNewName("");
      setShowNewForm(false);
      toast({ title: "Profile created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiRequest("PATCH", `/api/profiles/${id}`, { name }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/active-profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setEditingId(null);
      toast({ title: "Profile renamed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/profiles/${id}`).then(r => r.json()),
    onSuccess: () => {
      invalidateAll();
      setDeleteTarget(null);
      toast({ title: "Profile deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/profiles/${id}/activate`).then(r => r.json()),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Profile switched" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("POST", "/api/import", data).then(r => r.json()),
    onSuccess: (result: any) => {
      invalidateAll();
      toast({ title: `Imported: ${result.profileName}` });
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const handleExport = async () => {
    try {
      const res = await apiRequest("GET", "/api/export");
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rome-profile-${json.profile?.name ?? "export"}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Profile exported" });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        importMutation.mutate(data);
      } catch {
        toast({ title: "Invalid JSON file", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    // Reset so same file can be imported again
    e.target.value = "";
  };

  const startEdit = (p: ProfileWithStats) => {
    setEditingId(p.id);
    setEditName(p.name);
  };

  const confirmRename = (id: number) => {
    if (!editName.trim()) return;
    renameMutation.mutate({ id, name: editName.trim() });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-muted-foreground text-sm">Loading profiles…</span>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1
          className="text-3xl font-bold gold-shimmer tracking-[0.12em] mb-1"
          style={{ fontFamily: "'Cinzel', serif" }}
        >
          PROFILE MANAGER
        </h1>
        <p className="text-muted-foreground text-sm">
          Switch, create, rename, and manage cognitive training profiles.
        </p>
      </div>

      {/* Profile list */}
      <div className="space-y-3">
        {profiles.map((p: ProfileWithStats) => (
          <div
            key={p.id}
            className={`rome-card rounded-xl p-5 border transition-all ${
              p.isActive
                ? "border-gold-500/30 bg-gold-500/4"
                : "border-cave-700/40"
            }`}
          >
            <div className="flex items-start gap-4">
              {/* Avatar */}
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${
                  p.isActive
                    ? "bg-gold-600/30 border border-gold-500/40 text-gold-300"
                    : "bg-cave-750 border border-cave-600/40 text-muted-foreground"
                }`}
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                {p.name[0]?.toUpperCase() ?? "?"}
              </div>

              {/* Name + stats */}
              <div className="flex-1 min-w-0">
                {editingId === p.id ? (
                  <div className="flex items-center gap-2 mb-1">
                    <Input
                      className="h-8 text-sm bg-cave-800 border-gold-500/30 focus:border-gold-400/60 w-48"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") confirmRename(p.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                    <button
                      onClick={() => confirmRename(p.id)}
                      className="text-green-400 hover:text-green-300 transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`font-semibold text-sm ${p.isActive ? "text-gold-300" : "text-foreground"}`}
                      style={p.isActive ? { fontFamily: "'Cinzel', serif" } : {}}
                    >
                      {p.name}
                    </span>
                    {p.isActive && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-gold-600/20 text-gold-400 border border-gold-500/20 font-roman">
                        <Crown className="w-2.5 h-2.5" />
                        Active
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Created {formatDate(p.createdAt)}</span>
                  <span className="text-cave-600">·</span>
                  <span>{p.sessionsCompleted} sessions</span>
                  <span className="text-cave-600">·</span>
                  <span>{p.minutesTrained} min trained</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {p.isActive ? (
                  <button
                    onClick={handleExport}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gold-400 border border-gold-500/25 hover:bg-gold-500/8 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export
                  </button>
                ) : (
                  <button
                    onClick={() => activateMutation.mutate(p.id)}
                    disabled={activateMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground border border-cave-600/40 hover:border-gold-500/30 hover:text-gold-400 transition-all disabled:opacity-50"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    Switch
                  </button>
                )}

                <button
                  onClick={() => startEdit(p)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-gold-400 hover:bg-gold-500/8 transition-all"
                  title="Rename"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => setDeleteTarget(p)}
                  disabled={profiles.length <= 1}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/8 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  title={profiles.length <= 1 ? "Cannot delete the only profile" : "Delete profile"}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* New profile form */}
      {showNewForm ? (
        <div className="rome-card rounded-xl p-5 border border-gold-500/20 bg-gold-500/3">
          <p className="text-xs text-muted-foreground mb-3 font-roman tracking-wider uppercase">New Profile</p>
          <div className="flex items-center gap-3">
            <Input
              className="h-9 bg-cave-800 border-gold-500/30 focus:border-gold-400/60 text-sm flex-1"
              placeholder="Profile name…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && newName.trim()) createMutation.mutate(newName.trim());
                if (e.key === "Escape") { setShowNewForm(false); setNewName(""); }
              }}
              autoFocus
            />
            <button
              onClick={() => newName.trim() && createMutation.mutate(newName.trim())}
              disabled={!newName.trim() || createMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs bg-gold-600/20 text-gold-400 border border-gold-500/30 hover:bg-gold-600/30 transition-all disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              Create
            </button>
            <button
              onClick={() => { setShowNewForm(false); setNewName(""); }}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-gold-400 border border-gold-500/25 hover:bg-gold-500/8 transition-all"
        >
          <UserPlus className="w-4 h-4" />
          New Profile
        </button>
      )}

      {/* Import section */}
      <div className="rome-card rounded-xl p-5 border border-cave-700/40">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2
              className="text-sm font-semibold text-foreground tracking-wider mb-0.5"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              IMPORT PROFILE
            </h2>
            <p className="text-xs text-muted-foreground">
              Upload a previously exported ROME profile JSON file.
            </p>
          </div>
          <Users className="w-5 h-5 text-muted-foreground/40" />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportFile}
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importMutation.isPending}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-muted-foreground border border-cave-600/40 hover:border-gold-500/30 hover:text-gold-400 transition-all disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          {importMutation.isPending ? "Importing…" : "Choose File"}
        </button>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="bg-cave-900 border border-cave-700">
          <DialogHeader>
            <DialogTitle
              className="text-red-400 tracking-wider"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Delete Profile
            </DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm leading-relaxed">
              Are you sure you want to delete{" "}
              <span className="text-foreground font-semibold">{deleteTarget?.name}</span>?
              This will permanently erase all sessions, trials, memory items, and notes
              associated with this profile. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-cave-600 text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              className="bg-red-900/40 border border-red-500/30 text-red-300 hover:bg-red-900/60 hover:text-red-200"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {deleteMutation.isPending ? "Deleting…" : "Delete Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
