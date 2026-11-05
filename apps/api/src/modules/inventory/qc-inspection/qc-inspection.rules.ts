/**
 * Incoming QC — the rules, as pure functions (plan 2026-11-03-incoming-qc). The service does the reading and writing; every
 * decision about what a result means lives here, so it can be tested without a database.
 *
 * Reference: Business Central's QC Specification Master List (a Value check has a min/max, a Descriptive check has a rule in
 * words) and QC Inspection Order (sample / accepted / rejected quantity, reason, deviation, approver).
 */

export const SAMPLING_TYPES = ['VALUE', 'DESCRIPTIVE'] as const;
export type SamplingType = (typeof SAMPLING_TYPES)[number];

export type LineResult = 'PASS' | 'FAIL';
export type InspectionResult = 'PASS' | 'FAIL' | 'DEVIATION';
export type InspectionStatus = 'OPEN' | 'PENDING_APPROVAL' | 'CLOSED';

/** Quantities are stored to four places. */
const QTY_TOLERANCE = 0.00005;

export interface SpecLineInput {
  sampling_type: string;
  measurement_code: string;
  measurement_description?: string | null;
  stage?: string | null;
  uom?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  acceptance_text?: string | null;
  is_mandatory?: boolean;
  is_active?: boolean;
}

/**
 * Why a specification line is not acceptable, or null. A QC code and a QC type are always needed; a Value check needs a range, and a
 * Descriptive check needs its description, which is the rule the inspector confirms.
 */
export function specLineProblem(line: SpecLineInput): string | null {
  const code = line.measurement_code?.trim();
  if (!code) return 'Every check needs a QC Code.';
  if (!SAMPLING_TYPES.includes(line.sampling_type as SamplingType)) {
    return `'${code}': QC Type must be VALUE or DESCRIPTIVE.`;
  }
  if (line.sampling_type === 'VALUE') {
    const hasMin = line.min_value != null;
    const hasMax = line.max_value != null;
    if (!hasMin && !hasMax) return `'${code}': a Value check needs a Min Value, a Max Value, or both.`;
    if (hasMin && hasMax && Number(line.min_value) > Number(line.max_value)) {
      return `'${code}': Min Value cannot be greater than Max Value.`;
    }
  } else if (!line.measurement_description?.trim()) {
    return `'${code}': a Descriptive check needs a Description: the rule the inspector confirms.`;
  }
  return null;
}

/** Every problem across a whole specification, including a QC Code used twice. Empty when it can be saved. */
export function specProblems(lines: SpecLineInput[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const problem = specLineProblem(line);
    if (problem) problems.push(problem);
    if (line.is_active === false || !line.measurement_code?.trim()) continue;
    const key = `${(line.stage || 'INCOMING').trim().toUpperCase()}|${line.measurement_code.trim().toUpperCase()}`;
    if (seen.has(key)) problems.push(`QC Code '${line.measurement_code.trim()}' appears twice.`);
    seen.add(key);
  }
  return problems;
}

/** The rows to store for a specification, in 10000-step line order. Fields that do not belong to the QC type are cleared. */
export function specRowsToStore(
  lines: SpecLineInput[],
  ids: { tenantId: string; companyId: string | null; itemId: string; userId?: string | null; newId: () => string },
) {
  return lines.map((line, i) => {
    const value = line.sampling_type === 'VALUE';
    const description = line.measurement_description?.trim() || null;
    return {
      spec_line_id: ids.newId(),
      tenant_id: ids.tenantId,
      company_id: ids.companyId,
      item_id: ids.itemId,
      line_no: lineNumber(i),
      stage: (line.stage || 'INCOMING').trim().toUpperCase(),
      measurement_code: line.measurement_code.trim(),
      measurement_description: description,
      sampling_type: line.sampling_type,
      uom: value ? line.uom?.trim() || null : null,
      min_value: value && line.min_value != null ? String(line.min_value) : null,
      max_value: value && line.max_value != null ? String(line.max_value) : null,
      // A Descriptive check's rule is its description; it is copied to the inspection as the thing to confirm.
      acceptance_text: value ? null : description,
      is_mandatory: line.is_mandatory ?? true,
      is_active: line.is_active ?? true,
      created_by: ids.userId ?? null,
      updated_by: ids.userId ?? null,
    };
  });
}

export interface InspectionLineSpec {
  measurement_code: string;
  sampling_type: string;
  min_value: string | number | null;
  max_value: string | number | null;
  is_mandatory: boolean;
}

export interface LineEntry {
  actual_value?: number | null;
  actual_text?: string | null;
  result?: string | null;
}

/**
 * What the inspector found against one check. A Value check is judged by the system against its range — the inspector types
 * the reading, not the verdict. A Descriptive check has no number to judge, so the inspector's PASS or FAIL is the verdict.
 * `null` means nothing was entered.
 */
export function judgeLine(
  spec: InspectionLineSpec,
  entry: LineEntry | undefined,
): { result: LineResult; actual_value: number | null; actual_text: string | null } | null {
  if (!entry) return null;
  if (spec.sampling_type === 'VALUE') {
    if (entry.actual_value == null || Number.isNaN(Number(entry.actual_value))) return null;
    const actual = Number(entry.actual_value);
    const belowMin = spec.min_value != null && actual < Number(spec.min_value);
    const aboveMax = spec.max_value != null && actual > Number(spec.max_value);
    return {
      result: belowMin || aboveMax ? 'FAIL' : 'PASS',
      actual_value: actual,
      actual_text: entry.actual_text?.trim() || null,
    };
  }
  if (entry.result !== 'PASS' && entry.result !== 'FAIL') return null;
  return { result: entry.result, actual_value: null, actual_text: entry.actual_text?.trim() || null };
}

export interface OutcomeInput {
  quantity: number;
  acceptedQty: number;
  rejectedQty: number;
  sampleQty?: number | null;
  deviation: boolean;
  hasReason: boolean;
  /** One entry per check on the inspection, already judged; null where the inspector entered nothing. */
  lines: { code: string; is_mandatory: boolean; result: LineResult | null }[];
}

export interface Outcome {
  result: InspectionResult;
  status: InspectionStatus;
  /** Quantity to write to the Inventory Ledger now. Zero for a failure, and for a deviation until it is approved. */
  postNow: number;
  /** Quantity to write once a deviation is approved. */
  postOnApproval: number;
}

/** What a completed inspection means, or the reason it cannot be completed as entered. */
export function decideOutcome(input: OutcomeInput): { outcome: Outcome } | { error: string } {
  const { quantity, acceptedQty, rejectedQty } = input;
  if (acceptedQty < 0 || rejectedQty < 0) return { error: 'Accepted and Rejected Qty cannot be negative.' };
  if (input.sampleQty != null && (input.sampleQty < 0 || input.sampleQty > quantity + QTY_TOLERANCE)) {
    return { error: 'Sample Qty must be between 0 and the quantity received.' };
  }
  if (Math.abs(acceptedQty + rejectedQty - quantity) > QTY_TOLERANCE) {
    return { error: `Accepted Qty + Rejected Qty must equal the quantity received (${quantity}).` };
  }

  const missing = input.lines.filter((l) => l.is_mandatory && l.result === null).map((l) => l.code);
  if (missing.length) return { error: `Enter a result for every mandatory check. Missing: ${missing.join(', ')}.` };

  const failed = input.lines.some((l) => l.is_mandatory && l.result === 'FAIL');

  if (!failed) {
    if (rejectedQty > QTY_TOLERANCE && !input.hasReason) {
      return { error: 'A Reason Code is required when part of the quantity is rejected.' };
    }
    return { outcome: { result: 'PASS', status: 'CLOSED', postNow: acceptedQty, postOnApproval: 0 } };
  }

  if (!input.deviation) {
    if (acceptedQty > QTY_TOLERANCE) {
      return { error: 'A failed inspection cannot accept stock. Reject the whole quantity, or accept with a deviation.' };
    }
    if (!input.hasReason) return { error: 'A Reason Code is required when the inspection fails.' };
    return { outcome: { result: 'FAIL', status: 'CLOSED', postNow: 0, postOnApproval: 0 } };
  }

  if (!input.hasReason) return { error: 'A Reason Code is required to accept stock with a deviation.' };
  if (acceptedQty <= QTY_TOLERANCE) return { error: 'A deviation accepts stock: enter an Accepted Qty, or reject the whole quantity.' };
  return { outcome: { result: 'DEVIATION', status: 'PENDING_APPROVAL', postNow: 0, postOnApproval: acceptedQty } };
}

/** The 10000-step line numbers the rest of the application uses. */
export function lineNumber(index: number): number {
  return (index + 1) * 10000;
}
