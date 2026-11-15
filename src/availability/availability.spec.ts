import { describe, expect, it } from 'vitest';
import {
  addDaysToDateKey,
  computeAvailability,
  localDateKey,
  weekdayFromDateKey,
  zonedDateTimeToUtc,
} from './availability.js';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const NEW_YORK = 'America/New_York';
const MONDAY = '2026-11-09';

/** Local noon the day before, so every Monday slot is in the future. */
const SUNDAY_NOON = new Date('2026-11-08T12:00:00-03:00');

function starts(slots: Array<{ startsAt: string }>): string[] {
  return slots.map((slot) => slot.startsAt);
}

describe('computeAvailability', () => {
  it('returns every candidate that fits in a single window', () => {
    const slots = computeAvailability({
      date: MONDAY,
      timezone: BUENOS_AIRES,
      durationMinutes: 30,
      workingHours: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
      now: SUNDAY_NOON,
    });

    // 09:00-11:30 local, UTC-3, every 15 minutes.
    expect(starts(slots)).toEqual([
      '2026-11-09T12:00:00.000Z',
      '2026-11-09T12:15:00.000Z',
      '2026-11-09T12:30:00.000Z',
      '2026-11-09T12:45:00.000Z',
      '2026-11-09T13:00:00.000Z',
      '2026-11-09T13:15:00.000Z',
      '2026-11-09T13:30:00.000Z',
      '2026-11-09T13:45:00.000Z',
      '2026-11-09T14:00:00.000Z',
      '2026-11-09T14:15:00.000Z',
      '2026-11-09T14:30:00.000Z',
    ]);
    expect(slots[0]).toEqual({
      startsAt: '2026-11-09T12:00:00.000Z',
      endsAt: '2026-11-09T12:30:00.000Z',
    });
  });

  it('keeps the service buffer free at the end of the window', () => {
    const slots = computeAvailability({
      date: MONDAY,
      timezone: BUENOS_AIRES,
      durationMinutes: 30,
      bufferMinutes: 15,
      workingHours: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
      now: SUNDAY_NOON,
    });

    // Latest start is 11:15 local because 11:15 + 30 + 15 = 12:00.
    expect(starts(slots)).toHaveLength(10);
    expect(starts(slots).at(-1)).toBe('2026-11-09T14:15:00.000Z');
  });

  it('merges multiple windows of the same day in chronological order', () => {
    const slots = computeAvailability({
      date: MONDAY,
      timezone: BUENOS_AIRES,
      durationMinutes: 30,
      granularityMinutes: 30,
      workingHours: [
        { weekday: 1, startTime: '14:00', endTime: '18:00' },
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
      ],
      now: SUNDAY_NOON,
    });

    expect(starts(slots)).toEqual([
      '2026-11-09T12:00:00.000Z',
      '2026-11-09T12:30:00.000Z',
      '2026-11-09T13:00:00.000Z',
      '2026-11-09T13:30:00.000Z',
      '2026-11-09T14:00:00.000Z',
      '2026-11-09T14:30:00.000Z',
      '2026-11-09T17:00:00.000Z',
      '2026-11-09T17:30:00.000Z',
      '2026-11-09T18:00:00.000Z',
      '2026-11-09T18:30:00.000Z',
      '2026-11-09T19:00:00.000Z',
      '2026-11-09T19:30:00.000Z',
      '2026-11-09T20:00:00.000Z',
      '2026-11-09T20:30:00.000Z',
    ]);
  });

  it('drops every slot that overlaps a time block', () => {
    const slots = computeAvailability({
      date: MONDAY,
      timezone: BUENOS_AIRES,
      durationMinutes: 30,
      workingHours: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
      timeBlocks: [
        {
          startsAt: new Date('2026-11-09T13:00:00.000Z'),
          endsAt: new Date('2026-11-09T14:00:00.000Z'),
        },
      ],
      now: SUNDAY_NOON,
    });

    expect(starts(slots)).toEqual([
      '2026-11-09T12:00:00.000Z',
      '2026-11-09T12:15:00.000Z',
      '2026-11-09T12:30:00.000Z',
      '2026-11-09T14:00:00.000Z',
      '2026-11-09T14:15:00.000Z',
      '2026-11-09T14:30:00.000Z',
    ]);
  });

  it('reserves the buffer before and after an existing appointment', () => {
    const slots = computeAvailability({
      date: MONDAY,
      timezone: BUENOS_AIRES,
      durationMinutes: 30,
      bufferMinutes: 15,
      workingHours: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
      busy: [
        {
          startsAt: new Date('2026-11-09T13:00:00.000Z'),
          endsAt: new Date('2026-11-09T13:30:00.000Z'),
        },
      ],
      now: SUNDAY_NOON,
    });

    // 09:00 and 09:15 end before the 15-minute buffer, then 10:45 resumes.
    expect(starts(slots)).toEqual([
      '2026-11-09T12:00:00.000Z',
      '2026-11-09T12:15:00.000Z',
      '2026-11-09T13:45:00.000Z',
      '2026-11-09T14:00:00.000Z',
      '2026-11-09T14:15:00.000Z',
    ]);
  });

  it('respects the minimum advance of the tenant', () => {
    const slots = computeAvailability({
      date: MONDAY,
      timezone: BUENOS_AIRES,
      durationMinutes: 30,
      workingHours: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
      now: new Date('2026-11-09T10:00:00-03:00'),
      minAdvanceMinutes: 60,
    });

    // now is 10:00 local and one hour of notice is required.
    expect(starts(slots)).toEqual([
      '2026-11-09T14:00:00.000Z',
      '2026-11-09T14:15:00.000Z',
      '2026-11-09T14:30:00.000Z',
    ]);
  });

  it('returns nothing beyond the maximum advance, in the past or off-schedule', () => {
    const base = {
      timezone: BUENOS_AIRES,
      durationMinutes: 30,
      workingHours: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }],
      now: SUNDAY_NOON,
    };

    expect(
      computeAvailability({ ...base, date: MONDAY, maxAdvanceDays: 0 }),
    ).toEqual([]);
    expect(
      computeAvailability({ ...base, date: '2026-11-02' }),
    ).toEqual([]);
    expect(
      computeAvailability({
        ...base,
        date: MONDAY,
        workingHours: [{ weekday: 2, startTime: '09:00', endTime: '12:00' }],
      }),
    ).toEqual([]);
  });

  it('does not duplicate a slot when windows overlap', () => {
    const slots = computeAvailability({
      date: MONDAY,
      timezone: BUENOS_AIRES,
      durationMinutes: 30,
      workingHours: [
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
      ],
      now: SUNDAY_NOON,
    });

    expect(new Set(starts(slots)).size).toBe(slots.length);
  });

  it('skips non-existent local times on the spring-forward transition', () => {
    const slots = computeAvailability({
      date: '2026-03-08',
      timezone: NEW_YORK,
      durationMinutes: 30,
      granularityMinutes: 30,
      workingHours: [{ weekday: 7, startTime: '01:00', endTime: '04:00' }],
      now: new Date('2026-03-07T12:00:00-05:00'),
    });

    // 02:00 and 02:30 do not exist in New York on that day.
    expect(starts(slots)).toEqual([
      '2026-03-08T06:00:00.000Z',
      '2026-03-08T06:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T07:30:00.000Z',
    ]);
  });

  it('uses the first occurrence of an ambiguous time on fall back', () => {
    const slots = computeAvailability({
      date: '2026-11-01',
      timezone: NEW_YORK,
      durationMinutes: 30,
      granularityMinutes: 30,
      workingHours: [{ weekday: 7, startTime: '00:00', endTime: '03:00' }],
      now: new Date('2026-10-31T12:00:00-04:00'),
    });

    // 01:00 happens twice; the engine returns the EDT (first) one only.
    expect(starts(slots)).toEqual([
      '2026-11-01T04:00:00.000Z',
      '2026-11-01T04:30:00.000Z',
      '2026-11-01T05:00:00.000Z',
      '2026-11-01T05:30:00.000Z',
      '2026-11-01T07:00:00.000Z',
      '2026-11-01T07:30:00.000Z',
    ]);
    expect(starts(slots)).not.toContain('2026-11-01T06:00:00.000Z');
  });

  it('rejects invalid input instead of silently returning slots', () => {
    expect(() =>
      computeAvailability({
        date: '2026-02-30',
        timezone: BUENOS_AIRES,
        durationMinutes: 30,
        workingHours: [],
      }),
    ).toThrow(/Invalid date/);

    expect(() =>
      computeAvailability({
        date: MONDAY,
        timezone: BUENOS_AIRES,
        durationMinutes: 30,
        granularityMinutes: 0,
        workingHours: [],
      }),
    ).toThrow(/granularity/);
  });
});

describe('timezone helpers', () => {
  it('maps a wall-clock time to UTC and back', () => {
    expect(
      zonedDateTimeToUtc(MONDAY, '09:00', BUENOS_AIRES)?.toISOString(),
    ).toBe('2026-11-09T12:00:00.000Z');
    expect(
      localDateKey(new Date('2026-11-10T02:00:00.000Z'), BUENOS_AIRES),
    ).toBe('2026-11-09');
  });

  it('returns null for a local time skipped by DST', () => {
    expect(zonedDateTimeToUtc('2026-03-08', '02:00', NEW_YORK)).toBeNull();
    expect(
      zonedDateTimeToUtc('2026-03-08', '03:00', NEW_YORK)?.toISOString(),
    ).toBe('2026-03-08T07:00:00.000Z');
  });

  it('handles ISO weekdays and month boundaries', () => {
    expect(weekdayFromDateKey(MONDAY)).toBe(1);
    expect(weekdayFromDateKey('2026-11-15')).toBe(7);
    expect(addDaysToDateKey('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDaysToDateKey('2026-01-01', -1)).toBe('2025-12-31');
  });
});
