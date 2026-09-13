export interface SchedulerLineCandidate {
  line_type?: string | null;
  activity_name?: string;
  item_id?: string | null;
  item_description?: string | null;
  item_label?: string | null;
  resource_id?: string | null;
  resource_name?: string | null;
  kpi_metric?: string | null;
  overhead_category?: string | null;
  occurrence?: string | null;
  start_day?: number | string | null;
  end_day?: number | string | null;
  day_of_week?: number | string | null;
  custom_days?: number[] | string | null;
  [key: string]: any;
}

export interface LookupOptions {
  items?: Array<{ item_id?: string; item_name?: string; [key: string]: any }> | any[];
  resources?: Array<{ resource_id?: string; resource_name?: string; [key: string]: any }> | any[];
}

export interface ConflictResult {
  conflictingLine: SchedulerLineCandidate;
  message: string;
}

export function formatPeriod(line: SchedulerLineCandidate): string {
  const start = Math.max(1, Number(line.start_day) || 1);
  const end = line.end_day !== null && line.end_day !== undefined && line.end_day !== ''
    ? `Day ${line.end_day}`
    : 'Stage close';

  if (line.occurrence === 'ONCE') {
    return `Day ${start} (Once)`;
  }
  if (line.occurrence === 'CUSTOM') {
    const rawDays = line.custom_days;
    const days = Array.isArray(rawDays)
      ? rawDays.join(', ')
      : typeof rawDays === 'string' && rawDays.trim()
        ? rawDays
        : '';
    return days ? `Days ${days} (Custom)` : `Day ${start} to ${end} (Custom)`;
  }
  if (line.occurrence === 'WEEKLY') {
    const dow = line.day_of_week ? `, Day ${line.day_of_week}` : '';
    return `Day ${start} to ${end} (Weekly${dow})`;
  }
  return `Day ${start} to ${end}`;
}

function parseCustomDays(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw
      .map((d) => (typeof d === 'object' && d !== null && 'day_number' in d ? Number((d as any).day_number) : Number(d)))
      .filter((n) => !Number.isNaN(n) && n > 0);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n) && n > 0);
  }
  return [];
}

export function checkDaysOverlap(
  a: SchedulerLineCandidate,
  b: SchedulerLineCandidate,
): boolean {
  const startA = Math.max(1, Number(a.start_day) || 1);
  const endA = a.end_day !== null && a.end_day !== undefined && a.end_day !== ''
    ? Math.max(startA, Number(a.end_day))
    : Number.POSITIVE_INFINITY;

  const startB = Math.max(1, Number(b.start_day) || 1);
  const endB = b.end_day !== null && b.end_day !== undefined && b.end_day !== ''
    ? Math.max(startB, Number(b.end_day))
    : Number.POSITIVE_INFINITY;

  // Check if general day ranges intersect
  const rangeOverlap = Math.max(startA, startB) <= Math.min(endA, endB);
  if (!rangeOverlap) return false;

  const occA = (a.occurrence || 'DAILY').toUpperCase();
  const occB = (b.occurrence || 'DAILY').toUpperCase();

  const customA = occA === 'CUSTOM' ? parseCustomDays(a.custom_days) : [];
  const customB = occB === 'CUSTOM' ? parseCustomDays(b.custom_days) : [];

  // CUSTOM vs CUSTOM
  if (occA === 'CUSTOM' && occB === 'CUSTOM') {
    if (!customA.length || !customB.length) return rangeOverlap;
    return customA.some((day) => customB.includes(day));
  }

  // CUSTOM vs ONCE
  if (occA === 'CUSTOM' && occB === 'ONCE') {
    return customA.length ? customA.includes(startB) : startB >= startA && startB <= endA;
  }
  if (occB === 'CUSTOM' && occA === 'ONCE') {
    return customB.length ? customB.includes(startA) : startA >= startB && startA <= endB;
  }

  // CUSTOM vs DAILY / WEEKLY
  if (occA === 'CUSTOM') {
    if (!customA.length) return true;
    return customA.some((day) => day >= startB && day <= endB);
  }
  if (occB === 'CUSTOM') {
    if (!customB.length) return true;
    return customB.some((day) => day >= startA && day <= endA);
  }

  // ONCE vs ONCE
  if (occA === 'ONCE' && occB === 'ONCE') {
    return startA === startB;
  }

  // ONCE vs DAILY
  if (occA === 'ONCE' && occB === 'DAILY') {
    return startA >= startB && startA <= endB;
  }
  if (occB === 'ONCE' && occA === 'DAILY') {
    return startB >= startA && startB <= endA;
  }

  // WEEKLY vs WEEKLY
  if (occA === 'WEEKLY' && occB === 'WEEKLY') {
    const dowA = a.day_of_week ? Number(a.day_of_week) : null;
    const dowB = b.day_of_week ? Number(b.day_of_week) : null;
    if (dowA && dowB) return dowA === dowB;
    return true;
  }

  // Standard range overlap for DAILY/WEEKLY/MONTHLY
  return true;
}

export function doLinesTargetSameSubject(
  a: SchedulerLineCandidate,
  b: SchedulerLineCandidate,
): boolean {
  if (a.line_type !== b.line_type) return false;

  const type = a.line_type;

  if (type === 'CONSUMPTION') {
    if (a.item_id && b.item_id) {
      return a.item_id === b.item_id;
    }
    // If item not yet set or matching activity
    return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
  }

  if (type === 'OUTPUT') {
    if (a.item_id && b.item_id) {
      return a.item_id === b.item_id;
    }
    return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
  }

  if (type === 'RESOURCE') {
    if (a.resource_id && b.resource_id) {
      return a.resource_id === b.resource_id;
    }
    return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
  }

  if (type === 'DESCRIPTIVE') {
    if (a.kpi_metric && b.kpi_metric) {
      return a.kpi_metric.trim().toLowerCase() === b.kpi_metric.trim().toLowerCase();
    }
    return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
  }

  if (type === 'OVERHEAD') {
    if (a.overhead_category && b.overhead_category) {
      return a.overhead_category.trim().toLowerCase() === b.overhead_category.trim().toLowerCase();
    }
    return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
  }

  if (type === 'TRANSFER') {
    return !!a.activity_name && a.activity_name.trim().toLowerCase() === b.activity_name?.trim().toLowerCase();
  }

  return false;
}

export function findConflictingSchedulerLine(
  candidate: SchedulerLineCandidate,
  existingLines: SchedulerLineCandidate[],
  lookups?: LookupOptions,
): ConflictResult | null {
  for (const existing of existingLines) {
    if (!doLinesTargetSameSubject(candidate, existing)) continue;
    if (!checkDaysOverlap(candidate, existing)) continue;

    // Build human-friendly message
    const periodDesc = formatPeriod(existing);
    let subjectName = '';

    if (candidate.line_type === 'CONSUMPTION') {
      const matchedItem = candidate.item_id && lookups?.items
        ? lookups.items.find((it) => it.item_id === candidate.item_id)
        : null;
      subjectName = matchedItem?.item_name || candidate.item_label || candidate.item_description || 'This item';
      return {
        conflictingLine: existing,
        message: `Schedule conflict: Item '${subjectName}' is already scheduled for activity '${existing.activity_name || 'Existing'}' during an overlapping period (${periodDesc}). Overlapping schedules for the same item are not allowed.`,
      };
    }

    if (candidate.line_type === 'OUTPUT') {
      const matchedItem = candidate.item_id && lookups?.items
        ? lookups.items.find((it) => it.item_id === candidate.item_id)
        : null;
      subjectName = matchedItem?.item_name || candidate.item_label || candidate.item_description || candidate.activity_name || 'This output';
      return {
        conflictingLine: existing,
        message: `Schedule conflict: Output '${subjectName}' is already scheduled during an overlapping period (${periodDesc}).`,
      };
    }

    if (candidate.line_type === 'RESOURCE') {
      const matchedRes = candidate.resource_id && lookups?.resources
        ? lookups.resources.find((r) => r.resource_id === candidate.resource_id)
        : null;
      subjectName = matchedRes?.resource_name || candidate.resource_name || candidate.activity_name || 'This resource';
      return {
        conflictingLine: existing,
        message: `Schedule conflict: Resource '${subjectName}' is already scheduled for activity '${existing.activity_name || 'Existing'}' during an overlapping period (${periodDesc}).`,
      };
    }

    if (candidate.line_type === 'DESCRIPTIVE') {
      subjectName = candidate.kpi_metric || candidate.activity_name || 'This metric';
      return {
        conflictingLine: existing,
        message: `Schedule conflict: KPI metric '${subjectName}' is already scheduled during an overlapping period (${periodDesc}).`,
      };
    }

    if (candidate.line_type === 'OVERHEAD') {
      subjectName = candidate.overhead_category || candidate.activity_name || 'This overhead';
      return {
        conflictingLine: existing,
        message: `Schedule conflict: Overhead category '${subjectName}' is already scheduled during an overlapping period (${periodDesc}).`,
      };
    }

    return {
      conflictingLine: existing,
      message: `Schedule conflict: Activity '${candidate.activity_name || candidate.line_type}' is already scheduled during an overlapping period (${periodDesc}).`,
    };
  }

  return null;
}
