/**
 * The sleep period's one moving part.
 *
 * Mounted once, for the same reason the focus warnings live in `AkiraProvider`
 * rather than in the Task Stabilizer: an alarm that only rings while a
 * particular page happens to be open is not an alarm. This watches the clock,
 * starts the siren five minutes out, owns the Tab key while it is going, and
 * hands over to the daily overview when it stops.
 *
 * It renders nothing at all unless a period exists.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IDLE_SLEEP, alarmProgress, markRinging, sleepStatus, wakeNow, type SleepStatus,
} from "@/lib/sleepSession";
import { readTasks } from "@/lib/focusSession";
import { alarmRinging, startWakeAlarm, stopWakeAlarm } from "@/lib/wakeAlarm";
import { useAkira } from "@/akira/AkiraProvider";
import { apiRequest, queryClient } from "@/lib/queryClient";
import DailyOverview, { spokenDebrief } from "./DailyOverview";

/**
 * One clock for the whole app, ticking once a second.
 *
 * A second is far finer than a nine-hour period needs, and exactly what the
 * five-minute ramp does need — the alarm has to start on the right second, not
 * the right minute.
 */
export function useSleepStatus(profileId: number | undefined): SleepStatus {
  const [status, setStatus] = useState<SleepStatus>(IDLE_SLEEP);
  useEffect(() => {
    const read = () => setStatus(sleepStatus(profileId));
    read();
    const id = window.setInterval(read, 1_000);
    window.addEventListener("rome:sleep:refresh", read);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("rome:sleep:refresh", read);
    };
  }, [profileId]);
  return status;
}

export default function SleepController() {
  const { data: activeProfile } = useQuery<{ id: number }>({ queryKey: ["/api/active-profile"] });
  const profileId = activeProfile?.id;
  const status = useSleepStatus(profileId);
  const akira = useAkira();
  const [overview, setOverview] = useState(false);
  /** Guards the dismissal against a held-down Tab firing it twice. */
  const dismissing = useRef(false);

  const ringing = status.phase === "ringing";

  /**
   * The siren follows the phase and nothing else.
   *
   * `startWakeAlarm` is handed a function rather than a deadline so it reads
   * the ramp from the wall clock on every cycle. A laptop that slept through
   * four of the five minutes then wakes at the loudness it should have reached,
   * instead of starting the climb over at its quietest.
   */
  useEffect(() => {
    if (!ringing || !status.period) { stopWakeAlarm(); return; }
    const period = status.period;
    markRinging(profileId);
    startWakeAlarm(now => alarmProgress(period, now));
    return () => stopWakeAlarm();
  }, [ringing, status.period?.id, profileId]);

  /**
   * Wake up: stop the noise, take the block off the calendar, say the day.
   *
   * The order matters. Silence comes first and synchronously — every other step
   * here can fail, and none of them should be able to leave a siren running.
   */
  const dismiss = useCallback(async () => {
    if (dismissing.current) return;
    dismissing.current = true;
    stopWakeAlarm();
    const result = wakeNow(profileId);
    if (!result.woke) { dismissing.current = false; return; }
    void queryClient.invalidateQueries({ queryKey: ["kronos-today"] });
    setOverview(true);

    // The debrief is read fresh rather than from the panel's query, because the
    // panel mounts in the same tick and its data has not arrived yet.
    try {
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const schedule = await apiRequest("GET", `/api/kronos/today?date=${dateStr}`)
        .then(r => r.json()).catch(() => []);
      const tasks = readTasks(profileId).filter(task => !task.completedAt);
      for (const line of spokenDebrief(Array.isArray(schedule) ? schedule : [], tasks)) {
        await akira.announce(line);
      }
      // Opened *after* the debrief so the first thing she does is not talk over
      // herself, and left open so "what's first?" is answerable without having
      // to say her name at six in the morning.
      await akira.activate(false).catch(() => undefined);
    } catch { /* the panel is the debrief that always works */ }
    finally { dismissing.current = false; }
  }, [akira, profileId]);

  /**
   * Tab, and only Tab.
   *
   * Registered in the capture phase and stopping propagation there, because
   * Tab already means "open the Constellation" — see the matching guard in
   * `ConstellationOverlay`, which is what actually keeps the map shut, since
   * two window-capture listeners fire in registration order and that one is
   * mounted first.
   *
   * No input-focus exemption, unlike the map's binding: whatever is focused at
   * four in the morning, Tab has to stop the alarm.
   */
  useEffect(() => {
    if (!ringing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void dismiss();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    // Reachable from the one place a key event never arrives: Electron main
    // forwards the Tab it intercepted when a native browser view has focus.
    (window as any).__romeDismissAlarm = dismiss;
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      delete (window as any).__romeDismissAlarm;
    };
  }, [ringing, dismiss]);

  // The siren must not outlive the app's own teardown.
  useEffect(() => () => stopWakeAlarm(), []);

  if (!overview) return null;
  return <DailyOverview profileId={profileId} onClose={() => setOverview(false)} />;
}

export { alarmRinging };
