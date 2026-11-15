import { describe, expect, it } from 'vitest';
import { replaceWorkingHoursSchema } from './staff.schemas.js';
import { workingHoursOverlapIssues } from './working-hours.js';

describe('workingHoursOverlapIssues', () => {
  it('accepts an empty schedule', () => {
    expect(workingHoursOverlapIssues([])).toEqual([]);
  });

  it('accepts disjoint ranges on the same weekday', () => {
    expect(
      workingHoursOverlapIssues([
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '13:00', endTime: '18:00' },
      ]),
    ).toEqual([]);
  });

  it('accepts adjacent ranges where one ends when the next starts', () => {
    expect(
      workingHoursOverlapIssues([
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '12:00', endTime: '18:00' },
      ]),
    ).toEqual([]);
  });

  it('reports overlapping ranges regardless of input order', () => {
    const issues = workingHoursOverlapIssues([
      { weekday: 2, startTime: '14:00', endTime: '18:00' },
      { weekday: 2, startTime: '09:00', endTime: '15:00' },
    ]);

    expect(issues).toHaveLength(1);
    // The second entry is the one that starts before the previous one ends.
    expect(issues[0]?.path).toEqual(['hours', 0]);
  });

  it('reports a range contained inside another one', () => {
    const issues = workingHoursOverlapIssues([
      { weekday: 3, startTime: '09:00', endTime: '18:00' },
      { weekday: 3, startTime: '10:00', endTime: '11:00' },
    ]);

    expect(issues).toHaveLength(1);
  });

  it('does not compare ranges on different weekdays', () => {
    expect(
      workingHoursOverlapIssues([
        { weekday: 1, startTime: '09:00', endTime: '18:00' },
        { weekday: 2, startTime: '09:00', endTime: '18:00' },
      ]),
    ).toEqual([]);
  });

  it('reports every conflicting pair', () => {
    const issues = workingHoursOverlapIssues([
      { weekday: 4, startTime: '09:00', endTime: '12:00' },
      { weekday: 4, startTime: '11:00', endTime: '13:00' },
      { weekday: 4, startTime: '12:30', endTime: '14:00' },
    ]);

    expect(issues).toHaveLength(2);
  });
});

describe('replaceWorkingHoursSchema', () => {
  it('accepts a valid weekly schedule', () => {
    const result = replaceWorkingHoursSchema.safeParse({
      hours: [
        { weekday: 1, startTime: '09:00', endTime: '13:00' },
        { weekday: 1, startTime: '14:00', endTime: '18:00' },
        { weekday: 7, startTime: '10:00', endTime: '14:00' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects overlapping hours', () => {
    const result = replaceWorkingHoursSchema.safeParse({
      hours: [
        { weekday: 1, startTime: '09:00', endTime: '13:00' },
        { weekday: 1, startTime: '12:00', endTime: '18:00' },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an end before the start', () => {
    const result = replaceWorkingHoursSchema.safeParse({
      hours: [{ weekday: 1, startTime: '18:00', endTime: '09:00' }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range weekday', () => {
    const result = replaceWorkingHoursSchema.safeParse({
      hours: [{ weekday: 8, startTime: '09:00', endTime: '10:00' }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a non HH:MM time', () => {
    const result = replaceWorkingHoursSchema.safeParse({
      hours: [{ weekday: 1, startTime: '9:00', endTime: '10:00' }],
    });

    expect(result.success).toBe(false);
  });
});
