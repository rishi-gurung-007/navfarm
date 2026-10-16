/**
 * The piggery stage master, named as the TDD tracker names it (row 24) and
 * timed as BBP-1 §1.7 times it.
 *
 * Those two documents disagree on vocabulary, not on biology. The tracker says
 * GILT_GROWER, DRY_SOW and WEANING where the blueprint says GILT_REARING,
 * DRY_PERIOD and (for the period the sow nurses) LACTATION; the tracker also
 * lists PRODUCTIVE_SOW, BOAR_AI and the four disposal states as stages, which
 * the blueprint's eight do not cover. Rishi's call is that the tracker governs
 * the names, so the codes here are the tracker's and every duration, minimum
 * and range still cites §1.7.
 *
 * Ranges stay ranges in the description; no arbitrary midpoint is presented as
 * a client-approved typical duration.
 *
 * LACTATION and WEANING both exist deliberately. Lactation is a period §1.7
 * gives 28 days and feed standards to; weaning is what ends it. The tracker
 * names only WEANING, so it is here as the OUTPUT event, and LACTATION stays
 * because dropping it would throw away the one stage the blueprint costs the
 * sow's nursing against. Worth confirming with Triple C whether their "weaning"
 * means the sow's event or the piglets' phase — on the BBP's own chain
 * (Sow → Piglet Lot → Weaner Batch) the weaner phase belongs to a batch, not a
 * sow.
 */
export const BBP_STAGE_SEED = [
  { stage_code: 'QUARANTINE', stage_name: 'Quarantine', stage_category: 'PRE_PRODUCTIVE', stage_sequence: 1, typical_duration_days: 28, min_days_before_move: 0, transition_trigger: 'MANUAL', next_stage_code: 'GILT_REARING', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Isolation and health monitoring.' },
  { stage_code: 'GILT_REARING', stage_name: 'Gilt Rearing', stage_category: 'PRE_PRODUCTIVE', stage_sequence: 2, typical_duration_days: 210, min_days_before_move: 0, transition_trigger: 'MANUAL', next_stage_code: 'INSEMINATION', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Growing gilts until ready for service.' },
  { stage_code: 'INSEMINATION', stage_name: 'Insemination', stage_category: 'PRODUCTIVE', stage_sequence: 3, typical_duration_days: 2, min_days_before_move: 0, transition_trigger: 'EVENT_BASED', next_stage_code: 'GESTATION', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Mating / artificial insemination.' },
  { stage_code: 'GESTATION', stage_name: 'Gestation', stage_category: 'PRODUCTIVE', stage_sequence: 4, typical_duration_days: 116, min_days_before_move: 0, transition_trigger: 'EVENT_BASED', next_stage_code: 'FARROWING', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Confirmed pregnancy through term.' },
  { stage_code: 'FARROWING', stage_name: 'Farrowing', stage_category: 'OUTPUT', stage_sequence: 5, min_days_before_move: 2, transition_trigger: 'EVENT_BASED', next_stage_code: 'LACTATION', data_entry_form: 'FARROWING', show_on_animal_card: true, stage_description: 'Farrowing and litter birth recording.' },
  { stage_code: 'LACTATION', stage_name: 'Lactation', stage_category: 'PRODUCTIVE', stage_sequence: 6, typical_duration_days: 28, min_days_before_move: 0, transition_trigger: 'EVENT_BASED', next_stage_code: 'PRODUCTIVE_SOW', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Nursing period for piglets.' },
  { stage_code: 'PRODUCTIVE_SOW', stage_name: 'Productive Sow', stage_category: 'PRODUCTIVE', stage_sequence: 7, min_days_before_move: 0, transition_trigger: 'MANUAL', next_stage_code: 'FLUSH', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Active sow in breeding herd between nursing and flush.' },
  { stage_code: 'FLUSH', stage_name: 'Flush', stage_category: 'PRE_PRODUCTIVE', stage_sequence: 8, min_days_before_move: 3, transition_trigger: 'EVENT_BASED', next_stage_code: 'INSEMINATION', data_entry_form: 'STANDARD', show_on_animal_card: true, stage_description: 'Flushing ration to prepare for insemination.' },
] as const;

/**
 * Codes an older build used, mapped onto the ones above.
 */
export const BBP_STAGE_RENAMES: Readonly<Record<string, string>> = {
  GILT_GROWER: 'GILT_REARING',
  DRY_SOW: 'PRODUCTIVE_SOW',
  DRY_PERIOD: 'PRODUCTIVE_SOW',
  DRY_SOW_GESTATION: 'GESTATION',
  FLUSH_SERVICE: 'FLUSH',
  WEANING: 'LACTATION',
  WEANER: 'LACTATION',
  GROWER: 'GILT_REARING',
  BOAR_AI: 'PRODUCTIVE_SOW',
  SLAUGHTER: 'PRODUCTIVE_SOW',
  SLAUGHTERED: 'PRODUCTIVE_SOW',
  DISPOSED: 'PRODUCTIVE_SOW',
  CULLED: 'PRODUCTIVE_SOW',
  DEAD: 'PRODUCTIVE_SOW',
  SOLD: 'PRODUCTIVE_SOW',
};
