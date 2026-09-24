/**
 * Reason Master Template.xlsx, added to `Master Templates/` 2026-09-21 — the
 * client's own 57-row catalog across nine categories, sheet "Example- Reason
 * Master" (the blank " Reason Master" sheet is the same header spec with no
 * rows). Replaces the three placeholder examples this file held before: an
 * earlier agent, with no client document to work from, deliberately seeded
 * only DOA/RATION_PIG/CULLED_PROC rather than invent the "47 reason codes"
 * AGENTS.md's open questions once mentioned. That document now exists —
 * MORTALITY alone is 21 rows, matching AGENTS.md's citation exactly — so this
 * is transcribed from it, not invented.
 *
 * Every field below is the template's own column, transcribed mechanically
 * (parsed from the workbook, not hand-typed) except two, both marked ours:
 * - `mandatory_weight`: not a template column: false for every row. No
 *   downstream code currently reads it (checked 2026-09-21); it stays an
 *   editable per-row flag on the master, same as before.
 * - `applicable_stages` vs `stage_filter_note`: the template's "Stage Filter"
 *   column is free text ("LACTATION (piglet)", "SOW / GILT_REARING", "GROWER
 *   / SOW", "GILT_REARING" for the client's own "GILT_REARING" wording of our
 *   GILT_GROWER stage code). `stage_filter_note` keeps that text verbatim.
 *   `applicable_stages` holds only the tokens that are exact stage_master
 *   codes — used for real filtering (reason.service.ts assertStages,
 *   findAll's stageCode filter). "SOW" names an animal type, not a
 *   stage_master row, and has no equivalent to map to; it is dropped from
 *   applicable_stages and kept only in stage_filter_note. Worth a client
 *   question if stage-level reason filtering needs to key off animal type too.
 */
export const REASON_CATEGORIES = [
  'MORTALITY', 'CULL', 'RETURN', 'SELECTION', 'DISPOSAL', 'TRANSFER', 'SCAN', 'ADJUSTMENT', 'REQUISITION',
] as const;
export type ReasonCategory = typeof REASON_CATEGORIES[number];

export interface DocumentedReason {
  reason_code: string;
  reason_name: string;
  category: ReasonCategory;
  sub_category: string | null;
  applicable_stages: string[] | null;
  stage_filter_note: string | null;
  mandatory_comment: boolean;
  mandatory_weight: boolean;
}

export const DOCUMENTED_REASONS: DocumentedReason[] = [
  { reason_code: 'MRT-001', reason_name: 'Respiratory Disease (PRRS/APP/Pneumonia)', category: 'MORTALITY', sub_category: 'Disease', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-002', reason_name: 'Enteric Disease (PED/Rotavirus/Scours)', category: 'MORTALITY', sub_category: 'Disease', applicable_stages: ['WEANING', 'LACTATION'], stage_filter_note: 'WEANER / LACTATION', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-003', reason_name: 'Reproductive Failure (MMA/Metritis)', category: 'MORTALITY', sub_category: 'Disease', applicable_stages: ['LACTATION', 'GESTATION'], stage_filter_note: 'LACTATION / GESTATION', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-004', reason_name: 'Septicaemia / Systemic Infection', category: 'MORTALITY', sub_category: 'Disease', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-005', reason_name: 'Greasy Pig Disease (Exudative Dermatitis)', category: 'MORTALITY', sub_category: 'Disease', applicable_stages: ['WEANING'], stage_filter_note: 'WEANER', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-006', reason_name: 'Meningitis / Streptococcus', category: 'MORTALITY', sub_category: 'Disease', applicable_stages: ['WEANING', 'GILT_GROWER'], stage_filter_note: 'WEANER / GROWER', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-007', reason_name: 'Crushing / Overlain by Sow', category: 'MORTALITY', sub_category: 'Trauma', applicable_stages: ['LACTATION'], stage_filter_note: 'LACTATION (piglet)', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-008', reason_name: 'Fighting / Biting Injury', category: 'MORTALITY', sub_category: 'Trauma', applicable_stages: ['WEANING', 'GILT_GROWER'], stage_filter_note: 'WEANER / GROWER / GILT_REARING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-009', reason_name: 'Prolapse (Rectal/Uterine/Vaginal)', category: 'MORTALITY', sub_category: 'Trauma', applicable_stages: ['GESTATION', 'LACTATION'], stage_filter_note: 'GESTATION / LACTATION', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-010', reason_name: 'Broken Limb / Leg Injury', category: 'MORTALITY', sub_category: 'Trauma', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-011', reason_name: 'Born Dead (BD) - Stillbirth', category: 'MORTALITY', sub_category: 'Stillbirth', applicable_stages: ['FARROWING'], stage_filter_note: 'FARROWING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-012', reason_name: 'Mummified Foetus (GA)', category: 'MORTALITY', sub_category: 'Stillbirth', applicable_stages: ['FARROWING'], stage_filter_note: 'FARROWING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-013', reason_name: 'Starvation / Low Viability Piglet', category: 'MORTALITY', sub_category: 'Starvation', applicable_stages: ['LACTATION'], stage_filter_note: 'LACTATION (piglet)', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-014', reason_name: 'Sow Off-Feed / Agalactia', category: 'MORTALITY', sub_category: 'Starvation', applicable_stages: ['LACTATION'], stage_filter_note: 'LACTATION', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-015', reason_name: 'Sudden Death / Cardiac Failure', category: 'MORTALITY', sub_category: 'Heart/Organ', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-016', reason_name: 'Organ Failure (Liver/Kidney)', category: 'MORTALITY', sub_category: 'Heart/Organ', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-017', reason_name: 'Dead on Arrival (DOA) - Transfer', category: 'MORTALITY', sub_category: 'DOA', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-018', reason_name: 'Ration Pig (Farm Butchery / Home Consumption)', category: 'MORTALITY', sub_category: 'Ration Pig', applicable_stages: ['WEANING', 'GILT_GROWER'], stage_filter_note: 'WEANER / GROWER', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'MRT-019', reason_name: 'Euthanasia - Welfare / Humane Kill', category: 'MORTALITY', sub_category: 'Euthanasia', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'MRT-020', reason_name: 'Unknown / Under Investigation', category: 'MORTALITY', sub_category: 'Unknown', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'MRT-021', reason_name: 'Other Mortality (specify in comment)', category: 'MORTALITY', sub_category: 'Other', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'CUL-001', reason_name: 'Poor Reproductive Performance (low BA, high BD)', category: 'CULL', sub_category: 'Reproductive', applicable_stages: null, stage_filter_note: 'SOW', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'CUL-002', reason_name: 'Failure to Cycle / Anestrus', category: 'CULL', sub_category: 'Reproductive', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'SOW / GILT_REARING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'CUL-003', reason_name: 'Repeat Returns (3 or more services)', category: 'CULL', sub_category: 'Reproductive', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'SOW / GILT_REARING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'CUL-004', reason_name: 'Abortion (repeat)', category: 'CULL', sub_category: 'Reproductive', applicable_stages: ['GESTATION'], stage_filter_note: 'GESTATION', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'CUL-005', reason_name: 'Leg / Feet / Structural Unsoundness', category: 'CULL', sub_category: 'Structural', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'CUL-006', reason_name: 'Body Condition / Thin Sow', category: 'CULL', sub_category: 'Structural', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'SOW / GILT_REARING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'CUL-007', reason_name: 'Old Age / High Parity (P6+)', category: 'CULL', sub_category: 'Age / Parity', applicable_stages: null, stage_filter_note: 'SOW', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'CUL-008', reason_name: 'Chronic Disease / Non-Responsive to Treatment', category: 'CULL', sub_category: 'Health', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'CUL-009', reason_name: 'Gilt Cull at Processing (Week 25 defect)', category: 'CULL', sub_category: 'Selection', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'GILT_REARING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'CUL-010', reason_name: 'Management Decision / Other Cull (specify)', category: 'CULL', sub_category: 'Other', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'RET-001', reason_name: 'Returned to Service (Repeat - not pregnant Day 28)', category: 'RETURN', sub_category: 'Repeat', applicable_stages: ['GESTATION'], stage_filter_note: 'GESTATION', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'RET-002', reason_name: 'Returned to Service (Repeat - not pregnant Day 45)', category: 'RETURN', sub_category: 'Repeat', applicable_stages: ['GESTATION'], stage_filter_note: 'GESTATION', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'RET-003', reason_name: 'Returned After Abortion (back to dry/service)', category: 'RETURN', sub_category: 'Abort', applicable_stages: ['GESTATION'], stage_filter_note: 'GESTATION', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'SEL-001', reason_name: 'Gilt Selected - Green Tag (Top GGP)', category: 'SELECTION', sub_category: 'Gilt', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'GILT_REARING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'SEL-002', reason_name: 'Gilt Selected - Blue Tag (GP - Multiplier)', category: 'SELECTION', sub_category: 'Gilt', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'GILT_REARING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'SEL-003', reason_name: 'Gilt Selected - Yellow Tag (PS - Farm Distribution)', category: 'SELECTION', sub_category: 'Gilt', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'GILT_REARING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'SEL-004', reason_name: 'Gilt Not Selected / Rejected at Week 4', category: 'SELECTION', sub_category: 'Gilt', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'GILT_REARING', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'DIS-001', reason_name: 'Farm Butchery (Ration Pig / Home Consumption)', category: 'DISPOSAL', sub_category: 'Destination', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'DIS-002', reason_name: 'Colcom Abattoir (Commercial Slaughter)', category: 'DISPOSAL', sub_category: 'Destination', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'GROWER / SOW', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'DIS-003', reason_name: 'On-Farm Burial / Rendering', category: 'DISPOSAL', sub_category: 'Destination', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'DIS-004', reason_name: 'Veterinary Post-Mortem (sent for PM)', category: 'DISPOSAL', sub_category: 'Destination', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'DIS-005', reason_name: 'Sale to Third Party (other than Colcom)', category: 'DISPOSAL', sub_category: 'Destination', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'DIS-006', reason_name: 'Donated / Welfare Disposal', category: 'DISPOSAL', sub_category: 'Destination', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'TRF-001', reason_name: 'Internal Transfer - Farm to Farm (production move)', category: 'TRANSFER', sub_category: 'Internal', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'TRF-002', reason_name: 'Internal Transfer - Gilt Distribution to Farm', category: 'TRANSFER', sub_category: 'Internal', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'GILT_REARING', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'TRF-003', reason_name: 'External Transfer - To Colcom Slaughter', category: 'TRANSFER', sub_category: 'External', applicable_stages: ['GILT_GROWER'], stage_filter_note: 'GROWER / SOW', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'SCN-001', reason_name: 'Confirmed Pregnant (Day 28 / Day 45)', category: 'SCAN', sub_category: 'Pregnancy', applicable_stages: ['GESTATION'], stage_filter_note: 'GESTATION', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'SCN-002', reason_name: 'Repeat - Not Pregnant (Return to Service)', category: 'SCAN', sub_category: 'Pregnancy', applicable_stages: ['GESTATION'], stage_filter_note: 'GESTATION', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'SCN-003', reason_name: 'Scan Failed / Inconclusive (rescan required)', category: 'SCAN', sub_category: 'Pregnancy', applicable_stages: ['GESTATION'], stage_filter_note: 'GESTATION', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'ADJ-001', reason_name: 'Positive Inventory Adjustment (found stock)', category: 'ADJUSTMENT', sub_category: 'Inventory', applicable_stages: null, stage_filter_note: 'N/A', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'ADJ-002', reason_name: 'Negative Inventory Adjustment (damage / write-off)', category: 'ADJUSTMENT', sub_category: 'Inventory', applicable_stages: null, stage_filter_note: 'N/A', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'ADJ-003', reason_name: 'Head Count Correction (data entry error)', category: 'ADJUSTMENT', sub_category: 'Headcount', applicable_stages: null, stage_filter_note: 'ALL', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'ADJ-004', reason_name: 'Feed Variance Adjustment (batch close)', category: 'ADJUSTMENT', sub_category: 'Inventory', applicable_stages: null, stage_filter_note: 'N/A', mandatory_comment: true, mandatory_weight: false },
  { reason_code: 'REQ-001', reason_name: 'Feed Requisition (weekly forecast shortfall)', category: 'REQUISITION', sub_category: 'Feed', applicable_stages: null, stage_filter_note: 'N/A', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'REQ-002', reason_name: 'Medicine / Vaccine Requisition', category: 'REQUISITION', sub_category: 'Medicine', applicable_stages: null, stage_filter_note: 'N/A', mandatory_comment: false, mandatory_weight: false },
  { reason_code: 'REQ-003', reason_name: 'Service / Overhead Requisition (non-inventory)', category: 'REQUISITION', sub_category: 'Service', applicable_stages: null, stage_filter_note: 'N/A', mandatory_comment: false, mandatory_weight: false },
];
