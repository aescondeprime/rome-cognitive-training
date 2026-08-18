/**
 * AkiraConsole — transcript, settings, memory, activity, and health.
 *
 * This was `AkiraAura` in V2, which rendered a permanent orb and an "AKIRA /
 * Standby" label bar docked in the lower right of every screen. Both are gone.
 * The console is now summoned (Command+Shift+' by default, or from Settings)
 * and mounts nothing at all when closed.
 *
 * The approval dialog is the one exception: it stays mounted regardless,
 * because a destructive action needs to interrupt by design.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  Check,
  Database,
  Mic,
  MicOff,
  RotateCw,
  Send,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  AKIRA_SHORTCUT_CHOICES,
  type AkiraActivityEntry,
  type AkiraCapabilityDescriptor,
  type AkiraSettings,
  type AkiraShortcut,
  type AkiraState,
} from "@shared/akira";
import { useAkira } from "./AkiraProvider";

type PanelTab = "conversation" | "settings" | "memory" | "activity" | "diagnostics";

const stateLabel: Record<AkiraState, string> = {
  DORMANT: "Standby",
  WAKE_DETECTED: "Awake",
  LISTENING: "Listening",
  PROCESSING: "Thinking",
  SPEAKING: "Speaking",
  ACTING: "Acting",
  AWAITING_APPROVAL: "Approval",
  AWAKE_IDLE: "Awake",
  DEACTIVATING: "Standing by",
  ERROR: "Error",
  UNAVAILABLE: "Unavailable",
};

/** Human-readable accelerator, e.g. "Command+'" → "⌘ '". */
function shortcutLabel(value: string): string {
  return value
    .replace(/Command/gi, "⌘")
    .replace(/Control/gi, "⌃")
    .replace(/Shift/gi, "⇧")
    .replace(/Alt|Option/gi, "⌥")
    .replace(/\+/g, " ");
}

export default function AkiraConsole() {
  const akira = useAkira();
  const { status, panelOpen, setPanelOpen } = akira;
  const [tab, setTab] = useState<PanelTab>("conversation");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<AkiraActivityEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [memory, setMemory] = useState<unknown[]>([]);
  const [capabilities, setCapabilities] = useState<AkiraCapabilityDescriptor[]>([]);
  const [elevenKey, setElevenKey] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [draft, setDraft] = useState<AkiraSettings | null>(null);

  useEffect(() => {
    if (status) setDraft(status.settings);
  }, [status?.settings]);

  useEffect(() => {
    if (!panelOpen) return;
    if (tab === "activity") void akira.loadActivity().then(setActivity);
    if (tab === "diagnostics") void akira.loadDiagnostics().then(setDiagnostics);
    if (tab === "settings") void akira.loadCapabilities().then(setCapabilities);
    if (tab === "memory") {
      // rome.memory.list is not registered until Phase 3; fail soft rather than
      // throwing an unhandled rejection into the panel.
      void akira
        .callCapability("rome.memory.list", {})
        .then((value: any) => setMemory(value?.result ?? []))
        .catch(() => setMemory([]));
    }
  }, [akira, panelOpen, tab]);

  useEffect(() => {
    const visible = panelOpen || Boolean(akira.approval);
    document.documentElement.dataset.romeAkiraPanelOpen = visible ? "true" : "false";
    window.dispatchEvent(new CustomEvent("rome:akira-panel-visibility", { detail: { visible } }));
    return () => { delete document.documentElement.dataset.romeAkiraPanelOpen; };
  }, [akira.approval, panelOpen]);

  useEffect(() => {
    if (!status) return;
    const root = document.documentElement;
    root.dataset.romeAkiraReduceMotion = status.settings.appearance.reduceMotion ? "true" : "false";
    return () => { delete root.dataset.romeAkiraReduceMotion; };
  }, [status?.settings.appearance.reduceMotion]);

  if (!window.romeDesktop?.isDesktop) return null;
  const state = status?.state ?? "UNAVAILABLE";
  const label = stateLabel[state];
  const turnBusy = state === "PROCESSING" || state === "ACTING" || state === "AWAITING_APPROVAL";

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const submit = () => run(async () => {
    if (turnBusy) return;
    const text = message.trim();
    if (!text) return;
    setMessage("");
    await akira.submitText(text);
  });

  const saveSettings = () => run(async () => {
    if (!draft || !status) return;
    await akira.updateSettings(draft);
    if (elevenKey.trim()) {
      await akira.setSecret("elevenLabsApiKey", elevenKey);
      setElevenKey("");
    }
    if (providerKey.trim()) {
      await akira.setSecret(`${draft.agent.provider}ApiKey`, providerKey);
      setProviderKey("");
    }
  });

  return (
    <>
      {panelOpen && (
        <aside className="akira-panel" aria-label="Akira console">
          <header className="akira-panel-header">
            <div>
              <strong>AKIRA</strong>
              <span><i className={`akira-status-dot state-${state.toLowerCase()}`} /> {label}</span>
            </div>
            <button onClick={() => setPanelOpen(false)} aria-label="Close Akira"><X size={15} /></button>
          </header>

          <nav className="akira-tabs" aria-label="Akira sections">
            <TabButton active={tab === "conversation"} onClick={() => setTab("conversation")} icon={<Mic size={12} />} label="Talk" />
            <TabButton active={tab === "settings"} onClick={() => setTab("settings")} icon={<Settings2 size={12} />} label="Settings" />
            <TabButton active={tab === "memory"} onClick={() => setTab("memory")} icon={<Database size={12} />} label="Memory" />
            <TabButton active={tab === "activity"} onClick={() => setTab("activity")} icon={<Activity size={12} />} label="Activity" />
            <TabButton active={tab === "diagnostics"} onClick={() => setTab("diagnostics")} icon={<TerminalSquare size={12} />} label="Health" />
          </nav>

          {error && <div className="akira-error"><X size={11} /> {error}</div>}
          {status?.reason && <div className="akira-notice">{status.reason}</div>}

          <div className="akira-panel-body">
            {tab === "conversation" && (
              <section className="akira-conversation">
                <div className="akira-transcript" aria-live="polite">
                  {akira.transcripts.length === 0 ? (
                    <div className="akira-empty">
                      <ShieldCheck size={24} />
                      <p>Say “Akira” to begin, or type below.</p>
                      <small>
                        {shortcutLabel(status?.settings.input.conversationShortcut ?? "Command+'")} starts and ends a conversation.
                      </small>
                    </div>
                  ) : akira.transcripts.map((entry, index) => (
                    <div key={`${entry.at}-${index}`} className={`akira-message ${entry.role}`}>
                      <span>{entry.role === "user" ? "YOU" : entry.role === "assistant" ? "AKIRA" : "SYSTEM"}</span>
                      <p>{entry.text}</p>
                    </div>
                  ))}
                </div>
                <div className="akira-compose">
                  <textarea
                    value={message}
                    onChange={event => setMessage(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
                    }}
                    placeholder="Ask Akira to work in ROME…"
                    rows={2}
                  />
                  <button disabled={busy || turnBusy || !message.trim() || !status?.available} onClick={() => void submit()} aria-label="Send"><Send size={14} /></button>
                </div>
                <div className="akira-actions">
                  <button disabled={busy || turnBusy || !status?.available} onClick={() => void run(akira.activate)}><Mic size={12} /> Listen</button>
                  <button disabled={busy || state === "DORMANT"} onClick={() => void run(akira.standby)}><MicOff size={12} /> Standby</button>
                </div>
              </section>
            )}

            {tab === "settings" && draft && status && (
              <section className="akira-settings">
                <SettingGroup title="Conversation">
                  <p className="akira-section-note">
                    Akira talks through an ElevenLabs agent. Create one from a blank template,
                    leave its first message empty, and paste its ID here.
                  </p>
                  <LabeledInput
                    label="ElevenLabs agent ID"
                    value={draft.realtime.agentId}
                    onChange={value => setDraft({ ...draft, realtime: { ...draft.realtime, agentId: value.trim() } })}
                    placeholder="agent_…"
                  />
                  <LabeledInput
                    label={`ElevenLabs API key · ${status.settings.secrets.elevenLabsConfigured ? "configured" : "not configured"}`}
                    value={elevenKey}
                    onChange={setElevenKey}
                    password
                    placeholder="Stored encrypted; never shown again"
                  />
                  <Toggle
                    label="Acknowledge when woken (“Yes?”)"
                    checked={draft.realtime.greetingEnabled}
                    onChange={checked => setDraft({ ...draft, realtime: { ...draft.realtime, greetingEnabled: checked } })}
                  />
                  <Toggle
                    label="Share what you're looking at as you move around ROME"
                    checked={draft.realtime.shareLiveContext}
                    onChange={checked => setDraft({ ...draft, realtime: { ...draft.realtime, shareLiveContext: checked } })}
                  />
                </SettingGroup>
                <SettingGroup title="Voice">
                  <Toggle label="Voice responses" checked={draft.voice.enabled} onChange={checked => setDraft({ ...draft, voice: { ...draft.voice, enabled: checked } })} />
                  <LabeledInput label="ElevenLabs voice ID" value={draft.voice.voiceId} onChange={value => setDraft({ ...draft, voice: { ...draft.voice, voiceId: value } })} />
                  <RangeInput label="Speech speed" value={draft.voice.speed} min={0.7} max={1.2} step={0.05} onChange={value => setDraft({ ...draft, voice: { ...draft.voice, speed: value } })} />
                  <RangeInput label="Playback volume" value={draft.voice.volume} min={0} max={1} step={0.05} onChange={value => setDraft({ ...draft, voice: { ...draft.voice, volume: value } })} />
                  <p className="akira-section-note">
                    Voice and speech model are chosen on the agent in the ElevenLabs dashboard.
                  </p>
                </SettingGroup>
                <SettingGroup title="Input">
                  <Toggle label="Local wake word “Akira”" checked={draft.input.wakeWordEnabled} onChange={checked => setDraft({ ...draft, input: { ...draft.input, wakeWordEnabled: checked } })} />
                  <Toggle label="Barge-in interruption" checked={draft.input.bargeInEnabled} onChange={checked => setDraft({ ...draft, input: { ...draft.input, bargeInEnabled: checked } })} />
                  <Toggle label="Wake when ROME is unfocused (advanced)" checked={draft.input.wakeWhenUnfocused} onChange={checked => setDraft({ ...draft, input: { ...draft.input, wakeWhenUnfocused: checked } })} />
                  <RangeInput label="Wake strictness" value={draft.input.wakeSensitivity} min={0} max={1} step={0.05} onChange={value => setDraft({ ...draft, input: { ...draft.input, wakeSensitivity: value } })} />
                  <label className="akira-field"><span>Local speech model</span><select value={draft.input.sttModel} onChange={event => setDraft({ ...draft, input: { ...draft.input, sttModel: event.target.value as "tiny" | "base" } })}><option value="base">Base · recommended</option><option value="tiny">Tiny · lower memory</option></select></label>
                  <ShortcutSelect
                    label="Conversation toggle"
                    value={draft.input.conversationShortcut}
                    exclude={draft.input.consoleShortcut}
                    onChange={value => setDraft({ ...draft, input: { ...draft.input, conversationShortcut: value } })}
                  />
                  <ShortcutSelect
                    label="Open this console"
                    value={draft.input.consoleShortcut}
                    exclude={draft.input.conversationShortcut}
                    onChange={value => setDraft({ ...draft, input: { ...draft.input, consoleShortcut: value } })}
                  />
                </SettingGroup>
                <SettingGroup title="Appearance">
                  <p className="akira-section-note">
                    Akira has no permanent interface. A live conversation is shown by the background
                    gradient — set its colors in the Constellation editor (open the Constellation, press E).
                  </p>
                  <RangeInput label="Glow intensity" value={draft.appearance.intensity} min={0.2} max={1} step={0.05} onChange={value => setDraft({ ...draft, appearance: { ...draft.appearance, intensity: value } })} />
                  <RangeInput label="Animation strength" value={draft.appearance.animationStrength} min={0} max={1} step={0.05} onChange={value => setDraft({ ...draft, appearance: { ...draft.appearance, animationStrength: value } })} />
                  <Toggle label="Reduce motion" checked={draft.appearance.reduceMotion} onChange={checked => setDraft({ ...draft, appearance: { ...draft.appearance, reduceMotion: checked } })} />
                </SettingGroup>
                <SettingGroup title="Background work (optional)">
                  <p className="akira-section-note">
                    Hermes handles long multi-step tasks in the background so they don't block the
                    conversation. Akira works without it; leave this alone unless you've installed it.
                  </p>
                  <label className="akira-field"><span>Cloud provider</span><select value={draft.agent.provider} onChange={event => setDraft({ ...draft, agent: { ...draft.agent, provider: event.target.value as AkiraSettings["agent"]["provider"] } })}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openrouter">OpenRouter</option></select></label>
                  <LabeledInput label="Model" value={draft.agent.model} onChange={value => setDraft({ ...draft, agent: { ...draft.agent, model: value } })} />
                  <LabeledInput label={`${draft.agent.provider} API key · ${status.settings.secrets.providerConfigured ? "configured" : "not configured"}`} value={providerKey} onChange={setProviderKey} password placeholder="Stored encrypted; never shown again" />
                </SettingGroup>
                <SettingGroup title="Privacy">
                  <Toggle label="Allow sanitized active-page reading" checked={draft.privacy.allowActivePageReading} onChange={checked => setDraft({ ...draft, privacy: { ...draft.privacy, allowActivePageReading: checked } })} />
                  <Toggle label="Include recent live workspace context" checked={draft.privacy.includeRecentWorkspaceContext} onChange={checked => setDraft({ ...draft, privacy: { ...draft.privacy, includeRecentWorkspaceContext: checked } })} />
                </SettingGroup>
                <SettingGroup title="Capability permissions">
                  <p className="akira-section-note">Writes ask by default. Destructive, financial, and bulk actions still require approval even if marked Allow.</p>
                  {capabilities.filter(capability => capability.risk !== "read" && capability.name !== "rome.undo").map(capability => (
                    <label className="akira-permission" key={capability.name}>
                      <span><strong>{capability.title}</strong><small>{capability.risk} · {capability.visual}</small></span>
                      <select
                        value={draft.permissions[capability.name] ?? "ask"}
                        onChange={event => setDraft({
                          ...draft,
                          permissions: { ...draft.permissions, [capability.name]: event.target.value as "ask" | "allow" | "deny" },
                        })}
                      >
                        <option value="ask">Ask</option>
                        <option value="allow">Allow</option>
                        <option value="deny">Deny</option>
                      </select>
                    </label>
                  ))}
                </SettingGroup>
                <button className="akira-primary" disabled={busy} onClick={() => void saveSettings()}><Check size={13} /> Save settings</button>
              </section>
            )}

            {tab === "memory" && (
              <section className="akira-list">
                <p className="akira-section-note">Profile-scoped ROME memory. Akira reads this live; it does not silently copy it into renderer storage.</p>
                {memory.length === 0 ? <div className="akira-empty"><Database size={20} /><p>No saved memories.</p></div> : memory.map((item: any) => <article key={item.id}><strong>{item.title || item.category || `Memory ${item.id}`}</strong><p>{item.content}</p></article>)}
              </section>
            )}

            {tab === "activity" && (
              <section className="akira-list">
                {activity.length === 0 ? <div className="akira-empty"><Activity size={20} /><p>No Akira actions recorded.</p></div> : activity.map(entry => (
                  <article key={entry.id}>
                    <strong>{entry.summary}</strong>
                    <span>{entry.status} · {entry.risk} · {new Date(entry.finishedAt).toLocaleString()}</span>
                    {entry.error && <p>{entry.error}</p>}
                    {entry.undoId && <button onClick={() => void run(async () => { await akira.callCapability("rome.undo", { undoId: entry.undoId }); setActivity(await akira.loadActivity()); })}><RotateCw size={11} /> Undo</button>}
                  </article>
                ))}
              </section>
            )}

            {tab === "diagnostics" && (
              <section className="akira-diagnostics">
                <dl>
                  <dt>Runtime</dt><dd>{status?.runtime.phase ?? "unknown"}</dd>
                  <dt>Version</dt><dd>{status?.runtime.version ?? "not detected"}</dd>
                  <dt>Gateway</dt><dd>{status?.available ? "connected" : "offline"}</dd>
                  <dt>Microphone</dt><dd>{akira.microphoneArmed ? "armed" : "not armed"}</dd>
                  <dt>Secure storage</dt><dd>{status?.settings.secrets.secureStorageAvailable ? "available" : "unavailable"}</dd>
                </dl>
                <button className="akira-primary" disabled={busy} onClick={() => void run(akira.installRuntime)}><RotateCw size={13} /> Install / repair runtime</button>
                {diagnostics && <pre>{JSON.stringify(diagnostics, null, 2)}</pre>}
              </section>
            )}
          </div>
        </aside>
      )}

      {akira.approval && (
        <div className="akira-approval-backdrop" role="dialog" aria-modal="true" aria-label="Akira action approval">
          <section className="akira-approval-card">
            <ShieldCheck size={24} />
            <small>{akira.approval.risk.toUpperCase()} ACTION</small>
            <h2>{akira.approval.title}</h2>
            <p>{akira.approval.summary}</p>
            <pre>{JSON.stringify(akira.approval.arguments, null, 2)}</pre>
            <div>
              <button onClick={() => void akira.respondToApproval(false)}>Decline</button>
              <button className="approve" onClick={() => void akira.respondToApproval(true)}>Approve once</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset><legend>{title}</legend>{children}</fieldset>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="akira-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><i /></label>;
}

function LabeledInput({ label, value, onChange, password, placeholder }: { label: string; value: string; onChange: (value: string) => void; password?: boolean; placeholder?: string }) {
  return <label className="akira-field"><span>{label}</span><input type={password ? "password" : "text"} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" /></label>;
}

function RangeInput({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="akira-field"><span>{label} · {value.toFixed(step < 0.1 ? 2 : 1)}</span><input type="range" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} /></label>;
}

/** Accelerator picker that refuses to let both shortcuts collide. */
function ShortcutSelect({
  label,
  value,
  exclude,
  onChange,
}: {
  label: string;
  value: AkiraShortcut;
  exclude: AkiraShortcut;
  onChange: (value: AkiraShortcut) => void;
}) {
  return (
    <label className="akira-field">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value as AkiraShortcut)}>
        {AKIRA_SHORTCUT_CHOICES.filter(choice => choice === value || choice !== exclude).map(choice => (
          <option key={choice} value={choice}>{shortcutLabel(choice)}</option>
        ))}
      </select>
    </label>
  );
}
