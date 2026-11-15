export interface WorkingWindow {
  /** ISO 8601 weekday: 1 = Monday, 7 = Sunday. */
  weekday: number;
  /** Wall-clock time in the tenant timezone, `HH:MM`. */
  startTime: string;
  /** Wall-clock time in the tenant timezone, `HH:MM`. */
  endTime: string;
}

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

export interface AvailabilityInput {
  /** Calendar date in the tenant timezone, `YYYY-MM-DD`. */
  date: string;
  timezone: string;
  durationMinutes: number;
  /** Preparation time kept free before and after an appointment. */
  bufferMinutes?: number;
  /** Step between candidate start times. Defaults to 15 minutes. */
  granularityMinutes?: number;
  workingHours: WorkingWindow[];
  /** Hard unavailability: vacations, breaks, external appointments. */
  timeBlocks?: Interval[];
  /** Already booked appointments. They also reserve their buffer. */
  busy?: Interval[];
  now?: Date;
  minAdvanceMinutes?: number;
  maxAdvanceDays?: number;
}

export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

interface ZonedParts extends DateParts {
  hour: number;
  minute: number;
  second: number;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  formatters.set(timeZone, formatter);

  return formatter;
}

function pad2(value: number): string {
  return `${value}`.padStart(2, '0');
}

export function parseDateKey(value: string): DateParts {
  const match = DATE_PATTERN.exec(value);

  if (!match) {
    throw new Error(`Invalid date: ${value}`);
  }

  const parts: DateParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const check = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  );

  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day
  ) {
    throw new Error(`Invalid date: ${value}`);
  }

  return parts;
}

export function formatDateKey(parts: DateParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function addDaysToDateKey(value: string, days: number): string {
  const parts = parseDateKey(value);
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );

  return formatDateKey({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/** ISO 8601 weekday (1 = Monday, 7 = Sunday) for a calendar date. */
export function weekdayFromDateKey(value: string): number {
  const parts = parseDateKey(value);
  const day = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();

  return day === 0 ? 7 : day;
}

function parseTimeToMinutes(value: string): number {
  const match = TIME_PATTERN.exec(value);

  if (!match) {
    throw new Error(`Invalid time: ${value}`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinutes(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const values: Record<string, number> = {};

  for (const part of getFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

/**
 * Offset of `timeZone` at a given instant, in milliseconds east of UTC.
 * Buenos Aires returns -3h; New York returns -5h or -4h depending on DST.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  // Ignore milliseconds so the offset is stable.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `timeZone` to a UTC instant. Returns `null`
 * when the local time does not exist (the hour skipped by a spring-forward
 * DST transition), so the caller can simply drop that candidate slot.
 */
export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
): Date | null {
  const parts = parseDateKey(date);
  const minutes = parseTimeToMinutes(time);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    minute,
    0,
    0,
  );

  let candidate = wallAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = zoneOffsetMs(new Date(candidate), timeZone);
    const next = wallAsUtc - offset;

    if (next === candidate) {
      break;
    }

    candidate = next;
  }

  const result = new Date(candidate);
  const actual = zonedParts(result, timeZone);

  if (
    actual.year !== parts.year ||
    actual.month !== parts.month ||
    actual.day !== parts.day ||
    actual.hour !== hour ||
    actual.minute !== minute
  ) {
    return null;
  }

  return result;
}

/** Calendar date (`YYYY-MM-DD`) of an instant in the given timezone. */
export function localDateKey(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);

  return formatDateKey(parts);
}

function dayDifference(from: string, to: string): number {
  const left = parseDateKey(from);
  const right = parseDateKey(to);

  return Math.round(
    (Date.UTC(right.year, right.month - 1, right.day) -
      Date.UTC(left.year, left.month - 1, left.day)) /
      MS_PER_DAY,
  );
}

function overlaps(
  start: number,
  end: number,
  interval: Interval,
): boolean {
  return (
    start < interval.endsAt.getTime() && interval.startsAt.getTime() < end
  );
}

/**
 * Computes the free start times for one staff member on one day.
 *
 * Rules (RN-02):
 * - the appointment plus its buffer must fit inside a working window;
 * - it cannot overlap a time block;
 * - it cannot overlap an appointment, keeping `bufferMinutes` before and after;
 * - it must respect the tenant's minimum and maximum advance.
 *
 * Candidate starts are generated in local wall-clock time and converted to
 * UTC one by one, so DST transitions are handled without shifting the whole
 * day. Non-existent local times (spring forward) are skipped.
 */
export function computeAvailability(
  input: AvailabilityInput,
): AvailabilitySlot[] {
  const now = input.now ?? new Date();
  const bufferMs = (input.bufferMinutes ?? 0) * MS_PER_MINUTE;
  const durationMs = input.durationMinutes * MS_PER_MINUTE;
  const granularity = input.granularityMinutes ?? 15;

  if (durationMs <= 0) {
    return [];
  }

  if (granularity <= 0) {
    throw new Error('granularityMinutes must be positive');
  }

  const today = localDateKey(now, input.timezone);
  const offsetDays = dayDifference(today, input.date);

  if (offsetDays < 0) {
    return [];
  }

  if (
    input.maxAdvanceDays !== undefined &&
    offsetDays > input.maxAdvanceDays
  ) {
    return [];
  }

  const weekday = weekdayFromDateKey(input.date);
  const windows = input.workingHours
    .filter((window) => window.weekday === weekday)
    .sort((left, right) => left.startTime.localeCompare(right.startTime));

  if (windows.length === 0) {
    return [];
  }

  const timeBlocks = input.timeBlocks ?? [];
  const busy = input.busy ?? [];
  const earliestStart =
    now.getTime() + (input.minAdvanceMinutes ?? 0) * MS_PER_MINUTE;
  const slots = new Map<string, AvailabilitySlot>();

  for (const window of windows) {
    const windowStartMinutes = parseTimeToMinutes(window.startTime);
    const windowEndMinutes = parseTimeToMinutes(window.endTime);
    const windowStartUtc = zonedDateTimeToUtc(
      input.date,
      window.startTime,
      input.timezone,
    );
    const windowEndUtc = zonedDateTimeToUtc(
      input.date,
      window.endTime,
      input.timezone,
    );

    if (!windowStartUtc || !windowEndUtc) {
      continue;
    }

    const latestStart =
      windowEndMinutes - input.durationMinutes - (input.bufferMinutes ?? 0);

    for (
      let candidate = windowStartMinutes;
      candidate <= latestStart;
      candidate += granularity
    ) {
      const startUtc = zonedDateTimeToUtc(
        input.date,
        formatMinutes(candidate),
        input.timezone,
      );

      if (!startUtc) {
        continue;
      }

      const start = startUtc.getTime();
      const end = start + durationMs;

      if (start < earliestStart) {
        continue;
      }

      if (start < windowStartUtc.getTime()) {
        continue;
      }

      if (end + bufferMs > windowEndUtc.getTime()) {
        continue;
      }

      if (timeBlocks.some((block) => overlaps(start, end, block))) {
        continue;
      }

      const busyConflict = busy.some(
        (appointment) =>
          start < appointment.endsAt.getTime() + bufferMs &&
          appointment.startsAt.getTime() < end + bufferMs,
      );

      if (busyConflict) {
        continue;
      }

      const key = startUtc.toISOString();

      slots.set(key, {
        startsAt: key,
        endsAt: new Date(end).toISOString(),
      });
    }
  }

  return [...slots.values()].sort((left, right) =>
    left.startsAt.localeCompare(right.startsAt),
  );
}
