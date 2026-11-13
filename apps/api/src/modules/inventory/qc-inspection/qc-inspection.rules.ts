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
  /** The QC Parameter Master row the check was taken from (0248). */
  param_id?: string | null;
  sampling_type: string;
  measurement_code: string;
  measurement_description?: string | null;
  stage?: string | null;
  uom?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  target_value?: number | null;
  acceptance_text?: string | null;
  is_mandatory?: boolean;
  is_active?: boolean;
}

/** A QC Parameter Master row, as far as a specification line needs it. */
export interface QcParameterForSpec {
  param_id: string;
  param_code: string;
  param_name: string;
  param_type: string;
  uom: string | null;
  min_value: string | number | null;
  max_value: string | number | null;
  target_value: string | number | null;
  is_mandatory: boolean;
  is_active: boolean;
}

const decimal = (v: string | number | null) => (v === null || v === undefined ? null : Number(v));

/**
 * The specification line for a QC parameter: its QC Code, Description, Unit, Min / Max / Target and Mandatory, as the master holds them. A Numeric
 * parameter is a Value check judged against Min..Max; a Yes / No parameter is a Descriptive check, the inspector confirms its Description.
 */
export function specLineFromParameter(param: QcParameterForSpec): SpecLineInput {
  const value = param.param_type === 'NUMERIC';
  return {
    param_id: param.param_id,
    measurement_code: param.param_code,
    measurement_description: param.param_name,
    sampling_type: value ? 'VALUE' : 'DESCRIPTIVE',
    uom: value ? param.uom : null,
    min_value: value ? decimal(param.min_value) : null,
    max_value: value ? decimal(param.max_value) : null,
    target_value: value ? decimal(param.target_value) : null,
    is_mandatory: param.is_mandatory,
    is_active: param.is_active,
  };
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
    if (line.target_value != null) {
      if (hasMin && Number(line.target_value) < Number(line.min_value)) return `'${code}': Target Value cannot be below Min Value.`;
      if (hasMax && Number(line.target_value) > Number(line.max_value)) return `'${code}': Target Value cannot be above Max Value.`;
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
      param_id: line.param_id ?? null,
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
      target_value: value && line.target_value != null ? String(line.target_value) : null,
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

/**
 * What becomes of a rejected quantity (0249). Recorded on the inspection only: nothing is posted for it, because how a rejection is
 * accounted for is Finance's decision. RETURN_TO_SOURCE is what a transfer's rejection already does (the inspection writes the
 * return to the sending location), so it is recorded, never chosen.
 */
export const REJECTION_DISPOSITIONS = ['RETURN_TO_SUPPLIER', 'SCRAP', 'HOLD', 'RETURN_TO_SOURCE'] as const;
export type RejectionDisposition = (typeof REJECTION_DISPOSITIONS)[number];

export const DISPOSITION_LABEL: Record<RejectionDisposition, string> = {
  RETURN_TO_SUPPLIER: 'Return to supplier',
  SCRAP: 'Scrap',
  HOLD: 'Hold for a decision',
  RETURN_TO_SOURCE: 'Returned to the sending location',
};

const TRANSFER_SOURCE_TYPES = ['TRANSFER_RECEIPT', 'TRANSFER_EVENT'];
const choices = (list: RejectionDisposition[]) => list.map((d) => DISPOSITION_LABEL[d]).join(' or ');

/** The dispositions open to a source. Only a goods receipt has a supplier to return to; a transfer's rejection always goes back where it came from. */
export function dispositionsFor(sourceDocType: string): RejectionDisposition[] {
  if (TRANSFER_SOURCE_TYPES.includes(sourceDocType)) return ['RETURN_TO_SOURCE'];
  return sourceDocType === 'GOODS_RECEIPT' ? ['RETURN_TO_SUPPLIER', 'SCRAP', 'HOLD'] : ['SCRAP', 'HOLD'];
}

/**
 * The disposition and reference to store for a rejected quantity, or why they cannot be stored. Nothing rejected stores neither; a transfer
 * stores RETURN_TO_SOURCE; any other source must say which of its dispositions applies.
 */
export function resolveDisposition(input: {
  sourceDocType: string;
  rejectedQty: number;
  disposition?: string | null;
  ref?: string | null;
}): { disposition: RejectionDisposition | null; ref: string | null } | { error: string } {
  if (!(input.rejectedQty > QTY_TOLERANCE)) return { disposition: null, ref: null };
  const ref = input.ref?.trim() || null;
  const allowed = dispositionsFor(input.sourceDocType);
  if (TRANSFER_SOURCE_TYPES.includes(input.sourceDocType)) {
    if (input.disposition && input.disposition !== 'RETURN_TO_SOURCE') {
      return { error: "A transfer's rejected quantity goes back to the location it was sent from; it cannot be given another disposition." };
    }
    return { disposition: 'RETURN_TO_SOURCE', ref };
  }
  if (!input.disposition) return { error: `Say what becomes of the rejected quantity: ${choices(allowed)}.` };
  if (!(allowed as string[]).includes(input.disposition)) {
    const name = DISPOSITION_LABEL[input.disposition as RejectionDisposition] ?? input.disposition;
    return { error: `${name} is not open to this inspection's rejected quantity: choose ${choices(allowed)}.` };
  }
  return { disposition: input.disposition as RejectionDisposition, ref };
}

/**
 * Why a rejected quantity cannot be settled as `next`, or null. Only a closed inspection's rejection is settled, only while it is held (or was
 * closed before dispositions were recorded), and only to a final disposition: holding it again settles nothing.
 */
export function settleProblem(input: {
  status: string;
  sourceDocType: string;
  rejectedQty: number;
  current: string | null;
  next: string;
}): string | null {
  if (input.status !== 'CLOSED') return 'Only a closed inspection has a rejected quantity to settle.';
  if (!(input.rejectedQty > QTY_TOLERANCE)) return 'Nothing was rejected on this inspection.';
  if (input.current && input.current !== 'HOLD') {
    return `The rejected quantity is already settled: ${DISPOSITION_LABEL[input.current as RejectionDisposition] ?? input.current}.`;
  }
  const final = dispositionsFor(input.sourceDocType).filter((d) => d !== 'HOLD');
  if (!(final as string[]).includes(input.next)) return `Choose ${choices(final)}.`;
  return null;
}

/** The 10000-step line numbers the rest of the application uses. */
export function lineNumber(index: number): number {
  return (index + 1) * 10000;
}
