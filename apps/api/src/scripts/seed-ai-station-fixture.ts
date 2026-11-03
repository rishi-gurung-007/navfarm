/**
 * Applies the AI Station set-up the client's documents describe (ai-station-fixture.lib.ts) through the running API, so validation and
 * audit run as they do for a user: the rules of Tempo, L-Line and Z-Line, the three Collector IDs, and SOP 21's five-point body condition
 * scale. A NAMED FIXTURE, not a default: nothing in the application needs it, and everything it creates is edited like any other row.
 * Read-only by default; --apply writes; safe to repeat (anything that exists is left alone).
 *
 *   pnpm nx run api:db-seed-ai-station-fixture                                        # print the plan
 *   pnpm nx run api:db-seed-ai-station-fixture -- --tempo-farms POR100,LOC-002 --multiplier-farm MUL100 --apply
 *   --tempo-farms     codes of the farms Tempo semen is for (Grasmere, Porta, Richlands, LionHead, Villa Franca on the client's sheet)
 *   --multiplier-farm code of the Multiplier Farm Z-Line semen is for
 *   Farms are given, never matched by name: a wrong guess would send semen to the wrong farm. Left out, that destination stays open.
 *   env: API_URL (http://127.0.0.1:2877/api/v1), SEED_EMAIL, SEED_PASSWORD
 */
import { Action, Existing, planFixture } from './ai-station-fixture.lib';

const API = (process.env.API_URL || 'http://127.0.0.1:2877/api/v1').replace(/\/$/, '');
const EMAIL = process.env.SEED_EMAIL || 'tenant.admin@triplec.local';
const PASSWORD = process.env.SEED_PASSWORD || '12345678';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const valueOf = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

async function run() {
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!login.ok) throw new Error(`Login failed (${login.status}). Is the API running at ${API}?`);
  const body: any = await login.json();
  const token: string = body.access_token ?? body.data?.access_token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const call = async (method: string, path: string, payload?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method, body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-tenant-id': claims.tenantId, 'x-active-company-id': claims.companyId, 'x-workspace-scope': 'COMPANY' },
    });
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, json, message: json?.error?.message ?? json?.message ?? text.slice(0, 200) };
  };
  const rows = async (path: string): Promise<any[]> => (await call('GET', path)).json?.data ?? [];
  console.log(`${APPLY ? 'APPLY' : 'READ-ONLY'} against ${API} (company ${claims.companyId})`);

  // ---- the farms the client's sheets name, given by code
  const farms = await rows('/location?locationType=FARM&rootOnly=true&isActive=true&limit=500');
  const farmId = (code: string) => {
    const f = farms.find((x) => String(x.location_code).toLowerCase() === code.trim().toLowerCase());
    if (!f) throw new Error(`No active farm with code "${code}". Farms here: ${farms.map((x) => x.location_code).join(', ') || 'none'}.`);
    return f.location_id as string;
  };
  const tempoFarmIds = (valueOf('--tempo-farms') ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(farmId);
  const multiplier = valueOf('--multiplier-farm');
  const choices = { tempoFarmIds, multiplierFarmId: multiplier ? farmId(multiplier) : null };

  // ---- what is already there
  const breeds = (await rows('/breed?limit=500')).filter((b) => b.company_id === claims.companyId);
  const setups = await rows('/breeding-line-setup?limit=200');
  const existing: Existing = {
    breeds: new Map(breeds.map((b) => [String(b.breed_code), String(b.breed_id)])),
    setupBreedIds: new Set(setups.map((s) => (s.breed_id ?? '') as string)),
    scaleScores: new Set((await rows('/bcs-scale?limit=200')).filter((r) => !r.breed_id).map((r) => Number(r.score))),
    collectorCodes: new Set((await rows('/semen-collector?limit=200')).map((c) => String(c.collector_code))),
  };

  const plan = planFixture(existing, choices);
  let made = 0, refused = 0;
  for (const a of plan) {
    const label = `${a.kind} ${a.key}`;
    if (a.do !== 'create') { console.log(`${label}: ${a.do === 'skip' ? 'SKIPPED' : 'exists'} — ${a.why}`); continue; }
    console.log(`${label}: ${APPLY ? 'creating' : 'would be created'}`);
    for (const n of a.notes ?? []) console.log(`    [${n.source}] ${n.field}: ${n.text}`);
    if (!APPLY) continue;
    const res = await call('POST', a.path, a.body);
    if (res.status >= 300) { refused += 1; console.log(`    REFUSED ${res.status} ${res.message}`); } else made += 1;
  }
  console.log(`${APPLY ? 'Done' : 'Plan only'}: ${made} created, ${refused} refused.${APPLY ? '' : ' Run with --apply to write.'}`);
  console.log('Not set (the documents do not give them): genetic-level TSI bands, the Tempo label, rest days, motility floor, collector names, any colorant stock item.');
  if (refused) process.exitCode = 1;
}
run().catch((e) => { console.error(e); process.exitCode = 1; });
