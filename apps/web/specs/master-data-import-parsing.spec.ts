import { parseCsvText } from "../src/modules/master-data/utils/master-csv";

describe("master-data-import-parsing", () => {
  it("correctly parses tab-delimited text with duplicate headers and extracts fields", () => {
    const rawInput = [
      "Nature of Business\tLine of Business\tCode\tName\tSpecies\tBreed Type\tDescription\tAvg Growth Rate (g/day)\tAvg FCR\tAvg Mortality %\tAvg Yield per Unit\tGestation Days\tLactation Days\tAvg Litter Size Born\tAvg Litter Size Weaned\tAvg Weaning Weight (KG)\tFarrowing Rate %\tProductive Life (months)\tProductive Life Cycles\tDoses per Week\tProductive Life (months)\tMature Age (months)\tResidual Value %\tBlocked",
      "LIVESTOCK\tLVS_PIGGERY\tBRD-006\tTempo-Boar\t\tMEAT\tAI STATION submitted no Breed Master; line names taken from the only sheet that codes them (LEARIG).\t\t\t\t\t\t\t\t\t\t\t\t\t\t29\t\t\tFALSE",
      "LIVESTOCK\tLVS_PIGGERY\tBRD-007\tTN-70-Sow\t\tMEAT\tLIONSHEAD EXTENSION submitted no usable Breed row; these are LIONSHEAD's figures, the herd it grows out.\t\t\t\t\t116\t28\t15\t13.9\t7.5\t\t42\t8\t\t29\t\t\tFALSE",
    ].join("\n");

    const { headers, rows } = parseCsvText(rawInput);

    expect(headers).toHaveLength(24);
    expect(rows).toHaveLength(2);

    const r1 = rows[0];
    const r2 = rows[1];

    expect(r1.Code).toBe("BRD-006");
    expect(r1.Name).toBe("Tempo-Boar");
    expect(r1.Description).toBe("AI STATION submitted no Breed Master; line names taken from the only sheet that codes them (LEARIG).");
    expect(r1.boar_productive_life_months).toBe("29");

    expect(r2.Code).toBe("BRD-007");
    expect(r2.Name).toBe("TN-70-Sow");
    expect(r2.Description).toBe("LIONSHEAD EXTENSION submitted no usable Breed row; these are LIONSHEAD's figures, the herd it grows out.");
    expect(r2["Gestation Days"]).toBe("116");
    expect(r2["Lactation Days"]).toBe("28");
    expect(r2["Avg Litter Size Born"]).toBe("15");
    expect(r2["Avg Litter Size Weaned"]).toBe("13.9");
    expect(r2["Avg Weaning Weight (KG)"]).toBe("7.5");
    expect(r2["Productive Life (months)"]).toBe("42");
    expect(r2["Productive Life Cycles"]).toBe("8");
    expect(r2.boar_productive_life_months).toBe("29");
    expect(r2.Blocked).toBe("FALSE");
  });

  it("also correctly parses comma-delimited text with quotes", () => {
    const rawCsv = [
      `"Nature of Business","Line of Business","Code","Name","Gestation Days","Lactation Days"`,
      `"LIVESTOCK","LVS_PIGGERY","BRD-007","TN-70-Sow","116","28"`,
    ].join("\r\n");

    const { headers, rows } = parseCsvText(rawCsv);
    expect(headers).toEqual(["Nature of Business", "Line of Business", "Code", "Name", "Gestation Days", "Lactation Days"]);
    expect(rows[0]["Gestation Days"]).toBe("116");
    expect(rows[0]["Lactation Days"]).toBe("28");
  });

  it("identifies invalid breed codes when mandatory fields are missing or invalid", () => {
    const rawInput = [
      "Code\tName\tBreed Type",
      "\tInvalid No Code\tMEAT",
      "BRD-009\t\tMEAT",
      "BRD-010\tValid Breed\tINVALID_TYPE",
    ].join("\n");

    const { rows } = parseCsvText(rawInput);
    const validationResults = rows.map((r, i) => {
      const code = (r.Code || "").trim();
      const name = (r.Name || "").trim();
      const type = (r["Breed Type"] || "MEAT").trim().toUpperCase();
      const errors: string[] = [];

      if (!code) errors.push("Breed Code is required.");
      if (!name) errors.push("Breed Name is required.");
      if (!["MEAT", "BREEDER", "DUAL_PURPOSE"].includes(type)) {
        errors.push(`Breed Type '${type}' is invalid.`);
      }

      return {
        index: i + 1,
        code: code || `Row #${i + 1}`,
        isValid: errors.length === 0,
        errors,
      };
    });

    const failed = validationResults.filter((r) => !r.isValid);
    expect(failed).toHaveLength(3);
    expect(failed[0].code).toBe("Row #1");
    expect(failed[0].errors).toContain("Breed Code is required.");
    expect(failed[1].code).toBe("BRD-009");
    expect(failed[1].errors).toContain("Breed Name is required.");
    expect(failed[2].code).toBe("BRD-010");
    expect(failed[2].errors).toContain("Breed Type 'INVALID_TYPE' is invalid.");
  });
});
