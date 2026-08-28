/**
 * Connecting Kronos Keep to an iCloud calendar.
 *
 * This is the credential half of the sync, brought forward ahead of the engine
 * so there is somewhere to put an Apple ID that is not a shell prompt.
 *
 * ── What it does and does not do ────────────────────────────────────────────
 *
 * It establishes and proves the connection: stores the Apple ID, stores an
 * app-specific password through Electron `safeStorage`, logs in, lists the
 * calendars that can hold events, and optionally creates an empty one.
 *
 * **It does not sync anything.** No ROME item is written to iCloud and no
 * iCloud event is read into ROME. That is the engine, and it arrives with a
 * dry-run confirmation in front of it. The panel says so plainly rather than
 * leaving someone to discover it by watching an empty calendar — a setup screen
 * that implies more than it does is how you get a bug report about missing
 * events that were never sent.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Check, ExternalLink, Eye, Loader2, Lock, Plus, RefreshCw,
  Unlink, UploadCloud, X,
} from "lucide-react";
import { motion } from "framer-motion";
import { GOLD } from "@/lib/kronosTypes";

const CAVE = "hsl(222 14% 9%)";
const HAIRLINE = "hsl(220 15% 14%)";
const MUTED = "hsl(220 8% 52%)";
const FAINT = "hsl(220 8% 36%)";

const inputCls =
  "w-full bg-[hsl(220_15%_6%)] border border-[hsl(220_15%_14%)] rounded-lg px-3 py-2 text-sm " +
  "text-foreground focus:outline-none focus:border-[hsl(220_30%_28%)] transition-colors " +
  "placeholder:text-muted-foreground/30";
const labelCls =
  "block text-[9px] font-mono tracking-widest uppercase text-muted-foreground/60 mb-1";

type Config = RomeKronosConfig;
type Verify = RomeKronosVerifyResult;

export default function CalendarSyncPanel({ onClose }: { onClose: () => void }) {
  const bridge = window.romeDesktop?.kronos;

  const [config, setConfig] = useState<Config | null>(null);
  const [appleId, setAppleId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"" | "verifying" | "creating" | "saving" | "previewing" | "pushing">("");
  const [result, setResult] = useState<Verify | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<RomeKronosSyncStatus | null>(null);
  // The dry run. Holding it in state is what makes "Send" mean *this* plan
  // rather than whatever the plan happens to be a few seconds later.
  const [preview, setPreview] = useState<RomeKronosCycleReport | null>(null);
  const [pushed, setPushed] = useState<RomeKronosCycleReport | null>(null);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getConfig().then(next => {
      setConfig(next);
      setAppleId(next.appleId);
    }).catch(() => setError("Could not read the calendar settings."));
    void bridge.syncStatus().then(setStatus).catch(() => undefined);
    return bridge.onSyncStatus(setStatus);
  }, [bridge]);

  const verify = useCallback(async () => {
    if (!bridge) return;
    setError("");
    setBusy("verifying");
    try {
      // Persist first: `verify` reads what is stored rather than taking the
      // password as an argument, so the credential crosses the bridge exactly
      // once and only in the direction that writes it.
      await bridge.updateConfig({ appleId: appleId.trim() });
      if (password.trim()) await bridge.setPassword(password.trim());
      setPassword("");
      const outcome = await bridge.verify();
      setResult(outcome);
      setConfig(await bridge.getConfig());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed.");
    } finally {
      setBusy("");
    }
  }, [bridge, appleId, password]);

  const chooseCalendar = useCallback(async (href: string, name: string) => {
    if (!bridge) return;
    setBusy("saving");
    try {
      setConfig(await bridge.updateConfig({ calendarHref: href, calendarName: name, enabled: true }));
    } finally {
      setBusy("");
    }
  }, [bridge]);

  const createCalendar = useCallback(async () => {
    if (!bridge) return;
    setBusy("creating");
    setError("");
    try {
      const outcome = await bridge.createCalendar("ROME");
      setResult(outcome);
      const next = await bridge.getConfig();
      if (outcome.ok && next.calendarHref) {
        setConfig(await bridge.updateConfig({ enabled: true }));
      } else {
        setConfig(next);
      }
    } finally {
      setBusy("");
    }
  }, [bridge]);

  const runPreview = useCallback(async () => {
    if (!bridge) return;
    setBusy("previewing");
    setPushed(null);
    setError("");
    try {
      setPreview(await bridge.syncNow(true));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not work out what to send.");
    } finally {
      setBusy("");
    }
  }, [bridge]);

  const runPush = useCallback(async () => {
    if (!bridge) return;
    setBusy("pushing");
    setError("");
    try {
      const report = await bridge.syncNow(false);
      setPushed(report);
      setPreview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The sync could not run.");
    } finally {
      setBusy("");
    }
  }, [bridge]);

  const disconnect = useCallback(async () => {
    if (!bridge) return;
    setResult(null);
    setPassword("");
    setConfig(await bridge.disconnect());
  }, [bridge]);

  // `npm run dev` in a browser has no bridge at all. Render nothing rather
  // than a panel whose every control throws.
  if (!bridge) return null;

  const connected = Boolean(config?.enabled && config.calendarHref);
  const calendars = result?.ok ? result.calendars : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="relative rounded-2xl border w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        style={{ background: CAVE, borderColor: HAIRLINE }}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: HAIRLINE }}>
          <div>
            <h2 className="text-sm font-bold" style={{ fontFamily: "Cinzel, serif", color: GOLD }}>
              Apple Calendar
            </h2>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: MUTED }}>
              {connected ? `Linked to ${config?.calendarName || "a calendar"}` : "Not connected"}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* The honest banner. Setup is not sync. */}
          <div
            className="flex gap-2.5 rounded-lg px-3 py-2.5"
            style={{ background: "hsl(43 40% 10% / 0.5)", border: `1px solid ${GOLD}28` }}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: GOLD }} />
            <p className="text-[11px] leading-relaxed" style={{ color: MUTED }}>
              Sending is <strong style={{ color: "hsl(220 10% 68%)" }}>one-way for now</strong>: Kronos items go
              to iCloud, nothing comes back, and <strong style={{ color: "hsl(220 10% 68%)" }}>deleting an item
              here does not yet remove it from iCloud</strong> — that needs the half that reads the calendar.
              Nothing is sent until you press Send, and you see exactly what will go first.
            </p>
          </div>

          {config && !config.secureStorageAvailable && (
            <div className="flex gap-2.5 rounded-lg px-3 py-2.5" style={{ background: "hsl(0 40% 10% / 0.5)", border: "1px solid hsl(0 50% 40% / .35)" }}>
              <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(0 60% 62%)" }} />
              <p className="text-[11px] leading-relaxed" style={{ color: MUTED }}>
                This system has no secure credential storage, so a password cannot be saved.
                Set <code>ROME_ICLOUD_PASS</code> in the environment instead.
              </p>
            </div>
          )}

          {/* ── Account ──────────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Apple ID</label>
              <input
                value={appleId}
                onChange={event => setAppleId(event.target.value)}
                placeholder="you@icloud.com"
                autoComplete="off"
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>
                App-specific password
                {config?.passwordConfigured && (
                  <span className="ml-2 normal-case tracking-normal" style={{ color: "hsl(145 50% 52%)" }}>
                    · saved
                  </span>
                )}
              </label>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder={config?.passwordConfigured ? "Stored — type to replace" : "abcd-efgh-ijkl-mnop"}
                autoComplete="new-password"
                className={inputCls}
              />
              <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: FAINT }}>
                Your ordinary Apple ID password will not work — iCloud rejects it for calendar
                access and it looks like a wrong password.{" "}
                <button
                  onClick={() => void bridge.openAppleIdPage()}
                  className="inline-flex items-center gap-1 underline"
                  style={{ color: GOLD }}
                >
                  Generate one <ExternalLink className="w-2.5 h-2.5" />
                </button>{" "}
                under Sign-In and Security → App-Specific Passwords.
              </p>
            </div>

            <button
              onClick={() => void verify()}
              disabled={Boolean(busy) || !appleId.trim() || (!password.trim() && !config?.passwordConfigured)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono transition-all disabled:opacity-40"
              style={{ color: GOLD, background: `${GOLD}14`, border: `1px solid ${GOLD}40` }}
            >
              {busy === "verifying" ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {busy === "verifying" ? "Checking with iCloud…" : "Verify"}
            </button>
          </div>

          {/* ── Outcome ──────────────────────────────────────────────────── */}
          {error && (
            <p className="text-[11px]" style={{ color: "hsl(0 60% 66%)" }}>{error}</p>
          )}

          {result && !result.ok && (
            <div className="rounded-lg px-3 py-2.5" style={{ background: "hsl(0 35% 9% / 0.6)", border: "1px solid hsl(0 45% 34% / .5)" }}>
              <p className="text-[11px] leading-relaxed" style={{ color: "hsl(0 55% 72%)" }}>{result.message}</p>
              <p className="text-[9px] font-mono mt-1" style={{ color: FAINT }}>{result.kind}</p>
            </div>
          )}

          {result?.ok && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5" style={{ color: "hsl(145 55% 55%)" }} />
                <p className="text-[11px]" style={{ color: MUTED }}>
                  Signed in. {result.calendars.length} calendar{result.calendars.length === 1 ? "" : "s"} can hold events.
                </p>
              </div>

              <div>
                <p className={labelCls}>Which calendar</p>

                {/* First and recommended. Syncing into a personal calendar turns
                    every routine into a real repeating event on the phone, and
                    unpicking that later is manual, event by event. */}
                <button
                  onClick={() => void createCalendar()}
                  disabled={Boolean(busy)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-dashed mb-2 transition-all disabled:opacity-40 text-left"
                  style={{ borderColor: `${GOLD}50`, background: `${GOLD}0d` }}
                >
                  {busy === "creating"
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: GOLD }} />
                    : <Plus className="w-3.5 h-3.5 shrink-0" style={{ color: GOLD }} />}
                  <span className="min-w-0">
                    <span className="block text-xs" style={{ color: GOLD }}>Create a new calendar called ROME</span>
                    <span className="block text-[10px] mt-0.5" style={{ color: FAINT }}>
                      Recommended — keeps ROME's items separate, and removable in one step
                    </span>
                  </span>
                </button>

                <div className="flex flex-col gap-1">
                  {result.calendars.map(calendar => {
                    const chosen = config?.calendarHref === calendar.href;
                    return (
                      <button
                        key={calendar.href}
                        onClick={() => void chooseCalendar(calendar.href, calendar.displayName)}
                        disabled={Boolean(busy)}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all disabled:opacity-40 text-left"
                        style={{
                          borderColor: chosen ? `${GOLD}60` : HAIRLINE,
                          background: chosen ? `${GOLD}12` : "transparent",
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: calendar.color || "hsl(220 10% 30%)" }}
                        />
                        <span className="flex-1 min-w-0 text-xs truncate" style={{ color: chosen ? GOLD : MUTED }}>
                          {calendar.displayName}
                        </span>
                        {chosen && <Check className="w-3 h-3 shrink-0" style={{ color: GOLD }} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-[9px] font-mono" style={{ color: FAINT }}>
                {result.origin.replace("https://", "")} · {result.homePath}
              </p>
            </div>
          )}

          {/* ── Sending ──────────────────────────────────────────────────── */}
          {connected && (
            <div className="pt-3 border-t space-y-3" style={{ borderColor: HAIRLINE }}>
              <div className="flex items-center justify-between">
                <p className={labelCls} style={{ marginBottom: 0 }}>Send to iCloud</p>
                <span className="text-[9px] font-mono" style={{ color: FAINT }}>
                  {status?.state === "syncing" ? "sending…"
                    : status?.lastSyncAt ? `last sent ${new Date(status.lastSyncAt).toLocaleTimeString()}`
                      : "never sent"}
                </span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => void runPreview()}
                  disabled={Boolean(busy)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono transition-all disabled:opacity-40"
                  style={{ color: MUTED, border: `1px solid ${HAIRLINE}` }}
                >
                  {busy === "previewing" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                  Preview
                </button>

                {/* Only offered once a preview exists, and it sends that plan. */}
                <button
                  onClick={() => void runPush()}
                  disabled={Boolean(busy) || !preview || (preview.plan.creates + preview.plan.updates === 0)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono transition-all disabled:opacity-30"
                  style={{ color: GOLD, background: `${GOLD}14`, border: `1px solid ${GOLD}40` }}
                >
                  {busy === "pushing" ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />}
                  {preview && preview.plan.creates + preview.plan.updates > 0
                    ? `Send ${preview.plan.creates + preview.plan.updates}`
                    : "Send"}
                </button>
              </div>

              {preview && (
                <div className="rounded-lg px-3 py-2.5" style={{ background: "hsl(220 15% 6%)", border: `1px solid ${HAIRLINE}` }}>
                  <p className="text-[11px] leading-relaxed" style={{ color: "hsl(220 10% 70%)" }}>{preview.summary}</p>
                  {preview.plan.skipped > 0 && (
                    <details className="mt-2">
                      <summary className="text-[10px] cursor-pointer" style={{ color: FAINT }}>
                        {preview.plan.skipped} not sent — why
                      </summary>
                      <ul className="mt-1.5 space-y-0.5">
                        {preview.plan.actions.filter(a => a.op === "skip").slice(0, 40).map((a, i) => (
                          <li key={i} className="text-[10px] font-mono" style={{ color: FAINT }}>
                            {a.row.title || `#${a.row.id}`} — {a.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {pushed && (
                <div
                  className="rounded-lg px-3 py-2.5"
                  style={{
                    background: pushed.failed ? "hsl(0 35% 9% / 0.6)" : "hsl(145 30% 8% / 0.6)",
                    border: `1px solid ${pushed.failed ? "hsl(0 45% 34% / .5)" : "hsl(145 40% 30% / .5)"}`,
                  }}
                >
                  <p className="text-[11px]" style={{ color: pushed.failed ? "hsl(0 55% 72%)" : "hsl(145 50% 68%)" }}>
                    Sent {pushed.pushed}{pushed.failed ? `, ${pushed.failed} failed` : ""}.
                    {!pushed.failed && " Check Apple Calendar."}
                  </p>
                  {pushed.problems.slice(0, 6).map((problem, i) => (
                    <p key={i} className="text-[10px] font-mono mt-1" style={{ color: "hsl(0 45% 68%)" }}>{problem}</p>
                  ))}
                </div>
              )}

              {status?.state === "error" && status.lastError && !pushed && (
                <p className="text-[10px] font-mono" style={{ color: "hsl(0 50% 66%)" }}>{status.lastError}</p>
              )}
            </div>
          )}

          {/* ── Connected ────────────────────────────────────────────────── */}
          {connected && (
            <div className="pt-2 border-t" style={{ borderColor: HAIRLINE }}>
              <p className="text-[11px] mb-2" style={{ color: MUTED }}>
                Linked to <strong style={{ color: GOLD }}>{config?.calendarName}</strong> as {config?.appleId}.
              </p>
              <button
                onClick={() => void disconnect()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono transition-all"
                style={{ color: "hsl(0 50% 62%)", border: "1px solid hsl(0 40% 30% / .5)" }}
              >
                <Unlink className="w-3 h-3" />
                Disconnect
              </button>
              <p className="text-[10px] mt-1.5" style={{ color: FAINT }}>
                Forgets the account and the password. Nothing on iCloud is deleted.
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
