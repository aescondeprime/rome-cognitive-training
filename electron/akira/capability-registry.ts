import type { BrowserController } from "../browser/browser-controller";
import type {
  AkiraCapabilityDescriptor,
  AkiraContextSnapshot,
  AkiraDataChanged,
  AkiraSettings,
} from "../../shared/akira";
import type { AkiraSettingsStore } from "./settings-store";
import { AkiraActivityStore } from "./activity-store";
import { AmbiguousTargetError, PermissionPolicy, matchByLabel, requireSingleMatch, validateCapabilityArguments } from "./permission-policy";
import { resolveDestination } from "./navigation";
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
  /** Resolved once; see `ensureCalendar`. */
  private calendarId: number | null = null;
  /**
   * The app's own session token, borrowed from the renderer.
   *
   * ROME's server accepts an unauthenticated call by falling back to the active
   * profile, which made every capability appear to work while writing as
   * whoever that happened to be. Reading and writing as the person actually
   * logged in is the difference between "created" and "created somewhere you
   * cannot see".
   */
  private sessionToken: string | null = null;
  private sessionTokenAt = 0;

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

    // "Navigate" and "open up …" are the same intent: take the view the user is
    // looking at and put something else in it. Which side of the app that
    // lands on — a ROME surface or a web page in the World Browser — is a
    // detail the user should not have to state, so one capability decides.
    this.add(this.descriptor("rome.navigate", "Navigate the view", "Switches what the user is looking at: a ROME surface named in plain words (Kronos Keep, Idea Workshop, Athena, Command Center), or a website, which opens in ROME's World Browser and takes the user there. Handles both \"navigate to …\" and \"open up …\".", "read", "navigate", [], [], false,
      objectSchema({
        target: string("Where to go, in the user's own words: a ROME surface name, a domain such as youtube.com, or a search."),
        route: string("Exact internal route, only when it is already known."),
      })),
      async args => {
        const destination = resolveDestination(args.target ?? args.route);
        if (destination.kind === "surface") {
          await this.dependencies.renderer.command("navigate", { route: destination.route });
          return { value: { opened: destination.name, route: destination.route } };
        }
        // Order matters: the World Browser's native view is only positioned
        // once that page has mounted, so a tab opened before the switch would
        // load behind whatever the user was looking at.
        const browser = this.requireBrowser();
        await this.dependencies.renderer.command("navigate", { route: "/world" });
        const tab = browser.createTab(destination.url) as Record<string, any> | undefined;
        return { value: { opened: destination.name, url: destination.url, tabId: tab?.id ? String(tab.id) : undefined } };
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

    this.add(this.descriptor("rome.tasks.update", "Update a task card", "Updates the text, color, pinned, or board visibility of one task card, found by its text.", "write", "background", [["/boards"]], [], true,
      objectSchema({
        content: string("The card's current text as the user said it."),
        taskId: number("Exact task id, only if one was returned earlier."),
        boardTitle: string("Board title, when more than one board could hold it."),
        newContent: string("Replacement text, only when rewording the card."),
        color: string("Color."), pinned: boolean("Pinned state."), on_board: boolean("Board visibility."),
      })),
      async args => {
        const card = await this.resolveTaskCard(args);
        const body = pick(args, ["color", "pinned", "on_board"]);
        const reworded = String(args.newContent ?? "").trim();
        if (reworded) body.content = reworded;
        if (!Object.keys(body).length) throw new Error("Nothing to change: provide newContent, color, pinned, or on_board.");
        await this.api("PATCH", `/api/tasks/${numericId(card.id)}`, body);
        return {
          value: { id: card.id, name: String(body.content ?? card.content ?? "").slice(0, 200) },
          undo: { method: "PATCH", path: `/api/tasks/${numericId(card.id)}`, body: pick(card, ["content", "color", "pinned", "on_board"]) },
        };
      });

    this.add(this.descriptor("rome.tasks.delete", "Delete a task card", "Permanently deletes one task card, found by its text.", "destructive", "background", [["/boards"]], [], false,
      objectSchema({
        content: string("The card's text as the user said it."),
        taskId: number("Exact task id, only if one was returned earlier."),
        boardTitle: string("Board title, when more than one board could hold it."),
      })),
      async args => {
        const card = await this.resolveTaskCard(args);
        await this.api("DELETE", `/api/tasks/${numericId(card.id)}`);
        return { value: { deleted: { id: card.id, name: String(card.content ?? "").slice(0, 200) } } };
      });

    // Focus tasks are addressed by name, not by id.
    //
    // These ids are uuids the user has never seen and cannot say. Requiring one
    // meant Akira had to list the queue, carry a uuid through the conversation,
    // and then read it back to confirm which task it meant — which is exactly
    // the wrong question. Every capability here takes the task's name, and
    // every result carries the name back so Akira has something speakable.
    this.add(this.descriptor("rome.stabilizer.list", "List focus tasks", "Lists the active profile's Task Stabilizer queue by name.", "read", "background", [], [], false,
      objectSchema({ includeCompleted: boolean("Include tasks already finished. Defaults to false.") })),
      async args => {
        const tasks = await this.stabilizerTasks();
        const visible = args.includeCompleted ? tasks : tasks.filter(task => !task.completedAt);
        return { value: visible.map(summariseStabilizerTask) };
      });
    this.add(this.descriptor("rome.stabilizer.create", "Add a focus task", "Adds a task to the active profile's focus queue.", "write", "background", [], ["task-stabilizer"], true,
      objectSchema({ title: string("Task name, in the user's own words.") }, ["title"])),
      async args => {
        const value = await this.dependencies.renderer.command("task-stabilizer.create", { title: requiredText(args.title, "title") });
        return { value: summariseStabilizerTask(value), undo: { rendererAction: "task-stabilizer.delete", rendererArgs: { id: (value as any)?.id } } };
      });
    this.add(this.descriptor("rome.stabilizer.complete", "Complete a focus task", "Marks one focus task finished, or reopens it, by its name.", "write", "background", [], ["task-stabilizer"], true,
      objectSchema({ title: string("The task's name as the user said it."), completed: boolean("False reopens a finished task. Defaults to true.") }, ["title"])),
      async args => {
        const task = await this.resolveStabilizerTask(args);
        const completed = args.completed === undefined ? true : Boolean(args.completed);
        const value = await this.dependencies.renderer.command("task-stabilizer.update", { id: task.id, completed });
        return {
          value: summariseStabilizerTask(value ?? { ...task, completedAt: completed ? Date.now() : null }),
          undo: { rendererAction: "task-stabilizer.update", rendererArgs: { id: task.id, completed: Boolean(task.completedAt) } },
        };
      });
    this.add(this.descriptor("rome.stabilizer.update", "Rename or complete a focus task", "Renames a focus task, or changes whether it is finished, by its name.", "write", "background", [], ["task-stabilizer"], true,
      objectSchema({
        title: string("The task's current name as the user said it."),
        id: string("Exact item id, only if one was returned earlier."),
        newTitle: string("New name, only when renaming."),
        completed: boolean("Completion state."),
      })),
      async args => {
        const task = await this.resolveStabilizerTask(args);
        const patch: Record<string, unknown> = { id: task.id };
        const renamed = String(args.newTitle ?? "").trim();
        if (renamed) patch.title = renamed;
        if (args.completed !== undefined) patch.completed = Boolean(args.completed);
        if (Object.keys(patch).length === 1) throw new Error("Provide newTitle or completed.");
        const value = await this.dependencies.renderer.command("task-stabilizer.update", patch);
        return {
          value: summariseStabilizerTask(value),
          undo: { rendererAction: "task-stabilizer.update", rendererArgs: { id: task.id, title: task.title, completed: Boolean(task.completedAt) } },
        };
      });
    this.add(this.descriptor("rome.stabilizer.delete", "Delete a focus task", "Permanently removes one focus task, by its name.", "destructive", "background", [], ["task-stabilizer"], false,
      objectSchema({ title: string("The task's name as the user said it."), id: string("Exact item id, only if one was returned earlier.") })),
      async args => {
        const task = await this.resolveStabilizerTask(args);
        await this.dependencies.renderer.command("task-stabilizer.delete", { id: task.id });
        return { value: { deleted: summariseStabilizerTask(task) } };
      });

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

    this.add(this.descriptor("rome.schedule.today", "Read today's Kronos schedule", "Reads live routines, assignments, events, and general items for a date.", "read", "background", [], [], false,
      objectSchema({ date: string("Local date in YYYY-MM-DD.") })),
      async args => ({ value: await this.api("GET", `/api/kronos/today${args.date ? `?date=${encodeURIComponent(String(args.date))}` : ""}`) }));
    this.add(this.descriptor("rome.schedule.create_assignment", "Create a Kronos assignment", "Creates a dated assignment on a Kronos calendar.", "write", "background", [["kronos-today"], ["/kronos"], ["/kronos/calendars"]], [], true,
      objectSchema({ calendarId: number("Calendar id."), title: string("Assignment title."), dueDate: string("Date YYYY-MM-DD."), date: string("Alias for dueDate."), startTime: string("Start time HH:MM, 24-hour."), endTime: string("End time HH:MM, 24-hour. Use this when the user gives a span such as five to nine."), durationMinutes: number("Duration in minutes, if no end time was given."), instructions: string("Optional instructions.") }, ["title"])),
      async args => {
        const calendarId = args.calendarId ? numericId(args.calendarId) : await this.ensureCalendar();
        const when = readSpan(args);
        const value = await this.api<any>("POST", `/api/kronos/calendars/${calendarId}/assignments`, {
          title: requiredText(args.title, "title"), due_date: when.date, start_time: when.startTime,
          duration_minutes: when.durationMinutes, instructions: args.instructions ?? "", saved: false,
        });
        return {
          value: await this.confirmScheduled(calendarId, "assignments", value, when),
          undo: { method: "DELETE", path: `/api/kronos/assignments/${numericId(value?.id)}` },
        };
      });

    this.add(this.descriptor("rome.browser.tabs", "List browser tabs", "Returns metadata for ROME's native browser tabs without page content.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: this.requireBrowser().tabs.getStates() }));
    this.add(this.descriptor("rome.browser.open", "Open a browser tab", "Opens an HTTP(S) URL or search in ROME's native browser, switching the view to it.", "read", "navigate", [], [], false,
      objectSchema({ url: string("HTTP(S) URL, domain, or search query.") }, ["url"])),
      async args => {
        const browser = this.requireBrowser();
        const url = requiredText(args.url, "url");
        await this.dependencies.renderer.command("navigate", { route: "/world" }).catch(() => undefined);
        return { value: browser.createTab(url) };
      });
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
    this.registerFocusCapabilities();
    this.registerWebCapabilities();

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
      objectSchema({ calendarId: number("Calendar id."), title: string("Routine title."), startTime: string("Start time HH:MM, 24-hour."), endTime: string("End time HH:MM, 24-hour."), durationMinutes: number("Duration in minutes, if no end time was given."), recurrence: string("daily or weekly."), daysOfWeek: { type: "array", items: { type: "number" }, description: "Weekday numbers, 0 = Sunday, when recurrence is weekly." }, notes: string("Optional notes."), startDate: string("First day the routine runs, YYYY-MM-DD. Defaults to the start of the current month."), endDate: string("Last day the routine runs, YYYY-MM-DD. Defaults to the end of the current month.") }, ["title"])),
      async args => {
        const calendarId = args.calendarId ? numericId(args.calendarId) : await this.ensureCalendar();
        const recurrence = String(args.recurrence ?? "daily") === "weekly" ? "weekly" : "daily";
        const value = await this.api<any>("POST", `/api/kronos/calendars/${calendarId}/routines`, {
          title: requiredText(args.title, "title"),
          start_time: readSpan(args).startTime,
          duration_minutes: readSpan(args).durationMinutes,
          recurrence,
          days_of_week: recurrence === "weekly" && Array.isArray(args.daysOfWeek) ? args.daysOfWeek : [],
          notes: args.notes ?? "", saved: false,
          // Unbounded by default would put the routine on every day forever in
          // both directions. Absent an explicit window, bound it to the month
          // it is being created in, which is what the page's form does too.
          start_date: args.startDate ?? monthStart(args.startDate ?? args.endDate),
          end_date: args.endDate ?? monthEnd(args.startDate ?? args.endDate),
        });
        return { value, undo: { method: "DELETE", path: `/api/kronos/routines/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.schedule.create_event", "Create a calendar event", "Creates a dated event on a Kronos calendar.", "write", "background", KRONOS, [], true,
      objectSchema({ calendarId: number("Calendar id."), title: string("Event title."), eventDate: string("Date YYYY-MM-DD."), date: string("Alias for eventDate."), startTime: string("Start time HH:MM, 24-hour."), endTime: string("End time HH:MM, 24-hour. Use this when the user gives a span such as five to nine."), durationMinutes: number("Duration in minutes, if no end time was given."), preparations: string("Optional preparation notes.") }, ["title"])),
      async args => {
        const calendarId = args.calendarId ? numericId(args.calendarId) : await this.ensureCalendar();
        const when = readSpan({ ...args, dueDate: args.eventDate ?? args.date });
        const value = await this.api<any>("POST", `/api/kronos/calendars/${calendarId}/events`, {
          title: requiredText(args.title, "title"),
          event_date: when.date,
          start_time: when.startTime,
          duration_minutes: when.durationMinutes,
          preparations: args.preparations ?? "", saved: false,
        });
        return {
          value: await this.confirmScheduled(calendarId, "events", value, when),
          undo: { method: "DELETE", path: `/api/kronos/events/${numericId(value?.id)}` },
        };
      });

    this.add(this.descriptor("rome.schedule.create_general", "Create a general calendar item", "Creates a dated general item — the neutral type, for anything that is not a routine, an assignment or an event.", "write", "background", KRONOS, [], true,
      objectSchema({ calendarId: number("Calendar id."), title: string("Item title."), itemDate: string("Date YYYY-MM-DD."), date: string("Alias for itemDate."), startTime: string("Start time HH:MM, 24-hour."), endTime: string("End time HH:MM, 24-hour."), durationMinutes: number("Duration in minutes, if no end time was given."), notes: string("Optional notes.") }, ["title"])),
      async args => {
        const calendarId = args.calendarId ? numericId(args.calendarId) : await this.ensureCalendar();
        const when = readSpan({ ...args, dueDate: args.itemDate ?? args.date });
        const value = await this.api<any>("POST", `/api/kronos/calendars/${calendarId}/generals`, {
          title: requiredText(args.title, "title"),
          item_date: when.date,
          start_time: when.startTime,
          duration_minutes: when.durationMinutes,
          notes: args.notes ?? "", saved: false,
        });
        return { value, undo: { method: "DELETE", path: `/api/kronos/generals/${numericId(value?.id)}` } };
      });

    this.add(this.descriptor("rome.schedule.find", "Find something on the calendar", "Searches every kind of Kronos item for a title, and says which calendar and day it is on. Use this when the user cannot find something, or to check where something was scheduled.", "read", "background", [], [], false,
      objectSchema({ title: string("Part of the title, in the user's words."), calendarId: number("Calendar id; every calendar is searched if omitted.") })),
      async args => {
        const label = String(args.title ?? "").trim();
        const calendars = await this.api<any[]>("GET", "/api/kronos/calendars");
        const wanted = args.calendarId ? [calendars.find(entry => numericId(entry?.id) === numericId(args.calendarId))].filter(Boolean) : calendars;
        const dateField: Record<string, string> = {
          events: "event_date", assignments: "due_date", generals: "item_date", routines: "start_date",
        };
        const found: Record<string, unknown>[] = [];
        for (const calendar of wanted.slice(0, 6)) {
          for (const kind of ["events", "assignments", "generals", "routines"] as const) {
            const rows = await this.api<any[]>("GET", `/api/kronos/calendars/${numericId(calendar.id)}/${kind}`).catch(() => []);
            for (const row of Array.isArray(rows) ? rows : []) {
              if (label && !matchByLabel([row], label, item => String(item?.title ?? "")).length) continue;
              found.push({
                kind: kind.slice(0, -1),
                title: String(row?.title ?? ""),
                calendar: String(calendar?.name ?? ""),
                day: describeDay(String(row?.[dateField[kind]] ?? "")),
                date: String(row?.[dateField[kind]] ?? ""),
                startTime: String(row?.start_time ?? ""),
                durationMinutes: Number(row?.duration_minutes ?? 0),
              });
            }
          }
        }
        found.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return { value: { matches: found.slice(0, 20), searched: wanted.length } };
      });

    this.add(this.descriptor("rome.schedule.cancel", "Cancel a scheduled item", "Deletes one routine, assignment, event, or general item by exact id.", "destructive", "background", KRONOS, [], false,
      objectSchema({ kind: string("routine, assignment, event, or general."), id: number("Exact item id.") }, ["kind", "id"])),
      async args => {
        const kind = String(args.kind);
        const plural: Record<string, string> = { routine: "routines", assignment: "assignments", event: "events", general: "generals" };
        const segment = plural[kind];
        if (!segment) throw new Error("kind must be routine, assignment, event, or general.");
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
  /**
   * The focus cycle.
   *
   * Every one of these is a thin wrapper over a renderer command, because the
   * cycle lives in the renderer's storage — the main process cannot read
   * localStorage, and duplicating the clock in two places would guarantee two
   * different answers to "how long have I got?".
   *
   * All of them are undoable, which is what lets them run without an approval
   * dialog. Nothing here is destructive: the worst case is a clock that has to
   * be restarted.
   */
  private registerFocusCapabilities(): void {
    const FOCUS_KEYS = [["kronos-today"], ["/kronos"]];

    this.add(this.descriptor("rome.focus.start", "Start a focus cycle", "Starts a timed cycle on one task, by name, creating the task if it is new. The clock runs in ROME's top bar; five minutes, one minute, and time's up are announced aloud.", "write", "background", FOCUS_KEYS, ["task-stabilizer"], true,
      objectSchema({ title: string("Task name, in the user's own words."), minutes: number("Length in minutes. Defaults to 25.") }, ["title"])),
      async args => {
        const value = await this.dependencies.renderer.command("focus.start", pick(args, ["title", "minutes"]));
        return { value, undo: { rendererAction: "focus.cancel" } };
      });

    this.add(this.descriptor("rome.focus.status", "Check the focus cycle", "Returns the running cycle's task and how much time is left, phrased for speech. Use this for any question about time remaining.", "read", "background", [], [], false, objectSchema({})),
      async () => ({ value: await this.dependencies.renderer.command("focus.status") }));

    this.add(this.descriptor("rome.focus.pause", "Pause the focus cycle", "Stops the clock without ending the cycle. Paused time is not counted against it.", "write", "background", [], ["task-stabilizer"], true,
      objectSchema({})),
      async () => ({
        value: await this.dependencies.renderer.command("focus.pause"),
        undo: { rendererAction: "focus.resume" },
      }));

    this.add(this.descriptor("rome.focus.resume", "Resume the focus cycle", "Restarts a paused clock where it stopped.", "write", "background", [], ["task-stabilizer"], true,
      objectSchema({})),
      async () => ({
        value: await this.dependencies.renderer.command("focus.resume"),
        undo: { rendererAction: "focus.pause" },
      }));

    this.add(this.descriptor("rome.focus.extend", "Add time to the focus cycle", "Adds minutes to the running cycle. Also the answer to \"no, I didn't finish\": a cycle that has run out reopens from now.", "write", "background", FOCUS_KEYS, ["task-stabilizer"], true,
      objectSchema({ minutes: number("Minutes to add.") }, ["minutes"])),
      async args => {
        const minutes = Math.round(Number(args.minutes) || 0);
        if (!minutes) throw new Error("Say how many minutes to add.");
        const value = await this.dependencies.renderer.command("focus.extend", { minutes });
        return { value, undo: { rendererAction: "focus.extend", rendererArgs: { minutes: -minutes } } };
      });

    this.add(this.descriptor("rome.focus.cancel", "Cancel the focus cycle", "Stops the cycle and leaves the task open and unfinished.", "write", "background", FOCUS_KEYS, ["task-stabilizer"], true,
      objectSchema({})),
      async () => {
        const value = await this.dependencies.renderer.command("focus.cancel") as Record<string, any>;
        return {
          value: { cancelled: value?.taskName ?? "the focus cycle" },
          // The clock is what someone wants back when they say "no, undo that";
          // the calendar row is not, so it is not recreated.
          ...(value?.taskId && value?.timer
            ? { undo: { rendererAction: "focus.restore", rendererArgs: { taskId: value.taskId, timer: value.timer } } }
            : {}),
        };
      });

    this.add(this.descriptor("rome.focus.complete", "Finish a focus task", "Marks the task finished, banks its capability credit, and squares the calendar up to the time actually spent. With no name, finishes the task the cycle is running on.", "write", "background", FOCUS_KEYS, ["task-stabilizer"], true,
      objectSchema({ title: string("Task name, if it is not the one the cycle is running on.") })),
      async args => {
        const value = await this.dependencies.renderer.command("focus.complete", pick(args, ["title"])) as Record<string, any>;
        return {
          value,
          ...(value?.taskId
            ? { undo: { rendererAction: "focus.restore_task", rendererArgs: { taskId: value.taskId } } }
            : {}),
        };
      });
  }

  /**
   * Questions ROME cannot answer from its own data.
   *
   * The ElevenLabs agent has no web access, and its model is chosen for
   * conversational latency rather than knowledge — so "what's the current
   * version of X" was answered from memory, confidently, and sometimes wrongly.
   *
   * This routes those to OpenAI's Responses API with its built-in web search,
   * using the key ROME already stores. It is billed as tokens rather than
   * conversation minutes, which is what makes it usable mid-focus-cycle: the
   * socket opens for the length of the question and closes again.
   */
  private registerWebCapabilities(): void {
    this.add(this.descriptor("rome.web.ask", "Ask the web", "Answers a question that needs current information from the internet — news, prices, releases, documentation, facts you are not certain of. Returns a short answer with its sources. Prefer this over answering from memory whenever the answer could have changed.", "read", "background", [], [], false,
      objectSchema({ question: string("The question, written out in full.") }, ["question"])),
      async args => ({ value: await this.askTheWeb(requiredText(args.question, "question")) }));
  }

  private async askTheWeb(question: string): Promise<unknown> {
    const settings = this.dependencies.settings.get();
    if (!settings.research.enabled) throw new Error("Web answers are switched off in Akira's settings.");
    const apiKey = this.dependencies.settings.getSecret("openaiApiKey");
    if (!apiKey) {
      throw new Error("No OpenAI key is configured. Tell the user to add one in Akira's Voice settings so you can search the web.");
    }

    const request = async (toolType: string) => fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: settings.research.model,
        tools: [{ type: toolType }],
        instructions: [
          "You are answering out loud through a voice assistant.",
          "Search the web when the answer could have changed, then answer in at most three sentences.",
          "No lists, no markdown, no URLs read aloud — name the source in words instead.",
          "Say plainly when the sources disagree or when you could not find it.",
        ].join(" "),
        input: question,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    // The hosted tool has been called both `web_search_preview` and
    // `web_search` while the API settled. Try the current name, and fall back
    // rather than failing on a rename that has nothing to do with the question.
    let response = await request("web_search");
    if (response.status === 400) {
      const detail = await response.clone().text().catch(() => "");
      if (/web_search/.test(detail)) response = await request("web_search_preview");
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 401) throw new Error("OpenAI rejected the stored key. It needs replacing in Akira's settings.");
      throw new Error(`The web search failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : "."}`);
    }

    const payload = await response.json().catch(() => ({} as Record<string, any>));
    const { text, sources } = readResponsesPayload(payload);
    if (!text) throw new Error("The web search came back empty. Say so rather than inventing an answer.");
    return { answer: text.slice(0, 4_000), sources: sources.slice(0, 5) };
  }

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

  private async stabilizerTasks(): Promise<Record<string, any>[]> {
    const value = await this.dependencies.renderer.command("task-stabilizer.list");
    return Array.isArray(value) ? value as Record<string, any>[] : [];
  }

  /**
   * Turn what the user said into one focus task.
   *
   * Unfinished tasks are searched first: "mark the dentist one done" is about
   * something still open far more often than something already closed. An
   * ambiguous name comes back as candidates rather than a failure, so Akira
   * can ask which one using their names.
   */
  private async resolveStabilizerTask(args: Record<string, unknown>): Promise<Record<string, any>> {
    const tasks = await this.stabilizerTasks();
    const id = String(args.id ?? "").trim();
    if (id) {
      const exact = tasks.find(task => String(task.id) === id);
      if (exact) return exact;
    }
    const label = String(args.title ?? args.match ?? args.name ?? "").trim();
    if (!label) throw new Error("Which task? Give the task's name as the user said it.");
    const open = tasks.filter(task => !task.completedAt);
    const matches = matchByLabel(open, label, task => String(task.title ?? ""));
    const searched = matches.length ? matches : matchByLabel(tasks, label, task => String(task.title ?? ""));
    if (!searched.length) throw new Error(`No focus task matches "${label.slice(0, 80)}".`);
    if (searched.length > 1) {
      throw new AmbiguousTargetError(
        searched.map(summariseStabilizerTask),
        "More than one focus task matches that name. Ask the user which one, using their names.",
      );
    }
    return searched[0];
  }

  /**
   * Turn what the user said into one task card.
   *
   * Same reasoning as the focus queue, one layer out: card ids are database
   * integers, and nobody says "update task four hundred and six".
   */
  private async resolveTaskCard(args: Record<string, unknown>): Promise<Record<string, any>> {
    if (args.taskId !== undefined) {
      const id = numericId(args.taskId);
      const boards = await this.api<Record<string, any>[]>("GET", "/api/boards");
      for (const board of boards.filter(board => String(board.type ?? "").includes("taskboard"))) {
        const cards = await this.api<Record<string, any>[]>("GET", `/api/boards/${numericId(board.id)}/tasks`).catch(() => []);
        const found = cards.find(card => numericId(card.id) === id);
        if (found) return found;
      }
      throw new Error("That task card was not found.");
    }
    const label = String(args.content ?? args.match ?? args.title ?? "").trim();
    if (!label) throw new Error("Which card? Give its text as the user said it.");
    const boards = (await this.api<Record<string, any>[]>("GET", "/api/boards"))
      .filter(board => String(board.type ?? "").includes("taskboard"));
    const wanted = String(args.boardTitle ?? "").trim().toLowerCase();
    const scoped = wanted ? boards.filter(board => String(board.title ?? "").trim().toLowerCase() === wanted) : boards;
    const cards: Record<string, any>[] = [];
    for (const board of scoped) {
      const values = await this.api<Record<string, any>[]>("GET", `/api/boards/${numericId(board.id)}/tasks`).catch(() => []);
      for (const card of values) cards.push({ ...card, boardTitle: board.title });
    }
    const matches = matchByLabel(cards, label, card => String(card.content ?? ""));
    if (!matches.length) throw new Error(`No task card matches "${label.slice(0, 80)}".`);
    if (matches.length > 1) {
      throw new AmbiguousTargetError(
        matches.map(card => ({ id: card.id, label: String(card.content ?? "").slice(0, 120), board: card.boardTitle })),
        "More than one task card matches that text. Ask the user which one, using their text.",
      );
    }
    return matches[0];
  }

  /**
   * The calendar to schedule onto, resolved once.
   *
   * This used to be a GET (and sometimes a POST) in front of every scheduling
   * call — two round trips to Supabase before the one that did the work, which
   * is most of why "schedule that for Wednesday" ran long enough for the agent
   * to give up on it. The id does not change; caching it makes scheduling a
   * single request.
   */
  private async ensureCalendar(): Promise<number> {
    if (this.calendarId !== null) return this.calendarId;
    const values = await this.api<any[]>("GET", "/api/kronos/calendars");
    if (values[0]?.id) {
      this.calendarId = numericId(values[0].id);
      return this.calendarId;
    }
    const value = await this.api<any>("POST", "/api/kronos/calendars", { name: "My Calendar" });
    this.calendarId = numericId(value?.id);
    return this.calendarId;
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

  /**
   * ROME's own data server, in this process rather than the renderer's.
   *
   * The failure text matters more than it looks: when this times out the agent
   * is told "the tool call timed out", which is indistinguishable from
   * ElevenLabs giving up on ROME. Naming which side stalled is the difference
   * between a diagnosis and another round of guessing.
   */
  private async api<T = unknown>(method: string, pathname: string, body?: unknown): Promise<T> {
    let response: Response;
    const auth = await this.authHeaders();
    try {
      response = await fetch(`${this.serverBase}${pathname}`, {
        method,
        headers: body === undefined ? auth : { ...auth, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        // Shorter than it was: past this something is wrong, and eight seconds
        // of waiting only pushes the report past the point of being useful.
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      const timedOut = error instanceof Error && /abort|timeout/i.test(error.name + error.message);
      throw new Error(timedOut
        ? `ROME's own data server did not answer within 8 seconds (${method} ${pathname}). This is ROME, not ElevenLabs — the app's server or its database is not responding.`
        : `ROME's own data server could not be reached at ${this.serverBase} (${method} ${pathname}): ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    const value = text ? safeJson(text) : null;
    if (!response.ok) {
      throw new Error(
        value?.error?.message ?? value?.error ?? value?.message
        ?? `ROME's data server returned HTTP ${response.status} for ${method} ${pathname}.`,
      );
    }
    return value as T;
  }

  /**
   * Read back what was just written, and describe it in the user's terms.
   *
   * "Successfully created" was true and useless: the row existed, on a calendar
   * and a date nobody had said out loud, and the user went looking for it on
   * the day they had in mind. One extra read turns a claim into a fact, and
   * returning the day, the time and the calendar name means Akira says the
   * three things that would have caught it.
   */
  private async confirmScheduled(
    calendarId: number,
    kind: "events" | "assignments" | "generals" | "routines",
    created: any,
    when: { date: string; startTime: string; durationMinutes: number },
  ): Promise<Record<string, unknown>> {
    const id = Number(created?.id);
    const calendars = await this.api<any[]>("GET", "/api/kronos/calendars").catch(() => []);
    const calendar = calendars.find(entry => numericId(entry?.id) === calendarId);
    const rows = await this.api<any[]>("GET", `/api/kronos/calendars/${calendarId}/${kind}`).catch(() => []);
    const found = Array.isArray(rows) ? rows.find(row => Number(row?.id) === id) : undefined;

    return {
      id: created?.id ?? null,
      title: String(created?.title ?? ""),
      calendar: String(calendar?.name ?? "your calendar"),
      // Say the weekday: the user thinks in "Wednesday", not in "2026-09-09",
      // and a date defaulted to today is exactly the mistake worth catching.
      day: describeDay(when.date),
      date: when.date,
      startTime: when.startTime,
      durationMinutes: when.durationMinutes,
      verified: Boolean(found),
      ...(found ? {} : { warning: "The row was created but did not come back when re-read. Tell the user it may not have saved." }),
    };
  }

  /**
   * The session token, cached for a minute.
   *
   * Asking the renderer on every call would put an IPC round trip in front of
   * every request; asking once and never again would survive a sign-out. A
   * minute is short enough that switching accounts settles on its own.
   */
  private async authHeaders(): Promise<Record<string, string>> {
    if (Date.now() - this.sessionTokenAt > 60_000) {
      this.sessionTokenAt = Date.now();
      try {
        const value = await this.dependencies.renderer.command("auth.token", {}, 2_000) as { token?: unknown };
        this.sessionToken = typeof value?.token === "string" && value.token ? value.token : null;
      } catch {
        // The window may not be up yet. The server's active-profile fallback
        // still applies, so this is degraded rather than broken.
        this.sessionToken = null;
      }
    }
    return this.sessionToken ? { "x-session-token": this.sessionToken } : {};
  }

  /**
   * Reachability, timed.
   *
   * Exposed so the console can ask the question directly rather than inferring
   * it from a failed voice command three layers up.
   */
  async probe(): Promise<{ ok: boolean; detail: string }> {
    const startedAt = Date.now();
    try {
      const calendars = await this.api<any[]>("GET", "/api/kronos/calendars");
      const count = Array.isArray(calendars) ? calendars.length : 0;
      const profile = await this.api<Record<string, unknown>>("GET", "/api/active-profile").catch(() => null);
      const who = profile?.name ? ` Writing as ${String(profile.name)}${this.sessionToken ? "" : " (no session token — the app's own login could differ)"}.` : "";
      const first = Array.isArray(calendars) && calendars[0]?.name ? ` First calendar: ${String(calendars[0].name)}.` : "";
      return {
        ok: true,
        detail: `ROME's data server answered in ${Date.now() - startedAt}ms (${count} calendar${count === 1 ? "" : "s"}).${first}${who}`,
      };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
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

/**
 * What a focus task looks like to the agent: a name, and a state it can say
 * out loud. The id rides along for the next call and nothing else.
 */
function summariseStabilizerTask(task: unknown): Record<string, unknown> {
  const record = (task && typeof task === "object" ? task : {}) as Record<string, any>;
  return {
    id: String(record.id ?? ""),
    name: String(record.title ?? "").slice(0, 200),
    completed: Boolean(record.completedAt),
  };
}

/**
 * Pull the answer out of an OpenAI Responses payload.
 *
 * `output_text` is an SDK convenience that the raw endpoint does not always
 * send, and the output array carries reasoning and tool-call items alongside
 * the message. Walk it rather than betting on a shape.
 */
function readResponsesPayload(payload: any): { text: string; sources: { title: string; url: string }[] } {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return { text: payload.output_text.trim(), sources: collectCitations(payload) };
  }
  const parts: string[] = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type !== "message") continue;
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return { text: parts.join(" ").trim(), sources: collectCitations(payload) };
}

function collectCitations(payload: any): { title: string; url: string }[] {
  const sources: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        const url = typeof annotation?.url === "string" ? annotation.url : "";
        if (!url || seen.has(url)) continue;
        seen.add(url);
        sources.push({ title: String(annotation.title ?? "").slice(0, 160) || url, url: url.slice(0, 500) });
      }
    }
  }
  return sources;
}

/**
 * When something is, from however the user said it.
 *
 * Speech gives spans, not durations: "five to nine on Wednesday" is a start and
 * an end, and the model passes them through as it heard them. The schema
 * rejects unknown arguments, so an `endTime` it had no way to send was refused
 * outright — the request failed, and the failure looked like the calendar being
 * broken rather than an argument name. Accepting the span and doing the
 * arithmetic here is both the fix and the more honest interface.
 */
export function readSpan(args: Record<string, unknown>): { date: string; startTime: string; durationMinutes: number } {
  const date = String(args.dueDate ?? args.date ?? "").trim() || localDate();
  const startTime = readClock(args.startTime) ?? "09:00";
  const end = readClock(args.endTime);
  const explicit = Number(args.durationMinutes);

  let durationMinutes = Number.isFinite(explicit) && explicit > 0 ? Math.round(explicit) : 0;
  if (!durationMinutes && end) {
    const span = minutesOfDay(end) - minutesOfDay(startTime);
    // A span that ends "before" it starts crossed midnight rather than being
    // nonsense — 22:00 to 01:00 is three hours.
    durationMinutes = span > 0 ? span : span + 24 * 60;
  }
  return {
    date,
    startTime,
    durationMinutes: Math.max(1, Math.min(24 * 60, durationMinutes || 60)),
  };
}

/** Accept 17:00, 5:00 PM, 5pm, 1700 — all of which the model has produced. */
function readClock(value: unknown): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  const match = text.match(/^(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) return null;
  if (match[3] === "pm" && hours < 12) hours += 12;
  if (match[3] === "am" && hours === 12) hours = 0;
  if (hours > 23) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function minutesOfDay(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

/** "Wednesday 9 September", or "today" when that is what it is. */
export function describeDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const when = new Date(`${date}T12:00:00`);
  const today = localDate();
  if (date === today) return "today";
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date === localDate(tomorrow)) return "tomorrow";
  return when.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** A body that is not JSON is a fact about the failure, not a crash. */
function safeJson(text: string): any {
  try { return JSON.parse(text); }
  catch { return { message: text.slice(0, 300) }; }
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

/** First day of the month containing `dateStr`, or of today. */
function monthStart(dateStr?: unknown): string {
  const d = typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(`${dateStr}T12:00:00`) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Last day of the month containing `dateStr`, or of today. */
function monthEnd(dateStr?: unknown): string {
  const d = typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(`${dateStr}T12:00:00`) : new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}
