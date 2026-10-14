/**
 * Feed Consumption lines of a breed lifecycle stage (Rishi, 13 Oct).
 *
 * A stage can be fed different feeds over its days: Day 1-8 one feed, Day 9-20 the next, and since 14 Oct several feeds
 * on the same days (A on 1-9 and B on 1-15). The data model already
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
  /** The daily feed per head as entered, in feed_qty_uom (the key keeps its old name; 14 Oct). */
  feed_qty_per_head_per_day_kg: number;
  /** A weight UOM code; blank = KG. */
  feed_qty_uom?: string | null;
  feed_wastage_pct?: number | null;
  /** Set by the service: the same amount in kg, which the scheduler, forecast and requisition read. */
  kg?: number;
}

/**
 * Lines sorted by From, each with a feed and a daily quantity and From <= To. Different feeds may share days
 * (Rishi, 14 Oct: A 1-9 with B 1-9, or A 1-9 with B 1-15); the same feed may not cover a day twice, which would
 * count it twice. Every day from the first From to the last To still has at least one feed.
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
    feed_qty_uom: l.feed_qty_uom ? String(l.feed_qty_uom).trim().toUpperCase() : 'KG',
    feed_wastage_pct: l.feed_wastage_pct == null || (l.feed_wastage_pct as unknown) === '' ? null : Number(l.feed_wastage_pct),
  })).sort((a, b) => a.period_from - b.period_from || a.period_to - b.period_to);
  let coveredTo = -Infinity;
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
    const twin = sorted.slice(0, i).find((p) => p.feed_item_id === l.feed_item_id && l.period_from <= p.period_to);
    if (twin) {
      throw new BadRequestException(`Feed lines ${twin.period_from}-${twin.period_to} and ${l.period_from}-${l.period_to} give the same feed on the same days: a feed can be on a day once.`);
    }
    if (i > 0 && l.period_from > coveredTo + 1) {
      throw new BadRequestException(`Feed lines leave a gap between ${coveredTo} and ${l.period_from}: days ${coveredTo + 1}-${l.period_from - 1} have no feed.`);
    }
    coveredTo = Math.max(coveredTo, l.period_to);
  });
  return sorted;
}

/** The columns that make rows the same stage record (a line each); null-safe. */
export const SIBLING_KEY_COLUMNS = ['breed_id', 'stage_id', 'farm_id', 'season_type', 'category'] as const;

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
      // As entered (0195); a row saved before then was entered in kg.
      feed_qty_per_head_per_day_kg: Number(r.feed_qty_per_head_per_day ?? r.feed_qty_per_head_per_day_kg),
      feed_qty_uom: r.feed_qty_uom ?? 'KG',
      feed_wastage_pct: r.feed_wastage_pct == null ? null : Number(r.feed_wastage_pct),
    }));
}
