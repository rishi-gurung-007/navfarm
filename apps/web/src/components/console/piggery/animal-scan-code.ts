/**
 * What an animal's QR code and barcode carry, and how a scan is read back.
 *
 * Both codes encode the animal code alone (the register's own identifier, issued
 * by the ANIMAL_PIGGERY number series and never edited afterwards). Nothing is
 * stored: the codes are drawn from the code each time they are shown, so a label
 * printed today still scans after any other field on the animal changes. A plain
 * code, not a URL, because the label has to outlive whatever host the app is
 * served from.
 */
export function animalScanValue(animal: { animal_code?: unknown }): string {
  return String(animal.animal_code ?? '').trim();
}

/**
 * The code to look up from whatever a scanner or a person produced.
 *
 * USB scanners type like a keyboard and many add a prefix or suffix (a carriage
 * return, a tab, a GS separator), and a pasted value carries stray whitespace, so
 * control characters are dropped and the ends trimmed. A link to the scan screen
 * (`/livestock/scan?code=…`) is read for its code, so a shared link works too.
 */
export function parseScannedCode(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  const text = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) {
    try {
      const code = new URL(text).searchParams.get('code');
      if (code && code.trim()) return code.trim();
    } catch {
      // Not a parsable URL: look it up as typed.
    }
  }
  return text;
}

/** The file a downloaded label is saved as: the code, made safe for every file system. */
export function labelFileName(code: string): string {
  const safe = code.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safe || 'animal'}-label.png`;
}

type Row = Record<string, any>;

export interface ScanEvent {
  key: string;
  date: string;
  title: string;
  detail: string;
}

const words = (v: unknown) => String(v ?? '').replaceAll('_', ' ').toLowerCase();

/**
 * Her latest events, newest first, from what `/animal/:id/breeding` already
 * returns (matings from either side, farrowings, posted transfers) plus her entry
 * and exit on the register. Nothing is fetched for this alone.
 */
export function recentScanEvents(animal: Row, breeding: Row | null, limit = 6): ScanEvent[] {
  const events: ScanEvent[] = [];
  for (const m of breeding?.matings ?? []) {
    if (!m.mating_date) continue;
    const sire = m.role === 'SIRE';
    const partner = sire ? m.sow_code : m.boar_code || (m.semen_lot_no ? `lot ${m.semen_lot_no}` : '');
    events.push({
      key: `mating-${m.breeding_id}`,
      date: String(m.mating_date),
      title: sire ? `Served ${partner || 'a sow'}` : `Served by ${partner || 'a boar'}`,
      detail: [words(m.mating_type), m.parity_number ? `parity ${m.parity_number}` : ''].filter(Boolean).join(' · '),
    });
  }
  for (const f of breeding?.farrowings ?? []) {
    if (!f.farrowing_date) continue;
    events.push({
      key: `farrow-${f.farrow_id}`,
      date: String(f.farrowing_date),
      title: `Farrowed ${Number(f.piglets_born_live) || 0} born live`,
      detail: [f.parity_number ? `parity ${f.parity_number}` : '', f.piglets_weaned ? `${f.piglets_weaned} weaned` : '']
        .filter(Boolean)
        .join(' · '),
    });
  }
  for (const t of breeding?.transfers ?? []) {
    if (!t.transfer_date) continue;
    const to = [t.to_pen_code, t.to_batch_no].filter(Boolean).join(' / ');
    events.push({
      key: `transfer-${t.transfer_id}`,
      date: String(t.transfer_date),
      title: to ? `Moved to ${to}` : 'Moved',
      detail: [t.transfer_no, words(t.reason)].filter(Boolean).join(' · '),
    });
  }
  if (animal.entry_date)
    events.push({ key: 'entry', date: String(animal.entry_date), title: 'Entered the herd', detail: words(animal.entry_type) });
  if (animal.disposal_date)
    events.push({ key: 'exit', date: String(animal.disposal_date), title: 'Left the herd', detail: words(animal.disposal_type) });
  return events
    .sort((a, b) => b.date.slice(0, 10).localeCompare(a.date.slice(0, 10)))
    .slice(0, limit);
}
