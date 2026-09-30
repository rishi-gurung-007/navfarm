import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";

/**
 * Rishi (Freebuff task-3, item 2, 29 Sep 2026): Grading was a three-option
 * select (1/2/3) — a grade of 0 could not be recorded and anything above 3
 * did not exist. Grading is a whole number 0–99, typed rather than picked.
 */
const animalConfig = MASTER_DATA_CONFIGS.find((config) => config.key === "animal")!;
const grading = animalConfig.fields.find((f) => f.key === "grading")!;

describe("Grading is a number, whole numbers 0–99", () => {
  it("is a number field, not the old three-option select", () => {
    expect(grading.type).toBe("number");
    expect(grading.options).toBeUndefined();
  });

  it("allows whole numbers only, two digits max", () => {
    expect(grading.min).toBe(0);
    expect(grading.max).toBe(99);
    expect(grading.step).toBe("1");
    expect(grading.maxLength).toBe(2);
  });
});
