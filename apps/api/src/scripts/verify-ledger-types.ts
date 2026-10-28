/**
 * Reads both ledgers back from MySQL and checks every Entry Type / Transaction Type pair the code can write: that it is in the database, that no
 * row holds a pair the map refuses, and that every Bio Asset Ledger row reads back as an event. READ-ONLY. Exits 1 when a pair that should be
 * there is missing, or a row breaks the map. Pairs that cannot be seeded today are listed with the reason and do not fail the check.
 *
 *   pnpm nx run api:db-verify-ledger-types                         # nf_devco
 *   pnpm nx run api:db-verify-ledger-types -- --database=nf_x
 *
 * Seed the postings first with:  pnpm nx run api:db-demo-chapters -- --apply --chapter=17-ledger-types
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { BIO_ENTRY_TYPES_BY_TRANSACTION_TYPE, bioCodes, bioEventOf } from '../modules/inventory/bio-asset-ledger/bio-asset-ledger.types';
import { ENTRY_TYPES_BY_TRANSACTION_TYPE, INVENTORY_ENTRY_TYPES, INVENTORY_TRANSACTION_TYPES } from '../modules/inventory/inventory-ledger/inventory-ledger.types';

/** Pairs nothing can post today, with the reason. They are reported, never failed. */
const INVENTORY_KNOWN_GAPS: Record<string, string> = {
  'SALES/NEGATIVE': 'nothing writes a sale to the Inventory Ledger yet',
  'OVERHEAD/OVERHEAD': 'needs a scheduler line of type OVERHEAD, and none is configured in the dev tenant',
};
const BIO_KNOWN_GAPS: Record<string, string> = {
  'LITTER_COST': 'the lactation cost is posted when a litter is weaned — wean the pending litter on the Breeding screen',
  'BIO_FAIR_VALUE_RUN': 'a costing run posts fair value only for a FAIR_VALUE costing profile, and none is set up',
};

const database = process.argv.find((a) => a.startsWith('--database='))?.slice('--database='.length) || process.env.DEMO_TENANT_DATABASE || 'nf_devco';
const cell = (value: string | number, width: number) => String(value).padEnd(width);

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
  });
  const problems: string[] = [];
  const out = (line = '') => console.log(line);

  try {
    await db.query('SET SESSION TRANSACTION READ ONLY');

    // ───────── Inventory Ledger ─────────
    const [inv] = await db.query<RowDataPacket[]>('SELECT entry_type, transaction_type, reversal_of_ledger_id IS NOT NULL AS is_reversal, COUNT(*) n FROM inventory_ledger GROUP BY 1, 2, 3');
    // A reversal keeps the original's transaction type and flips its entry type, so it is checked against the flipped pair and not counted as an original.
    const invCount = new Map(inv.filter((r) => !r.is_reversal).map((r) => [`${r.transaction_type}/${r.entry_type}`, Number(r.n)]));
    const flip = (entry: string) => (entry === 'POSITIVE' ? 'NEGATIVE' : entry === 'NEGATIVE' ? 'POSITIVE' : entry);
    out(`Inventory Ledger (${database})`);
    out(`  ${cell('TRANSACTION TYPE', 20)}${cell('ENTRY TYPE', 14)}${cell('ROWS', 8)}`);
    for (const transaction of INVENTORY_TRANSACTION_TYPES) {
      for (const entry of ENTRY_TYPES_BY_TRANSACTION_TYPE[transaction]) {
        const key = `${transaction}/${entry}`;
        const n = invCount.get(key) ?? 0;
        const gap = INVENTORY_KNOWN_GAPS[key];
        out(`  ${cell(transaction, 20)}${cell(entry, 14)}${n > 0 ? `✔ ${n}` : gap ? `– cannot be seeded: ${gap}` : '✘ MISSING'}`);
        if (n === 0 && !gap) problems.push(`Inventory Ledger: no ${transaction} / ${entry} row`);
      }
    }
    for (const r of inv) {
      const allowed = (ENTRY_TYPES_BY_TRANSACTION_TYPE as Record<string, readonly string[] | undefined>)[r.transaction_type];
      const fits = allowed && (r.is_reversal ? allowed.some((e) => flip(e) === r.entry_type) : allowed.includes(r.entry_type));
      if (!fits) problems.push(`Inventory Ledger: ${r.n} ${r.is_reversal ? 'reversal ' : ''}row(s) hold ${r.transaction_type} / ${r.entry_type}, which the map does not allow`);
    }
    const reversals = inv.filter((r) => r.is_reversal).reduce((n, r) => n + Number(r.n), 0);
    out(`  reversal rows (marked by reversal_of_ledger_id; the original's transaction type, the opposite entry type): ${reversals}`);
    const [glRows] = await db.query<RowDataPacket[]>("SELECT GROUP_CONCAT(DISTINCT gl_mapping_type ORDER BY gl_mapping_type) kinds FROM inventory_ledger WHERE gl_mapping_type IS NOT NULL");
    out(`  GL rules named on rows: ${glRows[0]?.kinds ?? 'none'}`);

    // ───────── Bio Asset Ledger ─────────
    const [bio] = await db.query<RowDataPacket[]>('SELECT entry_type, transaction_type, document_type, COUNT(*) n FROM bio_asset_ledger GROUP BY 1, 2, 3');
    const bioCount = new Map(bio.map((r) => [`${r.document_type}|${r.entry_type}|${r.transaction_type}`, Number(r.n)]));
    const catalogue: Array<[string, { entry_type: string; transaction_type: string; document_type: string }]> = [
      ['animals received on a GRN', bioCodes.purchase()],
      ['batch bought', bioCodes.batchReceipt({ born: false })],
      ['batch born on the farm', bioCodes.batchReceipt({ born: true })],
      ['animal registered', bioCodes.registration()],
      ['feed capitalised', bioCodes.feed()],
      ['overhead capitalised', bioCodes.overhead()],
      ['semen used by a mating, charged to the sow', bioCodes.semen()],
      ['birth cost, sow gives', bioCodes.costAllocation({ gives: true, lactation: false })],
      ['birth cost, litter takes', bioCodes.costAllocation({ gives: false, lactation: false })],
      ['lactation cost, sow gives', bioCodes.costAllocation({ gives: true, lactation: true })],
      ['lactation cost, litter takes', bioCodes.costAllocation({ gives: false, lactation: true })],
      ['batch transfer out', bioCodes.batchTransfer({ out: true })],
      ['batch transfer in', bioCodes.batchTransfer({ out: false })],
      ['amortisation, costing run', bioCodes.amortisation({ source: 'RUN' })],
      ['amortisation, batch', bioCodes.amortisation({ source: 'BATCH' })],
      ['fair value gain, costing run', bioCodes.fairValue({ source: 'RUN', gain: true })],
      ['fair value loss, costing run', bioCodes.fairValue({ source: 'RUN', gain: false })],
      ['fair value gain, batch', bioCodes.fairValue({ source: 'BATCH', gain: true })],
      ['fair value loss, batch', bioCodes.fairValue({ source: 'BATCH', gain: false })],
      ['death', bioCodes.mortality()],
      ['gilt selected', bioCodes.giltSelection()],
      ['maturity marker', bioCodes.maturity()],
      ['harvest (output on a mature batch)', bioCodes.harvest()],
      ['sale, batch', bioCodes.disposal({ sold: true, scope: 'BATCH' })],
      ['other exit, batch', bioCodes.disposal({ sold: false, scope: 'BATCH' })],
      ['sale, animal', bioCodes.disposal({ sold: true, scope: 'ANIMAL' })],
      ['other exit, animal', bioCodes.disposal({ sold: false, scope: 'ANIMAL' })],
    ];
    out('');
    out(`Bio Asset Ledger (${database})`);
    out(`  ${cell('EVENT', 38)}${cell('ENTRY TYPE', 13)}${cell('TRANSACTION TYPE', 19)}${cell('DOCUMENT TYPE', 21)}ROWS`);
    for (const [label, codes] of catalogue) {
      const n = bioCount.get(`${codes.document_type}|${codes.entry_type}|${codes.transaction_type}`) ?? 0;
      const gap = BIO_KNOWN_GAPS[codes.document_type];
      out(`  ${cell(label, 38)}${cell(codes.entry_type, 13)}${cell(codes.transaction_type, 19)}${cell(codes.document_type, 21)}${n > 0 ? `✔ ${n}` : gap ? `– cannot be seeded: ${gap}` : '✘ MISSING'}`);
      if (n === 0 && !gap) problems.push(`Bio Asset Ledger: no ${label} row (${codes.entry_type} / ${codes.transaction_type} / ${codes.document_type})`);
    }
    const manual = bio.filter((r) => r.document_type === 'MANUAL_ENTRY').reduce((n, r) => n + Number(r.n), 0);
    out(`  ${cell('manual entries (POST /bio-asset-ledger)', 38)}${manual > 0 ? `✔ ${manual}` : '– none yet'}`);
    for (const r of bio) {
      const row = { entry_type: r.entry_type, transaction_type: r.transaction_type, document_type: r.document_type };
      const allowed = BIO_ENTRY_TYPES_BY_TRANSACTION_TYPE[r.transaction_type as keyof typeof BIO_ENTRY_TYPES_BY_TRANSACTION_TYPE];
      if (!allowed || !(allowed as readonly string[]).includes(r.entry_type)) problems.push(`Bio Asset Ledger: ${r.n} row(s) hold ${r.transaction_type} / ${r.entry_type}, which the map does not allow`);
      if (r.document_type !== 'MANUAL_ENTRY' && bioEventOf(row) === null) problems.push(`Bio Asset Ledger: ${r.n} row(s) with document ${r.document_type} (${r.entry_type} / ${r.transaction_type}) read back as no event`);
    }
    const [nullRows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) n FROM bio_asset_ledger WHERE document_type IS NULL OR document_type = ''");
    if (Number(nullRows[0]?.n)) problems.push(`Bio Asset Ledger: ${nullRows[0].n} row(s) have no document type, which says which event a row is`);

    out('');
    out(`Entry types in use:        Inventory ${[...new Set(inv.map((r) => r.entry_type))].sort().join(', ')}  |  Bio ${[...new Set(bio.map((r) => r.entry_type))].sort().join(', ')}`);
    out(`Transaction types in use:  Inventory ${[...new Set(inv.map((r) => r.transaction_type))].sort().join(', ')}  |  Bio ${[...new Set(bio.map((r) => r.transaction_type))].sort().join(', ')}`);
    out(`Entry types not in use:    Inventory ${INVENTORY_ENTRY_TYPES.filter((e) => !inv.some((r) => r.entry_type === e)).join(', ') || 'none'}  |  Bio ${INVENTORY_ENTRY_TYPES.filter((e) => !bio.some((r) => r.entry_type === e)).join(', ') || 'none'}`);
  } finally {
    await db.end();
  }

  out('');
  if (problems.length) {
    out(`FAILED — ${problems.length} problem(s):`);
    for (const p of problems) out(`  ✘ ${p}`);
    process.exit(1);
  }
  out('OK — every pair the code can write is present, except the ones listed as not seedable, and no row breaks the map.');
}

main().catch((error) => { console.error(error); process.exit(2); });
