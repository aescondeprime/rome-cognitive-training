import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  CircleStop,
  Database,
  KeyRound,
  Mic,
  MicOff,
  PanelRightOpen,
  RotateCw,
  Send,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  X,
} from "lucide-react";
import type { AkiraActivityEntry, AkiraCapabilityDescriptor, AkiraSettings, AkiraState } from "@shared/akira";
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

export default function AkiraAura() {
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
      void akira.callCapability("rome.memory.list", {}).then((value: any) => setMemory(value?.result ?? [])).catch(error => setError(String(error?.message ?? error)));
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
    root.style.setProperty("--akira-gradient-a", status.settings.appearance.gradientA);
    root.style.setProperty("--akira-gradient-b", status.settings.appearance.gradientB);
    root.style.setProperty("--akira-intensity", String(status.settings.appearance.intensity));
    root.style.setProperty("--akira-animation-strength", String(status.settings.appearance.animationStrength));
    root.dataset.romeAkiraSize = status.settings.appearance.auraSize;
    root.dataset.romeAkiraReduceMotion = status.settings.appearance.reduceMotion ? "true" : "false";
    return () => {
      root.style.removeProperty("--akira-gradient-a");
      root.style.removeProperty("--akira-gradient-b");
      root.style.removeProperty("--akira-intensity");
      root.style.removeProperty("--akira-animation-strength");
      delete root.dataset.romeAkiraSize;
      delete root.dataset.romeAkiraReduceMotion;
    };
  }, [status?.settings.appearance]);

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

  const primaryAction = () => {
    if (state === "UNAVAILABLE" || state === "ERROR") {
      setPanelOpen(true);
      setTab("diagnostics");
    } else if (state === "DORMANT" || !akira.microphoneArmed) {
      void run(akira.activate);
    } else if (state === "SPEAKING") {
      void run(akira.interrupt);
    } else {
      setPanelOpen(true);
      setTab("conversation");
    }
  };

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
      <div className={`akira-dock akira-state-${state.toLowerCase()}`} data-testid="akira-aura">
        <button
          className="akira-aura"
          onClick={primaryAction}
          aria-label={state === "DORMANT" ? "Activate Akira" : state === "SPEAKING" ? "Interrupt Akira" : "Open Akira"}
          title={status?.reason || `Akira · ${label}`}
        >
          <span className="akira-aura-orbit" />
          <span className="akira-aura-core">{state === "LISTENING" ? <Mic size={17} /> : state === "SPEAKING" ? <CircleStop size={15} /> : <Bot size={16} />}</span>
        </button>
        <button className="akira-dock-label" onClick={() => setPanelOpen(!panelOpen)}>
          <span>AKIRA</span>
          <small>{label}</small>
          <PanelRightOpen size={11} />
        </button>
      </div>

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
            <TabButton active={tab === "conversation"} onClick={() => setTab("conversation")} icon={<Bot size={12} />} label="Talk" />
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
                      <p>While Akira is in Standby, say “Akira” or type below.</p>
                      <small>Dormant audio stays on-device. Control+Escape returns to standby.</small>
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
                <SettingGroup title="Voice">
                  <Toggle label="Voice responses" checked={draft.voice.enabled} onChange={checked => setDraft({ ...draft, voice: { ...draft.voice, enabled: checked } })} />
                  <LabeledInput label="ElevenLabs voice ID" value={draft.voice.voiceId} onChange={value => setDraft({ ...draft, voice: { ...draft.voice, voiceId: value } })} />
                  <RangeInput label="Speech speed" value={draft.voice.speed} min={0.7} max={1.2} step={0.05} onChange={value => setDraft({ ...draft, voice: { ...draft.voice, speed: value } })} />
                  <RangeInput label="Playback volume" value={draft.voice.volume} min={0} max={1} step={0.05} onChange={value => setDraft({ ...draft, voice: { ...draft.voice, volume: value } })} />
                  <LabeledInput label={`ElevenLabs API key · ${status.settings.secrets.elevenLabsConfigured ? "configured" : "not configured"}`} value={elevenKey} onChange={setElevenKey} password placeholder="Stored encrypted; never shown again" />
                </SettingGroup>
                <SettingGroup title="Input">
                  <Toggle label="Local wake word “Akira”" checked={draft.input.wakeWordEnabled} onChange={checked => setDraft({ ...draft, input: { ...draft.input, wakeWordEnabled: checked } })} />
                  <Toggle label="Barge-in interruption" checked={draft.input.bargeInEnabled} onChange={checked => setDraft({ ...draft, input: { ...draft.input, bargeInEnabled: checked } })} />
                  <Toggle label="Wake when ROME is unfocused (advanced)" checked={draft.input.wakeWhenUnfocused} onChange={checked => setDraft({ ...draft, input: { ...draft.input, wakeWhenUnfocused: checked } })} />
                  <RangeInput label="Wake strictness" value={draft.input.wakeSensitivity} min={0} max={1} step={0.05} onChange={value => setDraft({ ...draft, input: { ...draft.input, wakeSensitivity: value } })} />
                  <label className="akira-field"><span>Local speech model</span><select value={draft.input.sttModel} onChange={event => setDraft({ ...draft, input: { ...draft.input, sttModel: event.target.value as "tiny" | "base" } })}><option value="base">Base · recommended</option><option value="tiny">Tiny · lower memory</option></select></label>
                  <label className="akira-field"><span>Standby shortcut</span><select value={draft.input.deactivationShortcut} onChange={event => setDraft({ ...draft, input: { ...draft.input, deactivationShortcut: event.target.value as AkiraSettings["input"]["deactivationShortcut"] } })}><option value="Control+Escape">Control + Escape</option><option value="Control+Shift+Escape">Control + Shift + Escape</option></select></label>
                </SettingGroup>
                <SettingGroup title="Appearance">
                  <label className="akira-field"><span>Aura size</span><select value={draft.appearance.auraSize} onChange={event => setDraft({ ...draft, appearance: { ...draft.appearance, auraSize: event.target.value as AkiraSettings["appearance"]["auraSize"] } })}><option value="compact">Compact</option><option value="standard">Standard</option><option value="large">Large</option></select></label>
                  <ColorInput label="Gradient A" value={draft.appearance.gradientA} onChange={value => setDraft({ ...draft, appearance: { ...draft.appearance, gradientA: value } })} />
                  <ColorInput label="Gradient B" value={draft.appearance.gradientB} onChange={value => setDraft({ ...draft, appearance: { ...draft.appearance, gradientB: value } })} />
                  <RangeInput label="Aura intensity" value={draft.appearance.intensity} min={0.2} max={1} step={0.05} onChange={value => setDraft({ ...draft, appearance: { ...draft.appearance, intensity: value } })} />
                  <RangeInput label="Animation strength" value={draft.appearance.animationStrength} min={0} max={1} step={0.05} onChange={value => setDraft({ ...draft, appearance: { ...draft.appearance, animationStrength: value } })} />
                  <Toggle label="Reduce Aura motion" checked={draft.appearance.reduceMotion} onChange={checked => setDraft({ ...draft, appearance: { ...draft.appearance, reduceMotion: checked } })} />
                </SettingGroup>
                <SettingGroup title="Agent">
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

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
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

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="akira-field"><span>{label}</span><input type="color" value={value} onChange={event => onChange(event.target.value)} /></label>;
}
