import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The sidebar is built per workspace scope. When two scopes link to the same
 * route they must call it the same thing — a person who steps from company
 * scope down into an operational area should not find "Finance" has become
 * "Finance & Costing" and "Production" has become "Batches" while landing on
 * exactly the same page.
 *
 * Top-level items only: child links repeat their parent's href by design.
 */

const LAYOUT = join(__dirname, '../src/app/(app)/layout.tsx');

/**
 * The dashboard is deliberately named per scope — the page renders genuinely
 * different content depending on where you stand, so "Company Dashboard" and
 * "PIGGERY Dashboard" are describing different things at the same route.
 */
const SCOPE_SPECIFIC_BY_DESIGN = new Set([
  '/dashboard',
  // /companies is a list of every company at tenant scope, and one company's
  // own settings page at company scope — where the user has exactly one and
  // the route redirects straight into it. Calling both "Companies" described
  // the tenant page and misdescribed the company one.
  '/companies',
]);

/**
 * Top-level items sit at six spaces of indentation; children at ten. An item is
 * written either on one line or, when it has children, spread over several.
 */
function navByScope(): Record<string, Map<string, string>> {
  const lines = readFileSync(LAYOUT, 'utf8').split('\n');
  const scopes: Record<string, Map<string, string>> = {};
  let current: string | null = null;

  const record = (href: string, labelKey: string) => {
    if (!current) return;
    (scopes[current] ??= new Map()).set(href, labelKey);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/activeScope === "TENANT"/.test(line)) current = 'TENANT';
    else if (/activeScope === "COMPANY"/.test(line)) current = 'COMPANY';
    else if (/^ {2}\} else \{/.test(line) && current === 'COMPANY') current = 'OPERATIONAL';
    if (!current) continue;

    // Single-line item: { label: t("key"), href: "/path", ... }
    const inline = line.match(/^ {6}\{\s*label: t\("([A-Za-z0-9_]+)"[^)]*\)\s*,\s*href: "([^"]+)"/);
    if (inline) {
      record(inline[2], inline[1]);
      continue;
    }

    // Multi-line item: an opening brace, then label and href on their own lines.
    if (/^ {6}\{\s*$/.test(line)) {
      let labelKey: string | null = null;
      let href: string | null = null;
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        labelKey ??= lines[j].match(/^ {8}label: t\("([A-Za-z0-9_]+)"/)?.[1] ?? null;
        href ??= lines[j].match(/^ {8}href: "([^"]+)"/)?.[1] ?? null;
      }
      if (labelKey && href) record(href, labelKey);
    }
  }
  return scopes;
}

describe('Sidebar consistency across workspace scopes', () => {
  it('finds nav items in all three scopes', () => {
    const scopes = navByScope();
    expect(Object.keys(scopes).sort()).toEqual(['COMPANY', 'OPERATIONAL', 'TENANT']);
    for (const [scope, items] of Object.entries(scopes)) {
      expect({ scope, hasItems: items.size > 0 }).toEqual({ scope, hasItems: true });
    }
  });

  it('uses one label for a route wherever that route appears', () => {
    const scopes = navByScope();
    const labelsByHref = new Map<string, Map<string, string>>();

    for (const [scope, items] of Object.entries(scopes)) {
      for (const [href, labelKey] of items) {
        (labelsByHref.get(href) ?? labelsByHref.set(href, new Map()).get(href)!).set(scope, labelKey);
      }
    }

    const disagreements = [...labelsByHref.entries()]
      .filter(([href]) => !SCOPE_SPECIFIC_BY_DESIGN.has(href))
      .filter(([, byScope]) => new Set(byScope.values()).size > 1)
      .map(([href, byScope]) => ({ href, labels: Object.fromEntries(byScope) }))
      .sort((a, b) => a.href.localeCompare(b.href));

    expect(disagreements).toEqual([]);
  });

  /**
   * Labels agreeing is not enough: a person who steps from company scope down
   * into an operational area should find the same things in the same order.
   * Master Data sat 4th in company scope and 10th in operational, Batches 7th
   * and 2nd, Livestock 8th and 4th — so the muscle memory built in one scope
   * was wrong in the other.
   *
   * Only the RELATIVE order of shared routes is locked. A scope keeps its own
   * items and may interleave them (Schedulers sits next to Batches in an
   * operational area, and exists nowhere else); what it may not do is reshuffle
   * the routes it has in common with another scope.
   */
  it('keeps shared routes in one relative order across scopes', () => {
    const scopes = navByScope();
    const names = Object.keys(scopes).sort();
    const conflicts: { scopes: string; a: string[]; b: string[] }[] = [];

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const first = [...scopes[names[i]].keys()];
        const second = [...scopes[names[j]].keys()];
        const shared = new Set(first.filter((href) => second.includes(href)));
        const a = first.filter((href) => shared.has(href));
        const b = second.filter((href) => shared.has(href));
        if (a.join() !== b.join()) conflicts.push({ scopes: `${names[i]} vs ${names[j]}`, a, b });
      }
    }

    expect(conflicts).toEqual([]);
  });
});
