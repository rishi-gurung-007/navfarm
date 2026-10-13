/**
 * Feed Consumption lines of a breed lifecycle stage (Rishi, 13 Oct).
 *
 * A stage can be fed different feeds over its days: Day 1-8 one feed, Day 9-20 the next. The data model already
 * stores that as several breed_lifecycle_stages rows for the same stage, each with its own day range and feed, and
 * everything that plans or posts feed (scheduler, forecast, requisition, next diet) reads those rows. These rules let
 * the form show the stage once, with its feeds as lines: one line = one of the stage's rows.
 */
import { BadRequestException } from '@nestjs/common';

export interface FeedLine {
  period_from: number;
  period_to: number;
  feed_item_id: string;
  feed_form?: string | null;
  feed_qty_per_head_per_day_kg: number;
  feed_wastage_pct?: number | null;
}

/**
 * Lines sorted by From, each with a feed and a daily quantity, From <= To, and following one another with no gap
 * and no overlap (1-8 then 9-20, never 1-8 then 8-20 or 1-8 then 12-20).
 */
export function validateFeedLines(lines: FeedLine[]): FeedLine[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new BadRequestException('Add at least one feed line.');
  }
  const sorted = [...lines].map((l) => ({
    ...l,
    period_from: Number(l.period_from),
    period_to: Number(l.period_to),
    feed_qty_per_head_per_day_kg: Number(l.feed_qty_per_head_per_day_kg),
    feed_wastage_pct: l.feed_wastage_pct == null || (l.feed_wastage_pct as unknown) === '' ? null : Number(l.feed_wastage_pct),
  })).sort((a, b) => a.period_from - b.period_from);
  sorted.forEach((l, i) => {
    const n = i + 1;
    if (!Number.isInteger(l.period_from) || !Number.isInteger(l.period_to) || l.period_from < 0 || l.period_to < 0) {
      throw new BadRequestException(`Feed line ${n}: From and To must be whole numbers.`);
    }
    if (l.period_from > l.period_to) {
      throw new BadRequestException(`Feed line ${n}: From (${l.period_from}) cannot be after To (${l.period_to}).`);
    }
    if (!l.feed_item_id) throw new BadRequestException(`Feed line ${n} (${l.period_from}-${l.period_to}): choose the feed.`);
    if (!Number.isFinite(l.feed_qty_per_head_per_day_kg) || l.feed_qty_per_head_per_day_kg <= 0) {
      throw new BadRequestException(`Feed line ${n} (${l.period_from}-${l.period_to}): enter the daily feed per head (more than 0).`);
    }
    if (l.feed_wastage_pct != null && (!Number.isFinite(l.feed_wastage_pct) || l.feed_wastage_pct < 0 || l.feed_wastage_pct > 100)) {
      throw new BadRequestException(`Feed line ${n} (${l.period_from}-${l.period_to}): wastage must be between 0 and 100.`);
    }
    if (i > 0) {
      const prev = sorted[i - 1];
      if (l.period_from <= prev.period_to) {
        throw new BadRequestException(`Feed lines ${prev.period_from}-${prev.period_to} and ${l.period_from}-${l.period_to} overlap: each day can have one feed line only.`);
      }
      if (l.period_from > prev.period_to + 1) {
        throw new BadRequestException(`Feed lines leave a gap between ${prev.period_to} and ${l.period_from}: days ${prev.period_to + 1}-${l.period_from - 1} have no feed. Lines must follow one another.`);
      }
    }
  });
  return sorted;
}

/** The columns that make rows the same stage record (a line each); null-safe. */
export const SIBLING_KEY_COLUMNS = ['breed_id', 'stage_id', 'farm_id', 'effective_from', 'effective_to', 'season_type', 'category'] as const;

export function siblingKey(row: Record<string, unknown>): string {
  return SIBLING_KEY_COLUMNS.map((c) => (row[c] == null ? '' : String(row[c]).slice(0, 36))).join('|');
}

/** A stage record's lines, from its rows (sorted by From), as the form reads them. */
export function linesOf(rows: Array<Record<string, any>>): FeedLine[] {
  return [...rows]
    .sort((a, b) => Number(a.period_from) - Number(b.period_from))
    .filter((r) => r.feed_item_id)
    .map((r) => ({
      period_from: Number(r.period_from),
      period_to: Number(r.period_to),
      feed_item_id: r.feed_item_id,
      feed_form: r.feed_form ?? null,
      feed_qty_per_head_per_day_kg: Number(r.feed_qty_per_head_per_day_kg),
      feed_wastage_pct: r.feed_wastage_pct == null ? null : Number(r.feed_wastage_pct),
    }));
}
