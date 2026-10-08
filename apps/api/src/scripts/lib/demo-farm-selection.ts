/**
 * Which of the nine demo farms a run covers. The nine-farm master seed and the
 * operational chapters both read this, so a small database is one setting
 * (`DEMO_FARMS=MUL100,POR100`) and the two can never disagree about the set.
 * Unset or empty means all nine, which is what every earlier run did.
 */
export const ALL_DEMO_FARM_CODES = ['MUL100', 'POR100', 'RIC100', 'VIL100', 'GRA100', 'LEA100', 'LIO100', 'AI100', 'LEX100'] as const;
export type DemoFarmCode = (typeof ALL_DEMO_FARM_CODES)[number];

export function selectDemoFarmCodes(value: string | undefined): readonly DemoFarmCode[] {
  const wanted = (value ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (wanted.length === 0) return ALL_DEMO_FARM_CODES;
  const unknown = wanted.filter((c) => !(ALL_DEMO_FARM_CODES as readonly string[]).includes(c));
  if (unknown.length) throw new Error(`DEMO_FARMS names unknown farm(s) ${unknown.join(', ')}. Known: ${ALL_DEMO_FARM_CODES.join(', ')}.`);
  // The chapters resolve the grasmere / kintyre handles from these two (demo/harness.ts).
  for (const required of ['MUL100', 'POR100']) {
    if (!wanted.includes(required)) throw new Error(`DEMO_FARMS must include ${required}; the demo chapters are written around it.`);
  }
  // Kept in the canonical order, whatever order the setting listed them in.
  return ALL_DEMO_FARM_CODES.filter((c) => wanted.includes(c));
}
