export interface WorkingHourInput {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface WorkingHourIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Working hours are wall-clock `HH:MM` strings, so lexicographic comparison is
 * enough. Two ranges overlap when the next one starts before the previous one
 * ends.
 */
export function workingHoursOverlapIssues(
  hours: WorkingHourInput[],
): WorkingHourIssue[] {
  const issues: WorkingHourIssue[] = [];
  const byWeekday = new Map<
    number,
    Array<WorkingHourInput & { index: number }>
  >();

  hours.forEach((hour, index) => {
    const entries = byWeekday.get(hour.weekday) ?? [];
    entries.push({ ...hour, index });
    byWeekday.set(hour.weekday, entries);
  });

  for (const [weekday, entries] of byWeekday) {
    const sorted = [...entries].sort((left, right) =>
      left.startTime.localeCompare(right.startTime),
    );

    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].startTime < sorted[index - 1].endTime) {
        issues.push({
          path: ['hours', sorted[index].index],
          message: `Working hours overlap on weekday ${weekday}`,
        });
      }
    }
  }

  return issues;
}
