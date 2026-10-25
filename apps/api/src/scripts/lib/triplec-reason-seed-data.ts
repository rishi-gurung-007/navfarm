/**
 * Triple C's reason codes, from the "Proposed" sheet of
 * `Reason Master Template - INPUT FROM GM FOR REVIEW 26TH SEPT 2026.xlsx`.
 *
 * DO NOT EDIT BY HAND. Regenerated from the workbook.
 *
 * "Proposed" is the sheet whose codes match this system's own (CUL-001), and
 * is the GM's reviewed list; the workbook's other six sheets are the historical
 * and per-class lists it was drawn from.
 *
 * CULLING is the client's word for the category this app calls CULL; every
 * other category they use is already one of ours.
 *
 * The Stage Filter column is free text listing whole classes of animal, and
 * reads "WEANER/GROWER /GILT REARING/DRYSOW/PREGANANT SOWS". Each word that
 * names a stage we carry becomes an entry in applicable_stages; the column is
 * also kept verbatim in stage_filter_note, which exists for exactly this —
 * BOARS and the odd "SOW" have no stage of their own in this tenant, and would
 * otherwise be lost. Spelling is the client's.
 *
 * DESTINATION (mortality pit, farm butchery, Colcom) has no column on
 * reason_master; it is carried here so it is not lost when one is added.
 */

export interface TripleCReasonRow {
  code: string;
  name: string;
  category: string;
  subCategory?: string;
  /** stage_master.stage_code entries resolved from the Stage Filter column. */
  stages?: string[];
  /** The Stage Filter column exactly as submitted. */
  stageFilterNote?: string;
  /** Where the animal goes. No home on reason_master yet. */
  destination?: string;
  mandatoryComment?: boolean;
}

export const TRIPLEC_REASONS: TripleCReasonRow[] = [
  { code: "CUL-001", name: "LEGS", category: "CULL", subCategory: "STRUCTURAL", stages: ["WEANER", "GROWER", "REARING", "PRODUCTIVE_SOW", "GESTATION"], stageFilterNote: "WEANER/GROWER /GILT REARING/DRYSOW/PREGANANT SOWS", destination: "FARM BUTCHERY", mandatoryComment: false },
  { code: "CUL-002", name: "MISCARRY", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["GESTATION"], stageFilterNote: "PREGNANCY", destination: "FARM BUTCHERY", mandatoryComment: false },
  { code: "CUL-003", name: "EMPTY", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-004", name: "BAD UDDER", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["LACTATION"], stageFilterNote: "LACTATING SOWS", destination: "FARM BUTCHERY", mandatoryComment: false },
  { code: "CUL-005", name: "LOW PRODUCTION", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["LACTATION", "PRODUCTIVE_SOW"], stageFilterNote: "LACTATING SOWS/DRY SOWS", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-006", name: "ANOESTRUS", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-007", name: "AGE", category: "CULL", subCategory: "Age / Parity", stages: ["PRODUCTIVE_SOW"], stageFilterNote: "DRY SOWS", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-008", name: "REPEAT RETURN", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-009", name: "DOGSITTER", category: "CULL", subCategory: "STRUCTURAL", stages: ["GROWER", "PRODUCTIVE_SOW", "GESTATION", "LACTATION"], stageFilterNote: "GROWER /DRYSOW/PREGANANT SOWS/LACTATING SOWS/BOARS", destination: "FARM BUTCHERY", mandatoryComment: false },
  { code: "CUL-010", name: "TWISTED INTESTINE", category: "CULL", subCategory: "INTERNAL ORGAN", stages: ["GROWER", "PRODUCTIVE_SOW", "GESTATION", "LACTATION"], stageFilterNote: "GROWER /DRYSOW/PREGNANCY/LACTATING SOWS/BOARS", destination: "FARM BUTCHERY", mandatoryComment: false },
  { code: "CUL-011", name: "SAVAGING", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["LACTATION"], stageFilterNote: "LACTATING SOWS", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-012", name: "EXCESS SERVICE", category: "CULL", subCategory: "OTHER", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-013", name: "RETURN", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-014", name: "ABORTION", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["GESTATION"], stageFilterNote: "PREGNANCY", destination: "FARM BUTCHERY", mandatoryComment: false },
  { code: "CUL-015", name: "TOO THIN", category: "CULL", subCategory: "STRUCTURAL", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY", mandatoryComment: false },
  { code: "CUL-016", name: "IRREGULAR RETURN", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["GESTATION"], stageFilterNote: "PREGNANCY", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-017", name: "STANDOVER", category: "CULL", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-018", name: "HERNIA", category: "CULL", subCategory: "INTERNAL ORGAN", stages: ["WEANER", "GROWER", "REARING"], stageFilterNote: "WEANER/GROWER /GILT REARING", destination: "FARM BUTCHERY", mandatoryComment: true },
  { code: "CUL-019", name: "UNVIABLE", category: "CULL", subCategory: "OTHER", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: false },
  { code: "CUL-020", name: "POOR CONDITION", category: "CULL", subCategory: "OTHER", stageFilterNote: "ALL", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "CUL-021", name: "RUNT", category: "CULL", subCategory: "OTHER", stages: ["WEANER"], stageFilterNote: "WEANER", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "CUL-022", name: "BLIND", category: "CULL", subCategory: "STRUCTURAL", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: false },
  { code: "CUL-023", name: "INFANT VULVA", category: "CULL", subCategory: "STRUCTURAL", stages: ["REARING"], stageFilterNote: "GILT REARING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "CUL-024", name: "CYSTITIS", category: "CULL", subCategory: "DISEASE", stages: ["PRODUCTIVE_SOW", "GROWER", "WEANER"], stageFilterNote: "DRY SOWS/GROWER/WEANER", destination: "MORTALITY PIT", mandatoryComment: false },
  { code: "CUL-025", name: "TOO FAT", category: "CULL", subCategory: "STRUCTURAL", stages: ["REARING", "INSEMINATION", "LACTATION"], stageFilterNote: "GILT REARING/MATING/SERVICING/LACTATION", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "HT-001", name: "SKIPPED HEAT", category: "HEAT", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "HT-002", name: "SHORT HEAT", category: "HEAT", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "HT-003", name: "MISSED HEAT", category: "HEAT", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "HT-004", name: "8 DAYS OFF CYCLE", category: "HEAT", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "HT-005", name: "2 DAYS OFF CYCLE", category: "HEAT", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "HT-006", name: "5 DAYS OFF CYCLE", category: "HEAT", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "HT-007", name: "SKIPPED HEAT", category: "HEAT", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "MRT-001", name: "BOWEL ODEMA", category: "MORTALITY", subCategory: "STRUCTURAL", stages: ["WEANER", "GROWER", "REARING", "PRODUCTIVE_SOW", "GESTATION"], stageFilterNote: "WEANER/GROWER /GILT REARING/DRYSOW/PREGANANT SOWS", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-002", name: "HBS (HAEMORRAGIC BOWEL SYNDROME)", category: "MORTALITY", subCategory: "DISEASE", stages: ["WEANER", "GROWER", "REARING", "PRODUCTIVE_SOW", "GESTATION"], stageFilterNote: "WEANER/GROWER /GILT REARING/DRYSOW/PREGANANT SOWS", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-003", name: "DYSTOKIA", category: "MORTALITY", subCategory: "REPRODUCTIVE", stages: ["GESTATION"], stageFilterNote: "PREGNANCY", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-004", name: "TWISTED STOMACH", category: "MORTALITY", subCategory: "INTERNAL ORGAN", stages: ["GROWER", "PRODUCTIVE_SOW", "GESTATION", "LACTATION"], stageFilterNote: "GROWER /DRYSOW/PREGNANCY/LACTATING SOWS/BOARS", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-005", name: "OEDEMA", category: "MORTALITY", subCategory: "STRUCTURAL", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-006", name: "SPLAYLEG", category: "MORTALITY", subCategory: "STRUCTURAL", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-007", name: "BITTEN DEAD", category: "MORTALITY", subCategory: "TRAUMA", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-008", name: "EARLY BORN", category: "MORTALITY", subCategory: "OTHER", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-009", name: "INJURY", category: "MORTALITY", subCategory: "STRUCTURAL", stageFilterNote: "ALL", destination: "FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-010", name: "STARVATION", category: "MORTALITY", subCategory: "STARVATION", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-011", name: "ANAEMIA", category: "MORTALITY", subCategory: "DISEASE", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-012", name: "LEGS", category: "MORTALITY", subCategory: "STRUCTURAL", stageFilterNote: "ALL", destination: "FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-013", name: "BLIND ANUS", category: "MORTALITY", subCategory: "STRUCTURAL", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-014", name: "DIARRHOEA", category: "MORTALITY", subCategory: "DISEASE", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-015", name: "DROWNED", category: "MORTALITY", subCategory: "OTHER", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-016", name: "SEPTICEMIA", category: "MORTALITY", subCategory: "DISEASE", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-017", name: "LUNGS", category: "MORTALITY", subCategory: "INTERNAL ORGAN", stageFilterNote: "ALL", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-018", name: "JOINT ILL", category: "MORTALITY", subCategory: "STRUCTURAL", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-019", name: "DEFORMITY", category: "MORTALITY", subCategory: "STRUCTURAL", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-020", name: "MENINGITIS", category: "MORTALITY", subCategory: "DISEASE", stages: ["WEANER", "GROWER"], stageFilterNote: "WEANER/GROWER", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-021", name: "E.COLI", category: "MORTALITY", subCategory: "DISEASE", stages: ["WEANER", "FARROWING"], stageFilterNote: "WEANER/FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-022", name: "COUGHING", category: "MORTALITY", subCategory: "DISEASE", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-023", name: "GLASSERS", category: "MORTALITY", subCategory: "DISEASE", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-024", name: "LAWSONIA", category: "MORTALITY", subCategory: "DISEASE", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-025", name: "TWIST GUT", category: "MORTALITY", subCategory: "INTERNAL ORGAN", stageFilterNote: "ALL", destination: "FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-026", name: "SCOURS", category: "MORTALITY", subCategory: "OTHER", stages: ["WEANER"], stageFilterNote: "WEANER", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-027", name: "DOA (DEAD ON ARRIVAL)", category: "MORTALITY", subCategory: "OTHER", stages: ["WEANER", "GROWER"], stageFilterNote: "WEANER/GROWER", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-028", name: "DDL (DIED DURING LOADING)", category: "MORTALITY", subCategory: "OTHER", stages: ["GROWER"], stageFilterNote: "GROWER", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-029", name: "HEATSTROKE", category: "MORTALITY", subCategory: "TRAUMA", stages: ["GROWER", "FARROWING", "PRODUCTIVE_SOW"], stageFilterNote: "GROWER/FARROWING/DRY SOWS", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-030", name: "PNEUMONIA", category: "MORTALITY", subCategory: "DISEASE", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-031", name: "CIRCO VIRUS", category: "MORTALITY", subCategory: "DISEASE", stages: ["WEANER", "GROWER", "REARING"], stageFilterNote: "WEANER/GROWER /GILT REARING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-032", name: "ULCERS", category: "MORTALITY", subCategory: "DISEASE", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-033", name: "LUNG AND HEART INFECTION", category: "MORTALITY", subCategory: "INTERNAL ORGAN", stageFilterNote: "ALL", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-034", name: "ABSCESS", category: "MORTALITY", subCategory: "DISEASE", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-035", name: "SEPSIS", category: "MORTALITY", subCategory: "DISEASE", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-036", name: "MASTITIS", category: "MORTALITY", subCategory: "DISEASE", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-037", name: "INGUINAL RING", category: "MORTALITY", subCategory: "DISEASE", stages: ["WEANER", "GROWER"], stageFilterNote: "WEANER/GROWER", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-038", name: "RETAINED TESTICLES", category: "MORTALITY", subCategory: "STRUCTURAL", stages: ["WEANER", "GROWER"], stageFilterNote: "WEANER/GROWER", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-039", name: "CLEFT PALATE", category: "MORTALITY", subCategory: "STRUCTURAL", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-040", name: "UDDER OEDEMA", category: "MORTALITY", subCategory: "DISEASE", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-041", name: "ILEITIS", category: "MORTALITY", subCategory: "DISEASE", stages: ["WEANER", "GROWER", "REARING"], stageFilterNote: "WEANER/GROWER /GILT REARING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-042", name: "ERYSIPELAS", category: "MORTALITY", subCategory: "DISEASE", stages: ["WEANER", "GROWER", "REARING", "PRODUCTIVE_SOW", "GESTATION"], stageFilterNote: "WEANER/GROWER /GILT REARING/DRYSOW/PREGANANT SOWS", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-043", name: "PARALYSED", category: "MORTALITY", subCategory: "STRUCTURAL", stageFilterNote: "ALL", destination: "FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-044", name: "COLITIS", category: "MORTALITY", subCategory: "INTERNAL ORGAN", stages: ["FARROWING", "WEANER", "GROWER"], stageFilterNote: "FARROWING/WEANER/GROWER", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-045", name: "PERICARDITIS", category: "MORTALITY", subCategory: "INTERNAL ORGAN", stages: ["WEANER", "GROWER", "REARING", "PRODUCTIVE_SOW", "GESTATION"], stageFilterNote: "WEANER/GROWER /GILT REARING/DRYSOW/PREGANANT SOWS", destination: "FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-046", name: "GREASY PIG DISEASE", category: "MORTALITY", subCategory: "DISEASE", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-047", name: "SUDDEN DEATH", category: "MORTALITY", subCategory: "INTERNAL ORGAN", stageFilterNote: "ALL", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-048", name: "HYPOGLYCEMIA", category: "MORTALITY", subCategory: "DISEASE", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-049", name: "CHILLED", category: "MORTALITY", subCategory: "OTHER", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT", mandatoryComment: true },
  { code: "MRT-050", name: "DAMAGED UTERUS", category: "MORTALITY", subCategory: "REPRODUCTIVE", stages: ["GESTATION", "FARROWING"], stageFilterNote: "PREGNANCY/FARROWING", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-051", name: "RETAINED PIGLETS", category: "MORTALITY", subCategory: "REPRODUCTIVE", stages: ["FARROWING"], stageFilterNote: "FARROWING", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "MRT-052", name: "VOMITING", category: "MORTALITY", subCategory: "OTHER", stageFilterNote: "ALL", destination: "MORTALITY PIT", mandatoryComment: false },
  { code: "MRT-053", name: "PROLAPSE", category: "MORTALITY", subCategory: "TRAUMA", stages: ["WEANER", "GROWER", "PRODUCTIVE_SOW", "GESTATION", "LACTATION"], stageFilterNote: "WEANER/GROWER /DRYSOW/PREGNANCY/LACTATING SOWS", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "RET-001", name: "RETURN SERVICE", category: "RETURN", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "RET-002", name: "SERVED 2 DAY STILL ON HEAT", category: "RETURN", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "SEL-005", name: "EXTREME LOSS (OVERALL BODY CONDITION)", category: "SERVICING", subCategory: "STRUCTURAL", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY", mandatoryComment: false },
  { code: "SERV-001", name: "BLEEDING", category: "SERVICING", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "SERV-002", name: "DELAY UPTAKE", category: "SERVICING", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "SERV-003", name: "SPILL", category: "SERVICING", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "SERV-004", name: "DIRTY INSIDE", category: "SERVICING", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "SERV-006", name: "URINATING DURING SERVICE", category: "SERVICING", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "SERV-007", name: "DISCHARGE", category: "SERVICING", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "FARM BUTCHERY/COLCOM", mandatoryComment: false },
  { code: "SERV-008", name: "SICK", category: "SERVICING", subCategory: "REPRODUCTIVE", stages: ["INSEMINATION"], stageFilterNote: "MATING/SERVICING", destination: "MORTALITY PIT/FARM BUTCHERY", mandatoryComment: true },
  { code: "TRF-001", name: "Internal Transfer - Farm to Farm (production move)", category: "TRANSFER", subCategory: "Internal", stageFilterNote: "ALL", mandatoryComment: false },
  { code: "TRF-002", name: "Internal Transfer - Gilt Distribution to Farm", category: "TRANSFER", subCategory: "Internal", stages: ["REARING"], stageFilterNote: "GILT REARING", mandatoryComment: false },
  { code: "TRF-003", name: "External Transfer - To Colcom Slaughter", category: "TRANSFER", subCategory: "External", stages: ["GROWER", "PRODUCTIVE_SOW"], stageFilterNote: "GROWER / SOW", mandatoryComment: false },
  { code: "ADJ-001", name: "Positive Inventory Adjustment (found stock)", category: "ADJUSTMENT", subCategory: "Inventory", stageFilterNote: "N/A", mandatoryComment: false },
  { code: "ADJ-002", name: "Negative Inventory Adjustment (damage / write-off)", category: "ADJUSTMENT", subCategory: "Inventory", stageFilterNote: "N/A", mandatoryComment: false },
  { code: "ADJ-003", name: "Head Count Correction (data entry error)", category: "ADJUSTMENT", subCategory: "Headcount", stageFilterNote: "ALL", mandatoryComment: false },
  { code: "ADJ-004", name: "Feed Variance Adjustment (batch close)", category: "ADJUSTMENT", subCategory: "Inventory", stageFilterNote: "N/A", mandatoryComment: false },
  { code: "DIS-001", name: "Farm Butchery (Ration Pig / Home Consumption)", category: "DISPOSAL", subCategory: "Destination", stageFilterNote: "ALL", mandatoryComment: false },
  { code: "DIS-002", name: "Colcom Abattoir (Commercial Slaughter)", category: "DISPOSAL", subCategory: "Destination", stages: ["GROWER", "PRODUCTIVE_SOW"], stageFilterNote: "GROWER / SOW", mandatoryComment: false },
  { code: "DIS-003", name: "On-Farm Burial / Rendering", category: "DISPOSAL", subCategory: "Destination", stageFilterNote: "ALL", mandatoryComment: false },
  { code: "DIS-004", name: "Veterinary Post-Mortem (sent for PM)", category: "DISPOSAL", subCategory: "Destination", stageFilterNote: "ALL", mandatoryComment: true },
  { code: "DIS-005", name: "Sale to Third Party (other than Colcom)", category: "DISPOSAL", subCategory: "Destination", stageFilterNote: "ALL", mandatoryComment: false },
  { code: "DIS-006", name: "Donated / Welfare Disposal", category: "DISPOSAL", subCategory: "Destination", stageFilterNote: "ALL", mandatoryComment: true },
  { code: "SCN-001", name: "Confirmed Pregnant (Day 28 / Day 45)", category: "SCAN", subCategory: "Pregnancy", stages: ["GESTATION"], stageFilterNote: "PREGNANCY", mandatoryComment: false },
  { code: "SCN-002", name: "Repeat - Not Pregnant (Return to Service)", category: "SCAN", subCategory: "Pregnancy", stages: ["GESTATION"], stageFilterNote: "PREGNANCY", mandatoryComment: false },
  { code: "SCN-003", name: "Scan Failed / Inconclusive (rescan required)", category: "SCAN", subCategory: "Pregnancy", stages: ["GESTATION"], stageFilterNote: "PREGNANCY", mandatoryComment: false },
  { code: "SEL-001", name: "Gilt Selected - Green Tag (Top GGP)", category: "SELECTION", subCategory: "Gilt", stages: ["REARING"], stageFilterNote: "GILT REARING", mandatoryComment: false },
  { code: "SEL-002", name: "Gilt Selected - Blue Tag (GP - Multiplier)", category: "SELECTION", subCategory: "Gilt", stages: ["REARING"], stageFilterNote: "GILT REARING", mandatoryComment: false },
  { code: "SEL-003", name: "Gilt Selected - Yellow Tag (PS - Farm Distribution)", category: "SELECTION", subCategory: "Gilt", stages: ["REARING"], stageFilterNote: "GILT REARING", mandatoryComment: false },
  { code: "SEL-004", name: "Gilt Not Selected / Rejected at Week 4", category: "SELECTION", subCategory: "Gilt", stages: ["REARING"], stageFilterNote: "GILT REARING", mandatoryComment: true },
];
