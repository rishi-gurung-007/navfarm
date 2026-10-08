import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "../../core/database/schema";

const tag = "0153_feed_forecast_run_archive";
const read = () => readFileSync(join(__dirname, `${tag}.sql`), "utf8");

describe("Tenant migration 0153 — current feed forecast run lifecycle", () => {
  it("is journalled immediately after feed requisition transfer links", () => {
    const entries = JSON.parse(readFileSync(join(__dirname, "meta/_journal.json"), "utf8")).entries;
    expect(entries.find((entry: any) => entry.idx === 153)).toEqual({
      idx: 153, version: "5", when: 1792000000022, tag, breakpoints: true,
    });
  });

  it("only adds archive evidence, its lookup index and one-run-per-requisition uniqueness", () => {
    const sql = read();
    expect(sql).toContain("ADD `archived_at` timestamp NULL");
    expect(sql).toContain("ADD `archived_by` varchar(36) NULL");
    expect(sql).toContain("idx_feed_forecast_run_tenant_farm_archive");
    expect(sql).toContain("CREATE UNIQUE INDEX `uq_requisition_feed_forecast_run`");
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|RENAME)\b/i);
    expect(sql).not.toMatch(/ALTER TABLE `(location_master|reporting_period)`/i);
  });

  it("exposes the additive columns and indexes through Drizzle", () => {
    const runs = getTableConfig(schema.feedForecastRun);
    const requisitions = getTableConfig(schema.requisition);
    expect(runs.columns.map((column) => column.name)).toEqual(expect.arrayContaining(["archived_at", "archived_by"]));
    expect(runs.indexes.map((index) => index.config.name)).toContain("idx_feed_forecast_run_tenant_farm_archive");
    expect(requisitions.indexes.map((index) => index.config.name)).toContain("uq_requisition_feed_forecast_run");
  });
});
