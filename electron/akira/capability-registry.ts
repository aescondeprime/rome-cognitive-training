import type { BrowserController } from "../browser/browser-controller";
import type {
  AkiraCapabilityDescriptor,
  AkiraContextSnapshot,
  AkiraDataChanged,
  AkiraSettings,
} from "../../shared/akira";
import type { AkiraSettingsStore } from "./settings-store";
import { AkiraActivityStore } from "./activity-store";
import { PermissionPolicy, requireSingleMatch, validateCapabilityArguments } from "./permission-policy";
import type { AkiraRendererBridge } from "./renderer-bridge";

interface CapabilityResult {
  value: unknown;
  undo?: { method?: string; path?: string; body?: unknown; rendererAction?: string; rendererArgs?: Record<string, unknown> };
}

interface RegisteredCapability {
  descriptor: AkiraCapabilityDescriptor;
  run: (args: Record<string, unknown>) => Promise<CapabilityResult>;
}

interface RegistryDependencies {
  browser: () => BrowserController | null;
  renderer: AkiraRendererBridge;
  settings: AkiraSettingsStore;
  activity: AkiraActivityStore;
  requestApproval: (descriptor: AkiraCapabilityDescriptor, args: Record<string, unknown>, reason: string) => Promise<boolean>;
  emitChanged: (event: AkiraDataChanged) => void;
  serverBase?: string;
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object", additionalProperties: false, properties, ...(required.length ? { required } : {}),
});
const string = (description: string) => ({ type: "string", description });
const number = (description: string) => ({ type: "number", description });
const boolean = (description: string) => ({ type: "boolean", description });
const BOARD_QUERY_KEYS = [["/boards"], ["/research-boards"], ["/api/boards"]];

export class AkiraCapabilityRegistry {
  private readonly capabilities = new Map<string, RegisteredCapability>();
  private readonly policy = new PermissionPolicy();
  private readonly serverBase: string;

  constructor(private readonly dependencies: RegistryDependencies) {
    this.serverBase = dependencies.serverBase ?? "http://127.0.0.1:5000";
    this.registerDefaults();
  }

  list(): AkiraCapabilityDescriptor[] {
    return Array.from(this.capabilities.values(), value => structuredClone(value.descriptor));
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const capability = this.capabilities.get(name);
    if (!capability) throw new Error(`Unknown ROME capability: ${name}`);
    if (JSON.stringify(args).length > 200_000) throw new Error("Capability arguments are too large.");
    validateCapabilityArguments(capability.descriptor.inputSchema, args);
    const profileId = await this.activeProfileId();
    const settings = this.dependencies.settings.get();
    const decision = this.policy.evaluate(capability.descriptor, args, settings);
    if (decision.kind === "deny") {
      this.record(capability.descriptor, "denied", decision.reason, profileId);
      throw new Error(decision.reason);
    }
    if (decision.kind === "ask") {
      const approved = await this.dependencies.requestApproval(capability.descriptor, args, decision.reason);
      if (!approved) {
        this.record(capability.descriptor, "denied", "The user declined the action.", profileId);
        throw new Error("The user declined the action.");
      }
    }
    try {
      const result = await capability.run(args);
      let undoId: string | undefined;
      if (result.undo && capability.descriptor.supportsUndo) {
        undoId = this.dependencies.activity.addUndo(
          name,
          profileId,
          result.undo as Record<string, unknown>,
        ).id;
      }
      this.dependencies.activity.record({
        profileId, capability: name, summary: capability.descriptor.title,
        risk: capability.descriptor.risk, status: "completed", undoId,
      });
      if (capability.descriptor.queryKeys.length || capability.descriptor.localStores.length) {
        this.dependencies.emitChanged({
          source: name,
          queryKeys: capability.descriptor.queryKeys,
          localStores: capability.descriptor.localStores,
          changedAt: Date.now(),
        });
      }
      return { ok: true, capability: name, result: result.value, ...(undoId ? { undoId } : {}) };
    } catch (error) {
      this.record(capability.descriptor, "failed", error instanceof Error ? error.message : String(error), profileId);
      throw error;
    }
  }

  private registerDefaults(): void {
    this.add(this.descriptor("rome.get_context", "Read current ROME context", "Returns a compact, live snapshot of the active profile, route, workspace, and browser metadata.", "read", "background", [], [], false,
      objectSchema({ includeRecent: boolean("Include recent workspace records.") })),
      async () => ({ value: await this.contextSnapshot() }));

    this.add(this.descriptor("rome.navigate", "Open a ROME surface", "Navigates ROME to a named internal route.", "read", "navigate", [], [], false,
      objectSchema({ route: string("Internal ROME route, such as /taskboard or /kronos-keep.") }, ["route"])),
      async args => {
        const route = cleanRoute(args.route);
        await this.dependencies.renderer.command("navigate", { route });
        return { value: { route } };
      });

    this.add(this.descriptor("rome.boards.list", "List workspace boards", "Lists live task, idea, component, or research boards.", "read", "background", [], [], false,
      objectSchema({ type: string("Optional board type.") })),
      async args => ({ value: await this.api("GET", `/api/boards${args.type ? `?type=${encodeURIComponent(String(args.type))}` : ""}`) }));

    this.add(this.descriptor("rome.boards.create", "Create a workspace board", "Creates a new named workspace board.", "write", "background", BOARD_QUERY_KEYS, [], true,
      objectSchema({ title: string("Board title."), type: string("Board type.") }, ["title", "type"])),
      async args => {
        const value = await this.api<any>("POST", "/api/boards", { title: requiredText(args.title, "title"), type: requiredText(args.type, "type") });
        return { value, undo: { method: "DELETE", path: `/api/boards/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.boards.rename", "Rename a workspace board", "Renames one unambiguous board.", "write", "background", BOARD_QUERY_KEYS, [], true,
      objectSchema({ boardId: number("Exact board id."), currentTitle: string("Current title if id is unknown."), title: string("New title.") }, ["title"])),
      async args => {
        if (args.boardId === undefined && !String(args.currentTitle ?? "").trim()) {
          throw new Error("An exact boardId or currentTitle is required before renaming a board.");
        }
        const board = await this.resolveBoard(args);
        await this.api("PATCH", `/api/boards/${numericId(board.id)}`, { title: requiredText(args.title, "title") });
        return { value: { id: board.id, title: args.title }, undo: { method: "PATCH", path: `/api/boards/${numericId(board.id)}`, body: { title: board.title } } };
      });

    this.add(this.descriptor("rome.boards.delete", "Delete a workspace board", "Permanently deletes a board and its owned records.", "destructive", "background", BOARD_QUERY_KEYS, [], false,
      objectSchema({ boardId: number("Exact board id."), title: string("Board title if id is unknown.") })),
      async args => {
        const board = await this.resolveBoard(args);
        await this.api("DELETE", `/api/boards/${numericId(board.id)}`);
        return { value: { deleted: board } };
      });

    this.add(this.descriptor("rome.tasks.list", "List board tasks", "Lists task cards from one task board.", "read", "background", [], [], false,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title if id is unknown.") })),
      async args => {
        const board = await this.resolveBoard(args, "taskboard");
        return { value: await this.api("GET", `/api/boards/${numericId(board.id)}/tasks`) };
      });

    this.add(this.descriptor("rome.tasks.create", "Create a task card", "Creates a task card on one task board.", "write", "background", [["/boards"]], [], true,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title."), content: string("Task text."), color: string("Optional ROME color token.") }, ["content"])),
      async args => {
        const board = await this.resolveBoard(args, "taskboard");
        const value = await this.api<any>("POST", `/api/boards/${numericId(board.id)}/tasks`, { content: requiredText(args.content, "content"), color: args.color ?? "gold" });
        return { value, undo: { method: "DELETE", path: `/api/tasks/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.tasks.update", "Update a task card", "Updates the text, color, pinned, or board visibility fields of a task card.", "write", "background", [["/boards"]], [], false,
      objectSchema({ taskId: number("Exact task id."), content: string("New task text."), color: string("Color."), pinned: boolean("Pinned state."), on_board: boolean("Board visibility.") }, ["taskId"])),
      async args => {
        const taskId = numericId(args.taskId);
        const body = pick(args, ["content", "color", "pinned", "on_board"]);
        await this.api("PATCH", `/api/tasks/${taskId}`, body);
        return { value: { id: taskId, ...body } };
      });

    this.add(this.descriptor("rome.tasks.delete", "Delete a task card", "Permanently deletes one task card.", "destructive", "background", [["/boards"]], [], false,
      objectSchema({ taskId: number("Exact task id.") }, ["taskId"])),
      async args => { const id = numericId(args.taskId); await this.api("DELETE", `/api/tasks/${id}`); return { value: { deletedId: id } }; });

    this.add(this.descriptor("rome.stabilizer.list", "List Task Stabilizer items", "Reads the active profile's local Task Stabilizer queue.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: await this.dependencies.renderer.command("task-stabilizer.list") }));
    this.add(this.descriptor("rome.stabilizer.create", "Add a Task Stabilizer item", "Adds an item to the active profile's local focus queue.", "write", "background", [], ["task-stabilizer"], true,
      objectSchema({ title: string("Task title.") }, ["title"])),
      async args => {
        const value = await this.dependencies.renderer.command("task-stabilizer.create", { title: requiredText(args.title, "title") });
        return { value, undo: { rendererAction: "task-stabilizer.delete", rendererArgs: { id: (value as any)?.id } } };
      });
    this.add(this.descriptor("rome.stabilizer.update", "Update a Task Stabilizer item", "Completes, restores, or renames one focus item.", "write", "background", [], ["task-stabilizer"], false,
      objectSchema({ id: string("Exact item id."), title: string("Optional new title."), completed: boolean("Optional completion state.") }, ["id"])),
      async args => ({ value: await this.dependencies.renderer.command("task-stabilizer.update", pick(args, ["id", "title", "completed"])) }));
    this.add(this.descriptor("rome.stabilizer.delete", "Delete a Task Stabilizer item", "Permanently removes one local focus item.", "destructive", "background", [], ["task-stabilizer"], false,
      objectSchema({ id: string("Exact item id.") }, ["id"])),
      async args => ({ value: await this.dependencies.renderer.command("task-stabilizer.delete", { id: requiredText(args.id, "id") }) }));

    this.addCrudCapabilities("notes", "/api/notes", [["/api/notes"]], {
      createSchema: objectSchema({ title: string("Note title."), content: string("Note body."), tags: { type: "array", items: { type: "string" } } }, ["title"]),
      createBody: args => ({ title: args.title, content: args.content ?? "", tags: args.tags ?? [] }),
      updateFields: ["title", "content", "tags", "pinned"],
      labelField: "title",
    });
    this.addCrudCapabilities("memory", "/api/memory", [["/api/memory"]], {
      createSchema: objectSchema({ content: string("Memory content."), type: string("reflection, pattern, strength, weakness, goal, insight, or preference."), importance: number("Importance from 0 to 100."), confidence: number("Confidence from 0 to 100.") }, ["content"]),
      createBody: args => ({ content: args.content, type: args.type ?? "reflection", source: "akira", importance: args.importance ?? 50, confidence: args.confidence ?? 50 }),
      updateFields: ["type", "content", "source", "confidence", "importance"],
      labelField: "content",
    });

    this.add(this.descriptor("rome.ideas.list", "List idea cards", "Lists ideas from one Idea Workshop board.", "read", "background", [], [], false,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title.") })),
      async args => { const board = await this.resolveBoard(args, "idea"); return { value: await this.api("GET", `/api/boards/${numericId(board.id)}/ideas`) }; });
    this.add(this.descriptor("rome.ideas.create", "Create an idea card", "Creates an idea in one Idea Workshop board.", "write", "background", [["/boards"]], [], true,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title."), content: string("Idea text."), tags: string("Tags."), energy: number("Energy from 1 to 5.") }, ["content"])),
      async args => {
        const board = await this.resolveBoard(args, "idea");
        const value = await this.api<any>("POST", `/api/boards/${numericId(board.id)}/ideas`, { content: args.content, tags: args.tags ?? "", energy: args.energy ?? 3 });
        return { value, undo: { method: "DELETE", path: `/api/ideas/${numericId(value?.id)}` } };
      });
    this.add(this.descriptor("rome.ideas.update", "Update an idea card", "Updates an existing idea card.", "write", "background", [["/boards"]], [], false,
      objectSchema({ ideaId: number("Exact idea id."), content: string("Idea text."), tags: string("Tags."), energy: number("Energy.") }, ["ideaId"])),
      async args => { const id = numericId(args.ideaId); const body = pick(args, ["content", "tags", "energy"]); await this.api("PATCH", `/api/ideas/${id}`, body); return { value: { id, ...body } }; });
    this.add(this.descriptor("rome.ideas.delete", "Delete an idea card", "Permanently deletes one idea card.", "destructive", "background", [["/boards"]], [], false,
      objectSchema({ ideaId: number("Exact idea id.") }, ["ideaId"])),
      async args => { const id = numericId(args.ideaId); await this.api("DELETE", `/api/ideas/${id}`); return { value: { deletedId: id } }; });

    this.add(this.descriptor("rome.schedule.today", "Read today's Kronos schedule", "Reads live routines, assignments, and events for a date.", "read", "background", [], [], false,
      objectSchema({ date: string("Local date in YYYY-MM-DD.") })),
      async args => ({ value: await this.api("GET", `/api/kronos/today${args.date ? `?date=${encodeURIComponent(String(args.date))}` : ""}`) }));
    this.add(this.descriptor("rome.schedule.create_assignment", "Create a Kronos assignment", "Creates a dated assignment on a Kronos calendar.", "write", "background", [["kronos-today"], ["/kronos"], ["/kronos/calendars"]], [], true,
      objectSchema({ calendarId: number("Calendar id."), title: string("Assignment title."), dueDate: string("Date YYYY-MM-DD."), startTime: string("Time HH:MM."), durationMinutes: number("Duration in minutes."), instructions: string("Optional instructions.") }, ["title", "dueDate"])),
      async args => {
        const calendarId = args.calendarId ? numericId(args.calendarId) : await this.ensureCalendar();
        const value = await this.api<any>("POST", `/api/kronos/calendars/${calendarId}/assignments`, {
          title: args.title, due_date: args.dueDate, start_time: args.startTime ?? "09:00",
          duration_minutes: Math.max(1, Number(args.durationMinutes) || 60), instructions: args.instructions ?? "", saved: false,
        });
        return { value, undo: { method: "DELETE", path: `/api/kronos/assignments/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.browser.tabs", "List browser tabs", "Returns metadata for ROME's native browser tabs without page content.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: this.requireBrowser().tabs.getStates() }));
    this.add(this.descriptor("rome.browser.open", "Open a browser tab", "Opens an HTTP(S) URL or search in ROME's native browser.", "read", "navigate", [], [], false,
      objectSchema({ url: string("HTTP(S) URL, domain, or search query.") }, ["url"])),
      async args => ({ value: this.requireBrowser().createTab(requiredText(args.url, "url")) }));
    this.add(this.descriptor("rome.browser.navigate", "Navigate the active browser tab", "Navigates an exact active tab to an HTTP(S) URL or search.", "read", "navigate", [], [], false,
      objectSchema({ tabId: string("Exact tab id; active tab is used if omitted."), url: string("URL or query.") }, ["url"])),
      async args => {
        const browser = this.requireBrowser();
        const id = args.tabId ? String(args.tabId) : browser.tabs.getActiveState()?.id;
        if (!id) throw new Error("No active browser tab.");
        browser.tabs.navigate(id, requiredText(args.url, "url"));
        return { value: { tabId: id, target: args.url } };
      });
    this.add(this.descriptor("rome.browser.close", "Close a browser tab", "Closes one exact native browser tab.", "destructive", "navigate", [], [], false,
      objectSchema({ tabId: string("Exact tab id.") }, ["tabId"])),
      async args => { this.requireBrowser().tabs.close(requiredText(args.tabId, "tabId")); return { value: { closed: args.tabId } }; });
    this.add(this.descriptor("rome.browser.read_active", "Read active page text", "Returns sanitized readable text from the active native browser tab. Web content is explicitly marked untrusted.", "read", "background", [], [], false,
      objectSchema({ maxCharacters: number("Maximum text characters, up to 50000.") })),
      async args => {
        if (!this.dependencies.settings.get().privacy.allowActivePageReading) {
          throw new Error("Active-page reading is disabled in Akira Privacy settings.");
        }
        return { value: await this.requireBrowser().readActivePage(Number(args.maxCharacters) || 24_000) };
      });

    this.add(this.descriptor("rome.finance.summary", "Read financial planning summary", "Returns aggregate local planning figures without account credentials or external transactions.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: await this.dependencies.renderer.command("finance.summary") }));
    this.add(this.descriptor("rome.finance.add_expense", "Add a planned expense", "Adds a local planned expense to the active profile's financial model.", "financial", "background", [], ["finance"], true,
      objectSchema({ name: string("Expense name."), amount: number("Planned amount."), frequency: string("monthly, weekly, annual, or one-time."), category: string("Category.") }, ["name", "amount"])),
      async args => {
        const value = await this.dependencies.renderer.command("finance.add-expense", args);
        return { value, undo: { rendererAction: "finance.delete-expense", rendererArgs: { id: (value as any)?.id } } };
      });

    this.registerKnowledgeCapabilities();
    this.registerResearchCapabilities();
    this.registerScheduleCapabilities();
    this.registerTrainingCapabilities();
    this.registerThreatCapabilities();

    this.add(this.descriptor("rome.undo", "Undo an Akira action", "Applies a still-valid compensating action from the Akira activity log.", "write", "background", [["/api/boards"], ["/api/notes"], ["/api/memory"], ["/kronos"]], ["task-stabilizer", "finance"], false,
      objectSchema({ undoId: string("Undo id returned by a prior action.") }, ["undoId"])),
      async args => ({ value: await this.performUndo(requiredText(args.undoId, "undoId")) }));
  }


  /**
   * Memory Vault — spaced-repetition recall items.
   *
   * Not generated by `addCrudCapabilities`: reviewing a card is
   * `PATCH /:id/review` with an SM-2 quality grade, not a field update, so the
   * factory's `update` would 404. Scheduling is the server's job; Akira only
   * reports the grade.
   */
  private registerKnowledgeCapabilities(): void {
    const RECALL = [["/api/recall-items"], ["/api/recall-items/due"]];

    this.add(this.descriptor("rome.recall.list", "List Memory Vault cards", "Lists spaced-repetition cards for the active profile.", "read", "background", [], [], false,
      objectSchema({ query: string("Optional case-insensitive text filter.") })),
      async args => {
        const values = await this.api<any[]>("GET", "/api/recall-items");
        const query = String(args.query ?? "").trim().toLowerCase();
        return { value: query ? values.filter(v => JSON.stringify(v).toLowerCase().includes(query)).slice(0, 50) : values.slice(0, 100) };
      });

    this.add(this.descriptor("rome.recall.due", "List cards due for review", "Lists Memory Vault cards whose review date has arrived.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: await this.api("GET", "/api/recall-items/due") }));

    this.add(this.descriptor("rome.recall.create", "Create a Memory Vault card", "Creates a spaced-repetition card with a front and back.", "write", "background", RECALL, [], true,
      objectSchema({ front: string("Prompt side."), back: string("Answer side."), category: string("Optional category."), tags: { type: "array", items: { type: "string" }, description: "Optional tags." } }, ["front", "back"])),
      async args => {
        const value = await this.api<any>("POST", "/api/recall-items", {
          front: requiredText(args.front, "front"),
          back: requiredText(args.back, "back"),
          category: args.category ?? "general",
          // The column stores JSON text, not an array.
          tags: JSON.stringify(Array.isArray(args.tags) ? args.tags : []),
        });
        return { value, undo: { method: "DELETE", path: `/api/recall-items/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.recall.review", "Grade a Memory Vault card", "Records a recall quality from 0 to 5; the server reschedules the card.", "write", "background", RECALL, [], false,
      objectSchema({ id: number("Exact card id."), front: string("Exact card front if the id is unknown."), quality: number("Recall quality from 0 (forgot) to 5 (perfect).") }, ["quality"])),
      async args => {
        const existing = await this.resolveRecord("/api/recall-items", args, "front");
        const quality = Math.max(0, Math.min(5, Math.round(Number(args.quality))));
        if (!Number.isFinite(quality)) throw new Error("A quality between 0 and 5 is required.");
        // No undo: SM-2 state is derived, so replaying a prior grade would not
        // restore the previous schedule.
        return { value: await this.api("PATCH", `/api/recall-items/${numericId(existing.id)}/review`, { quality }) };
      });

    this.add(this.descriptor("rome.recall.delete", "Delete a Memory Vault card", "Permanently deletes one spaced-repetition card.", "destructive", "background", RECALL, [], false,
      objectSchema({ id: number("Exact card id."), front: string("Exact card front if the id is unknown.") })),
      async args => {
        const existing = await this.resolveRecord("/api/recall-items", args, "front");
        await this.api("DELETE", `/api/recall-items/${numericId(existing.id)}`);
        return { value: { deleted: existing } };
      });
  }

  /**
   * Research Lab and Component Board.
   *
   * These are board children on `workspace-routes`, which speaks snake_case in
   * both directions and returns only `{ok:true}` from PATCH and DELETE — so an
   * undo has to capture prior state from a GET rather than the response.
   */
  private registerResearchCapabilities(): void {
    const BOARDS = [["/boards"], ["/research-boards"]];

    this.add(this.descriptor("rome.research.articles", "List research articles", "Lists articles on one Research Lab science board.", "read", "background", [], [], false,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title.") })),
      async args => {
        const board = await this.resolveBoard(args, "science");
        return { value: await this.api("GET", `/api/boards/${numericId(board.id)}/articles`) };
      });

    this.add(this.descriptor("rome.research.create_article", "Add a research article", "Adds an article reference to a Research Lab science board.", "write", "background", BOARDS, [], true,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title."), title: string("Article title."), authors: string("Authors."), year: string("Publication year."), url: string("Source URL."), abstract: string("Abstract or summary."), tags: string("Comma-separated tags.") }, ["title"])),
      async args => {
        const board = await this.resolveBoard(args, "science");
        const value = await this.api<any>("POST", `/api/boards/${numericId(board.id)}/articles`, {
          title: requiredText(args.title, "title"),
          authors: args.authors ?? "", year: args.year ?? "", url: args.url ?? "",
          abstract: args.abstract ?? "", tags: args.tags ?? "",
        });
        return { value, undo: { method: "DELETE", path: `/api/articles/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.research.update_article", "Update a research article", "Updates fields on one exact article.", "write", "background", BOARDS, [], false,
      objectSchema({ articleId: number("Exact article id."), title: string("Article title."), authors: string("Authors."), year: string("Year."), url: string("URL."), abstract: string("Abstract."), tags: string("Tags.") }, ["articleId"])),
      async args => {
        const id = numericId(args.articleId);
        const body = pick(args, ["title", "authors", "year", "url", "abstract", "tags"]);
        if (!Object.keys(body).length) throw new Error("No supported update fields were provided.");
        await this.api("PATCH", `/api/articles/${id}`, body);
        return { value: { id, ...body } };
      });

    this.add(this.descriptor("rome.research.delete_article", "Delete a research article", "Permanently deletes one article and leaves its conclusions orphaned.", "destructive", "background", BOARDS, [], false,
      objectSchema({ articleId: number("Exact article id.") }, ["articleId"])),
      async args => { const id = numericId(args.articleId); await this.api("DELETE", `/api/articles/${id}`); return { value: { deletedId: id } }; });

    this.add(this.descriptor("rome.research.conclusions", "List article conclusions", "Lists conclusions recorded on one science board.", "read", "background", [], [], false,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title.") })),
      async args => {
        const board = await this.resolveBoard(args, "science");
        return { value: await this.api("GET", `/api/boards/${numericId(board.id)}/conclusions`) };
      });

    this.add(this.descriptor("rome.research.create_conclusion", "Record a conclusion", "Records a conclusion drawn from one article.", "write", "background", BOARDS, [], true,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title."), articleId: number("Article the conclusion is drawn from."), content: string("The conclusion."), strength: string("strong, moderate, weak, or speculative.") }, ["articleId", "content"])),
      async args => {
        const board = await this.resolveBoard(args, "science");
        const strength = String(args.strength ?? "moderate");
        const value = await this.api<any>("POST", `/api/boards/${numericId(board.id)}/conclusions`, {
          article_id: numericId(args.articleId),
          content: requiredText(args.content, "content"),
          strength: ["strong", "moderate", "weak", "speculative"].includes(strength) ? strength : "moderate",
        });
        return { value, undo: { method: "DELETE", path: `/api/conclusions/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.components.pins", "List Component Board pins", "Lists pins on one Component Board.", "read", "background", [], [], false,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title.") })),
      async args => {
        const board = await this.resolveBoard(args, "component");
        return { value: await this.api("GET", `/api/boards/${numericId(board.id)}/pins`) };
      });

    this.add(this.descriptor("rome.components.create_pin", "Add a Component Board pin", "Adds a pin of evidence or reasoning to a Component Board.", "write", "background", BOARDS, [], true,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title."), content: string("Pin text."), pinType: string("Pin type, e.g. evidence."), color: string("amber, teal, crimson, or slate.") }, ["content"])),
      async args => {
        const board = await this.resolveBoard(args, "component");
        const value = await this.api<any>("POST", `/api/boards/${numericId(board.id)}/pins`, {
          content: requiredText(args.content, "content"),
          pin_type: args.pinType ?? "evidence",
          color: args.color ?? "amber",
        });
        return { value, undo: { method: "DELETE", path: `/api/pins/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.components.update_pin", "Update a Component Board pin", "Updates the text, type, or colour of one exact pin.", "write", "background", BOARDS, [], false,
      objectSchema({ pinId: number("Exact pin id."), content: string("Pin text."), pinType: string("Pin type."), color: string("Colour.") }, ["pinId"])),
      async args => {
        const id = numericId(args.pinId);
        const body: Record<string, unknown> = {};
        if (args.content !== undefined) body.content = args.content;
        if (args.pinType !== undefined) body.pin_type = args.pinType;
        if (args.color !== undefined) body.color = args.color;
        if (!Object.keys(body).length) throw new Error("No supported update fields were provided.");
        await this.api("PATCH", `/api/pins/${id}`, body);
        return { value: { id, ...body } };
      });

    this.add(this.descriptor("rome.components.delete_pin", "Delete a Component Board pin", "Permanently deletes one pin and any threads attached to it.", "destructive", "background", BOARDS, [], false,
      objectSchema({ pinId: number("Exact pin id.") }, ["pinId"])),
      async args => { const id = numericId(args.pinId); await this.api("DELETE", `/api/pins/${id}`); return { value: { deletedId: id } }; });

    this.add(this.descriptor("rome.components.link_pins", "Link two Component Board pins", "Draws a labelled thread between two pins.", "write", "background", BOARDS, [], true,
      objectSchema({ boardId: number("Board id."), boardTitle: string("Board title."), fromId: number("Source pin id."), toId: number("Target pin id."), label: string("Relationship label."), color: string("Thread colour.") }, ["fromId", "toId"])),
      async args => {
        const board = await this.resolveBoard(args, "component");
        const value = await this.api<any>("POST", `/api/boards/${numericId(board.id)}/threads`, {
          from_id: numericId(args.fromId), to_id: numericId(args.toId),
          label: args.label ?? "", color: args.color ?? "amber",
        });
        return { value, undo: { method: "DELETE", path: `/api/threads/${numericId(value?.id)}` } };
      });
  }

  /** Kronos Keep — completes the set around the existing assignment capability. */
  private registerScheduleCapabilities(): void {
    const KRONOS = [["kronos-today"], ["/kronos"], ["/kronos/calendars"]];

    this.add(this.descriptor("rome.schedule.calendars", "List Kronos calendars", "Lists the active profile's calendars.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: await this.api("GET", "/api/kronos/calendars") }));

    this.add(this.descriptor("rome.schedule.create_routine", "Create a recurring routine", "Creates a daily or weekly routine on a Kronos calendar.", "write", "background", KRONOS, [], true,
      objectSchema({ calendarId: number("Calendar id."), title: string("Routine title."), startTime: string("Time HH:MM."), durationMinutes: number("Duration in minutes."), recurrence: string("daily or weekly."), daysOfWeek: { type: "array", items: { type: "number" }, description: "Weekday numbers, 0 = Sunday, when recurrence is weekly." }, notes: string("Optional notes.") }, ["title"])),
      async args => {
        const calendarId = args.calendarId ? numericId(args.calendarId) : await this.ensureCalendar();
        const recurrence = String(args.recurrence ?? "daily") === "weekly" ? "weekly" : "daily";
        const value = await this.api<any>("POST", `/api/kronos/calendars/${calendarId}/routines`, {
          title: requiredText(args.title, "title"),
          start_time: args.startTime ?? "09:00",
          duration_minutes: Math.max(1, Number(args.durationMinutes) || 60),
          recurrence,
          days_of_week: recurrence === "weekly" && Array.isArray(args.daysOfWeek) ? args.daysOfWeek : [],
          notes: args.notes ?? "", saved: false,
        });
        return { value, undo: { method: "DELETE", path: `/api/kronos/routines/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.schedule.create_event", "Create a calendar event", "Creates a dated event on a Kronos calendar.", "write", "background", KRONOS, [], true,
      objectSchema({ calendarId: number("Calendar id."), title: string("Event title."), eventDate: string("Date YYYY-MM-DD."), startTime: string("Time HH:MM."), durationMinutes: number("Duration in minutes."), preparations: string("Optional preparation notes.") }, ["title", "eventDate"])),
      async args => {
        const calendarId = args.calendarId ? numericId(args.calendarId) : await this.ensureCalendar();
        const value = await this.api<any>("POST", `/api/kronos/calendars/${calendarId}/events`, {
          title: requiredText(args.title, "title"),
          event_date: requiredText(args.eventDate, "eventDate"),
          start_time: args.startTime ?? "09:00",
          duration_minutes: Math.max(1, Number(args.durationMinutes) || 60),
          preparations: args.preparations ?? "", saved: false,
        });
        return { value, undo: { method: "DELETE", path: `/api/kronos/events/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.schedule.cancel", "Cancel a scheduled item", "Deletes one routine, assignment, or event by exact id.", "destructive", "background", KRONOS, [], false,
      objectSchema({ kind: string("routine, assignment, or event."), id: number("Exact item id.") }, ["kind", "id"])),
      async args => {
        const kind = String(args.kind);
        const plural: Record<string, string> = { routine: "routines", assignment: "assignments", event: "events" };
        const segment = plural[kind];
        if (!segment) throw new Error("kind must be routine, assignment, or event.");
        const id = numericId(args.id);
        await this.api("DELETE", `/api/kronos/${segment}/${id}`);
        return { value: { deletedId: id, kind } };
      });
  }

  /**
   * Cognitive training.
   *
   * Reads only, apart from recording a trial. Trials, sessions, domain scores,
   * and calibration are append-only server-side — there is no update or delete
   * path — so this surface is deliberately narrow.
   */
  private registerTrainingCapabilities(): void {
    this.add(this.descriptor("rome.training.profile", "Read cognitive domain scores", "Returns current scores across all cognitive domains.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: await this.api("GET", "/api/domain-scores") }));

    this.add(this.descriptor("rome.training.stats", "Read training summary", "Returns aggregate training statistics including strongest and weakest domains.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: await this.api("GET", "/api/stats") }));

    this.add(this.descriptor("rome.training.recent_trials", "Read recent trials", "Returns the most recent training trials.", "read", "background", [], [], false,
      objectSchema({ limit: number("How many trials to return, up to 100.") })),
      async args => {
        const values = await this.api<any[]>("GET", "/api/trials/recent");
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 25));
        return { value: values.slice(0, limit) };
      });

    this.add(this.descriptor("rome.training.sessions", "Read training sessions", "Returns recent completed training sessions.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: await this.api("GET", "/api/sessions") }));

    this.add(this.descriptor("rome.training.calibration", "Read confidence calibration", "Returns how well stated confidence has matched actual accuracy.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: await this.api("GET", "/api/calibration") }));

    this.add(this.descriptor("rome.training.record_trial", "Record a training trial", "Records one trial result, updating domain scores and calibration.", "write", "background", [["/api/domain-scores"], ["/api/trials/recent"], ["/api/calibration"], ["/api/stats"]], [], false,
      objectSchema({ domain: string("recall, working_memory, focus, flexibility, problem_solving, creativity, intuition, or metacognition."), activityId: string("Activity identifier."), correct: boolean("Whether the response was correct."), responseTimeMs: number("Response time in milliseconds."), confidence: number("Stated confidence from 0 to 100."), difficulty: number("Difficulty from 1 to 5."), notes: string("Optional notes.") }, ["domain", "activityId", "correct"])),
      async args => {
        const domains = ["recall", "working_memory", "focus", "flexibility", "problem_solving", "creativity", "intuition", "metacognition"];
        const domain = String(args.domain);
        if (!domains.includes(domain)) throw new Error(`domain must be one of: ${domains.join(", ")}.`);
        // Recording is not reversible: the server folds each trial into running
        // domain averages and a calibration bucket, so there is nothing to undo.
        return { value: await this.api("POST", "/api/trials", {
          domain,
          activityId: requiredText(args.activityId, "activityId"),
          correct: args.correct ? 1 : 0,
          responseTimeMs: Math.max(0, Number(args.responseTimeMs) || 0),
          confidence: Math.max(0, Math.min(100, Number(args.confidence) ?? 50)),
          difficulty: Math.max(1, Math.min(5, Number(args.difficulty) || 1)),
          notes: args.notes ?? null,
        }) };
      });
  }


  /**
   * Threats — the risks and blockers tracked on the Constellation widget.
   *
   * The routes these call only reached the desktop app once they were ported
   * out of the Vercel handler into workspace-routes; before that this whole
   * surface 404'd.
   */
  private registerThreatCapabilities(): void {
    const THREATS = [["threats"]];

    this.add(this.descriptor("rome.threats.list", "List tracked threats", "Lists open and resolved threats for the active profile.", "read", "background", [], [], false,
      objectSchema({ includeResolved: boolean("Include threats already resolved.") })),
      async args => {
        const values = await this.api<any[]>("GET", "/api/threats");
        return { value: args.includeResolved ? values : values.filter(threat => !threat?.resolved) };
      });

    this.add(this.descriptor("rome.threats.create", "Track a new threat", "Records a risk or blocker with a priority from 1 to 3.", "write", "background", THREATS, [], true,
      objectSchema({ title: string("What the threat is."), priority: number("1 = highest, 3 = lowest.") }, ["title"])),
      async args => {
        const priority = Math.max(1, Math.min(3, Math.round(Number(args.priority) || 1)));
        const value = await this.api<any>("POST", "/api/threats", { title: requiredText(args.title, "title"), priority });
        return { value, undo: { method: "DELETE", path: `/api/threats/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.threats.resolve", "Resolve or reopen a threat", "Marks one threat resolved, or reopens it.", "write", "background", THREATS, [], true,
      objectSchema({ id: number("Exact threat id."), title: string("Exact threat title if the id is unknown."), resolved: boolean("True to resolve, false to reopen.") })),
      async args => {
        const existing = await this.resolveRecord("/api/threats", args, "title");
        const resolved = args.resolved === undefined ? true : Boolean(args.resolved);
        await this.api("PATCH", `/api/threats/${numericId(existing.id)}`, { resolved });
        return {
          value: { id: existing.id, resolved },
          undo: { method: "PATCH", path: `/api/threats/${numericId(existing.id)}`, body: { resolved: Boolean(existing.resolved) } },
        };
      });

    this.add(this.descriptor("rome.threats.delete", "Delete a threat", "Permanently removes one tracked threat.", "destructive", "background", THREATS, [], false,
      objectSchema({ id: number("Exact threat id."), title: string("Exact threat title if the id is unknown.") })),
      async args => {
        const existing = await this.resolveRecord("/api/threats", args, "title");
        await this.api("DELETE", `/api/threats/${numericId(existing.id)}`);
        return { value: { deleted: existing } };
      });
  }

  private addCrudCapabilities(
    noun: string,
    path: string,
    queryKeys: string[][],
    options: {
      createSchema: Record<string, unknown>;
      createBody: (args: Record<string, unknown>) => Record<string, unknown>;
      updateFields: string[];
      labelField: string;
    },
  ): void {
    const singular = noun.endsWith("s") ? noun.slice(0, -1) : noun;
    this.add(this.descriptor(`rome.${noun}.list`, `List ${noun}`, `Lists live ${noun} for the active profile.`, "read", "background", [], [], false,
      objectSchema({ query: string("Optional case-insensitive text filter.") })),
      async args => {
        const values = await this.api<any[]>("GET", path);
        const query = String(args.query ?? "").trim().toLowerCase();
        return { value: query ? values.filter(value => JSON.stringify(value).toLowerCase().includes(query)).slice(0, 50) : values.slice(0, 100) };
      });
    this.add(this.descriptor(`rome.${noun}.create`, `Create ${singular}`, `Creates one ${singular} for the active profile.`, "write", "background", queryKeys, [], true, options.createSchema),
      async args => {
        const value = await this.api<any>("POST", path, options.createBody(args));
        return { value, undo: { method: "DELETE", path: `${path}/${numericId(value?.id)}` } };
      });
    this.add(this.descriptor(`rome.${noun}.update`, `Update ${singular}`, `Updates one exact or unambiguous ${singular}.`, "write", "background", queryKeys, [], true,
      objectSchema({ id: number("Exact id."), match: string(`Exact existing ${options.labelField} if id is unknown.`), patch: { type: "object", description: `Fields to change: ${options.updateFields.join(", ")}.` } }, ["patch"])),
      async args => {
        const existing = await this.resolveRecord(path, args, options.labelField);
        const patch = pick((args.patch && typeof args.patch === "object" ? args.patch : {}) as Record<string, unknown>, options.updateFields);
        if (!Object.keys(patch).length) throw new Error("No supported update fields were provided.");
        const value = await this.api("PATCH", `${path}/${numericId(existing.id)}`, patch);
        return { value, undo: { method: "PATCH", path: `${path}/${numericId(existing.id)}`, body: pick(existing, options.updateFields) } };
      });
    this.add(this.descriptor(`rome.${noun}.delete`, `Delete ${singular}`, `Permanently deletes one exact or unambiguous ${singular}.`, "destructive", "background", queryKeys, [], false,
      objectSchema({ id: number("Exact id."), match: string(`Exact existing ${options.labelField} if id is unknown.`) })),
      async args => {
        const existing = await this.resolveRecord(path, args, options.labelField);
        await this.api("DELETE", `${path}/${numericId(existing.id)}`);
        return { value: { deleted: existing } };
      });
  }

  private async contextSnapshot(): Promise<AkiraContextSnapshot> {
    const include = this.dependencies.settings.get().privacy.includeRecentWorkspaceContext;
    const browser = this.dependencies.browser();
    const rendererContext = await this.dependencies.renderer.command("context.snapshot").catch(() => ({})) as Record<string, any>;
    const [profile, boards, tasks, today, notes, memory] = await Promise.all([
      this.api<Record<string, unknown>>("GET", "/api/active-profile").catch(() => null),
      include ? this.api<unknown[]>("GET", "/api/boards").catch(() => []) : [],
      include ? this.api<unknown[]>("GET", "/api/taskboard").catch(() => []) : [],
      include ? this.api<unknown[]>("GET", "/api/kronos/today").catch(() => []) : [],
      include ? this.api<unknown[]>("GET", "/api/notes").then(values => values.slice(0, 12)).catch(() => []) : [],
      include ? this.api<unknown[]>("GET", "/api/memory").then(values => values.slice(0, 12)).catch(() => []) : [],
    ]);
    const tabs = (browser?.tabs.getStates() ?? []).map(sanitizeBrowserMetadata);
    return {
      capturedAt: Date.now(),
      route: typeof rendererContext.route === "string" ? rendererContext.route : "unknown",
      profile,
      browser: { active: browser?.tabs.getActiveState() ? sanitizeBrowserMetadata(browser.tabs.getActiveState()!) : null, tabs },
      workspace: { boards, tasks, today, notes, memory, local: rendererContext.local ?? {} },
    };
  }

  private async resolveBoard(args: Record<string, unknown>, preferredType?: string): Promise<Record<string, any>> {
    const boards = await this.api<Record<string, any>[]>("GET", "/api/boards");
    if (args.boardId !== undefined) {
      const id = numericId(args.boardId);
      return requireSingleMatch(boards.filter(board => numericId(board.id) === id), "board");
    }
    const title = String(args.boardTitle ?? args.currentTitle ?? args.title ?? "").trim().toLowerCase();
    let matches = boards.filter(board => !title || String(board.title ?? "").trim().toLowerCase() === title);
    if (preferredType) matches = matches.filter(board => String(board.type ?? "").includes(preferredType));
    return requireSingleMatch(matches, "board");
  }

  private async resolveRecord(path: string, args: Record<string, unknown>, labelField: string): Promise<Record<string, any>> {
    const values = await this.api<Record<string, any>[]>("GET", path);
    if (args.id !== undefined) {
      const id = numericId(args.id);
      return requireSingleMatch(values.filter(value => numericId(value.id) === id), path.slice(5));
    }
    const label = String(args[labelField] ?? args.match ?? args.title ?? "").trim().toLowerCase();
    if (!label) throw new Error(`An exact id or ${labelField} is required.`);
    return requireSingleMatch(values.filter(value => String(value[labelField] ?? "").trim().toLowerCase() === label), path.slice(5));
  }

  private async ensureCalendar(): Promise<number> {
    const values = await this.api<any[]>("GET", "/api/kronos/calendars");
    if (values[0]?.id) return numericId(values[0].id);
    const value = await this.api<any>("POST", "/api/kronos/calendars", { name: "My Calendar" });
    return numericId(value?.id);
  }

  private async performUndo(id: string): Promise<unknown> {
    const record = this.dependencies.activity.getUndo(id);
    const payload = record.payload;
    let result: unknown;
    if (typeof payload.rendererAction === "string") {
      result = await this.dependencies.renderer.command(payload.rendererAction, (payload.rendererArgs ?? {}) as Record<string, unknown>);
    } else if (typeof payload.method === "string" && typeof payload.path === "string") {
      result = await this.api(payload.method, payload.path, payload.body);
    } else {
      throw new Error("The stored undo operation is invalid.");
    }
    this.dependencies.activity.markUndoUsed(id);
    return result;
  }

  private requireBrowser(): BrowserController {
    const browser = this.dependencies.browser();
    if (!browser) throw new Error("ROME's native browser is unavailable.");
    return browser;
  }

  private add(descriptor: AkiraCapabilityDescriptor, run: RegisteredCapability["run"]): void {
    if (this.capabilities.has(descriptor.name)) throw new Error(`Duplicate capability: ${descriptor.name}`);
    this.capabilities.set(descriptor.name, { descriptor, run });
  }

  private descriptor(
    name: string, title: string, description: string,
    risk: AkiraCapabilityDescriptor["risk"], visual: AkiraCapabilityDescriptor["visual"],
    queryKeys: string[][], localStores: string[], supportsUndo: boolean,
    inputSchema: Record<string, unknown>,
  ): AkiraCapabilityDescriptor {
    return { name, title, description, risk, visual, queryKeys, localStores, supportsUndo, inputSchema };
  }

  private async api<T = unknown>(method: string, pathname: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.serverBase}${pathname}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    const value = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(value?.error?.message ?? value?.error ?? value?.message ?? `ROME API returned HTTP ${response.status}.`);
    return value as T;
  }

  private async activeProfileId(): Promise<number | null> {
    const profile = await this.api<Record<string, unknown>>("GET", "/api/active-profile").catch(() => null);
    const id = Number(profile?.id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  private record(descriptor: AkiraCapabilityDescriptor, status: "denied" | "failed", error: string, profileId: number | null): void {
    this.dependencies.activity.record({
      profileId, capability: descriptor.name, summary: descriptor.title,
      risk: descriptor.risk, status, error,
    });
  }
}

function requiredText(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  return text.slice(0, 20_000);
}

function numericId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("A valid positive numeric id is required.");
  return id;
}

function pick(source: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) if (source[field] !== undefined) result[field] = source[field];
  return result;
}

function cleanRoute(value: unknown): string {
  const route = requiredText(value, "route");
  // Mirrors the routes registered in client/src/App.tsx. The training drills
  // were missing, so "take me to dual n-back" failed for no good reason.
  const allowed = new Set([
    "/athena", "/athena/dual-n-back", "/athena/cwm", "/athena/mental-math",
    "/athena/corsi", "/athena/memory-span", "/athena/pasat",
    "/philosophy", "/strategic", "/taskboard", "/kronos-keep",
    "/creative", "/idea-workshop", "/investigative", "/component-board", "/research-lab",
    "/world", "/funding", "/academia", "/settings",
  ]);
  if (!allowed.has(route)) throw new Error("That route is not an approved ROME surface.");
  return route;
}

function sanitizeBrowserMetadata(tab: {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  active?: unknown;
  loading?: unknown;
  incognito?: unknown;
  crashed?: unknown;
}): Record<string, unknown> {
  const url = typeof tab.url === "string" ? tab.url : "";
  let safeUrl = url;
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|key|secret|password|auth|session|code/i.test(key)) parsed.searchParams.set(key, "[redacted]");
    }
    safeUrl = parsed.toString().slice(0, 2_000);
  } catch {
    safeUrl = url.slice(0, 2_000);
  }
  return {
    id: String(tab.id ?? ""),
    title: String(tab.title ?? "").slice(0, 500),
    url: safeUrl,
    active: Boolean(tab.active),
    loading: Boolean(tab.loading),
    incognito: Boolean(tab.incognito),
    crashed: Boolean(tab.crashed),
  };
}
