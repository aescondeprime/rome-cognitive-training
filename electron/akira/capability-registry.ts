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

    this.add(this.descriptor("rome.navigate", "Open a ROME surface", "Navigates ROME to a named internal route. Projects and Idea Workshop use /idea-workshop.", "read", "navigate", [], [], false,
      objectSchema({ route: string("Internal ROME route, such as /idea-workshop, /taskboard, or /kronos-keep.") }, ["route"])),
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

    this.add(this.descriptor("rome.undo", "Undo an Akira action", "Applies a still-valid compensating action from the Akira activity log.", "write", "background", [["/api/boards"], ["/api/notes"], ["/api/memory"], ["/kronos"]], ["task-stabilizer", "finance"], false,
      objectSchema({ undoId: string("Undo id returned by a prior action.") }, ["undoId"])),
      async args => ({ value: await this.performUndo(requiredText(args.undoId, "undoId")) }));
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
  const allowed = new Set([
    "/athena", "/philosophy", "/strategic", "/taskboard", "/kronos-keep",
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
