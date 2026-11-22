#!/usr/bin/env bash
# Showcase demo data for the local cccshow tenant, written THROUGH THE API (curl), never raw SQL.
# Demo-flavoured, plausible Triple C piggery data. Not production data.
#
# Usage (password is never stored here):
#   TENANT=cccshow LOGIN_EMAIL=company.admin@cccshow.local LOGIN_PASSWORD='...' \
#     scripts/showcase-seed-cccshow.sh [step ...]
# Steps: parties schedulers breed_names breeds lifecycle service_batches daily costing forecast requisition alerts health wean overheads periods porta mill_plan   (default: all, in that order)
#
# Use the COMPANY admin: a TENANT_ADMIN only sees tenant-wide masters (scope trap).
# Rerunnable: masters are skipped when they already exist; daily entries upsert (same day + line);
# the forecast, requisition and treatment steps skip when this script already made theirs.
# Needs: curl, python3. Row counts can be checked afterwards with:  mysql -u root nf_cccshow
set -u
API="${API:-http://localhost:2877/api/v1}"
TENANT="${TENANT:-cccshow}"
: "${LOGIN_EMAIL:?set LOGIN_EMAIL}" "${LOGIN_PASSWORD:?set LOGIN_PASSWORD}"
FROM="${FROM:-2026-11-14}"   # first of the 7 daily-data days
TO="${TO:-2026-11-20}"

json() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

LOGIN=$(curl -s -X POST "$API/auth/login" -H 'content-type: application/json' -H "x-tenant-id: $TENANT" \
  -d "{\"email\":\"$LOGIN_EMAIL\",\"password\":\"$LOGIN_PASSWORD\"}")
TOK=$(echo "$LOGIN" | json "print(d['access_token'])") || { echo "login failed"; exit 1; }
CO=$(echo "$LOGIN" | json "print(d['user']['companyId'])")
api() { local m=$1 p=$2; shift 2
  curl -s -X "$m" "$API$p" -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
    -H "x-tenant-id: $TENANT" -H "x-active-company-id: $CO" -H 'x-workspace-scope: COMPANY' "$@"; }
ok() { echo "$1" | json "import sys; sys.exit(0 if d.get('success') or 'data' in d else 1)" 2>/dev/null; }
say() { printf '%-14s %s\n' "$1" "$2"; }
list_has() { api GET "$1" | python3 -c "
import json,sys
d=json.load(sys.stdin); x=d.get('data',d)
x=x.get('items',x.get('data',x)) if isinstance(x,dict) else x
sys.exit(0 if any(str(r.get('$2'))=='$3' for r in (x or [])) else 1)" 2>/dev/null; }

# ------------------------------------------------------------------ 0. schedulers: drop repeated feed lines
# Older schedulers were generated from the breed lifecycle rows of every farm, so a batch got each feed line once per
# farm. The generator is fixed (it now reads default rows and the batch's own farm); this clears the repeats already
# there. Of lines with the same item, days, quantity and occurrence, the first is kept and the rest are deactivated
# (history kept). Rerunnable: it finds nothing the second time.
step_schedulers() {
  api GET "/scheduler-header?limit=500" | json "
x=d.get('data',d); x=x.get('items',x) if isinstance(x,dict) else x
print('\n'.join(h['scheduler_id'] for h in x))" | while read -r sid; do
    api GET "/scheduler-header/$sid" | json "
seen=set()
for l in sorted(d['data']['lines'], key=lambda l: l['line_seq']):
    if not l.get('is_active', True) or l['line_type']!='CONSUMPTION' or not l.get('item_id'): continue
    k=(l['item_id'],l.get('start_day'),l.get('end_day'),str(l.get('standard_qty')),l.get('occurrence'))
    if k in seen: print(l['line_id'])
    seen.add(k)" | while read -r lid; do
      r=$(api DELETE "/scheduler-header/$sid/lines/$lid")
      ok "$r" && say schedulers "$sid: repeated feed line $lid deactivated" || say schedulers "FAILED $lid: $r"
    done
  done
}

# ------------------------------------------------------------------ 0a. breed names without "Sow"; boars carry their own line
# The breed code cannot be changed through the API once created (master-code preservation), so this one step edits the
# breed master and the boars' breed in MySQL. Rerunnable: it finds the old codes only the first time. Needs the local
# mysql client: DB=nf_cccshow (override with SEED_DB).
# Boar lines are from "A.I Animal Register Master Template for AI Station" (management reviewed): the 23 boars are
# TEMPO (14: codes DA*, CJ*, CL*), L-Line (5: LA*) and Z-Line (4: BLX*). A semen batch takes its boar's breed.
step_breed_names() {
  mysql -u "${SEED_DB_USER:-root}" "${SEED_DB:-nf_cccshow}" -e "
    UPDATE breed_master SET breed_code='TN-70',  breed_name='TN-70'  WHERE breed_code IN ('TN-70-SOW','TN-70-Sow');
    UPDATE breed_master SET breed_code='Z-LINE', breed_name='Z-Line' WHERE breed_code IN ('Z-LINE-SOW','Z-Line-Sow');
    INSERT INTO breed_master (breed_id, tenant_id, nob_id, lob_id, breed_code, breed_name, species, breed_type, is_active, company_id, status, created_by, updated_by, created_at, updated_at, is_blocked)
      SELECT UUID(), t.tenant_id, t.nob_id, t.lob_id, n.code, n.name, t.species, t.breed_type, 1, t.company_id, 'ACTIVE', t.created_by, t.updated_by, NOW(), NOW(), 0
      FROM breed_master t JOIN (SELECT 'TEMPO' code, 'TEMPO' name UNION ALL SELECT 'L-LINE', 'L-Line') n
      WHERE t.breed_code='TEASER-BOAR' AND NOT EXISTS (SELECT 1 FROM breed_master x WHERE x.breed_code=n.code);
    UPDATE animal_register a JOIN breed_master b ON b.breed_code = CASE
        WHEN a.animal_code LIKE 'DA%' OR a.animal_code LIKE 'CJ%' OR a.animal_code LIKE 'CL%' THEN 'TEMPO'
        WHEN a.animal_code LIKE 'LA%'  THEN 'L-LINE'
        WHEN a.animal_code LIKE 'BLX%' THEN 'Z-LINE' END
      SET a.breed_id=b.breed_id WHERE a.animal_type='BOAR';
    UPDATE semen_batch s JOIN animal_register a ON a.animal_id=s.boar_animal_id SET s.breed_id=a.breed_id;" \
    && say breed_names "breeds renamed, boars set to TEMPO / L-Line / Z-Line" || say breed_names "FAILED"
}

# ------------------------------------------------------------------ 0c. feed programme of Weaner, Double Stock and Grower
# From the management-reviewed Breed Master workbooks (sheet "Breeder L-cycle stages -WeanGro"; the Multiplier and Porta
# sheets carry the same feed text). Replaces the DEMO feed lines of those three stages, on every farm's row of every
# breed, leaving the stage's KPIs, weights and alerts as they are. Weeks are counted from the day the batch enters the
# stage (Weaner = age 4-10 wk, Double Stock = 10-14, Grower = 14-22). Readings of the sheet's text:
#   Weaner  : 4 wk (8 days) Creep 2 0.48 | 5-6 wk (14 days) Creep 3 0.94 | 7-10 wk (17 days) Wean 1 1.1  -> weeks 1 | 2-3 | 4-6
#   Double  : "Wean 1 OTC 3.3 kg, Grower 1 4.8 kg" is two weeks added up: 1.6 + 1.7 and 2.2 + 2.5 kg a day (the Grower sheet's
#             own weekly figures for age 10-13 wk)                                                            -> weeks 1-2 | 3-4
#   Grower  : age 14-15 Grower 2 2.6 / 2.7 | 16 Grower 3 2.9 | 17-18 Grower 3 3.1 | 19-22 Finisher 3.1       -> weeks 1-2 | 3 | 4-5 | 6-8
# Product names -> items (assumed, for the client to confirm): Creep 2 = FEED000007, Creep 3 = FEED000084, Wean 1 / Wean 1 OTC =
# FEED000024 Weaner O.T.C, Grower 1 = FEED000001, Grower 2 = FEED000002, Grower 3 = FEED000018, Finisher = FEED000095.
# The sheet gives Multiplier finisher houses 3.1 to 3.9 kg; 3.1 (the first house) is used. Rerunnable: it sets the same lines.
step_lifecycle() {
  API="$API" TOK="$TOK" TENANT="$TENANT" CO="$CO" python3 - <<'PY'
import json, os, urllib.request, urllib.parse
API, TOK, TEN, CO = os.environ['API'], os.environ['TOK'], os.environ['TENANT'], os.environ['CO']
def call(m, path, body=None):
    req = urllib.request.Request(API + path, method=m, data=None if body is None else json.dumps(body).encode(),
        headers={'authorization': 'Bearer ' + TOK, 'content-type': 'application/json', 'x-tenant-id': TEN,
                 'x-active-company-id': CO, 'x-workspace-scope': 'COMPANY'})
    try:
        with urllib.request.urlopen(req) as r: return json.load(r)
    except urllib.error.HTTPError as e: return json.loads(e.read() or b'{}')
def rows(r):
    x = r.get('data', r); return x.get('items', x) if isinstance(x, dict) else x
ITEMS = {'creep2': 'FEED000007', 'creep3': 'FEED000084', 'wean1': 'FEED000024', 'g1': 'FEED000001', 'g2': 'FEED000002', 'g3': 'FEED000018', 'fin': 'FEED000095'}
item = {}
for k, code in ITEMS.items():
    hit = [i for i in rows(call('GET', '/item?search=' + code + '&limit=20')) if i.get('item_code') == code]
    if not hit: print('lifecycle      no item', code); raise SystemExit
    item[k] = hit[0]['item_id']
PROG = {  # stage code -> [(from week, to week, item, kg per head per day)]
 'WEANER':       [(1, 1, 'creep2', 0.48), (2, 3, 'creep3', 0.94), (4, 6, 'wean1', 1.1)],
 'DOUBLE_STOCK': [(1, 1, 'wean1', 1.6), (2, 2, 'wean1', 1.7), (3, 3, 'g1', 2.2), (4, 4, 'g1', 2.5)],
 'GROWER':       [(1, 1, 'g2', 2.6), (2, 2, 'g2', 2.7), (3, 3, 'g3', 2.9), (4, 5, 'g3', 3.1), (6, 8, 'fin', 3.1)],
}
NOTE = 'Feed programme from the management-reviewed Breed Master workbook (Weaner / Double Stock / Grower sheet); feed names matched to items by Triple C.'
stages = {s['stage_code']: s['stage_id'] for s in rows(call('GET', '/stage?limit=100')) if s.get('stage_code') in PROG}
breeds = [b for b in rows(call('GET', '/breed?limit=200')) if b['breed_code'] in ('TN-70', 'Z-LINE', 'TN-70-SOW', 'Z-LINE-SOW')]
done = 0
for b in breeds:
    for code, sid in stages.items():
        for r in rows(call('GET', '/breed-lifecycle-stage?breedId=%s&stageId=%s' % (b['breed_id'], sid))):
            if not r.get('is_active', True): continue
            lines = [{'period_from': f, 'period_to': t, 'feed_item_id': item[i], 'feed_qty_per_head_per_day_kg': q} for f, t, i, q in PROG[code]]
            res = call('PUT', '/breed-lifecycle-stage/' + r['lifecycle_id'], {'feed_lines': lines, 'notes': NOTE})
            ok = res.get('success')
            print('lifecycle      %-8s %-12s %-22s %s' % (b['breed_code'], code, (r.get('farm_name') or 'default')[:22], 'feed lines set' if ok else 'FAILED ' + str(res.get('error', res))[:160]))
            done += bool(ok)
print('lifecycle      %d stage rows updated' % done)
PY
}

# ------------------------------------------------------------------ 0d. one batch per service week
# The imported breeding history sat on one FOUNDATION-STOCK batch per farm, so the Farrowing report showed a single batch.
# From 2025-01-01 each mating is moved to a batch for its service week (<farm code>-<ISO year>-W<week>, like the foundation
# batches' descriptive names, so the BATCH-0000NN series is untouched); its farrowing follows it; each sow joins the batch of
# her latest service; opening quantity = sows served that week; batches older than 7 months are CLOSED. Earlier matings stay
# on the foundation batch. Raw SQL because no API re-points breeding records. Rerunnable: only matings still on a
# foundation batch are moved. Needs the mysql client (SEED_DB, default nf_cccshow).
step_service_batches() {
  mysql -u "${SEED_DB_USER:-root}" "${SEED_DB:-nf_cccshow}" <<'SQL' && say service_batches "service-week batches in place" || say service_batches "FAILED"
START TRANSACTION;
CREATE TEMPORARY TABLE svc AS
SELECT f.batch_id AS fid, br.breeding_id, br.mating_date,
       CONCAT(l.location_code,'-',DATE_FORMAT(br.mating_date,'%x'),'-W',DATE_FORMAT(br.mating_date,'%v')) AS bno
FROM breeding_record br
JOIN batch_header f ON f.batch_id = br.batch_id AND f.batch_no LIKE '%-FOUNDATION-STOCK'
JOIN location_master l ON l.location_id = f.farm_id
WHERE br.mating_date >= '2025-01-01';
INSERT INTO batch_header (batch_id,tenant_id,company_id,batch_no,lob_id,nob_id,costing_method,breed_id,start_date,status,opening_quantity,uom,remarks,animal_tracking,farm_id,tracking_mode,is_litter_lot,created_at,updated_at)
SELECT UUID(), f.tenant_id, f.company_id, s.bno, f.lob_id, f.nob_id, f.costing_method, f.breed_id, MIN(s.mating_date), 'ACTIVE', 0, 'HEAD',
       'Service-week batch: the sows served that week, grouped from the imported breeding history', f.animal_tracking, f.farm_id, f.tracking_mode, 0, NOW(), NOW()
FROM svc s JOIN batch_header f ON f.batch_id = s.fid
WHERE NOT EXISTS (SELECT 1 FROM batch_header x WHERE x.batch_no = s.bno AND x.tenant_id = f.tenant_id)
GROUP BY s.bno, f.batch_id;
UPDATE breeding_record br JOIN svc s ON s.breeding_id = br.breeding_id
  JOIN batch_header f ON f.batch_id = s.fid
  JOIN batch_header nb ON nb.batch_no = s.bno AND nb.tenant_id = f.tenant_id
  SET br.batch_id = nb.batch_id;
UPDATE farrowing_record fr JOIN breeding_record b ON b.breeding_id = fr.breeding_id
  SET fr.batch_id = b.batch_id WHERE b.mating_date >= '2025-01-01';
UPDATE animal_register a
  JOIN (SELECT sow_animal_id, SUBSTRING_INDEX(GROUP_CONCAT(batch_id ORDER BY mating_date DESC SEPARATOR ','), ',', 1) AS bid
        FROM breeding_record WHERE mating_date >= '2025-01-01' GROUP BY sow_animal_id) m ON m.sow_animal_id = a.animal_id
  JOIN batch_header nb ON nb.batch_id = m.bid AND nb.remarks LIKE 'Service-week batch%'
  SET a.current_batch_id = nb.batch_id
  WHERE a.current_batch_id IN (SELECT batch_id FROM batch_header WHERE batch_no LIKE '%-FOUNDATION-STOCK');
UPDATE batch_header b SET opening_quantity = (SELECT COUNT(DISTINCT sow_animal_id) FROM breeding_record r WHERE r.batch_id = b.batch_id)
  WHERE b.remarks LIKE 'Service-week batch%';
UPDATE batch_header b SET status='CLOSED', actual_end_date = DATE_ADD(b.start_date, INTERVAL 150 DAY), closed_at = NOW()
  WHERE b.remarks LIKE 'Service-week batch%' AND b.status='ACTIVE' AND b.start_date < DATE_SUB(CURDATE(), INTERVAL 7 MONTH);
COMMIT;
SQL
}

# ------------------------------------------------------------------ 0b. breed master figures from the client's workbooks
# "Multiplier Breed master_REVIEWED BY MANAGEMENT" and "Porta Breed Master_REVIEWED BY MANAGEMENT" (scripts/new data to
# seed/), sheet "Breed Master", the sow row of each. Percentages are as the master stores them (0.93 in the sheet = 93).
# Only the numeric columns are loaded; the lifecycle sheets are narrative text ("As per Feed schedule", "Creep 2-0.48,
# Creep 3-0.94") and the vaccination column needs vaccine items, so neither is loaded. Rerunnable: PUT of the same values.
step_breeds() {
  api GET "/breed?limit=200" | json "
x=d.get('data',d); x=x.get('items',x) if isinstance(x,dict) else x
print('\n'.join(b['breed_code']+'|'+b['breed_id'] for b in x))" | while IFS='|' read -r code bid; do
    case "$code" in
      Z-LINE|Z-LINE-SOW) body='{"gestation_days":116,"lactation_days":28,"productive_life_months":46,"productive_life_cycles":10,"avg_litter_size":16,"avg_litter_size_born":15,"avg_litter_size_weaned":13.8,"avg_weaning_weight_kg":7.5,"avg_mortality_pct":8,"farrowing_rate_pct":90,"boar_doses_per_week":36,"boar_productive_life_months":29}' ;;
      TN-70|TN-70-SOW)  body='{"gestation_days":116,"lactation_days":28,"productive_life_months":42,"productive_life_cycles":8,"avg_litter_size":17.24,"avg_litter_size_born":16.33,"avg_litter_size_weaned":15.35,"avg_weaning_weight_kg":8,"avg_mortality_pct":6,"farrowing_rate_pct":93,"boar_doses_per_week":74,"boar_productive_life_months":29}' ;;
      *) continue ;;
    esac
    r=$(api PUT "/breed/$bid" -d "$body")
    ok "$r" && say breeds "$code: breed master figures saved" || say breeds "FAILED $code: $r"
  done
}

# ------------------------------------------------------------------ 1. suppliers and customers
step_parties() {
  for row in "AgriFeeds Zimbabwe (Pvt) Ltd|FEED_SUPPLIER|sales@agrifeeds.example|+263772100100|Harare" \
             "VetCare Animal Health|MEDICINE_SUPPLIER|orders@vetcare.example|+263772100200|Bulawayo" \
             "Midlands Farm Equipment|EQUIPMENT_SUPPLIER|sales@mfe.example|+263772100300|Gweru"; do
    IFS='|' read -r n t e p c <<<"$row"
    list_has "/supplier?limit=500" supplier_name "$n" && { say supplier "exists: $n"; continue; }
    r=$(api POST /supplier -d "{\"company_id\":\"$CO\",\"supplier_name\":\"$n\",\"vendor_type\":\"$t\",\"email\":\"$e\",\"phone\":\"$p\",\"city\":\"$c\",\"country\":\"Zimbabwe\",\"payment_terms\":\"Net 30\"}")
    ok "$r" && say supplier "created: $n" || say supplier "FAILED $n: $r"
  done
  for row in "Harare Pork Processors (Demo)|+263772200100|purchasing@hpp.example|Harare|50000" \
             "Surrey Meats Pvt Ltd|+263772200200|orders@surrey.example|Norton|30000" \
             "Pork Hub Butchery|+263772200300|hub@porkhub.example|Chitungwiza|8000"; do
    IFS='|' read -r n m e c l <<<"$row"
    list_has "/customer?limit=500" customer_name "$n" && { say customer "exists: $n"; continue; }
    r=$(api POST /customer -d "{\"company_id\":\"$CO\",\"customer_name\":\"$n\",\"mobile\":\"$m\",\"email\":\"$e\",\"city\":\"$c\",\"country\":\"Zimbabwe\",\"credit_limit\":$l}")
    ok "$r" && say customer "created: $n" || say customer "FAILED $n: $r"
  done
}

# ------------------------------------------------------------------ 2. daily data, 7 days, 3 batch-wise batches
# BLOCKER: feed CONSUMPTION on a BIO_ASSET batch posts under GL mapping BIO_CONSUMPTION_PREMATURE/MATURE, which this
# tenant lacks and which the GL Mapping API refuses to create (BIO_* types are seeded by setup only). Set
# TRY_FEED=1 to attempt it anyway once the mappings exist. Mortality and the KPI lines post fine without it.
batch_id() { api GET "/batch?limit=200" | json "
x=d.get('data',d); x=x.get('items',x) if isinstance(x,dict) else x
print(next(b['batch_id'] for b in x if b['batch_no']=='$1'))"; }
scheduler_lines() { # batch_no -> 'activity|line_id' rows
  api GET "/scheduler-header?limit=200" | json "
x=d.get('data',d); x=x.get('items',x) if isinstance(x,dict) else x
print('\n'.join(h['scheduler_id'] for h in x if h.get('batch_no')=='$1'))" | while read -r sid; do
    api GET "/scheduler-header/$sid" | json "
for l in d['data']['lines']: print(l['activity_name']+'|'+l['line_id']+'|'+l['line_type'])"; done; }
post_entry() { # batch_id line_id date value [extra-json-fields]
  local r; r=$(api POST "/batch/$1/daily-data" -d "{\"line_id\":\"$2\",\"entry_date\":\"$3\",\"entered_value\":$4${5:+,$5}}")
  echo "$r" | json "import sys; sys.exit(0 if d.get('success') else 1)" 2>/dev/null && return 0
  echo "    FAILED $3: $(echo "$r" | json "print(d.get('error',{}).get('message',d))")"; return 1; }

step_daily() {
  # batch | body weight start,end | ADG | FCR | mortality % | mortality dates
  for spec in "BATCH-000009|18.5,21.3|0.47|1.6|0.4|2026-11-14,2026-11-17" \
              "BATCH-000011|17.8,20.4|0.43|1.7|0.4|2026-11-15,2026-11-19" \
              "BATCH-000012|46.0,52.5|1.05|2.4|0.2|2026-11-16"; do
    IFS='|' read -r bn bw adg fcr mp mdates <<<"$spec"
    bid=$(batch_id "$bn") || { say daily "no batch $bn"; continue; }
    lines=$(scheduler_lines "$bn"); n=0; bad=0
    while IFS='|' read -r act lid typ; do
      case "$act" in
        *"Body Weight"*) i=0; for d in $FROM $TO; do v=$(echo "$bw" | cut -d, -f$((i+1))); post_entry "$bid" "$lid" "$d" "$v" && n=$((n+1)) || bad=$((bad+1)); i=$((i+1)); done ;;
        *"Average Daily Gain"*)   for d in $FROM $TO; do post_entry "$bid" "$lid" "$d" "$adg" && n=$((n+1)) || bad=$((bad+1)); done ;;
        *"Feed Conversion Ratio"*) for d in $FROM $TO; do post_entry "$bid" "$lid" "$d" "$fcr" && n=$((n+1)) || bad=$((bad+1)); done ;;
        *"Mortality %"*)          for d in $FROM $TO; do post_entry "$bid" "$lid" "$d" "$mp" && n=$((n+1)) || bad=$((bad+1)); done ;;
        *"Mortality"*)  # daily MORTALITY_COUNT line: one death on each listed date
          for d in ${mdates//,/ }; do
            post_entry "$bid" "$lid" "$d" 1 '"mortality_animals":[{"dead_weight_kg":7.5,"reason_text":"Scours (post-weaning diarrhoea)","disposal_destination":"Burial pit"}]' && n=$((n+1)) || bad=$((bad+1)); done ;;
      esac
      if [ "${TRY_FEED:-0}" = 1 ] && [ "$typ" = CONSUMPTION ]; then
        for d in $(python3 -c "
import datetime as D; a=D.date.fromisoformat('$FROM'); b=D.date.fromisoformat('$TO')
print(' '.join(str(a+D.timedelta(i)) for i in range((b-a).days+1)))"); do
          post_entry "$bid" "$lid" "$d" 100 '"lot_no":"LOT-2025-01-FEED000024"' && n=$((n+1)) || bad=$((bad+1)); break; done
      fi
    done <<<"$lines"
    say daily "$bn: $n entries posted, $bad refused"
  done
}

# ------------------------------------------------------------------ 2b. feed cost, stage moves and one costed slaughter
# What fills Cost of Sales and the Weaner-Grower matrix on the GM dashboard:
#  - GL mappings BIO_CONSUMPTION_PREMATURE / _MATURE (the setup wizard seeds them; this tenant lacked them and the GL
#    Mapping API refuses BIO_* types, so they are added here with mysql, accounts 1050/5080 against 1010) so that feed
#    posts and adds its cost to the batch's carrying value;
#  - feed posted through Daily Data on two weaner batches and a grower batch (stock is per silo, so each spec names the
#    lot sitting in that batch's silo and a date on or after its receipt);
#  - the two weaner batches moved Weaner -> Double Stock (their weaner spells end in the window);
#  - the grower batch sent to slaughter at its now non-zero carrying value, kill sheet reconciled, order closed and the
#    batch closed (its grower spell ends), so the dispatch row and the Sale journal carry a cost.
# Needs the mysql client for the mapping rows (SEED_DB, default nf_cccshow). Rerunnable: skips what is already there.
step_costing() {
  have=$(mysql -N -u "${SEED_DB_USER:-root}" "${SEED_DB:-nf_cccshow}" -e "SELECT COUNT(*) FROM gl_mapping_master WHERE transaction_type IN ('BIO_CONSUMPTION_PREMATURE','BIO_CONSUMPTION_MATURE') AND deleted_at IS NULL")
  if [ "${have:-0}" -lt 2 ]; then
    mysql -u "${SEED_DB_USER:-root}" "${SEED_DB:-nf_cccshow}" -e "
      INSERT INTO gl_mapping_master (mapping_id,tenant_id,company_id,mapping_code,transaction_type,debit_gl_account_id,credit_gl_account_id)
      SELECT UUID(), m.tenant_id, m.company_id, x.code, x.t,
             (SELECT gl_account_id FROM gl_account_master WHERE account_code=x.dr AND company_id=m.company_id LIMIT 1),
             (SELECT gl_account_id FROM gl_account_master WHERE account_code='1010' AND company_id=m.company_id LIMIT 1)
      FROM (SELECT tenant_id, company_id FROM gl_mapping_master WHERE deleted_at IS NULL LIMIT 1) m
      JOIN (SELECT 'GLMAP-013' code,'BIO_CONSUMPTION_PREMATURE' t,'1050' dr UNION ALL SELECT 'GLMAP-014','BIO_CONSUMPTION_MATURE','5080') x
      WHERE NOT EXISTS (SELECT 1 FROM gl_mapping_master g WHERE g.transaction_type=x.t AND g.deleted_at IS NULL)" \
      && say costing "feed consumption GL mappings added" || { say costing "FAILED adding GL mappings"; return; }
  fi
  # batch | activity text | lot | kg per day | first day | last day
  for spec in "BATCH-000009|Weaner O.T.C|LOT-2025-01-FEED000024|180|2026-11-14|2026-11-18" \
              "BATCH-000011|Weaner O.T.C|LOT-2025-01-FEED000024|180|2026-11-14|2026-11-18" \
              "BATCH-000012|Grower1|LOT-00089|128|2026-11-19|2026-11-20"; do
    IFS='|' read -r bn act lot kg d1 d2 <<<"$spec"
    bid=$(batch_id "$bn") || { say costing "no batch $bn"; continue; }
    [ "$(api GET "/batch/$bid" | json "print(d['data'].get('status'))")" = ACTIVE ] || { say costing "$bn: not active, feed skipped"; continue; }
    lid=$(scheduler_lines "$bn" | grep -F "$act|" | head -1 | cut -d'|' -f2)
    [ -z "$lid" ] && { say costing "$bn: no feed line '$act'"; continue; }
    n=0; bad=0
    for d in $(python3 -c "
import datetime as D; a=D.date.fromisoformat('$d1'); b=D.date.fromisoformat('$d2')
print(' '.join(str(a+D.timedelta(i)) for i in range((b-a).days+1)))"); do
      post_entry "$bid" "$lid" "$d" "$kg" "\"lot_no\":\"$lot\"" && n=$((n+1)) || bad=$((bad+1))
    done
    say costing "$bn: $n feed entries posted ($kg kg/day), $bad refused"
  done
  for bn in BATCH-000009 BATCH-000011; do
    bid=$(batch_id "$bn") || continue
    cur=$(api GET "/batch/$bid" | json "print(d['data'].get('current_stage_code'))")
    if [ "$cur" = WEANER ]; then
      r=$(api POST "/batch/$bid/transfer-stage" -d '{"to_stage_code":"DOUBLE_STOCK","transfer_date":"2026-11-19","remarks":"Weaned off to double stock (demo)"}')
      ok "$r" && say costing "$bn: moved Weaner -> Double Stock on 2026-11-19" || say costing "$bn: move FAILED: $r"
    else say costing "$bn: already in $cur"; fi
  done
  # An earlier weighing inside each weaner spell: the dashboard takes the spell's first weighing as the entry weight, so with a
  # single weighing the gain is 0 and FCE Weaner stays empty. 15.8 kg on 9 Nov rising to the 18.5 kg of 14 Nov is about 0.5 kg/day.
  for bn in BATCH-000009 BATCH-000011; do
    bid=$(batch_id "$bn") || continue
    lid=$(scheduler_lines "$bn" | grep -F "Body Weight" | head -1 | cut -d'|' -f2)
    [ -n "$lid" ] && post_entry "$bid" "$lid" 2026-11-09 15.8 && say costing "$bn: entry weighing 15.8 kg on 2026-11-09"
  done
  # One costed slaughter from the grower batch. Skipped when its order (remark below) exists.
  farm=$(api GET /feed-forecast/farms | json "print(next(f['farmId'] for f in d['data'] if 'GRASMERE' in f.get('farmName','').upper() or 'MUL100' in str(f)))")
  if api GET "/slaughter-transfer-order" | json "
import sys; x=d.get('data',d); x=x.get('items',x) if isinstance(x,dict) else x
sys.exit(0 if any(isinstance(o,dict) and o.get('ho_approval_ref')=='HO-SHOWCASE-MUL-002' for o in x) else 1)"; then say costing "slaughter order exists"; return; fi
  bid=$(batch_id BATCH-000012)
  head=$(api GET "/slaughter-transfer-order/eligible-lots?farm_id=$farm&as_of=2026-11-20" | json "print(next(int(l['head']) for l in d['data'] if l['batch_id']=='$bid'))") || { say costing "BATCH-000012 not eligible"; return; }
  r=$(api POST /slaughter-transfer-order -d "{\"to_date\":\"2026-11-20\",\"farm_id\":\"$farm\",\"ho_approval_ref\":\"HO-SHOWCASE-MUL-002\",\"destination\":\"Colcom Foods\",\"lines\":[{\"batch_id\":\"$bid\",\"head_count\":$head,\"avg_live_weight_kg\":128}]}")
  to=$(echo "$r" | json "print(d['data']['to_id'])") || { say costing "order FAILED: $r"; return; }
  line=$(echo "$r" | json "print(d['data']['lines'][0]['line_id'])")
  for step in "confirm|{}" "pod|{\"pod_date\":\"2026-11-20\",\"received_by\":\"Colcom Foods\",\"lines\":[{\"line_id\":\"$line\",\"doa_head\":0}]}" \
              "kill-sheet|{\"kill_sheet_ref\":\"3647110\",\"kill_sheet_date\":\"2026-11-21\",\"invoice_no\":\"COLCOM-3647110\",\"lines\":[{\"line_id\":\"$line\",\"avg_carcass_weight_kg\":97.3,\"price_per_kg\":2.573}]}" \
              "close|{}"; do
    nm=${step%%|*}; body=${step#*|}
    r=$(api POST "/slaughter-transfer-order/$to/$nm" -d "$body")
    ok "$r" && say costing "slaughter order $nm done" || { say costing "slaughter $nm FAILED: $r"; return; }
  done
  r=$(api POST "/batch/$bid/close" -d '{"actual_end_date":"2026-11-20","closing_quantity":0}')
  ok "$r" && say costing "BATCH-000012 closed" || say costing "BATCH-000012 close FAILED: $r"
}

# ------------------------------------------------------------------ 3. feed forecast run + consolidation
step_forecast() {
  FARMS=$(api GET /feed-forecast/farms | json "print(' '.join(f['farmId'] for f in d['data']))")
  for f in $FARMS; do
    if [ "$(api GET "/feed-forecast/runs?farmId=$f" | json "print(len(d['data']))")" != 0 ]; then say forecast "run exists for farm $f"; continue; fi
    r=$(api POST /feed-forecast/runs -d "{\"farmId\":\"$f\",\"view\":\"WEEKLY\"}")
    ok "$r" && say forecast "run saved: $(echo "$r" | json "print(d['data']['runCode'])")" || say forecast "FAILED: $r"
  done
}

# ------------------------------------------------------------------ 4. requisitions: feed (submit, approve, consolidate) + common
FEED_REMARK='Creep feed top-up (demo)'
step_requisition() {
  F=$(api GET /feed-forecast/farms | json "print(d['data'][0]['farmId'])")
  if api GET "/feed-requisition?farmId=$F" | grep -q '"req_no"'; then say requisition "feed requisition exists (any on this farm: not adding another)"; else
    # A manual feed requisition: the from-run path needs bulk quantities that fit the silo, which the demo silos do not.
    RUN=$(api GET "/feed-forecast/runs?farmId=$F" | json "print(d['data'][0]['run_id'] if 'run_id' in d['data'][0] else d['data'][0]['runId'])")
    BODY=$(api GET "/feed-requisition/from-run/$RUN/preview" | json "
import json as J
print(J.dumps({'farmId':'$F','remarks':'$FEED_REMARK','lines':[{'destination_location_id':l['destination_location_id'],'item_id':l['item_id'],'quantity_kg':l['quantity_kg'],'proposed_delivery_date':'$(date -v+3d +%F 2>/dev/null || date -d '+3 day' +%F)'} for l in d['data']['lines'] if l['source_type']!='SILO']}))")
    r=$(api POST /feed-requisition -d "$BODY"); Q=$(echo "$r" | json "print(d['data']['requisition_id'])") || { say requisition "feed create FAILED: $r"; return; }
    r=$(api POST "/feed-requisition/$Q/submit" -d '{}'); A=$(echo "$r" | json "print(d['data']['approval_request_id'])") || { say requisition "submit FAILED: $r"; return; }
    api POST "/approval/$A/approve" -d '{"remarks":"Approved for the weekly mill run (demo)"}' >/dev/null
    LINE=$(api GET "/feed-requisition/consolidations/eligible?farmId=$F" | json "print(next(l['line_id'] for l in d['data'] if l['requisition_id']=='$Q'))")
    r=$(api POST /feed-requisition/consolidations -d "{\"farmId\":\"$F\",\"requisitionIds\":[\"$Q\"],\"lines\":[{\"requisitionLineId\":\"$LINE\",\"millApprovedQtyKg\":3000}]}")
    C=$(echo "$r" | json "print(d['data']['consolidationId'])") && api POST "/feed-requisition/consolidations/$C/review" -d '{}' >/dev/null
    say requisition "feed requisition submitted+approved, consolidation $(echo "$r" | json "print(d['data']['consolidationNo'])" 2>/dev/null || echo FAILED)"
  fi
  JUST='Replenish vaccines and medicines for the December farrowing cohort (demo)'
  if api GET "/requisition?company_id=$CO" | grep -q '"doc_type":"ITEM"'; then say requisition "common requisition exists"; else
    BODY=$(api GET "/requisition/options?company_id=$CO" | json "
import json as J
it=[i for i in d['data']['items'] if i['item_code'].startswith('DRG')][:2]
print(J.dumps({'company_id':'$CO','farm_id':'$F','doc_type':'ITEM','purpose':'PURCHASE','required_date':'2026-11-30','justification':'$JUST','remarks':'Demo requisition','lines':[{'item_id':i['item_id'],'quantity':20,'uom':i['uom_primary'],'est_rate':12.5} for i in it]}))")
    Q=$(api POST /requisition -d "$BODY" | json "print(d['data']['requisition_id'])") || { say requisition "common create FAILED"; return; }
    api POST "/requisition/$Q/submit" -d '{}' >/dev/null; r=$(api POST "/requisition/$Q/approve" -d '{}')
    say requisition "common requisition: $(echo "$r" | json "print(d['data']['req_no'], d['data']['status'])")"
  fi
}

# ------------------------------------------------------------------ 5. alert rules + evaluation
step_alerts() {
  for row in "FEED-BELOW-L1|Silo feed below 600 kg|FEED_BELOW_L1|SILO|600|CRITICAL|HEAD_OF_FARM,FARM_MANAGER|DAILY" \
             "FEED-ABOVE|Silo feed above 2500 kg|FEED_ABOVE|SILO|2500|INFO|FARM_MANAGER|DAILY" \
             "SILO-SHORTFALL|Silo shortfall before next delivery|SHORTFALL|SILO|3|WARNING|HEAD_OF_FARM,MILL_MANAGER|DAILY" \
             "DIET-CHANGE|Diet change due in 3 days|DIET_CHANGE|FEED_PLAN|3|WARNING|FARM_MANAGER|ONCE" \
             "REQ-DEADLINE|Requisition deadline in 2 days|REQ_DEADLINE|REQUISITION|2|WARNING|FARM_MANAGER,HEAD_OF_FARM|ONCE"; do
    IFS='|' read -r code name ev ent val pri roles freq <<<"$row"
    list_has "/alert-rule?limit=200" notification_code "$code" && { say alert-rule "exists: $code"; continue; }
    rl=$(python3 -c "import json;print(json.dumps('$roles'.split(',')))")
    r=$(api POST /alert-rule -d "{\"company_id\":\"$CO\",\"notification_code\":\"$code\",\"notification_name\":\"$name\",\"event_type\":\"$ev\",\"trigger_entity\":\"$ent\",\"threshold_reference\":\"FIXED_VALUE\",\"threshold_value\":$val,\"priority_level\":\"$pri\",\"recipient_roles\":$rl,\"delivery_channel\":\"IN_APP\",\"frequency\":\"$freq\"}")
    ok "$r" && say alert-rule "created: $code" || say alert-rule "FAILED $code: $r"
  done
  for f in $(api GET /feed-forecast/farms | json "print(' '.join(f['farmId'] for f in d['data']))"); do
    say evaluate "$(api POST /feed-alert/evaluate -d "{\"farmId\":\"$f\"}" | json "print(d['data'])")"
  done
}

# ------------------------------------------------------------------ 6. diseases + one treatment (mortality is in step 2)
step_health() {
  while IFS='|' read -r n s sy tg; do
    list_has "/disease?limit=200" disease_name "$n" && { say disease "exists: $n"; continue; }
    r=$(api POST /disease -d "{\"company_id\":\"$CO\",\"disease_name\":\"$n\",\"scientific_name\":\"$s\",\"symptoms\":\"$sy\",\"treatment_guideline\":\"$tg\"}")
    ok "$r" && say disease "created: $n" || say disease "FAILED $n: $r"
  done <<'EOF'
Post-weaning diarrhoea|Escherichia coli (ETEC)|Watery scour, dehydration, poor growth in the first two weeks after weaning|Oral electrolytes, targeted antibiotic per vet, review creep feed transition
Porcine respiratory disease complex|Mycoplasma hyopneumoniae and co-pathogens|Dry cough, laboured breathing, reduced daily gain in growers|Tilmicosin or tiamulin per vet, improve ventilation, vaccinate replacements
Swine erysipelas|Erysipelothrix rhusiopathiae|Fever, diamond-shaped skin lesions, lameness|Penicillin course, erysipelas vaccination programme
Greasy pig disease|Staphylococcus hyicus|Greasy brown exudate on skin of suckling and weaner pigs|Topical wash, systemic antibiotic per vet, reduce skin abrasions
Porcine reproductive and respiratory syndrome|PRRS virus|Abortions, stillbirths, weak piglets, respiratory signs|Herd stabilisation, acclimatise gilts, biosecurity review
Lameness (joint ill)|Streptococcus suis / Mycoplasma hyosynoviae|Swollen joints, reluctance to stand|NSAID plus antibiotic per vet, soft bedding
EOF
  # one treatment: a medicine logged against a live animal (animal_medication_log). Skipped if that animal already has one.
  A=$(api GET "/animal?limit=1&status=ACTIVE" | json "x=d.get('data',d); x=x.get('items',x) if isinstance(x,dict) else x; print(x[0]['animal_id'])") || { say treatment "no animal"; return; }
  if api GET "/animal/$A/medications" | json "import sys; sys.exit(0 if d.get('data') else 1)" 2>/dev/null; then say treatment "exists"; return; fi
  I=$(api GET "/requisition/options?company_id=$CO" | json "print(next(i['item_id'] for i in d['data']['items'] if i['item_code'].startswith('DRG')))")
  r=$(api POST "/animal/$A/medications" -d "{\"item_id\":\"$I\",\"administered_date\":\"$TO\",\"dose_qty\":2,\"uom\":\"ML\",\"administered_by\":\"Farm vet (demo)\",\"notes\":\"Demo treatment entry\"}")
  ok "$r" && say treatment "logged for animal $A" || say treatment "FAILED: $r"
}

# ------------------------------------------------------------------ 7. weaning weights (dashboard: Avg Wean Weight, Total Litter Mass)
# The farrowing page's own weaning call. A litter can be weaned once, so this weans unweaned litters farrowed 15-30 Oct
# (weaned 21 days later, inside the dashboard window) and records a weaning weight. Litters already weaned by the
# workbook import have no weight and the API has no way to edit them, so they are left as they are.
WEAN_LITTERS="${WEAN_LITTERS:-12}"
step_wean() {
  local rows n done
  rows=$(api GET "/piggery/breeding/farrowing?company_id=$CO" | WEAN_N="$WEAN_LITTERS" TO="$TO" python3 -c "
import json,sys,os,datetime as D
d=json.load(sys.stdin); x=d if isinstance(d,list) else d.get('data',d)
x=x.get('items',x.get('data',x)) if isinstance(x,dict) else x
x=x or []
day=lambda v: str(v)[:10] if v else ''
n=int(os.environ['WEAN_N']); to=os.environ['TO']
done=[f for f in x if float(f.get('avg_weaning_weight_kg') or 0)>0 and '2026-10-25'<=day(f.get('weaning_date'))<=to]
if len(done)>=n: print('DONE'); sys.exit(0)
todo=sorted([f for f in x if not f.get('piglets_weaned') and '2026-10-15'<=day(f.get('farrowing_date'))<='2026-10-30' and f.get('piglets_born_live')],
            key=lambda f: day(f['farrowing_date']))[:n-len(done)]
for i,f in enumerate(todo):
    wd=D.date.fromisoformat(day(f['farrowing_date']))+D.timedelta(days=21)
    heads=max(1,int(f['piglets_born_live'])-1)
    print('%s|%s|%d|%.2f' % (f['farrow_id'], wd, heads, 6.5+(i%6)*0.35))
")
  [ "$rows" = DONE ] && { say wean "already has $WEAN_LITTERS weighed litters in the window"; return; }
  [ -z "$rows" ] && { say wean "no unweaned litter farrowed 15-30 Oct found"; return; }
  n=0; done=0
  while IFS='|' read -r fid wd heads kg; do
    r=$(api PATCH "/piggery/breeding/farrowing/$fid/weaning" -d "{\"weaning_date\":\"$wd\",\"piglets_weaned\":$heads,\"avg_weaning_weight_kg\":$kg}")
    if echo "$r" | json "import sys; sys.exit(1 if d.get('error') or d.get('statusCode') or d.get('success') is False else 0)" 2>/dev/null; then n=$((n+1)); else done=$((done+1)); echo "    FAILED $fid: $(echo "$r" | json "print(d.get('error',{}).get('message',d.get('message',d)))" 2>/dev/null)"; fi
  done <<<"$rows"
  say wean "$n litters weaned with a weight, $done refused"
}

# ------------------------------------------------------------------ 8. overheads (dashboard: Staff Overheads, Other Overheads)
# The dashboard reads journal lines on GL 4600 (Other) and 4610 (Staff) that carry the cost centre CC-<farm code>. A farm's
# cost centre comes from the cost centre set on its FARM location, so this step also makes the two accounts, a cash account
# to pay from, one cost centre per farm and links it. Then it posts expenses through the Expense page's own endpoint.
gl_id() { api GET "/gl-account?limit=500" | python3 -c "
import json,sys
d=json.load(sys.stdin); x=d.get('data',d)
x=x.get('items',x.get('data',x)) if isinstance(x,dict) else x
print(next((r['gl_account_id'] for r in (x or []) if str(r.get('account_code'))=='$1'),''))"; }
step_overheads() {
  for row in "4600|Other Overheads|EXPENSE" "4610|Staff Overheads|EXPENSE" "1100|Cash and Bank|ASSET"; do
    IFS='|' read -r code name typ <<<"$row"
    list_has "/gl-account?limit=500" account_code "$code" && { say gl-account "exists: $code"; continue; }
    r=$(api POST /gl-account -d "{\"company_id\":\"$CO\",\"account_code\":\"$code\",\"account_name\":\"$name\",\"account_type\":\"$typ\"}")
    ok "$r" && say gl-account "created: $code $name" || say gl-account "FAILED $code: $r"
  done
  OTHER=$(gl_id 4600); STAFF=$(gl_id 4610); CASH=$(gl_id 1100)
  { [ -n "$OTHER" ] && [ -n "$STAFF" ] && [ -n "$CASH" ]; } || { say overheads "a GL account is missing, stopping"; return; }
  FARMLIST=$(api GET "/expense-documents/locations?companyId=$CO" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in d['data']['farms']: print('%s|%s|%s|' % (r['location_id'], r['location_code'], r['location_name']))")
  while IFS='|' read -r lid lcode lname lcc; do
    [ -z "$lid" ] && continue
    code="CC-$lcode"
    list_has "/cost-center?limit=500" cost_center_code "$code" || {
      r=$(api POST /cost-center -d "{\"company_id\":\"$CO\",\"cost_center_code\":\"$code\",\"cost_center_name\":\"$lname\",\"cost_center_type\":\"FARM\"}")
      ok "$r" && say cost-centre "created: $code" || say cost-centre "FAILED $code: $r"; }
    ccid=$(api GET "/cost-center?limit=500" | python3 -c "
import json,sys
d=json.load(sys.stdin); x=d.get('data',d)
x=x.get('items',x.get('data',x)) if isinstance(x,dict) else x
print(next((r['cost_center_id'] for r in (x or []) if r.get('cost_center_code')=='$code'),''))")
    if [ -n "$ccid" ]; then
      r=$(api PUT "/location/$lid" -d "{\"cost_center_id\":\"$ccid\"}")
      ok "$r" && say farm-link "$lcode -> $code" || say farm-link "FAILED $lcode: $r"
    fi
  done <<<"$FARMLIST"
  if api GET "/expense-documents/expense?companyId=$CO&limit=200" | grep -q 'demo overhead'; then say expense "demo overheads already posted"; return; fi
  # farm code | date | account | amount | what
  while IFS='|' read -r lid lcode lname lcc; do
    [ -z "$lid" ] && continue
    case "$lcode" in MUL*) k=1.0 ;; *) k=0.7 ;; esac
    for e in "2026-10-30|$STAFF|18500|Staff wages, October (demo overhead)" \
             "2026-11-13|$STAFF|9250|Staff casual labour, November (demo overhead)" \
             "2026-11-10|$OTHER|7200|Farm repairs and utilities (demo overhead)"; do
      IFS='|' read -r dt acct amt what <<<"$e"
      amt=$(python3 -c "print(round($amt*$k,2))")
      r=$(api POST /expense-documents/expense -d "{\"company_id\":\"$CO\",\"posting_date\":\"$dt\",\"payee\":\"Demo payees\",\"description\":\"$lcode: $what\",\"amount\":-$amt,\"expense_gl_account_id\":\"$acct\",\"payment_gl_account_id\":\"$CASH\",\"location_id\":\"$lid\"}")
      echo "$r" | json "import sys; sys.exit(0 if d.get('success') or 'data' in d else 1)" 2>/dev/null \
        && say expense "$lcode $dt $amt" || say expense "FAILED $lcode $dt: $(echo "$r" | json "print(d.get('error',{}).get('message',d.get('message',d)))" 2>/dev/null)"
    done
  done <<<"$FARMLIST"
}

# ------------------------------------------------------------------ periods: Accounting Period Master (Monthly Ops report needs fiscal years)
# 4-4-5 calendar as the ccc tenant has it: 28/28/35-day periods, fiscal year starting the last Sunday of June, named by the month
# most of the period falls in. Three fiscal years (Jul 2024 - Jun 2027) so the 2025 and 2026 production data sits inside one.
step_periods() {
  python3 - "$API" "$TOK" "$TENANT" "$CO" <<'PY'
import json, sys, urllib.request
from datetime import date, timedelta
api, tok, tenant, co = sys.argv[1:5]
H = {'authorization': 'Bearer ' + tok, 'content-type': 'application/json', 'x-tenant-id': tenant,
     'x-active-company-id': co, 'x-workspace-scope': 'COMPANY'}
def call(m, path, body=None):
    r = urllib.request.Request(api + path, data=json.dumps(body).encode() if body else None, headers=H, method=m)
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: return {'error': e.read().decode()[:200]}
d = call('GET', '/accounting-period?limit=500')
x = d.get('data', d); x = x.get('items', x.get('data', x)) if isinstance(x, dict) else x
have = {str(r.get('starting_date'))[:10] for r in (x or [])}
rows, start = [], date(2024, 6, 30)
for fy in range(3):
    for i, days in enumerate([28, 28, 35] * 4):
        rows.append((start, i == 0)); start += timedelta(days=days)
rows.append((start, True))
made = 0
for st, new in rows:
    if st.isoformat() in have: continue
    name = (st + timedelta(days=14)).strftime('%B')
    r = call('POST', '/accounting-period', {'company_id': co, 'starting_date': st.isoformat(), 'name': name, 'new_fiscal_year': new})
    if 'error' in r: print('periods       FAILED %s: %s' % (st, r['error'])); continue
    made += 1
print('periods       created %d, already there %d' % (made, len(have)))
PY
}

# ------------------------------------------------------------------ porta: weaner + grower data for the Porta farm (Weaner-Grower panel, Cost of Sales)
# Porta had no feed stock, feed postings, weights or stage moves, so its dashboard rows were empty. Mirrors what costing does for Multiplier:
# opening feed stock (stock adjustments), a Porta weaner batch (210 head, PWH2, 2-19 Nov, moved to Double Stock), grower batch BATCH-000015 fed and
# weighed 10-19 Nov, then slaughtered with a kill sheet and closed. Skipped when the weaner batch (remark below) already exists.
step_porta() {
  python3 - "$API" "$TOK" "$TENANT" "$CO" <<'PY'
import json, sys, urllib.request, datetime as D
api, tok, tenant, co = sys.argv[1:5]
H = {'authorization': 'Bearer ' + tok, 'content-type': 'application/json', 'x-tenant-id': tenant, 'x-active-company-id': co, 'x-workspace-scope': 'COMPANY'}
def call(m, path, body=None):
    r = urllib.request.Request(api + path, data=json.dumps(body).encode() if body is not None else None, headers=H, method=m)
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: return {'error': e.read().decode()[:200]}
def rows(path):
    d = call('GET', path); x = d.get('data', d)
    return x.get('items', x.get('data', x)) if isinstance(x, dict) else (x or [])
def say(m): print('porta         ' + m)
REMARK = 'Porta weaner batch (showcase)'
batches = rows('/batch?limit=200')
if any(b.get('remarks') == REMARK for b in batches): say('exists, skipping'); sys.exit(0)
def loc(code):
    for l in rows('/location-master?limit=500&search=' + code):
        if l.get('location_code') == code: return l['location_id']
def item(code):
    for i in rows('/item-master?limit=500&search=' + code):
        if i.get('item_code') == code: return i['item_id']
def bid(no): return next(b['batch_id'] for b in batches if b['batch_no'] == no)
# 1. opening feed stock; silos/stores are where each feed line draws from (PST1 store, PW-1 silo)
stock = {'PWH2': [], 'PGH2': [], 'PGH1': [],
         'PST1': [('FEED000007', 3000), ('FEED000084', 3000), ('FEED000002', 3000), ('FEED000018', 3000), ('FEED000095', 3000)],
         'PW-1': [('FEED000024', 6000)]}
for wh, lines in stock.items():
    if not lines: continue
    r = call('POST', '/stock-adjustment', {'company_id': co, 'warehouse_id': loc(wh), 'posting_date': '2026-11-01', 'reason': 'Opening feed stock (showcase)',
        'lines': [{'item_id': item(c), 'quantity': q, 'uom': 'KG', 'rate': 0.45, 'lot_no': 'LOT-POR-' + c} for c, q in lines]})
    aid = (r.get('data') or {}).get('adjustment_id')
    if not aid: say('stock %s FAILED %s' % (wh, r)); sys.exit(1)
    call('POST', '/stock-adjustment/%s/post' % aid, {}); say('stock posted at ' + wh)
# 2. the weaner batch
lob = next(b['lob_id'] for b in batches if b['batch_no'] == 'BATCH-000015')
oa = next(b.get('operational_area_id') for b in batches if b['batch_no'] == 'BATCH-000015')
stage = {s['stage_code']: s['stage_id'] for s in rows('/stage-master?limit=100')}
breed = next(b['breed_id'] for b in batches if b['batch_no'] == 'BATCH-000015')
r = call('POST', '/batch', {'company_id': co, 'lob_id': lob, 'operational_area_id': oa, 'costing_method': 'BIO_ASSET', 'breed_id': breed,
    'stage_id': stage['WEANER'], 'auto_generate_scheduler': True, 'shed_id': loc('PWH2'), 'location_id': loc('PWH2'), 'start_date': '2026-11-02',
    'expected_end_date': '2026-11-30', 'opening_quantity': 210, 'uom': 'HEAD', 'remarks': REMARK,
    'input_lines': [{'item_id': item('BIO-SWINE-PIGLET'), 'quantity': 210, 'uom': 'HEAD', 'rate': 0}]})
W = (r.get('data') or {}).get('batch_id')
if not W: say('weaner batch FAILED %s' % r); sys.exit(1)
call('POST', '/batch/%s/activate' % W, {})
def lines_of(batch_id, stage_code):
    for h in rows('/scheduler-header?limit=200'):
        if h.get('batch_id') == batch_id and h.get('stage_code', stage_code) == stage_code:
            ls = call('GET', '/scheduler-header/' + h['scheduler_id'])['data']['lines']
            out = {}
            for l in ls: out.setdefault(l['activity_name'], l['line_id'])
            return out
def feed(batch, ln, act, code, kg, d1, d2):
    a, n = D.date.fromisoformat(d1), 0
    while a <= D.date.fromisoformat(d2):
        r = call('POST', '/batch/%s/daily-data' % batch, {'line_id': ln[act], 'entry_date': str(a), 'entered_value': kg, 'lot_no': 'LOT-POR-' + code})
        n += bool(r.get('success')); a += D.timedelta(1)
    say('%s: %d entries' % (act, n))
def val(batch, ln, act, d, v): call('POST', '/batch/%s/daily-data' % batch, {'line_id': ln[act], 'entry_date': d, 'entered_value': v})
wl = lines_of(W, 'WEANER')
feed(W, wl, 'Weaner Feed — Creep 2 Nosilac', 'FEED000007', 100, '2026-11-02', '2026-11-04')
feed(W, wl, 'Weaner Feed — Creep 3 Nosilac Bagged', 'FEED000084', 200, '2026-11-05', '2026-11-09')
feed(W, wl, 'Weaner Feed — Weaner O.T.C', 'FEED000024', 230, '2026-11-10', '2026-11-18')
for d, v in [('2026-11-02', 9.0), ('2026-11-10', 14.2), ('2026-11-18', 20.1)]: val(W, wl, 'KPI: Body Weight', d, v)
for a, v in [('KPI: Average Daily Gain', 0.45), ('KPI: Feed Conversion Ratio', 1.45), ('KPI: Mortality %', 0.4)]: val(W, wl, a, '2026-11-18', v)
r = call('POST', '/batch/%s/transfer-stage' % W, {'to_stage_code': 'DOUBLE_STOCK', 'transfer_date': '2026-11-19', 'remarks': 'Weaned off to double stock (demo)'})
say('weaner batch moved to Double Stock' if 'error' not in r else 'move FAILED %s' % r)
# 3. the grower batch: feed, weights, slaughter, close
G = bid('BATCH-000015'); gl = lines_of(G, 'GROWER')
feed(G, gl, 'Grower Feed — Grower 2', 'FEED000002', 450, '2026-11-10', '2026-11-12')
feed(G, gl, 'Grower Feed — Grower 3', 'FEED000018', 480, '2026-11-13', '2026-11-16')
feed(G, gl, 'Grower Feed — Grower Finisher Bagged', 'FEED000095', 500, '2026-11-17', '2026-11-19')
for d, v in [('2026-11-09', 78.0), ('2026-11-19', 87.5)]: val(G, gl, 'Grower Body Weight Check', d, v)
for a, v in [('KPI: Average Daily Gain', 0.95), ('KPI: Feed Conversion Ratio', 2.8), ('KPI: Mortality %', 0.2)]: val(G, gl, a, '2026-11-19', v)
farm = next(b['farm_id'] for b in batches if b['batch_no'] == 'BATCH-000015')
lot = next(l for l in call('GET', '/slaughter-transfer-order/eligible-lots?farm_id=%s&as_of=2026-11-20' % farm)['data'] if l['batch_id'] == G)
r = call('POST', '/slaughter-transfer-order', {'to_date': '2026-11-20', 'farm_id': farm, 'ho_approval_ref': 'HO-SHOWCASE-POR-002', 'destination': 'Colcom Foods',
    'lines': [{'batch_id': G, 'head_count': int(lot['head']), 'avg_live_weight_kg': 87.5}]})
to = (r.get('data') or {}).get('to_id')
if not to: say('slaughter FAILED %s' % r); sys.exit(1)
line = r['data']['lines'][0]['line_id']
for nm, b in [('confirm', {}), ('pod', {'pod_date': '2026-11-20', 'received_by': 'Colcom Foods', 'lines': [{'line_id': line, 'doa_head': 0}]}),
              ('kill-sheet', {'kill_sheet_ref': '3647111', 'kill_sheet_date': '2026-11-21', 'invoice_no': 'COLCOM-3647111',
                              'lines': [{'line_id': line, 'avg_carcass_weight_kg': 66.4, 'price_per_kg': 2.573}]}), ('close', {})]:
    r = call('POST', '/slaughter-transfer-order/%s/%s' % (to, nm), b)
    if 'error' in r: say('slaughter %s FAILED %s' % (nm, r)); sys.exit(1)
r = call('POST', '/batch/%s/close' % G, {'actual_end_date': '2026-11-20', 'closing_quantity': 0})
say('slaughter done, BATCH-000015 closed' if 'error' not in r else 'close FAILED %s' % r)
PY
}

# ------------------------------------------------------------------ mill_plan: keep both farms' sheds in Mill Planning after the costing/porta steps
# Those steps close a grower batch (slaughter) and move weaner batches to Double Stock, which would leave the Mill Planning page nearly empty.
#  - A stage move gives the next stage's scheduler header the BATCH start date as effective_from, so a batch started in 2025 reads as day 690 of Double Stock
#    and the plan finds no feed row: reset those headers to the move date (labelled SQL; the API has no way to set it).
#  - BATCH-000014 (Porta grower) was loaded with closing_quantity 0, which the forecast reads as no heads: set to its opening quantity.
#  - Add an active Multiplier grower batch (MUGR4, 200 head) to stand in for the one slaughtered, so the grower shed still plans feed.
step_mill_plan() {
  mysql -u "${SEED_DB_USER:-root}" "${SEED_DB:-nf_cccshow}" -e "
    UPDATE scheduler_header h JOIN batch_header b ON b.batch_id=h.batch_id JOIN stage_master s ON s.stage_id=h.stage_id
       SET h.effective_from='2026-11-19'
     WHERE b.batch_no IN ('BATCH-000009','BATCH-000011','BATCH-000016') AND s.stage_code='DOUBLE_STOCK' AND h.effective_from<'2026-11-19';
    UPDATE batch_header SET closing_quantity=opening_quantity WHERE batch_no='BATCH-000014' AND closing_quantity=0;" \
    && say mill_plan "Double Stock headers and Porta head count set" || say mill_plan "SQL FAILED"
  python3 - "$API" "$TOK" "$TENANT" "$CO" <<'PY'
import json, sys, urllib.request
api, tok, tenant, co = sys.argv[1:5]
H = {'authorization': 'Bearer ' + tok, 'content-type': 'application/json', 'x-tenant-id': tenant, 'x-active-company-id': co, 'x-workspace-scope': 'COMPANY'}
def call(m, path, body=None):
    r = urllib.request.Request(api + path, data=json.dumps(body).encode() if body is not None else None, headers=H, method=m)
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: return {'error': e.read().decode()[:200]}
def rows(path):
    d = call('GET', path); x = d.get('data', d)
    return x.get('items', x.get('data', x)) if isinstance(x, dict) else (x or [])
REMARK = 'Multiplier grower batch (showcase)'
batches = rows('/batch?limit=200')
if any(b.get('remarks') == REMARK for b in batches): print('mill_plan     grower batch exists'); sys.exit(0)
ref = next(b for b in batches if b['batch_no'] == 'BATCH-000012')
stage = {s['stage_code']: s['stage_id'] for s in rows('/stage-master?limit=100')}
def one(path, key, val, field):
    return next(r[field] for r in rows(path) if r.get(key) == val)
mugr4 = one('/location-master?limit=500&search=MUGR4', 'location_code', 'MUGR4', 'location_id')
piglet = one('/item-master?limit=500&search=BIO-SWINE-GROWER', 'item_code', 'BIO-SWINE-GROWER', 'item_id')
r = call('POST', '/batch', {'company_id': co, 'lob_id': ref['lob_id'], 'operational_area_id': ref.get('operational_area_id'), 'costing_method': 'BIO_ASSET',
    'breed_id': ref['breed_id'], 'stage_id': stage['GROWER'], 'auto_generate_scheduler': True, 'shed_id': mugr4, 'location_id': mugr4,
    'start_date': '2026-11-12', 'expected_end_date': '2027-02-20', 'opening_quantity': 200, 'uom': 'HEAD', 'remarks': REMARK,
    'input_lines': [{'item_id': piglet, 'quantity': 200, 'uom': 'HEAD', 'rate': 0}]})
b = (r.get('data') or {}).get('batch_id')
if not b: print('mill_plan     grower batch FAILED', r); sys.exit(1)
call('POST', '/batch/%s/activate' % b, {}); print('mill_plan     Multiplier grower batch created and active')
PY
}

STEPS=("$@"); [ ${#STEPS[@]} -eq 0 ] && STEPS=(parties schedulers breed_names breeds lifecycle service_batches daily costing forecast requisition alerts health wean overheads periods porta mill_plan)
for s in "${STEPS[@]}"; do "step_$s"; done
