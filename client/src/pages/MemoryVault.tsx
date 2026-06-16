import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Plus, Trash2, BookOpen, Clock, Brain, Search } from "lucide-react";
import type { RecallItem } from "@shared/schema";

const CATEGORIES = ["general", "clinical", "pharmacology", "learning science", "anatomy", "procedures", "concepts"];

export default function MemoryVault() {
  const [showAdd, setShowAdd] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [category, setCategory] = useState("general");
  const [search, setSearch] = useState("");

  const { data: items = [], isLoading } = useQuery<RecallItem[]>({
    queryKey: ["/api/recall-items"],
    queryFn: () => apiRequest("GET", "/api/recall-items").then(r => r.json()),
  });

  const { data: dueItems = [] } = useQuery<RecallItem[]>({
    queryKey: ["/api/recall-items/due"],
    queryFn: () => apiRequest("GET", "/api/recall-items/due").then(r => r.json()),
  });

  const addMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/recall-items", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recall-items"] });
      setFront(""); setBack(""); setCategory("general"); setShowAdd(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/recall-items/${id}`).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/recall-items"] }),
  });

  const filtered = items.filter(item =>
    !search || item.front.toLowerCase().includes(search.toLowerCase()) || item.back.toLowerCase().includes(search.toLowerCase())
  );

  const daysBefore = (ts: number) => {
    const days = Math.round((ts - Date.now()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return "Due now";
    return `Due in ${days}d`;
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Memory Vault</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Spaced recall system · SM-2 algorithm · {items.length} items · {dueItems.length} due</p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)} size="sm" className="gap-2" data-testid="add-item-btn">
          <Plus className="w-4 h-4" />
          Add Item
        </Button>
      </div>

      {/* Science callout */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
        <p className="text-xs font-mono text-primary mb-1">HOW SPACED RECALL WORKS</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Items are scheduled using the SM-2 spaced repetition algorithm. After each review, you rate how well you recalled it (0-5). Items you recall well get longer intervals; hard items are reviewed sooner. Research (Butowska et al., PNAS 2024) shows that varying the retrieval context slightly — answering the same question from different angles — boosts retention further.
        </p>
      </div>

      {/* Due items alert */}
      {dueItems.length > 0 && (
        <div className="bg-amber-400/10 border border-amber-400/30 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-400">{dueItems.length} item{dueItems.length > 1 ? "s" : ""} due for review</p>
              <p className="text-xs text-muted-foreground">Open the Spaced Recall Drill in the Training Map to review</p>
            </div>
          </div>
          <a href="#/activity/spaced-recall">
            <Button size="sm" variant="outline" className="border-amber-400/40 text-amber-400 hover:bg-amber-400/10 shrink-0">
              Review Now
            </Button>
          </a>
        </div>
      )}

      {/* Add item form */}
      {showAdd && (
        <div className="bg-card border border-primary/30 rounded-lg p-5 space-y-4 animate-fade-in">
          <h3 className="font-display font-semibold text-sm text-foreground">Add Recall Item</h3>
          <div>
            <label className="text-xs text-muted-foreground">Prompt / Question (front)</label>
            <Input
              value={front}
              onChange={e => setFront(e.target.value)}
              placeholder="e.g. What is the mechanism of action of metoprolol?"
              className="mt-1"
              data-testid="recall-front-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Answer (back)</label>
            <textarea
              value={back}
              onChange={e => setBack(e.target.value)}
              placeholder="e.g. Selective beta-1 blocker; reduces HR and contractility by blocking sympathetic stimulation at the SA node"
              className="w-full h-20 bg-muted/50 border border-border rounded-md p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary mt-1"
              data-testid="recall-back-input"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Category</label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {CATEGORIES.map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs border transition-all",
                    category === c ? "bg-primary/15 border-primary/40 text-primary" : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1">Cancel</Button>
            <Button
              onClick={() => addMutation.mutate({ front, back, category, tags: "[]" })}
              disabled={!front.trim() || !back.trim() || addMutation.isPending}
              className="flex-1"
              data-testid="save-recall-item-btn"
            >
              Save Item
            </Button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items..."
          className="pl-9"
          data-testid="recall-search-input"
        />
      </div>

      {/* Items list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-lg animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Brain className="w-10 h-10 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground text-sm">
            {search ? "No items match your search." : "Your Memory Vault is empty. Add your first item above."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => (
            <RecallCard
              key={item.id}
              item={item}
              isDue={dueItems.some(d => d.id === item.id)}
              onDelete={() => deleteMutation.mutate(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecallCard({ item, isDue, onDelete }: { item: RecallItem; isDue: boolean; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const interval = item.intervalDays ? Math.round(item.intervalDays) : 1;

  return (
    <div
      className={cn(
        "bg-card border rounded-lg p-4 cursor-pointer transition-all",
        isDue ? "border-amber-400/40" : "border-border",
        expanded && "border-primary/30"
      )}
      onClick={() => setExpanded(e => !e)}
      data-testid={`recall-card-${item.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{item.front}</p>
          {expanded && (
            <div className="mt-3 pt-3 border-t border-border animate-fade-in">
              <p className="text-xs text-muted-foreground mb-1">Answer:</p>
              <p className="text-sm text-foreground">{item.back}</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isDue ? (
            <Badge variant="outline" className="text-xs border-amber-400/40 text-amber-400">Due</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">⟲ {interval}d</span>
          )}
          <Badge variant="outline" className="text-xs">{item.category}</Badge>
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="text-muted-foreground hover:text-rose-400 transition-colors"
            data-testid={`delete-recall-${item.id}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
