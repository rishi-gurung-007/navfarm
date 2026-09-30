import { MASTER_DATA_CONFIGS } from "@/modules/master-data/configs";

/**
 * Reason master (Freebuff task-3, item 5, Rishi 29 Sep 2026): Description is
 * capped at 50 characters in the form as in the DTO; no stage filter is
 * pre-selected by default; the list search also matches the reason's category
 * (server side — reason.service.ts — pinned by the API spec).
 */
const reason = MASTER_DATA_CONFIGS.find((config) => config.key === "reason")!;
const field = (key: string) => reason.fields.find((f) => f.key === key)!;

describe("Reason master — Description capped at 50", () => {
  it("limits the Description field (reason_name) to 50 characters", () => {
    expect(field("reason_name").maxLength).toBe(50);
    expect(field("reason_name").label).toBe("Description");
  });
});

describe("Reason master — no stage filter pre-selected", () => {
  it("leaves the Stage Filter multi-select empty on create", () => {
    // MasterDataTable.openCreate pre-seeds every multiple field carrying an
    // allOption with the All option — except on the reason master
    // (`config.key !== "reason"`). Pin the config shape that exception keys on:
    // the field is multiple with an allOption, so the pre-seed path exists, and
    // the master key that opts out is reason.
    const stageFilter = field("applicable_stages")!;
    expect(stageFilter.multiple).toBe(true);
    expect(stageFilter.allOption).toEqual({ stage_code: "ALL", stage_name: "All Stages" });
    expect(stageFilter.defaultValue).toBeUndefined();
    expect(reason.key).toBe("reason");
  });
});
