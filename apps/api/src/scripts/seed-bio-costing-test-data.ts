/**
 * Seeds what a tester needs before exercising bio-asset costing end to end (bio-asset costing, Phase 6): an accumulated-amortisation
 * account (the chart has none) and the two costing profiles the demo herd uses, ACTIVE, with their GL accounts and the local
 * fair-value rate. It writes through the running API, not SQL, so every rule the real screens meet (BBP origin/method, GL accounts,
 * one active profile per scope) applies to the seed too. It does NOT assign animals, run a period or register an animal: those are the
 * steps being tested (docs/TEST-GUIDE-bio-asset-costing-full-flow.md).
 *
 * Read-only by default (prints the plan); --apply writes. Safe to repeat: whatever already exists is left alone.
 *
 *   pnpm nx run api:db-seed-bio-costing-test-data              # print the plan
 *   pnpm nx run api:db-seed-bio-costing-test-data -- --apply
 *   env: API_URL (http://127.0.0.1:2877/api/v1), SEED_EMAIL (tenant.admin@triplec.local), SEED_PASSWORD (12345678), SEED_EFFECTIVE_FROM (2026-01-01)
 *
 * [ours] choices, awaiting the client: monthly runs, effective date 2026-01-01 (the documents give none; the scheduler's catch-up
 * starts there), profiles that calculate and wait for a person to post (auto_post off), and no male profile: the demo herd's one boar
 * is deliberately left uncosted so the "no profile fits" path can be tested.
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

  // --- the company's residual value: once per sex, not on each profile ---
  const haveSex = new Set(((await call(s, 'GET', '/bio-costing/residual-settings')).json.data as any[]).map((r) => r.gender));
  const residuals = [
    { gender: 'F', residual_rule: 'WEIGHT_X_PRICE', residual_weight_kg: 150, residual_price_per_kg: 2.05, effective_from: EFFECTIVE_FROM, note: 'Fixed Asset sheet: assumed 150 kg x 2.05' },
    { gender: 'M', residual_rule: 'NONE', effective_from: EFFECTIVE_FROM, note: 'Fixed Asset sheet: no residual for a male' },
  ];
  for (const r of residuals) {
    if (haveSex.has(r.gender)) { say(`Residual (${r.gender}): exists, left alone`); continue; }
    if (!APPLY) { say(`Residual (${r.gender}): would be set`); continue; }
    const made = await call(s, 'POST', '/bio-costing/residual-settings', r);
    if (made.status >= 300) throw new Error(`Could not set the ${r.gender} residual - ${refusal(made)}`);
    say(`Residual (${r.gender}): set from ${EFFECTIVE_FROM}`);
  }

  // --- profiles ---
  const existing = (await call(s, 'GET', '/bio-costing/profiles')).json.data as any[];
  const have = new Map<string, any>(existing.map((p) => [p.profile_code, p]));
  const common = { run_frequency: 'MONTHLY', day_basis: 'FREQUENCY_DAYS', tracking: 'INDIVIDUAL', auto_post: false, effective_from: EFFECTIVE_FROM, ...gl };
  const profiles = [
    { terms: { profile_code: 'IMP-F', name: 'Imported female - amortisation', origin: 'IMPORTED', gender: 'F', costing_method: 'AMORTIZATION', start_age_weeks: 33, useful_life_months: 36,
        residual_rule: 'NONE', ...common }, rate: null as any },
    // Local animals are amortised too (21 Oct 2026, Arun's instruction; awaiting the client's sign-off).
    { terms: { profile_code: 'LOC-F', name: 'Local female - amortisation', origin: 'LOCAL', gender: 'F', costing_method: 'AMORTIZATION', start_age_weeks: 33, useful_life_months: 36,
        residual_rule: 'NONE', ...common }, rate: null as any },
  ];
  for (const { terms, rate } of profiles) {
    const code = terms.profile_code;
    let p = have.get(code);
    if (p) { say(`Profile ${code}: exists (${p.status}), left alone`); continue; }
    if (!APPLY) { say(`Profile ${code} (${terms.costing_method}, ${terms.origin} ${terms.gender}): would be created and activated`); continue; }
    const made = await call(s, 'POST', '/bio-costing/profiles', terms);
    if (made.status >= 300) throw new Error(`Could not create ${code} - ${refusal(made)}`);
    p = made.json.data;
    if (rate) {
      const r = await call(s, 'POST', `/bio-costing/profiles/${p.profile_id}/rates`, rate);
      if (r.status >= 300) throw new Error(`Could not add the rate to ${code} - ${refusal(r)}`);
    }
    const act = await call(s, 'POST', `/bio-costing/profiles/${p.profile_id}/activate`);
    if (act.status >= 300) throw new Error(`Could not activate ${code} - ${refusal(act)}`);
    say(`Profile ${code}: created and activated${rate ? ' with its rate' : ''}`);
  }
  if (!APPLY) console.log('\nNothing written. Run again with --apply.');
}

run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
