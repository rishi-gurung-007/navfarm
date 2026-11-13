import { bandNote, cellText, parseTsiPaste, planDraftIssues } from "./boar-selection-rules";

describe("parseTsiPaste", () => {
  it("reads code, TSI and an optional genetic rank, split by commas, tabs or semicolons", () => {
    const out = parseTsiPaste("DA3337, 116, 1\nDA3132\t113\t2\nDA4244;113");
    expect(out.errors).toEqual([]);
    expect(out.rows).toEqual([
      { animal_code: "DA3337", tsi: 116, published_rank: 1 },
      { animal_code: "DA3132", tsi: 113, published_rank: 2 },
      { animal_code: "DA4244", tsi: 113 },
    ]);
  });

  it("skips blank lines and a heading line", () => {
    expect(parseTsiPaste("Boar,TSI,Rank\n\nDA1,100\n").rows).toEqual([{ animal_code: "DA1", tsi: 100 }]);
  });

  it("says which line is wrong, and keeps the good ones", () => {
    const out = parseTsiPaste("DA1,100\nDA2,abc\nDA3,0\nDA4,90,x\nDA5,95,0");
    expect(out.rows).toEqual([{ animal_code: "DA1", tsi: 100 }]);
    expect(out.errors).toEqual([
      "Line 2: DA2 needs a TSI above 0.",
      "Line 3: DA3 needs a TSI above 0.",
      "Line 4: DA4's genetic rank must be a whole number, 1 or more.",
      "Line 5: DA5's genetic rank must be a whole number, 1 or more.",
    ]);
  });

  it("refuses a boar listed twice", () => {
    expect(parseTsiPaste("DA1,100\nDA1,101").errors).toEqual(["A boar is listed twice: DA1."]);
  });
});

describe("cellText: body condition", () => {
  it("reads the status in words, with the day it falls due where there is one", () => {
    expect(cellText("bcs_status", "OVERDUE", { bcs_due: "2026-10-31" })).toBe("Overdue · 31/10/26");
    expect(cellText("bcs_status", "OK", { bcs_due: "2026-11-30" })).toBe("On schedule · 30/11/26");
    expect(cellText("bcs_status", "NEVER", { bcs_due: null })).toBe("Never assessed");
    expect(cellText("bcs_status", "NOT_SCHEDULED", {})).toBe("No schedule");
    expect(cellText("bcs_status", null)).toBe("—");
  });
  it("shows a score, or a dash where he has none", () => {
    expect(cellText("bcs_score", 3)).toBe("3");
    expect(cellText("bcs_score", null)).toBe("—");
  });
});

describe("cellText", () => {
  it("shows a dash where there is no figure, and never a zero that was not recorded", () => {
    expect(cellText("last_doses", null)).toBe("—");
    expect(cellText("dose_rank", undefined)).toBe("—");
    expect(cellText("last_doses", 0)).toBe("0");
  });

  it("shows the overall grading to one decimal and trims stored precision elsewhere", () => {
    expect(cellText("overall_grading", 4.5)).toBe("4.5");
    expect(cellText("overall_grading", 3)).toBe("3.0");
    expect(cellText("tsi", "116.00")).toBe("116");
    expect(cellText("last_volume_ml", "200.50")).toBe("200.5");
  });
});

describe("planDraftIssues", () => {
  const draft = (over: object = {}) => ({ date: "2026-11-04", boarCount: 2, reference: "", destination: "", ...over });

  it("is clean for a plan that needs nothing more than boars and a day", () => {
    expect(planDraftIssues(draft(), null)).toEqual([]);
    expect(planDraftIssues(draft(), { reference_required: false, destination_rule: "ANY" })).toEqual([]);
  });

  it("wants boars and a day", () => {
    expect(planDraftIssues(draft({ boarCount: 0, date: "" }), null).map((i) => i.field)).toEqual(["boars", "date"]);
  });

  it("wants the reference a line asks for, by the name the line gave it", () => {
    const rules = { reference_required: true, reference_label: "Breeding Web reference", destination_rule: "ANY" };
    expect(planDraftIssues(draft(), rules)).toEqual([{ field: "reference", text: "Enter the Breeding Web reference." }]);
    expect(planDraftIssues(draft({ reference: " BW-1 " }), rules)).toEqual([]);
    expect(planDraftIssues(draft(), { reference_required: true })[0].text).toBe("Enter the reference.");
  });

  it("wants a destination farm when the line restricts where its semen goes", () => {
    expect(planDraftIssues(draft(), { destination_rule: "ONE" })).toEqual([{ field: "destination", text: "Choose the destination farm." }]);
    expect(planDraftIssues(draft({ destination: "f1" }), { destination_rule: "LIST" })).toEqual([]);
  });
});

describe("bandNote: why a boar has no genetic level", () => {
  const bands = [{ level_name: "Average", tsi_from: 1, tsi_to: 22 }];
  it("says nothing when every boar with a TSI has a level, or none has a TSI", () => {
    expect(bandNote([{ boar: "B1", tsi: 10, genetic_level: "Average" }], bands)).toBeNull();
    expect(bandNote([{ boar: "B1", tsi: null, genetic_level: null }], bands)).toBeNull();
    expect(bandNote([{ boar: "B1", tsi: null, genetic_level: null }], [])).toBeNull();
  });

  it("says when the line has no bands at all", () => {
    expect(bandNote([{ boar: "B1", tsi: 10, genetic_level: null }], [])).toContain("No genetic level bands are set");
  });

  it("names the boars whose TSI is in none of the bands", () => {
    const note = bandNote([{ boar: "B1", tsi: 131, genetic_level: null }, { boar: "B2", tsi: 5, genetic_level: "Average" }, { boar: "B3", tsi: 124, genetic_level: null }], bands)!;
    expect(note).toContain("B1 (131), B3 (124)");
    expect(note).toContain("These boars");
  });
});

