import { assessDraftIssues, consequenceOf, needsAttention, nextAssessmentText, ScaleOption, STATUS_LABEL } from "./boar-condition-rules";

// The client's SOP 21 scale, as test data (the application holds none until one is entered).
const opt = (score: number, name: string, feed: number | null, action: string | null = null, health = false, meds = false): ScaleOption => ({
  score, score_name: name, feed_kg_per_day: feed, required_action: action, health_assessment_required: health, medication_review: meds,
});
const sop = [opt(1, "Very thin", 4, "Assess health status. Possible medication requirement", true, true), opt(2, "Below normal", 3.5, "Assess health status", true), opt(3, "Normal / ideal", 3), opt(4, "Overfat", 2.5), opt(5, "Obese", 2.3)];
const rules = { allow_feed_override: false, override_reason_required: true };
const draft = (over: object = {}) => ({ score: 3, date: "2026-11-02", today: "2026-11-02", feed: "", reason: "", ...over });

describe("consequenceOf", () => {
  it("says the feed level a score sets, and the change from what it was", () => {
    expect(consequenceOf(sop[2], null)).toEqual(["Feed level: 3 kg a day."]);
    expect(consequenceOf(sop[2], 3)).toEqual(["Feed level: 3 kg a day."]);
    expect(consequenceOf(sop[1], 3)).toEqual(["Feed level: 3 → 3.5 kg a day.", "Required action: Assess health status", "Flags a health assessment."]);
  });

  it("flags a health assessment and a medication review where the scale does", () => {
    expect(consequenceOf(sop[0], 3)).toEqual(["Feed level: 3 → 4 kg a day.", "Required action: Assess health status. Possible medication requirement", "Flags a health assessment.", "Flags a medication review."]);
  });

  it("says a score that sets no feed level leaves it as it is", () => {
    expect(consequenceOf(opt(9, "x", null), 3)).toEqual(["This score leaves the feed level as it is."]);
  });

  it("says nothing before a score is chosen", () => {
    expect(consequenceOf(undefined, 3)).toEqual([]);
  });
});

describe("assessDraftIssues", () => {
  it("is clean for a score and today", () => {
    expect(assessDraftIssues(draft(), sop, rules)).toEqual([]);
  });

  it("wants a score and a date not in the future", () => {
    expect(assessDraftIssues(draft({ score: null }), sop, rules).map((i) => i.field)).toEqual(["score"]);
    expect(assessDraftIssues(draft({ date: "2026-11-03" }), sop, rules).map((i) => i.field)).toEqual(["date"]);
    expect(assessDraftIssues(draft({ date: "" }), sop, rules).map((i) => i.field)).toEqual(["date"]);
  });

  it("says plainly when there is no scale", () => {
    expect(assessDraftIssues(draft(), [], rules)).toEqual([{ field: "score", text: "No body condition scale is set up for this boar's line. Add one under Body Condition Scale." }]);
  });

  it("wants a reason for a feed level that differs from the scale's, and not for the scale's own", () => {
    expect(assessDraftIssues(draft({ feed: "3.4" }), sop, rules).map((i) => i.field)).toEqual(["reason"]);
    expect(assessDraftIssues(draft({ feed: "3.4", reason: "recovering" }), sop, rules)).toEqual([]);
    expect(assessDraftIssues(draft({ feed: "3" }), sop, rules)).toEqual([]);
    expect(assessDraftIssues(draft({ feed: "3.4" }), sop, { ...rules, override_reason_required: false })).toEqual([]);
  });

  it("refuses a feed level of nothing or less", () => {
    expect(assessDraftIssues(draft({ feed: "0" }), sop, rules).map((i) => i.field)).toEqual(["feed"]);
    expect(assessDraftIssues(draft({ feed: "abc" }), sop, rules).map((i) => i.field)).toEqual(["feed"]);
  });
});

describe("status helpers", () => {
  it("names every status, and calls the ones that want action", () => {
    expect(STATUS_LABEL.OVERDUE).toBe("Overdue");
    expect(["OVERDUE", "DUE", "NEVER"].every(needsAttention)).toBe(true);
    expect(["OK", "DUE_SOON", "NOT_SCHEDULED"].some(needsAttention)).toBe(false);
  });
});

describe("the status and the next assessment are two things", () => {
  it("calls a boar within his schedule 'On schedule', and says in the next column when he is next due", () => {
    expect(STATUS_LABEL.OK).toBe("On schedule");
    expect(nextAssessmentText("OK", "2026-12-02")).toBe("02/12/26");
    expect(nextAssessmentText("DUE_SOON", "2026-11-30")).toBe("30/11/26");
    expect(nextAssessmentText("OVERDUE", "2026-10-30")).toBe("30/10/26");
  });

  it("says to score a boar who has never been scored, and that there is no schedule where there is none", () => {
    expect(nextAssessmentText("NEVER", null)).toBe("Score now");
    expect(nextAssessmentText("NOT_SCHEDULED", null)).toBe("No schedule");
    expect(nextAssessmentText("OK", null)).toBe("—");
  });
});

