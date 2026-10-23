/**
 * Switches on the litter's cost-at-birth journal (BBP: Dr Piglets Inventory - Current Biological Asset / Cr Biological Asset WIP). It writes through the running
 * API, like the other seeds: a GL account 1055 "Piglets Inventory - Current Biological Assets" if the chart has none, and a GL mapping for BIO_LITTER_BIRTH
 * (debit 1055, credit 1050, the pre-mature account where the sow's capitalised WIP sits). Without the mapping a farrowing still moves the sow's cost into the new lot
 * in the bio-asset ledger, but posts no journal. Read-only by default; --apply writes; safe to repeat.
 *
 * CAUTION for Finance: later postings on a piglet lot (mortality, consumption) still hit 1050, so with this on, 1055 is relieved only through the ledger until the
 * gilt-selection and loss legs are mapped (decision D8).
 *
 *   pnpm nx run api:db-seed-litter-birth-gl              # print the plan
 *   pnpm nx run api:db-seed-litter-birth-gl -- --apply
 *   env: API_URL (http://127.0.0.1:2877/api/v1), SEED_EMAIL (tenant.admin@triplec.local), SEED_PASSWORD (12345678)
 */
const API = (process.env.API_URL || 'http://127.0.0.1:2877/api/v1').replace(/\/$/, '');
const EMAIL = process.env.SEED_EMAIL || 'tenant.admin@triplec.local';
const PASSWORD = process.env.SEED_PASSWORD || '12345678';
const APPLY = process.argv.slice(2).includes('--apply');

async function login() {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!res.ok) throw new Error(`Login as ${EMAIL} failed (${res.status}). Is the API running at ${API}?`);
  const body: any = await res.json();
  const token: string = body.access_token ?? body.data?.access_token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return { token, tenantId: claims.tenantId as string, companyId: claims.companyId as string };
}

async function run() {
  const s = await login();
  const call = async (method: string, path: string, body?: unknown, scope = 'COMPANY') => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json', 'x-tenant-id': s.tenantId, 'x-active-company-id': s.companyId, 'x-workspace-scope': scope },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, json };
  };
  console.log(`${APPLY ? 'APPLY' : 'READ-ONLY'} against ${API} (company ${s.companyId})`);

  const chart = (await call('GET', '/gl-account?limit=500')).json.data as any[];
  const byCode = new Map<string, any>(chart.map((a) => [a.account_code, a]));
  const wip = byCode.get('1050');
  if (!wip) throw new Error('The chart has no account 1050 (Biological Assets - Pre-mature).');
  let inventory = byCode.get('1055');
  if (inventory) console.log('GL 1055: exists, left alone');
  else if (!APPLY) console.log('GL 1055 Piglets Inventory - Current Biological Assets: would be created');
  else {
    const made = await call('POST', '/gl-account', { account_code: '1055', account_name: 'Piglets Inventory - Current Biological Assets', account_type: 'ASSET', nob_id: wip.nob_id, lob_id: wip.lob_id });
    if (made.status >= 300) throw new Error(`Could not create GL 1055: ${made.status} ${JSON.stringify(made.json?.error ?? made.json)}`);
    inventory = made.json.data ?? made.json;
    console.log('GL 1055: created');
  }

  const mappings = (await call('GET', '/gl-mapping?limit=500')).json.data as any[];
  if (mappings.some((m) => m.transaction_type === 'BIO_LITTER_BIRTH')) { console.log('GL mapping BIO_LITTER_BIRTH: exists, left alone'); return; }
  if (!APPLY) { console.log('GL mapping BIO_LITTER_BIRTH (debit 1055, credit 1050): would be created. Run again with --apply.'); return; }
  const made = await call('POST', '/gl-mapping', { transaction_type: 'BIO_LITTER_BIRTH', debit_gl_account_id: inventory.gl_account_id, credit_gl_account_id: wip.gl_account_id });
  if (made.status >= 300) throw new Error(`Could not create the mapping: ${made.status} ${JSON.stringify(made.json?.error ?? made.json)}`);
  console.log('GL mapping BIO_LITTER_BIRTH: created (Dr 1055 / Cr 1050)');
}

run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
