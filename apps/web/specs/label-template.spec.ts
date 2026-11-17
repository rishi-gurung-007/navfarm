import {
  insertAt,
  labelTemplateIssues,
  normaliseLabelTemplate,
  previewLabel,
  LABEL_PARTS,
  LABEL_PRESETS,
} from '../src/modules/master-data/utils/label-template';

const sample = { line: 'ZL', boarTags: ['BLXA9988'], boarCodes: ['PIG-0020'], date: new Date(2026, 10, 16), seq: 1 };

describe('the lot label template, made easy to get right', () => {
  it('offers the same seven parts the API accepts', () => {
    expect(LABEL_PARTS.map((p) => p.token).sort()).toEqual(['BOAR_CODE', 'BOAR_TAG', 'DATE', 'LINE', 'SEQ', 'WEEK', 'YEAR']);
  });

  it('gives ready formats that are all valid', () => {
    for (const p of LABEL_PRESETS) expect(labelTemplateIssues(p.template)).toEqual([]);
  });

  it('puts a near miss right: a token in lower case or with spaces', () => {
    expect(normaliseLabelTemplate('{boar tag}-{ week }')).toBe('{BOAR_TAG}-{WEEK}');
    expect(normaliseLabelTemplate('pool-{Week}')).toBe('pool-{WEEK}');
    expect(normaliseLabelTemplate('{colour}')).toBe('{colour}');
  });

  it('says what the API would refuse, before saving', () => {
    expect(labelTemplateIssues('{BOAR_TAG-{WEEK}')).toContain('A { has no matching } (or the other way round).');
    expect(labelTemplateIssues('{WEEK}}')).toContain('A { has no matching } (or the other way round).');
    expect(labelTemplateIssues('{COLOUR}-{WEEK}')[0]).toContain('{COLOUR}');
    expect(labelTemplateIssues('')).toEqual([]);
    expect(labelTemplateIssues('POOLL-{WEEK}')).toEqual([]);
  });

  it('adds a part where the cursor is, or over what is selected', () => {
    expect(insertAt('POOL-', '{WEEK}', 5)).toEqual({ text: 'POOL-{WEEK}', cursor: 11 });
    expect(insertAt('-{WEEK}', '{BOAR_TAG}', 0)).toEqual({ text: '{BOAR_TAG}-{WEEK}', cursor: 10 });
    expect(insertAt('AB-CD', '{LINE}', 0, 2)).toEqual({ text: '{LINE}-CD', cursor: 6 });
  });

  it('previews a sachet the way the API fills it: ISO week, boars joined with +', () => {
    expect(previewLabel('{BOAR_TAG}-{WEEK}', sample)).toBe('BLXA9988-47');
    expect(previewLabel('POOLL-{WEEK}', sample)).toBe('POOLL-47');
    expect(previewLabel('{LINE}-{YEAR}-{SEQ}', { ...sample, seq: 2 })).toBe('ZL-2026-2');
    expect(previewLabel('{BOAR_TAG}', { ...sample, boarTags: ['A', 'B'] })).toBe('A+B');
    expect(previewLabel('{DATE}', sample)).toBe('2026-11-16');
    expect(previewLabel('', sample)).toBeNull();
  });
});
