import { translations } from "@/utils/translations";
import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";

/**
 * KPI casing (Freebuff task-3, item 6, Rishi 29 Sep 2026): every user-facing
 * label/heading/menu text that says "Kpi" or "kpi" must read "KPI". Code
 * identifiers (translation keys like brpKpiTotalLitters, kpi_metric columns)
 * are not renamed. The audit this spec pins found every user-facing string
 * already correct, so this guards the invariant rather than fixing a defect.
 */
type Dict = Record<string, unknown>;

/** Walks a dictionary collecting only string leaf values, keyed by their path. */
function leafStrings(obj: Dict, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") out[`${prefix}${key}`] = value;
    else if (value && typeof value === "object") Object.assign(out, leafStrings(value as Dict, `${prefix}${key}.`));
  }
  return out;
}

describe("KPI casing — every user-facing string reads KPI", () => {
  const en = (translations as unknown as Record<string, Dict>).en;

  it("holds no wrongly-cased 'Kpi'/'kpi' in any English display string", () => {
    const strings = leafStrings(en);
    const offenders = Object.entries(strings)
      .filter(([key, value]) => /kpi/i.test(value) && !/KPI/.test(value))
      .map(([key, value]) => `${key}: "${value}"`);
    expect(offenders).toEqual([]);
  });

  it("keeps the known KPI strings in capitals", () => {
    const strings = leafStrings(en);
    for (const key of ["rolKpiMetrics", "notifCategoryKpiAlerts", "schedColKpiMode", "scPlaceholderKpiUom"]) {
      const value = strings[key];
      expect(value).toBeDefined();
      expect(value).toMatch(/KPI/);
      expect(value).not.toMatch(/Kpi/);
    }
  });

  it("labels the KPI Metric master and its references in capitals in the configs", () => {
    const kpiMetric = MASTER_DATA_CONFIGS.find((c) => c.key === "kpi-metric")!;
    expect(kpiMetric.label).toBe("KPI Metrics");
    expect(kpiMetric.singular).toBe("KPI Metric");

    const breed = MASTER_DATA_CONFIGS.find((c) => c.key === "breed-lifecycle-stage")!;
    const thresholds = breed.fields.find((f) => f.key === "kpi_thresholds");
    expect(thresholds).toBeDefined();
    expect(thresholds!.label).toBe("KPIs & Alerts");
    expect(thresholds!.jsonRow!.find((r) => r.key === "metric")!.label).toBe("KPI");
  });
});
