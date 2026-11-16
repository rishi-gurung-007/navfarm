/**
 * The label a semen lot carries, and where its doses may go (plan 2026-11-02-ai-station-semen-collection, Phase 5). Pure. The
 * template, the destination farms and whether a use outside them warns or stops are all the line's setup; nothing here is the
 * client's figure.
 */

export interface LabelContext {
  /** The breeding line's code (its breed). */
  line: string;
  /** The tags of the boars in the lot (his tag, or his animal code when he has none). Several are joined with "+". */
  boarTags: string[];
  boarCodes: string[];
  /** The ISO week of the collection date and the year that week belongs to. */
  week: number;
  year: number;
  /** yyyy-mm-dd. */
  date: string;
  /** How many lots of this line already carry this week, plus one: for a template that must tell two lots of a week apart. */
  seq: number;
}

/**
 * Fills a label template. Tokens: {LINE} {BOAR_TAG} {BOAR_CODE} {WEEK} {YEAR} {DATE} {SEQ}; anything else is printed as typed. The
 * week is the plain ISO week number (no leading zero). When the line says to include the year and the template has no {YEAR}, the
 * year is added at the end after a hyphen. A template that gives nothing (empty) gives no label.
 */
export function renderLotLabel(template: string | null | undefined, ctx: LabelContext, includeYear = false): string | null {
  if (!template?.trim()) return null;
  const values: Record<string, string> = {
    LINE: ctx.line,
    BOAR_TAG: ctx.boarTags.join('+'),
    BOAR_CODE: ctx.boarCodes.join('+'),
    WEEK: String(ctx.week),
    YEAR: String(ctx.year),
    DATE: ctx.date,
    SEQ: String(ctx.seq),
  };
  let label = template.replace(/{([A-Z_]+)}/g, (whole, token: string) => (token in values ? values[token] : whole));
  if (includeYear && !template.includes('{YEAR}')) label += `-${ctx.year}`;
  return label.trim() || null;
}

export type Restriction = 'NONE' | 'WARN' | 'BLOCK';

export interface DestinationCheckInput {
  restriction: Restriction;
  /** The destination named on the lot (the plan's), which is then the only farm allowed. */
  lotDestination: string | null;
  /** Otherwise the line's own destination farms. */
  lineFarms: string[] | null;
  /** The farm the doses are going to; null when it cannot be told (nothing is then proved against it). */
  targetFarm: string | null;
}

export interface DestinationVerdict {
  verdict: 'OK' | 'WARN' | 'BLOCK';
  /** The farms the semen may go to, for the message. */
  allowed: string[];
}

/** Whether using or moving a lot's doses to a farm breaks the line's restriction. */
export function destinationVerdict(i: DestinationCheckInput): DestinationVerdict {
  const allowed = i.lotDestination ? [i.lotDestination] : (i.lineFarms ?? []);
  if (i.restriction === 'NONE' || !allowed.length || !i.targetFarm || allowed.includes(i.targetFarm)) return { verdict: 'OK', allowed };
  return { verdict: i.restriction, allowed };
}
