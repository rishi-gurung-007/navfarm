import { ageBetween, formatAge } from "@/modules/master-data/utils/age";

describe("ageBetween", () => {
  it("splits the age into whole weeks and leftover days", () => {
    expect(ageBetween("2026-07-01", "2026-09-22")).toEqual({ totalDays: 83, weeks: 11, days: 6 });
    expect(ageBetween("2026-09-01", "2026-09-22")).toEqual({ totalDays: 21, weeks: 3, days: 0 });
  });

  it("is zero on the day of birth", () => {
    expect(ageBetween("2026-09-22", "2026-09-22")).toEqual({ totalDays: 0, weeks: 0, days: 0 });
  });

  it("floors weeks the way the API does: six days into a week is not a week lived", () => {
    expect(ageBetween("2026-09-01", "2026-09-07")?.weeks).toBe(0);
    expect(ageBetween("2026-09-01", "2026-09-08")?.weeks).toBe(1);
  });

  it("is not thrown by timestamps or daylight-saving changes", () => {
    expect(ageBetween("2026-03-20T10:00:00.000Z", "2026-04-03")).toEqual({ totalDays: 14, weeks: 2, days: 0 });
  });

  it("gives nothing when a date is missing, malformed or the entry is before birth", () => {
    expect(ageBetween("", "2026-09-22")).toBeNull();
    expect(ageBetween("2026-09-22", undefined)).toBeNull();
    expect(ageBetween("not-a-date", "2026-09-22")).toBeNull();
    expect(ageBetween("2026-09-22", "2026-09-01")).toBeNull();
  });
});

describe("formatAge", () => {
  it("reads as weeks and days, singular where it is one", () => {
    expect(formatAge({ totalDays: 83, weeks: 11, days: 6 })).toBe("11 weeks 6 days");
    expect(formatAge({ totalDays: 8, weeks: 1, days: 1 })).toBe("1 week 1 day");
    expect(formatAge({ totalDays: 0, weeks: 0, days: 0 })).toBe("0 weeks 0 days");
  });
});
