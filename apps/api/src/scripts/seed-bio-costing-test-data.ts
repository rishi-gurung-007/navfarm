/**
 * Seeds what a tester needs before exercising bio-asset costing end to end: an accumulated-amortisation account (the chart has none) and the
 * costing terms on the demo catalog's sow item (the TDD Item Card's Bio Asset Costing tab), with its GL accounts. It writes through the running
 * API, not SQL, so every rule the real item form meets applies to the seed too. It does NOT date animals, run a period or register an animal:
 * those are the steps being tested (docs/TEST-GUIDE-bio-asset-costing-full-flow.md).
 *
 * Read-only by default (prints the plan); --apply writes. Safe to repeat: whatever already exists is left alone.
 *
 *   pnpm nx run api:db-seed-bio-costing-test-data              # print the plan
 *   pnpm nx run api:db-seed-bio-costing-test-data -- --apply
 *   env: API_URL (http://127.0.0.1:2877/api/v1), SEED_EMAIL (tenant.admin@triplec.local), SEED_PASSWORD (12345678), SEED_EFFECTIVE_FROM (2026-01-01)
 *
 * [ours] choices, awaiting confirmation: monthly runs, Costing From 2026-01-01 (the documents give none; the scheduler's catch-up starts there),
 * a run that calculates and waits for a person to post (auto_post off), and no costing terms on the boar item: the demo herd's one boar is
 * deliberately left uncosted so the "no costing terms" path can be tested.
 */

const API = (process.env.API_URL || 'http://127.0.0.1:2877/api/v1').replace(/\/$/, '');
const EMAIL = process.env.SEED_EMAIL || 'tenant.admin@triplec.local';
const PASSWORD = process.env.SEED_PASSWORD || '12345678';
const EFFECTIVE_FROM = process.env.SEED_EFFECTIVE_FROM || '2026-01-01';
const APPLY = process.argv.slice(2).includes('--apply');

const ACCUMULATED = { account_code: '1065', account_name: 'Accumulated Amortisation - Bio Assets', account_type: 'ASSET' };

interface Session { token: string; tenantId: string; companyId: string }

async function login(): Promise<Session> {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!res.ok) throw new Error(`Login as ${EMAIL} failed (${res.status}). Is the API running at ${API}?`);
  const body: any = await res.json();
  const token: string = body.access_token ?? body.data?.access_token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return { token, tenantId: claims.tenantId, companyId: claims.companyId };
}

async function call(s: Session, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', 'x-tenant-id': s.tenantId, 'x-active-company-id': s.companyId,
      // Master data scope matching is exact: the chart lives at company scope.
      'x-workspace-scope': 'COMPANY',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function refusal(r: { status: number; json: any }): string {
  const m = r.json?.error?.message ?? r.json?.message ?? r.json?.raw;
  return `${r.status}: ${Array.isArray(m) ? m.join('; ') : m}`;
}

async function run() {
  const s = await login();
  const log: string[] = [];
  const say = (line: string) => { log.push(line); console.log(line); };
  say(`${APPLY ? 'APPLY' : 'READ-ONLY'} against ${API} as ${EMAIL} (company ${s.companyId})`);

  // --- GL accounts ---
  const chart = (await call(s, 'GET', '/gl-account?limit=500')).json.data as any[];
  const byCode = new Map<string, any>(chart.map((a) => [a.account_code, a]));
  const need = { asset: '1060', expense: '5100', fairValue: '4020', writeOff: '5010' };
  for (const [what, code] of Object.entries(need)) if (!byCode.has(code)) throw new Error(`The chart has no account ${code} (${what}); the starter seed should have created it.`);
  const donor = byCode.get('1060');
  let accumulated = byCode.get(ACCUMULATED.account_code);
  if (accumulated) say(`GL ${ACCUMULATED.account_code}: exists, left alone`);
  else if (!APPLY) say(`GL ${ACCUMULATED.account_code} ${ACCUMULATED.account_name}: would be created (same NOB/LOB as 1060)`);
  else {
    const r = await call(s, 'POST', '/gl-account', { ...ACCUMULATED, nob_id: donor.nob_id, lob_id: donor.lob_id });
    if (r.status >= 300) throw new Error(`Could not create GL ${ACCUMULATED.account_code} - ${refusal(r)}`);
    accumulated = r.json.data ?? r.json;
    say(`GL ${ACCUMULATED.account_code}: created`);
  }
  const gl = {
    acquisition_gl_id: donor.gl_account_id, amort_expense_gl_id: byCode.get(need.expense).gl_account_id,
    fv_gain_loss_gl_id: byCode.get(need.fairValue).gl_account_id, writeoff_gl_id: byCode.get(need.writeOff).gl_account_id,
    accum_amort_gl_id: accumulated?.gl_account_id,
  };

  // --- the sow item: costing terms on its Bio Asset Costing tab ---
  const items = (await call(s, 'GET', '/item?limit=200&itemType=LIVING_ASSET')).json.data as any[];
  const sow = items.find((i) => i.item_name === 'Mature Parity Breeding Sow');
  if (!sow) throw new Error("The catalog has no item 'Mature Parity Breeding Sow'.");
  if (sow.bio_costing_method) say(`Item ${sow.item_code}: already has costing terms (${sow.bio_costing_method}), left alone`);
  else if (!APPLY) say(`Item ${sow.item_code} (${sow.item_name}): would take amortisation from week 33 over 36 months, residual 150 kg x 2.05, from ${EFFECTIVE_FROM}`);
  else {
    const terms = {
      bio_costing_method: 'AMORTIZATION', bio_gender: 'F', bio_start_age_weeks: 33, bio_useful_life_months: 36,
      bio_residual_rule: 'WEIGHT_X_PRICE', bio_residual_weight_kg: 150, bio_residual_price_per_kg: 2.05,
      bio_run_frequency: 'MONTHLY', bio_day_basis: 'FREQUENCY_DAYS', bio_effective_from: EFFECTIVE_FROM, bio_auto_post: false,
      bio_acquisition_gl_id: gl.acquisition_gl_id, bio_accum_amort_gl_id: gl.accum_amort_gl_id, bio_amort_expense_gl_id: gl.amort_expense_gl_id,
      bio_fv_gain_loss_gl_id: gl.fv_gain_loss_gl_id, bio_writeoff_gl_id: gl.writeoff_gl_id,
    };
    const made = await call(s, 'PUT', `/item/${sow.item_id}`, terms);
    if (made.status >= 300) throw new Error(`Could not set the costing terms on ${sow.item_code} - ${refusal(made)}`);
    say(`Item ${sow.item_code}: costing terms set from ${EFFECTIVE_FROM}`);
  }
  if (!APPLY) console.log('\nNothing written. Run again with --apply.');
}

run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
