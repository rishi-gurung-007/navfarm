import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * One date style on every screen: DD/MM/YY, from `utils/date-short.ts` (field specification D16; the 2026-11 audit found
 * eight styles side by side — raw ISO, "03 Nov 2026", the browser's locale, "3 Nov 2026, 1:17 PM" and more).
 *
 * This fails when a screen goes back to the browser's date formatting, or prints a stored date straight into the page.
 * Show the date with `formatDate` / `formatDateTime`, and take one with `<DateInput>` (components/ui/date-input.tsx), never `<input type="date">`; a month heading ("November 2026") is a period, not a date, and is listed below.
 */
const SRC = join(__dirname, '..', 'src');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.next') walk(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.spec\./.test(entry.name)) out.push(path);
  }
  return out;
};

const FILES = walk(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));

/** Month headings are a period, not a date. */
const MONTH_HEADINGS = ['components/console/finance/bio-costing-runs-panel.tsx'];

const BROWSER_DATE_FORMATTING = /new Date\([^)]*\)\s*\.toLocaleString|\bparsed\.toLocaleString|toLocaleDateString|toLocaleTimeString|dateStyle\s*:|timeStyle\s*:|month:\s*['"](short|2-digit)['"]/;
// A stored date field printed as the page's text: {row.posting_date}, {x.expiry_date || NA} ...
const BARE_DATE_IN_PAGE = /(?<![=\w$])\{\s*[A-Za-z_][\w.?]*(_date|_on)\s*(\}|\|\||\?\?)/;

describe('one date style on every screen', () => {
  it('no screen formats a date with the browser locale', () => {
    const offenders = FILES.filter((f) => !MONTH_HEADINGS.includes(f.path) && BROWSER_DATE_FORMATTING.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('no screen prints a stored date straight into the page', () => {
    const offenders = FILES.filter((f) => f.path.endsWith('.tsx') && BARE_DATE_IN_PAGE.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('no form uses the browser\'s own date input, which shows the date in the browser\'s language', () => {
    const offenders = FILES.filter((f) => f.path.endsWith('.tsx') && f.path !== 'components/ui/date-input.tsx' && /type=(\{?['"])date\1/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
