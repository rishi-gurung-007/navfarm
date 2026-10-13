import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { formatAmount, formatDecimal, formatExact, formatQuantity, formatRate, toInputNumber } from "@/lib/utils";

/**
 * 13 Oct 2026: the API returns every DECIMAL column as text at its full stored scale ("5.0000",
 * "150.000000", "65.00000000"), and ~60 places printed it as it came. Numbers on screen go through
 * lib/utils' formatters; edit boxes get toInputNumber, which drops the padding without rounding.
 */
describe("number formatters", () => {
  it("shows a quantity with at most 2 decimals, grouped, and HEAD as a whole number", () => {
    expect(formatQuantity("5.0000")).toBe("5");
    expect(formatQuantity("12.5000")).toBe("12.5");
    expect(formatQuantity("62695.0000")).toBe("62,695");
    expect(formatQuantity("3.14159")).toBe("3.14");
    expect(formatQuantity("2.0000", "HEAD")).toBe("2");
  });

  it("shows money with exactly 2 decimals", () => {
    expect(formatAmount("62695.0000")).toBe("62,695.00");
    expect(formatAmount("537.0000")).toBe("537.00");
    expect(formatAmount("71.4")).toBe("71.40");
  });

  it("keeps a unit rate's small digits rather than rounding them to 0.00 or 0.05", () => {
    expect(formatRate("28000.000000")).toBe("28,000.00");
    expect(formatRate("0.045800")).toBe("0.0458");
    expect(formatRate("0.500000")).toBe("0.50");
  });

  it("keeps a generic column's small fraction and trims the rest", () => {
    expect(formatDecimal("150.000000")).toBe("150");
    expect(formatDecimal("0.00100000")).toBe("0.001");
    expect(formatDecimal("65.00000000")).toBe("65");
  });

  it("leaves GPS and conversion factors exact, and gives edit boxes the unrounded number", () => {
    expect(formatExact("-17.82920000")).toBe("-17.8292");
    expect(toInputNumber("150.000000")).toBe("150");
    expect(toInputNumber("0.045800")).toBe("0.0458");
    expect(toInputNumber(null)).toBe("");
  });
});

/** The decimal fields that reached the screen raw; printing one without a formatter brings the zeros back. */
const DECIMAL_FIELDS = [
  "quantity", "cost_amount", "amount", "unit_cost", "rate", "std_rate", "book_value", "nca_book_value",
  "total_debit", "total_credit", "std_value", "standard_qty", "remaining_quantity", "on_hand_qty", "net_weight",
  "gross_weight", "cost_impact", "actual_value", "variance_amount", "computed_cost", "qty_to_ship", "qty_to_receive",
  "alternate_quantity", "dose_qty", "max_capacity", "min_value", "max_value", "default_qty_per_unit",
  "default_qty_per_batch", "opening_quantity", "closing_quantity", "current_quantity",
];
const RAW = new RegExp(
  String.raw`(?:\{|\$\{)\s*[A-Za-z_$][\w$]*(?:\??\.[\w$]+)*\??\.(?:` + DECIMAL_FIELDS.join("|") + String.raw`|[a-z_]+_weight_kg)\s*(?:\?\?[^}]*|\|\|[^}]*)?\}`,
);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("screens print no raw decimal", () => {
  it("passes every decimal field through a formatter (edit boxes use toInputNumber)", () => {
    const src = join(__dirname, "..", "src");
    const offenders: string[] = [];
    for (const file of tsxFiles(src)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/\b(value|defaultValue|key)=\{/.test(line)) return; // an edit box's own state, not a stored value
        if (RAW.test(line)) offenders.push(`${relative(src, file)}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
