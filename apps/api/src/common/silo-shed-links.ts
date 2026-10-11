/**
 * "Links effective on a date": the ONE place that reads silo_shed_link's
 * effective_from / effective_to (Master r8). A link serves its shed from
 * effective_from to effective_to inclusive; a null end is open, and a link
 * with no dates is always effective. The feed forecast, the batch daily-data
 * silo pick, the stock count's house list and a location's attached silos all
 * read links through this, so they cannot disagree about which silo a shed
 * draws from on a day.
 */
import { and, isNull, lte, gte, or, type SQL } from 'drizzle-orm';
import * as schema from '../core/database/schema';

export interface DatedLink { effectiveFrom?: string | null; effectiveTo?: string | null }

/** Pure form, for links already in memory. Dates are YYYY-MM-DD. */
export function linkEffectiveOn(link: DatedLink, date: string): boolean {
  return (!link.effectiveFrom || link.effectiveFrom <= date) && (!link.effectiveTo || link.effectiveTo >= date);
}

export function linksEffectiveOn<T extends DatedLink>(links: T[], date: string): T[] {
  return links.filter((link) => linkEffectiveOn(link, date));
}

/** The same rule as a WHERE condition on silo_shed_link. */
export function siloShedLinkEffectiveOn(date: string): SQL {
  return and(
    or(isNull(schema.siloShedLink.effective_from), lte(schema.siloShedLink.effective_from, date)),
    or(isNull(schema.siloShedLink.effective_to), gte(schema.siloShedLink.effective_to, date)),
  )!;
}

/** Today as YYYY-MM-DD, for the screens that show current links. */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);
