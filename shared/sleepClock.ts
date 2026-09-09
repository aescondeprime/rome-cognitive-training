/**
 * The sleep clock — the arithmetic, on its own.
 *
 * A sleep period is not a focus cycle with a longer number in it. It has no
 * countdown, because it can run for nine hours and nobody watches a nine-hour
 * timer; it is *armed* before it begins, because "bedtime at eleven thirty" is
 * a thing you set and then walk away from; and it does not end at its end —
 * the alarm rings past it, indefinitely, until a key is pressed. Every one of
 * those is a rule about time, so all of them live here, pure, rather than
 * inside a component where they could only be checked by staying up all night.
 */

/** How long before the end the alarm starts, at its quietest. */
export const ALARM_LEAD_MS = 5 * 60_000;
/** Where it arrives, and stays, at the loudest setting. */
export const ALARM_PEAK_GAIN = 1;
/**
 * How far below the peak the ramp begins, in decibels.
 *
 * A *range* rather than a floor, so the climb is the same climb whatever the
 * peak is set to. A fixed floor would give a quiet peak almost no ramp at all —
 * set to 45 dB it would start most of the way up and the first four minutes
 * would do nothing.
 */
export const ALARM_RAMP_DB = 34;
/**
 * Where the ramp begins at full peak. Audible in a quiet room, not enough to
 * wake anyone.
 *
 * Derived from the range rather than written down beside it. The two were
 * separately-chosen numbers that agreed to three decimal places, which is the
 * kind of near-agreement that quietly stops being agreement the first time
 * somebody adjusts one of them.
 */
export const ALARM_MIN_GAIN = Math.pow(10, -ALARM_RAMP_DB / 20);

/**
 * The loudness scale the editor speaks in.
 *
 * ROME cannot measure sound pressure — there is no calibrated path from a gain
 * value to what reaches a pair of ears, because the system volume, the output
 * device and the distance are all unknown to it. So this is honest about what
 * it is: **ROME's own scale, where 85 dB is full output**, chosen because 85 is
 * the number worth not exceeding for prolonged exposure. Everything below it is
 * a true relative decibel — 75 really is ten decibels quieter than 85 — and the
 * absolute figure is only as true as the system volume it is played through.
 */
export const ALARM_MAX_DB = 85;
export const ALARM_MIN_DB = 45;
export const DEFAULT_ALARM_DB = 85;

/** dB on that scale to a linear gain. 85 → 1, 65 → 0.1, 45 → 0.01. */
export function dbToGain(db: number): number {
  const clamped = Math.max(ALARM_MIN_DB, Math.min(ALARM_MAX_DB, db));
  return Math.pow(10, (clamped - ALARM_MAX_DB) / 20);
}

export function gainToDb(gain: number): number {
  return ALARM_MAX_DB + 20 * Math.log10(Math.max(1e-6, gain));
}

/** The four alarms. Switched in the Constellation editor. */
export const ALARM_VOICES = ["klaxon", "pulsar", "siren", "chime"] as const;
export type AlarmVoice = (typeof ALARM_VOICES)[number];
export const DEFAULT_ALARM_VOICE: AlarmVoice = "klaxon";

export const ALARM_VOICE_LABELS: Record<AlarmVoice, string> = {
  klaxon: "Klaxon",
  pulsar: "Pulsar",
  siren:  "Siren",
  chime:  "Chime",
};

/** One line each, so the editor says what you are about to hear. */
export const ALARM_VOICE_HINTS: Record<AlarmVoice, string> = {
  klaxon: "Ring-modulated whoops over a stepped sub. The loudest and the least ignorable.",
  pulsar: "Fast rising pulses. Sharp rather than heavy — cuts through a quiet room.",
  siren:  "A slow resonant sweep, up and back down. Fills the room instead of stabbing it.",
  chime:  "Descending bells with a long tail. The one that will not startle you awake.",
};

export function normalizeVoice(value: unknown): AlarmVoice {
  return (ALARM_VOICES as readonly string[]).includes(String(value))
    ? value as AlarmVoice
    : DEFAULT_ALARM_VOICE;
}
/** Longest period anyone means. Past this, a spoken duration was misheard. */
export const MAX_SLEEP_MS = 24 * 3_600_000;
/** Shortest worth arming. Below this it is not a nap, it is a typo. */
export const MIN_SLEEP_MS = 60_000;
/**
 * How long past its wake time a period is still a period.
 *
 * The alarm is deliberately unbounded — it rings until Tab, however long that
 * takes. But "however long" has to stop somewhere: a period left behind by a
 * machine that was closed on Friday and opened on Monday would otherwise greet
 * whoever opened it with a full-volume siren for an alarm three days stale.
 * Twelve hours is comfortably longer than anyone sleeps through their own
 * alarm and comfortably shorter than a working day away from the desk.
 */
export const MAX_OVERRUN_MS = 12 * 3_600_000;

export interface SleepPeriod {
  id: string;
  /** What to call it: "Sleep", "Nap", or the user's own word. */
  label: string;
  /** When the period begins. In the future while it is armed. */
  startsAt: number;
  /** When the alarm reaches full volume. The period does not end here — see `sleepPhase`. */
  endsAt: number;
  /** The Kronos row drawing this period on the calendar, if one was made. */
  kronosItemId: number | null;
  /**
   * When the alarm first sounded.
   *
   * Recorded so that quitting and reopening ROME mid-alarm resumes the ramp
   * where it was rather than starting it over quietly — which, at four in the
   * morning, is indistinguishable from the alarm having failed.
   */
  ringingSince: number | null;
  createdAt: number;
}

export type SleepPhase = "idle" | "armed" | "asleep" | "ringing";

export interface SleepStatus {
  phase: SleepPhase;
  period: SleepPeriod | null;
  /** 0 while asleep, 0→1 across the lead window, 1 from the end onward. */
  alarmProgress: number;
  /** Whole minutes until the alarm starts. 0 once it has. */
  minutesToAlarm: number;
  /** Whole minutes until the period begins. 0 once it has. */
  minutesToStart: number;
}

export const IDLE_SLEEP: SleepStatus = {
  phase: "idle", period: null, alarmProgress: 0, minutesToAlarm: 0, minutesToStart: 0,
};

/** Accept a period written by any earlier version, or reject it as absent. */
export function normalizePeriod(value: any): SleepPeriod | null {
  if (!value || typeof value !== "object") return null;
  const startsAt = Number(value.startsAt);
  const endsAt = Number(value.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return null;
  return {
    id: String(value.id ?? `sleep-${startsAt}`),
    label: String(value.label ?? "Sleep").slice(0, 40) || "Sleep",
    startsAt,
    endsAt,
    kronosItemId: typeof value.kronosItemId === "number" ? value.kronosItemId : null,
    ringingSince: typeof value.ringingSince === "number" ? value.ringingSince : null,
    createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : startsAt,
  };
}

/**
 * How long the alarm has to climb.
 *
 * Five minutes, except on a period too short to give it five — a twenty-minute
 * nap whose alarm started at minute fifteen would be ringing for most of it.
 * Half the period is the floor, so a ten-minute nap gets five quiet minutes and
 * then five loud ones, and a six-minute one still gets three of each.
 */
export function alarmLeadMs(period: SleepPeriod): number {
  return Math.min(ALARM_LEAD_MS, Math.max(0, (period.endsAt - period.startsAt) / 2));
}

export function alarmStartsAt(period: SleepPeriod): number {
  return period.endsAt - alarmLeadMs(period);
}

/**
 * Where the alarm is in its climb: 0 at the first sound, 1 at the end.
 *
 * Pinned at 1 afterwards rather than continuing to rise, because the period is
 * over and the alarm is simply still going — there is nothing left to ramp
 * towards.
 */
export function alarmProgress(period: SleepPeriod, now = Date.now()): number {
  const lead = alarmLeadMs(period);
  if (lead <= 0) return now >= period.endsAt ? 1 : 0;
  return Math.max(0, Math.min(1, (now - alarmStartsAt(period)) / lead));
}

/**
 * Progress to loudness, on a constant-decibel slope.
 *
 * Linear gain would spend four of the five minutes already loud: hearing is
 * logarithmic, and the halfway point of a linear ramp is most of the way up.
 * A constant ratio per unit of time is what "gets louder steadily" actually
 * sounds like.
 *
 * `peak` is where the climb ends. The ramp is always `ALARM_RAMP_DB` below it,
 * so lowering the peak lowers the whole curve rather than flattening it.
 */
export function alarmGain(progress: number, peak = ALARM_PEAK_GAIN): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return peak * Math.pow(10, ((clamped - 1) * ALARM_RAMP_DB) / 20);
}

export function sleepPhase(period: SleepPeriod | null, now = Date.now()): SleepPhase {
  if (!period) return "idle";
  // Abandoned rather than answered: see MAX_OVERRUN_MS.
  if (now > period.endsAt + MAX_OVERRUN_MS) return "idle";
  if (now < period.startsAt) return "armed";
  // Deliberately open-ended: the alarm does not stop at `endsAt`, or at any
  // other time. Only being dismissed ends it.
  if (now >= alarmStartsAt(period)) return "ringing";
  return "asleep";
}

export function sleepStatus(period: SleepPeriod | null, now = Date.now()): SleepStatus {
  const phase = sleepPhase(period, now);
  if (!period || phase === "idle") return IDLE_SLEEP;
  return {
    phase,
    period,
    alarmProgress: phase === "ringing" ? alarmProgress(period, now) : 0,
    minutesToAlarm: Math.max(0, Math.ceil((alarmStartsAt(period) - now) / 60_000)),
    minutesToStart: Math.max(0, Math.ceil((period.startsAt - now) / 60_000)),
  };
}

// ── Turning what someone said into two instants ─────────────────────────────

export interface SleepRequest {
  /** "23:30" — when to begin. Absent means now. */
  startTime?: string | null;
  /** "07:00" — when to wake. */
  endTime?: string | null;
  /** Length in minutes, as an alternative to `endTime`. */
  durationMinutes?: number | null;
  label?: string | null;
}

/**
 * Parse "23:30", "7:00", "7", "07:00:00". Returns minutes past midnight.
 *
 * Deliberately strict about the shape and forgiving about the padding: the
 * agent is told to pass 24-hour times, and anything it actually sends that is
 * not one of those is better refused than guessed at — waking someone twelve
 * hours late is the failure this function exists to prevent.
 */
export function parseClockTime(value: string): number | null {
  const match = /^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*$/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The next time the local clock reads `minutesPastMidnight`, strictly after `after`.
 *
 * Strictly, so "wake me at seven" said at exactly seven means tomorrow morning
 * rather than an alarm that has already finished. Built by mutating a local
 * `Date` rather than by adding milliseconds, so a period spanning a daylight
 * saving change still ends at the time on the wall.
 */
export function nextClockTime(minutesPastMidnight: number, after: number): number {
  const at = new Date(after);
  at.setHours(Math.floor(minutesPastMidnight / 60), minutesPastMidnight % 60, 0, 0);
  if (at.getTime() <= after) at.setDate(at.getDate() + 1);
  return at.getTime();
}

export interface ResolvedSleep {
  startsAt: number;
  endsAt: number;
  label: string;
}

/**
 * Work out the two instants, or say why it cannot.
 *
 * Every refusal here is phrased to be spoken back: this runs behind a voice
 * command, and "invalid argument" is not something anyone can act on at
 * midnight.
 */
export function resolveSleep(request: SleepRequest, now = Date.now()): ResolvedSleep {
  const label = (request.label ?? "").trim().slice(0, 40) || "Sleep";

  let startsAt = now;
  if (request.startTime) {
    const minutes = parseClockTime(request.startTime);
    if (minutes === null) throw new Error(`I could not read "${request.startTime}" as a time of day.`);
    startsAt = nextClockTime(minutes, now);
  }

  let endsAt: number | null = null;
  if (request.endTime) {
    const minutes = parseClockTime(request.endTime);
    if (minutes === null) throw new Error(`I could not read "${request.endTime}" as a time of day.`);
    // Anchored to the start, not to now, so "at eleven thirty until seven" is
    // seven and a half hours rather than a period that ended this morning.
    endsAt = nextClockTime(minutes, startsAt);
  } else if (request.durationMinutes) {
    const minutes = Math.round(Number(request.durationMinutes));
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Say how long the period should be.");
    endsAt = startsAt + minutes * 60_000;
  }

  if (endsAt === null) throw new Error("Say when to wake you, or how long to sleep for.");
  if (endsAt - startsAt < MIN_SLEEP_MS) throw new Error("That period is under a minute — say a longer one.");
  if (endsAt - startsAt > MAX_SLEEP_MS) throw new Error("That period is longer than a day. Say it again with the wake time.");
  return { startsAt, endsAt, label };
}

// ── Saying it back ──────────────────────────────────────────────────────────

/** "7:05 AM", for a person. */
export function clockLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "seven hours and twenty minutes", spoken rather than displayed. */
export function spokenSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} minute${rest === 1 ? "" : "s"}`;
  const hoursPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? hoursPart : `${hoursPart} and ${rest} minute${rest === 1 ? "" : "s"}`;
}

/** One sentence, for Akira to confirm with and for the tool result to carry. */
export function describePeriod(period: SleepPeriod, now = Date.now()): string {
  const phase = sleepPhase(period, now);
  const wake = clockLabel(period.endsAt);
  if (phase === "armed") {
    return `${period.label} is set for ${clockLabel(period.startsAt)}, waking at ${wake} — ${spokenSpan(period.endsAt - period.startsAt)}.`;
  }
  if (phase === "ringing") return `The alarm is going. It will not stop until you press Tab.`;
  return `${period.label} until ${wake} — ${spokenSpan(period.endsAt - now)} left.`;
}
