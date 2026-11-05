import * as mysql from 'mysql2/promise';
const API = 'http://localhost:2877/api/v1';
let token = '';
async function call(m: string, p: string, b?: any) {
  const t0 = Date.now();
  const r = await fetch(API + p, {
    method: m,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: b ? JSON.stringify(b) : undefined,
  });
  const txt = await r.text();
  return { s: r.status, ms: Date.now() - t0, d: txt.slice(0, 400) };
}
(async () => {
  const l = await (
    await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'company.admin@ccc.com',
        password: '12345678',
      }),
    })
  ).json();
  token = (l.data ?? l).access_token;
  const db = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: process.env.DATABASE_PASSWORD,
    database: 'nf_ccc',
  });
  const [[row]] = await db.query<any>(
    `select h.batch_id, l.line_id from scheduler_line l join scheduler_header h using(scheduler_id) join batch_header b on b.batch_id=h.batch_id where b.batch_no='BATCH-000012' and l.kpi_metric='BODY_WEIGHT'`,
  );
  for (const d of ['2026-08-03', '2026-08-10'])
    console.log(
      'entry',
      d,
      await call('POST', `/batch/${row.batch_id}/daily-data`, {
        line_id: row.line_id,
        entry_date: d,
        entered_value: 110,
      }),
    );
  console.log(
    'post-day',
    await call('POST', `/batch/${row.batch_id}/post-day?date=2025-09-15`),
  );
  await db.end();
})();
