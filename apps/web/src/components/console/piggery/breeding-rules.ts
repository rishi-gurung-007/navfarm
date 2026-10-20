/**
 * What the Breeding forms check before they let a mating, a farrowing or a semen collection be saved.
 *
 * Every `error` here is a rule the API also enforces (breeding.service.ts) — the form only says so earlier, in words,
 * next to the field. A `warn` is guidance the API does not enforce: an unusual figure the user should look at twice.
 * The thresholds marked "guidance" are ours, not the client's; they only colour a hint and never block a save.
 */

export type Row = Record<string, any>;
export type Issue = { level: "error" | "warn"; field: string; text: string };

const DAY = 86_400_000;

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY);
}

const isWhole = (n: number) => Number.isInteger(n);
const num = (v: string | number | undefined | null) => (v === "" || v == null ? NaN : Number(v));

// ── Which animals and batches a form offers ─────────────────────────────────────────────────────────────

/** An active animal-wise batch: the only kind breeding is recorded in. */
export const isBreedingBatch = (b: Row) => b.tracking_mode === "ANIMAL_WISE" && b.status === "ACTIVE";

export const isLiveSow = (a: Row) => (a.animal_type === "SOW" || a.animal_type === "GILT") && a.gender === "F" && a.is_active !== false;
export const isLiveBoar = (a: Row) => a.animal_type === "BOAR" && a.gender === "M" && a.is_active !== false;

/** The service that is still open for a sow: pending or confirmed, and not yet farrowed. */
export function openMatingOf(sowId: string, matings: Row[]): Row | undefined {
  return matings
    .filter((m) => m.sow_id === sowId && !m.farrow_id && (m.conception_result ?? "PENDING") !== "FAILED" && (m.conception_result ?? "PENDING") !== "REPEAT")
    .sort((a, b) => String(b.mating_date).localeCompare(String(a.mating_date)))[0];
}

/** Why a sow cannot be served now, or null when she can. Mirrors BreedingService.assertSowCanBeServed. */
export function whyNotServed(sow: Row, matings: Row[]): string | null {
  const open = openMatingOf(sow.animal_id, matings);
  if (open) return `open service ${String(open.mating_date).slice(0, 10)} — not farrowed`;
  if (sow.status === "PREGNANT") return "pregnant";
  if (sow.status === "LACTATING") return "nursing — wean first";
  return null;
}

/** Why a sow cannot farrow now (no open service to farrow from, or she is already nursing), or null. */
export function whyNotFarrowing(sow: Row, matings: Row[]): string | null {
  if (sow.status === "LACTATING") return "already nursing a litter — wean it first";
  if (!openMatingOf(sow.animal_id, matings)) return "no open mating recorded";
  return null;
}

/** The semen lots a service on `matingDate` can draw from: doses left, collected on or before it, not expired by it. */
export function lotState(lot: Row, matingDate: string): { left: number; usable: boolean; why: string | null } {
  const left = Number(lot.doses_collected) - Number(lot.doses_used_internal || 0) - Number(lot.doses_sold || 0);
  if (left <= 0) return { left, usable: false, why: "no doses left" };
  if (lot.expiry_date && String(lot.expiry_date).slice(0, 10) < matingDate) return { left, usable: false, why: `expired ${String(lot.expiry_date).slice(0, 10)}` };
  if (lot.collection_date && String(lot.collection_date).slice(0, 10) > matingDate) return { left, usable: false, why: "collected after the mating" };
  return { left, usable: true, why: null };
}

/** Days since a boar's latest collection (as the main boar or pooled), or null when he has none on record. */
export function daysSinceCollection(boarId: string, lots: Row[], onDate: string): number | null {
  const dates = lots
    .filter((l) => l.boar_id === boarId || (l.boars || []).some((b: Row) => b.boar_id === boarId))
    .map((l) => String(l.collection_date).slice(0, 10))
    .filter((d) => d <= onDate)
    .sort();
  return dates.length ? daysBetween(dates[dates.length - 1], onDate) : null;
}

// ── Mating ──────────────────────────────────────────────────────────────────────────────────────────────

export interface MatingCheck {
  form: Row;
  sow?: Row;
  boar?: Row;
  lot?: Row;
  matings: Row[];
  gestationDays: number | null;
}

export function checkMating({ form, sow, boar, lot, matings, gestationDays }: MatingCheck): Issue[] {
  const out: Issue[] = [];
  const err = (field: string, text: string) => out.push({ level: "error", field, text });
  const warn = (field: string, text: string) => out.push({ level: "warn", field, text });
  const today = todayIso();

  if (!form.batch_id) err("batch_id", "Choose the batch first.");
  if (!form.sow_animal_id) err("sow_animal_id", "Choose the sow or gilt.");
  else if (sow) {
    const why = whyNotServed(sow, matings);
    if (why) err("sow_animal_id", `${sow.animal_code} cannot be served: ${why}.`);
  }
  if (!form.mating_date) err("mating_date", "Enter the mating date.");
  else if (form.mating_date > today) err("mating_date", "The mating date cannot be in the future.");

  const isAi = form.mating_type === "AI";
  if (!isAi && !form.boar_animal_id) err("boar_animal_id", "A natural mating needs the boar.");
  if (isAi && !form.semen_lot_id) err("semen_lot_id", "Choose the semen lot — its doses leave stock and it names the sire.");
  if (boar && boar.is_active === false) err("boar_animal_id", `${boar.animal_code} is no longer active.`);

  if (isAi) {
    const qty = num(form.semen_dose_qty);
    if (!(qty >= 1) || !isWhole(qty)) err("semen_dose_qty", "Doses used must be a whole number, at least 1.");
    if (lot && form.mating_date) {
      const st = lotState(lot, form.mating_date);
      if (!st.usable) err("semen_lot_id", `Lot ${lot.lot_no ?? ""} cannot be used: ${st.why}.`);
      else if (qty > st.left) err("semen_dose_qty", `Lot ${lot.lot_no ?? ""} has ${st.left} dose${st.left === 1 ? "" : "s"} left.`);
    }
  }

  if (form.second_mating_date && form.mating_date) {
    if (form.second_mating_date < form.mating_date) err("second_mating_date", "The second insemination cannot be before the first.");
    else if (form.second_mating_date > addDays(form.mating_date, 7)) err("second_mating_date", "The second insemination is within a week of the first.");
    else if (form.second_mating_date > today) err("second_mating_date", "The second insemination cannot be in the future.");
  }

  if (form.mating_date && form.expected_farrowing_date) {
    if (form.expected_farrowing_date <= form.mating_date) err("expected_farrowing_date", "Expected farrowing must be after the mating date.");
    else if (gestationDays != null && Math.abs(daysBetween(form.mating_date, form.expected_farrowing_date) - gestationDays) > 3) {
      warn("expected_farrowing_date", `That is ${daysBetween(form.mating_date, form.expected_farrowing_date)} days of gestation; the breed's is ${gestationDays}.`);
    }
  }
  if (form.mating_date && form.preg_check_date && form.preg_check_date < form.mating_date) {
    err("preg_check_date", "The pregnancy check cannot be before the mating date.");
  }
  return out;
}

// ── Farrowing ───────────────────────────────────────────────────────────────────────────────────────────

export interface FarrowingCheck {
  form: Row;
  sow?: Row;
  mating?: Row;
}

export function checkFarrowing({ form, sow, mating }: FarrowingCheck): Issue[] {
  const out: Issue[] = [];
  const err = (field: string, text: string) => out.push({ level: "error", field, text });
  const warn = (field: string, text: string) => out.push({ level: "warn", field, text });
  const today = todayIso();

  if (!form.batch_id) err("batch_id", "Choose the batch first.");
  if (!form.sow_animal_id) err("sow_animal_id", "Choose the sow.");
  else if (sow && sow.status === "LACTATING") err("sow_animal_id", `${sow.animal_code} is already nursing a litter — wean it first.`);
  if (form.sow_animal_id && sow && !mating) err("breeding_id", `${sow.animal_code} has no open mating — record her mating before her farrowing.`);

  if (!form.farrowing_date) err("farrowing_date", "Enter the farrowing date.");
  else {
    if (form.farrowing_date > today) err("farrowing_date", "The farrowing date cannot be in the future.");
    if (mating) {
      const served = String(mating.mating_date).slice(0, 10);
      if (form.farrowing_date <= served) err("farrowing_date", `The mating was on ${served}; the farrowing must be after it.`);
      else {
        // Guidance: a sow normally farrows at 114–116 days; well outside 105–122 deserves a second look.
        const gestation = daysBetween(served, form.farrowing_date);
        if (gestation < 105 || gestation > 122) warn("farrowing_date", `${gestation} days after the mating — a sow normally farrows about 114–116 days after service. Check the date and the mating chosen.`);
      }
    }
  }

  const live = num(form.piglets_born_live);
  const still = form.piglets_stillborn === "" ? 0 : num(form.piglets_stillborn);
  const mummy = form.piglets_mummified === "" ? 0 : num(form.piglets_mummified);
  const fin = form.foster_received === "" ? 0 : num(form.foster_received);
  const fout = form.fostered_out === "" ? 0 : num(form.fostered_out);

  if (Number.isNaN(live)) err("piglets_born_live", "Enter the piglets born alive (0 if none).");
  else if (live < 0 || !isWhole(live)) err("piglets_born_live", "Born alive must be a whole number.");
  if (Number.isNaN(still) || still < 0 || !isWhole(still)) err("piglets_stillborn", "Stillborn must be a whole number.");
  if (Number.isNaN(mummy) || mummy < 0 || !isWhole(mummy)) err("piglets_mummified", "Mummified must be a whole number.");
  if (Number.isNaN(fin) || fin < 0 || !isWhole(fin)) err("foster_received", "Fostered in must be a whole number.");
  if (Number.isNaN(fout) || fout < 0 || !isWhole(fout)) err("fostered_out", "Fostered out must be a whole number.");

  if (!Number.isNaN(live) && live + still + mummy === 0) err("piglets_born_live", "A farrowing needs at least one piglet born — live, stillborn or mummified.");
  if (!Number.isNaN(live) && fout > live + fin) err("fostered_out", `Only ${live + fin} piglets are there to foster out (${live} born alive + ${fin} received).`);
  if (live + still + mummy > 0) {
    const total = live + still + mummy;
    if (total > 25) warn("piglets_born_live", `${total} born is an exceptionally large litter — check the counts.`);
    if (still + mummy > total * 0.3) warn("piglets_stillborn", `${Math.round(((still + mummy) / total) * 100)}% of the litter was born dead — check the counts.`);
  }

  const netLitter = Math.max(0, (Number.isNaN(live) ? 0 : live) + (fin || 0) - (fout || 0));
  if (netLitter > 0 && !form.piglet_item_id) {
    err("piglet_item_id", "Choose the piglet item — the litter is held as a lot of it. Without it the piglets exist nowhere and cannot be weaned or moved.");
  }

  const avg = num(form.avg_birth_weight_kg);
  const total = num(form.total_litter_weight_kg);
  if (!Number.isNaN(avg) && avg <= 0) err("avg_birth_weight_kg", "Average birth weight must be above 0.");
  else if (!Number.isNaN(avg) && (avg < 0.8 || avg > 2.5)) warn("avg_birth_weight_kg", "Newborn piglets are usually about 1.0–1.8 kg — check the weight.");
  if (!Number.isNaN(total) && total <= 0) err("total_litter_weight_kg", "Total litter weight must be above 0.");
  if (!Number.isNaN(avg) && !Number.isNaN(total) && live > 0 && Math.abs(avg * live - total) > Math.max(0.5, total * 0.1)) {
    warn("total_litter_weight_kg", `${live} × ${avg} kg is ${(avg * live).toFixed(1)} kg, not ${total} kg.`);
  }
  return out;
}

// ── Semen collection ────────────────────────────────────────────────────────────────────────────────────

export interface SemenCheck {
  form: Row;
  boars: Row[];
  lots: Row[];
}

export function checkSemen({ form, boars, lots }: SemenCheck): Issue[] {
  const out: Issue[] = [];
  const err = (field: string, text: string) => out.push({ level: "error", field, text });
  const warn = (field: string, text: string) => out.push({ level: "warn", field, text });
  const today = todayIso();

  if (!form.batch_id) err("batch_id", "Choose the batch first.");
  if (!form.boar_animal_ids.length) err("boar_animal_ids", "Choose at least one boar.");
  if (!form.collection_date) err("collection_date", "Enter the collection date.");
  else if (form.collection_date > today) err("collection_date", "The collection date cannot be in the future.");

  for (const b of boars) {
    if (b.entry_date && form.collection_date && form.collection_date < String(b.entry_date).slice(0, 10)) {
      err("collection_date", `${b.animal_code} entered on ${String(b.entry_date).slice(0, 10)}.`);
    }
    if (form.collection_date) {
      const since = daysSinceCollection(b.animal_id, lots, form.collection_date);
      // Guidance: a boar is usually collected no more than every 3–4 days.
      if (since === 0) warn("boar_animal_ids", `${b.animal_code} was already collected on ${form.collection_date}.`);
      else if (since != null && since < 3) warn("boar_animal_ids", `${b.animal_code} was collected ${since} day${since === 1 ? "" : "s"} ago — boars are usually rested 3 days or more.`);
    }
  }

  const doses = num(form.doses_collected);
  if (Number.isNaN(doses) || doses < 1 || !isWhole(doses)) err("doses_collected", "Doses collected must be a whole number, at least 1.");
  if (!form.output_item_id) {
    err("output_item_id", "Choose the semen item — it is what puts the doses into inventory and makes them usable for AI. Without it the collection is only a note.");
  }

  const motility = num(form.motility_pct);
  if (!Number.isNaN(motility)) {
    if (motility < 0 || motility > 100) err("motility_pct", "Motility is a percentage, 0–100.");
    // Guidance: AI semen is commonly required to be at least 70% motile.
    else if (motility < 70) warn("motility_pct", "Motility under 70% is usually too low to use for AI.");
  }
  const volume = num(form.volume_ml);
  if (!Number.isNaN(volume) && volume <= 0) err("volume_ml", "Volume must be above 0.");
  const conc = num(form.concentration_m_per_ml);
  if (!Number.isNaN(conc) && conc <= 0) err("concentration_m_per_ml", "Concentration must be above 0.");
  for (const k of ["amortisation_period", "feed_cost_period", "drug_cost_period", "overhead_cost_period"]) {
    const v = num(form[k]);
    if (!Number.isNaN(v) && v < 0) err(k, "A cost cannot be negative.");
  }
  return out;
}

export const errorsOf = (issues: Issue[]) => issues.filter((i) => i.level === "error");
export const issueFor = (issues: Issue[], field: string) => issues.find((i) => i.field === field);
