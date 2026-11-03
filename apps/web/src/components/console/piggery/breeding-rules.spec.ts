import {
  acceptedBoarIds,
  checkFarrowing,
  checkMating,
  checkSemen,
  daysSinceCollection,
  errorsOf,
  isBreedingBatch,
  isLiveBoar,
  isLiveSow,
  lotDosesOf,
  lotState,
  openMatingOf,
  whyNotFarrowing,
  whyNotServed,
} from "./breeding-rules";

const sow = { animal_id: "s1", animal_code: "SOW-1", animal_type: "SOW", gender: "F", status: "ACTIVE", is_active: true };
const fields = (issues: { field: string; level: string }[], level = "error") => issues.filter((i) => i.level === level).map((i) => i.field);

describe("who a breeding form offers", () => {
  it("only active animal-wise batches", () => {
    expect(isBreedingBatch({ tracking_mode: "ANIMAL_WISE", status: "ACTIVE" })).toBe(true);
    expect(isBreedingBatch({ tracking_mode: "BATCH_WISE", status: "ACTIVE" })).toBe(false);
    expect(isBreedingBatch({ tracking_mode: "ANIMAL_WISE", status: "CLOSED" })).toBe(false);
  });

  it("a sow is a live female SOW/GILT, a boar a live male BOAR — a BOAR recorded female is neither", () => {
    expect(isLiveSow({ animal_type: "GILT", gender: "F" })).toBe(true);
    expect(isLiveSow({ animal_type: "BOAR", gender: "F" })).toBe(false);
    expect(isLiveSow({ ...sow, is_active: false })).toBe(false);
    expect(isLiveBoar({ animal_type: "BOAR", gender: "M" })).toBe(true);
    expect(isLiveBoar({ animal_type: "BOAR", gender: "F" })).toBe(false);
    expect(isLiveBoar({ animal_type: "SOW", gender: "M" })).toBe(false);
  });

  it("an open service is pending or confirmed and not farrowed", () => {
    const m = (over: object) => ({ sow_id: "s1", mating_date: "2026-06-01", ...over });
    expect(openMatingOf("s1", [m({ conception_result: "PENDING" })])).toBeDefined();
    expect(openMatingOf("s1", [m({ conception_result: "CONFIRMED", farrow_id: "f1" })])).toBeUndefined();
    expect(openMatingOf("s1", [m({ conception_result: "REPEAT" })])).toBeUndefined();
    expect(openMatingOf("s1", [m({ conception_result: "FAILED" })])).toBeUndefined();
    expect(openMatingOf("other", [m({})])).toBeUndefined();
  });

  it("says why a sow cannot be served or farrow", () => {
    expect(whyNotServed(sow, [])).toBeNull();
    expect(whyNotServed({ ...sow, status: "PREGNANT" }, [])).toBe("pregnant");
    expect(whyNotServed({ ...sow, status: "LACTATING" }, [])).toMatch(/wean/);
    expect(whyNotServed(sow, [{ sow_id: "s1", mating_date: "2026-06-01", conception_result: "PENDING" }])).toMatch(/open service/);
    expect(whyNotFarrowing(sow, [])).toMatch(/no open mating/);
    expect(whyNotFarrowing({ ...sow, status: "LACTATING" }, [{ sow_id: "s1", mating_date: "2026-06-01" }])).toMatch(/nursing/);
    expect(whyNotFarrowing(sow, [{ sow_id: "s1", mating_date: "2026-06-01" }])).toBeNull();
  });
});

describe("semen lots", () => {
  const lot = { doses_collected: 40, doses_used_internal: 2, doses_sold: 1, collection_date: "2026-10-10", expiry_date: "2026-10-15" };
  it("counts what is left and refuses an expired, empty or not-yet-collected lot", () => {
    expect(lotState(lot, "2026-10-12")).toEqual({ left: 37, usable: true, why: null });
    expect(lotState(lot, "2026-10-16").usable).toBe(false);
    expect(lotState(lot, "2026-10-09").why).toMatch(/after the mating/);
    expect(lotState({ ...lot, doses_used_internal: 39 }, "2026-10-12").why).toBe("no doses left");
  });

  it("days since a boar was last collected, counting pooled lots", () => {
    const lots = [
      { boar_id: "b1", collection_date: "2026-10-10" },
      { boar_id: "b2", boars: [{ boar_id: "b1" }, { boar_id: "b2" }], collection_date: "2026-10-12" },
    ];
    expect(daysSinceCollection("b1", lots, "2026-10-14")).toBe(2);
    expect(daysSinceCollection("b9", lots, "2026-10-14")).toBeNull();
  });
});

describe("checkMating", () => {
  const form = (over: object = {}) => ({
    batch_id: "b", sow_animal_id: "s1", mating_type: "AI", mating_date: "2026-03-01", semen_dose_qty: "1", semen_lot_id: "", boar_animal_id: "",
    second_mating_date: "", expected_farrowing_date: "2026-06-25", preg_check_date: "2026-03-29", ...over,
  });
  const run = (over: object = {}, extra: object = {}) => checkMating({ form: form(over), sow, matings: [], gestationDays: 116, ...extra });

  it("is clean for a complete AI service, with only the no-lot warning", () => {
    const issues = run();
    expect(errorsOf(issues)).toEqual([]);
    expect(fields(issues, "warn")).toEqual(["semen_lot_id"]);
  });

  it("needs the batch, the sow and a boar for a natural mating", () => {
    expect(fields(run({ batch_id: "", sow_animal_id: "" }, { sow: undefined }))).toEqual(["batch_id", "sow_animal_id"]);
    expect(fields(run({ mating_type: "NATURAL_MATING" }))).toContain("boar_animal_id");
  });

  it("refuses a sow that is already pregnant", () => {
    expect(fields(run({}, { sow: { ...sow, status: "PREGNANT" } }))).toContain("sow_animal_id");
  });

  it("checks the dates", () => {
    expect(fields(run({ mating_date: "2999-01-01" }))).toContain("mating_date");
    expect(fields(run({ second_mating_date: "2026-02-28" }))).toContain("second_mating_date");
    expect(fields(run({ second_mating_date: "2026-03-20" }))).toContain("second_mating_date");
    expect(fields(run({ second_mating_date: "2026-03-02" }))).not.toContain("second_mating_date");
    expect(fields(run({ expected_farrowing_date: "2026-03-01" }))).toContain("expected_farrowing_date");
    expect(fields(run({ preg_check_date: "2026-02-01" }))).toContain("preg_check_date");
    expect(fields(run({ expected_farrowing_date: "2026-06-10" }), "warn")).toContain("expected_farrowing_date");
  });

  it("checks the doses against the lot", () => {
    const lot = { lot_no: "L1", doses_collected: 5, doses_used_internal: 3, doses_sold: 0, collection_date: "2026-02-01", expiry_date: "2026-04-01" };
    expect(fields(run({ semen_lot_id: "l", semen_dose_qty: "3" }, { lot }))).toContain("semen_dose_qty");
    expect(errorsOf(run({ semen_lot_id: "l", semen_dose_qty: "2" }, { lot }))).toEqual([]);
    expect(fields(run({ semen_lot_id: "l", semen_dose_qty: "1.5" }, { lot }))).toContain("semen_dose_qty");
    expect(fields(run({ semen_lot_id: "l", mating_date: "2026-05-01" }, { lot }))).toContain("semen_lot_id");
  });
});

describe("checkFarrowing", () => {
  const mating = { breeding_id: "m1", mating_date: "2026-06-20" };
  const form = (over: object = {}) => ({
    batch_id: "b", sow_animal_id: "s1", farrowing_date: "2026-10-12", piglets_born_live: "12", piglets_stillborn: "", piglets_mummified: "",
    foster_received: "", fostered_out: "", avg_birth_weight_kg: "", total_litter_weight_kg: "", piglet_item_id: "item", ...over,
  });
  const run = (over: object = {}, extra: object = {}) => checkFarrowing({ form: form(over), sow, mating, ...extra });

  it("is clean for a normal litter", () => {
    const issues = run();
    expect(errorsOf(issues)).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("refuses a Total Born that is not born alive + born dead + mummified, and accepts one that is (or none)", () => {
    expect(fields(run({ piglets_born_live: "10", piglets_stillborn: "1", piglets_mummified: "1", piglets_total_born: "13" }))).toContain("piglets_total_born");
    expect(fields(run({ piglets_born_live: "10", piglets_stillborn: "1", piglets_mummified: "1", piglets_total_born: "12" }))).not.toContain("piglets_total_born");
    expect(fields(run({ piglets_total_born: "" }))).not.toContain("piglets_total_born");
  });

  it("needs an open mating and a sow that is not nursing", () => {
    expect(fields(run({}, { mating: undefined }))).toContain("breeding_id");
    expect(fields(run({}, { sow: { ...sow, status: "LACTATING" } }))).toContain("sow_animal_id");
  });

  it("dates the farrowing after the mating and not in the future, and warns about an unusual gestation", () => {
    expect(fields(run({ farrowing_date: "2026-06-20" }))).toContain("farrowing_date");
    expect(fields(run({ farrowing_date: "2999-01-01" }))).toContain("farrowing_date");
    expect(fields(run({ farrowing_date: "2026-08-01" }), "warn")).toContain("farrowing_date");
  });

  it("counts whole piglets, at least one, and no more fostered out than there are", () => {
    expect(fields(run({ piglets_born_live: "" }))).toContain("piglets_born_live");
    expect(fields(run({ piglets_born_live: "0" }))).toContain("piglets_born_live");
    expect(fields(run({ piglets_born_live: "11.5" }))).toContain("piglets_born_live");
    expect(fields(run({ fostered_out: "13" }))).toContain("fostered_out");
    expect(fields(run({ fostered_out: "14", foster_received: "2" }))).not.toContain("fostered_out");
    expect(fields(run({ piglets_born_live: "0", piglets_stillborn: "3", piglet_item_id: "" }))).toEqual([]);
  });

  it("needs the piglet item when any piglets are kept, and checks weights", () => {
    expect(fields(run({ piglet_item_id: "" }))).toEqual(["piglet_item_id"]);
    expect(fields(run({ avg_birth_weight_kg: "0.2" }), "warn")).toContain("avg_birth_weight_kg");
    expect(fields(run({ avg_birth_weight_kg: "1.4", total_litter_weight_kg: "30" }), "warn")).toContain("total_litter_weight_kg");
    expect(fields(run({ avg_birth_weight_kg: "1.4", total_litter_weight_kg: "16.8" }), "warn")).toEqual([]);
  });
});

describe("checkSemen", () => {
  const given = (over: object = {}) => ({
    collector_id: "", volume_ml: "", doses: "30", morphology_pct: "", motility_pct: "", concentration_m_per_ml: "", accepted: true, reject_reason: "", ...over,
  });
  const form = (over: object = {}) => ({
    batch_id: "b", boar_animal_ids: ["b1"], collection_date: "2026-10-14", output_item_id: "item",
    results: { b1: given() } as Record<string, object>,
    amortisation_period: "", feed_cost_period: "", drug_cost_period: "", overhead_cost_period: "", ...over,
  });
  const boar = { animal_id: "b1", animal_code: "BOAR-1" };
  const run = (over: object = {}, lots: object[] = [], boars: object[] = [boar]) => checkSemen({ form: form(over), boars, lots });

  it("is clean for a complete collection", () => {
    expect(run()).toEqual([]);
  });

  it("needs the batch, a boar and the semen item", () => {
    expect(fields(run({ batch_id: "", boar_animal_ids: [], output_item_id: "" }, [], [])).sort()).toEqual(["batch_id", "boar_animal_ids", "output_item_id"]);
  });

  it("asks for the breed once the batch is chosen, and not before", () => {
    expect(fields(run({ breed_id: "" }))).toEqual(["breed_id"]);
    expect(fields(run({ batch_id: "", breed_id: "" }))).not.toContain("breed_id");
    expect(run({ breed_id: "tempo" })).toEqual([]);
  });

  it("refuses a future date or one before the boar entered", () => {
    expect(fields(run({ collection_date: "2999-01-01" }))).toContain("collection_date");
    expect(fields(run({}, [], [{ ...boar, entry_date: "2026-10-15" }]))).toContain("collection_date");
  });

  it("works the lot's doses out from the accepted boars, and ignores a rejected boar's", () => {
    const two = form({ boar_animal_ids: ["b1", "b2"], results: { b1: given({ doses: "40" }), b2: given({ doses: "99", accepted: false, reject_reason: "discoloured" }) } });
    expect(lotDosesOf(two)).toBe(40);
    expect(acceptedBoarIds(two)).toEqual(["b1"]);
    expect(lotDosesOf(form({ results: { b1: given({ doses: "" }) } }))).toBe(0);
  });

  it("wants whole doses from every accepted boar, beside that boar", () => {
    expect(fields(run({ results: { b1: given({ doses: "10.5" }) } }))).toEqual(["results.b1.doses"]);
    expect(fields(run({ results: { b1: given({ doses: "" }) } }))).toEqual(["results.b1.doses"]);
  });

  it("wants a reason for a rejected ejaculate, and at least one accepted boar", () => {
    const rejected = run({ results: { b1: given({ accepted: false }) } });
    expect(fields(rejected).sort()).toEqual(["boar_animal_ids", "results.b1.reject_reason"]);
    expect(fields(run({ results: { b1: given({ accepted: false, reject_reason: "bad" }) } }))).toEqual(["boar_animal_ids"]);
  });

  it("bounds each boar's volume, morphology, motility and concentration", () => {
    const bad = run({ results: { b1: given({ volume_ml: "0", morphology_pct: "101", motility_pct: "120", concentration_m_per_ml: "-1" }) } });
    expect(fields(bad).sort()).toEqual(["results.b1.concentration_m_per_ml", "results.b1.morphology_pct", "results.b1.motility_pct", "results.b1.volume_ml"]);
  });

  it("checks no rest or motility rule when the line has none: no figure is made up", () => {
    const lots = [{ boar_id: "b1", collection_date: "2026-10-13" }];
    expect(run({ results: { b1: given({ motility_pct: "5" }) } }, lots)).toEqual([]);
  });

  it("counts a boar tapped in an earlier collection even when his ejaculate was rejected", () => {
    expect(daysSinceCollection("b1", [{ boar_id: "other", collection_date: "2026-10-12", results: [{ boar_id: "b1" }] }], "2026-10-14")).toBe(2);
  });

  describe("with the rules of the boar's line", () => {
    const rules = { pooling_allowed: true, min_boars_per_lot: null, max_boars_per_lot: null, min_rest_days: 3, min_motility_pct: "70.00", rule_enforcement: "WARN" };
    const lots = [{ boar_id: "b1", collection_date: "2026-10-13" }];
    const lowMotility = { results: { b1: given({ motility_pct: "60" }) } };
    const runWith = (r: object, over: object = {}) => checkSemen({ form: form(over), boars: [boar], lots, rules: { ...rules, ...r } });

    it("warns, without blocking, about a boar collected inside the line's rest days and low motility", () => {
      const issues = runWith({}, lowMotility);
      expect(errorsOf(issues)).toEqual([]);
      expect(fields(issues, "warn").sort()).toEqual(["boar_animal_ids", "results.b1.motility_pct"]);
    });

    it("stops the collection instead when the line blocks", () => {
      expect(fields(runWith({ rule_enforcement: "BLOCK" }, lowMotility)).sort()).toEqual(["boar_animal_ids", "results.b1.motility_pct"]);
    });

    it("reads the rest days and the motility floor from the line, not from a constant", () => {
      expect(runWith({ min_rest_days: 1, min_motility_pct: "50" }, lowMotility)).toEqual([]);
      expect(fields(runWith({ min_rest_days: 2 }), "warn")).toEqual(["boar_animal_ids"]);
    });

    it("counts only the accepted boars against the line's pooling limits", () => {
      const two = { boar_animal_ids: ["b1", "b2"], results: { b1: given(), b2: given({ accepted: false, reject_reason: "bad" }) } };
      expect(fields(runWith({ pooling_allowed: false, min_rest_days: null }, two))).toEqual([]);
      const both = { boar_animal_ids: ["b1", "b2"], results: { b1: given(), b2: given() } };
      expect(fields(runWith({ pooling_allowed: false, min_rest_days: null }, both))).toEqual(["boar_animal_ids"]);
      expect(fields(runWith({ max_boars_per_lot: 1, min_rest_days: null }, both))).toEqual(["boar_animal_ids"]);
      expect(fields(runWith({ min_boars_per_lot: 2, min_rest_days: null }))).toEqual(["boar_animal_ids"]);
      expect(runWith({ min_boars_per_lot: 2, max_boars_per_lot: 2, min_rest_days: null }, both)).toEqual([]);
    });
  });
});
