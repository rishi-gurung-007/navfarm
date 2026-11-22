#!/usr/bin/env bash
# Showcase demo data for the local cccshow tenant, written THROUGH THE API (curl), never raw SQL.
# Demo-flavoured, plausible Triple C piggery data. Not production data.
#
# Usage (password is never stored here):
#   TENANT=cccshow LOGIN_EMAIL=company.admin@cccshow.local LOGIN_PASSWORD='...' \
#     scripts/showcase-seed-cccshow.sh [step ...]
# Steps: parties daily forecast requisition alerts health wean overheads   (default: all, in that order)
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
d=json.load(sys.stdin); x=d.get('data',d)
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
  FARMLIST=$(api GET "/location?limit=500" | python3 -c "
import json,sys
d=json.load(sys.stdin); x=d.get('data',d)
x=x.get('items',x.get('data',x)) if isinstance(x,dict) else x
for r in (x or []):
    if r.get('location_type')=='FARM': print('%s|%s|%s|%s' % (r['location_id'], r['location_code'], r.get('location_name') or r['location_code'], r.get('cost_center_id') or ''))")
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
    if [ -n "$ccid" ] && [ -z "$lcc" ]; then
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

STEPS=("$@"); [ ${#STEPS[@]} -eq 0 ] && STEPS=(parties daily forecast requisition alerts health wean overheads)
for s in "${STEPS[@]}"; do "step_$s"; done
