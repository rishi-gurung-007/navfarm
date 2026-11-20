import { supportsGenericImport, parseGenericImportRow, generateMasterTemplateCsv, parseCsvText, prefetchGenericEntityOptions, exportMasterRowsToCsv, downloadCsvFile, applyOperationalNobLob, resolveImportCodeDisplay } from './master-csv';
import type { MasterDataConfig } from '../types';

jest.mock('@/services/api-client', () => ({ api: { get: jest.fn() } }));
import { api } from '@/services/api-client';

function cfg(overrides: Partial<MasterDataConfig>): MasterDataConfig {
  return {
    key: 'widget', label: 'Widgets', apiBase: '/widget', idKey: 'widget_id',
    group: 'Test', fields: [], ...overrides,
  };
}

describe('supportsGenericImport', () => {
  it('is true for a config whose only unsupported-type field is optional', () => {
    const config = cfg({
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'photo_url', label: 'Photo', type: 'image' },
      ],
    });
    expect(supportsGenericImport(config)).toBe(true);
  });

  it('is false when a required field uses an unsupported type', () => {
    const config = cfg({
      fields: [
        { key: 'ingredients', label: 'Ingredients', type: 'json', required: true },
      ],
    });
    expect(supportsGenericImport(config)).toBe(false);
  });

  it('ignores a required-and-unsupported field that is hideInForm', () => {
    const config = cfg({
      fields: [
        { key: 'legacy_blob', label: 'Legacy', type: 'json', required: true, hideInForm: true },
      ],
    });
    expect(supportsGenericImport(config)).toBe(true);
  });

  it('stays false for breed-lifecycle-stage/BC-owned/number-series regardless of fields', () => {
    expect(supportsGenericImport(cfg({ key: 'breed-lifecycle-stage', fields: [] }))).toBe(false);
    expect(supportsGenericImport(cfg({ owner: 'BC', fields: [] }))).toBe(false);
    expect(supportsGenericImport(cfg({ key: 'number-series', fields: [] }))).toBe(false);
  });

  it('is true for breed — one CSV row per breed is exactly what the generic reader already handles', () => {
    expect(supportsGenericImport(cfg({ key: 'breed', fields: [{ key: 'breed_code', label: 'Code', type: 'text', required: true }] }))).toBe(true);
  });
});

describe('genericImportFields (via parseGenericImportRow)', () => {
  afterEach(() => localStorage.clear());

  it('no longer drops an image-type field — it reads as plain text', async () => {
    const config = cfg({ fields: [{ key: 'photo_url', label: 'Photo', type: 'image' }] });
    const { payload, errors } = await parseGenericImportRow(config, { photo_url: 'https://example.com/p.jpg' }, {});
    expect(payload.photo_url).toBe('https://example.com/p.jpg');
    expect(errors).toEqual([]);
  });

  it('excludes nob_id/lob_id from the required-fields check when the workspace is OPERATIONAL', async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'OPERATIONAL_ADMIN' }));
    localStorage.setItem('active_workspace_scope', 'OPERATIONAL');
    const config = cfg({
      fields: [
        { key: 'nob_id', label: 'Nature of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/nobs' },
        { key: 'lob_id', label: 'Line of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/lobs' },
      ],
    });
    const { errors } = await parseGenericImportRow(config, {}, {});
    expect(errors).toEqual([]);
  });

  it('still requires nob_id/lob_id from the CSV when the workspace is not OPERATIONAL', async () => {
    const config = cfg({
      fields: [
        { key: 'nob_id', label: 'Nature of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/nobs' },
      ],
    });
    const { errors } = await parseGenericImportRow(config, {}, {});
    expect(errors).toEqual(['Nature of Business is required.']);
  });
});

describe('parseGenericImportRow NOB/LOB auto-fill', () => {
  afterEach(() => localStorage.clear());

  it('fills nob_id/lob_id from the active operational area when OPERATIONAL', async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'OPERATIONAL_ADMIN' }));
    localStorage.setItem('active_workspace_scope', 'OPERATIONAL');
    localStorage.setItem('active_operational_area', JSON.stringify({ area_id: 'a-1', nob_id: 'nob-livestock', lob_id: 'lob-piggery' }));
    const config = cfg({
      fields: [
        { key: 'nob_id', label: 'Nature of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/nobs' },
        { key: 'lob_id', label: 'Line of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/lobs' },
      ],
    });
    const { payload, errors } = await parseGenericImportRow(config, {}, {});
    expect(payload).toMatchObject({ nob_id: 'nob-livestock', lob_id: 'lob-piggery' });
    expect(errors).toEqual([]);
  });

  it('the active area wins even when the CSV row names an nob_id/lob_id-looking column', async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'OPERATIONAL_ADMIN' }));
    localStorage.setItem('active_workspace_scope', 'OPERATIONAL');
    localStorage.setItem('active_operational_area', JSON.stringify({ area_id: 'a-1', nob_id: 'nob-livestock', lob_id: 'lob-piggery' }));
    const config = cfg({
      fields: [{ key: 'nob_id', label: 'Nature of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/nobs' }],
    });
    const { payload } = await parseGenericImportRow(config, { nob_id: 'some-other-id' }, {});
    expect(payload.nob_id).toBe('nob-livestock');
  });

  it('no-ops for a config with no nob_id/lob_id fields', async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'OPERATIONAL_ADMIN' }));
    localStorage.setItem('active_workspace_scope', 'OPERATIONAL');
    localStorage.setItem('active_operational_area', JSON.stringify({ area_id: 'a-1', nob_id: 'nob-livestock', lob_id: 'lob-piggery' }));
    const config = cfg({ fields: [{ key: 'name', label: 'Name', type: 'text', required: true }] });
    const { payload } = await parseGenericImportRow(config, { name: 'Widget A' }, {});
    expect(payload).toEqual({ name: 'Widget A' });
  });
});

describe('generateMasterTemplateCsv generic fallback — field list and headers', () => {
  it('excludes hideInForm/editOnly fields from the template, same as the create form', async () => {
    const config = cfg({
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'company_id', label: 'Company', type: 'text', hideInForm: true },
        { key: 'is_active', label: 'Active', type: 'boolean', editOnly: true },
      ],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [headerLine] = csv.split('\r\n');
    expect(headerLine).toBe('Name');
  });

  it('appends " Code" to a select-entity header, leaves a plain select/text header alone', async () => {
    const config = cfg({
      fields: [
        { key: 'breed_id', label: 'Breed', type: 'select-entity', entityEndpoint: '/breed', entityValueKey: 'breed_id', entityLabelKeys: ['breed_code'] },
        { key: 'gender', label: 'Gender', type: 'select', options: [{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }] },
      ],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [headerLine] = csv.split('\r\n');
    expect(headerLine.split(',')).toEqual(['Breed Code', 'Gender']);
  });
});

describe('generateMasterTemplateCsv generic fallback — sample row', () => {
  afterEach(() => jest.resetAllMocks());

  it('shows the real option list for a select field', async () => {
    const config = cfg({
      fields: [{ key: 'animal_type', label: 'Animal Type', type: 'select', options: ['SOW', 'BOAR', 'GILT'].map((v) => ({ value: v, label: v })) }],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [, sampleLine] = csv.split('\r\n');
    expect(sampleLine).toBe('SOW / BOAR / GILT');
  });

  it('shows a real existing code for an independent select-entity field', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ breed_id: 'b-1', breed_code: 'LARGE_WHITE' }] });
    const config = cfg({
      fields: [{ key: 'breed_id', label: 'Breed', type: 'select-entity', entityEndpoint: '/breed', entityValueKey: 'breed_id', entityLabelKeys: ['breed_code'] }],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [, sampleLine] = csv.split('\r\n');
    expect(sampleLine).toBe('LARGE_WHITE');
  });

  it('leaves a dependent select-entity field blank (its options aren\'t pre-fetched)', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ stage_id: 's-1', stage_code: 'GROWER' }] });
    const config = cfg({
      fields: [
        { key: 'breed_id', label: 'Breed', type: 'select-entity', entityEndpoint: '/breed', entityValueKey: 'breed_id', entityLabelKeys: ['breed_code'] },
        { key: 'current_stage_id', label: 'Current Stage', type: 'select-entity', entityEndpoint: '/stage?breedId={value}', entityValueKey: 'stage_id', entityLabelKeys: ['stage_code'], dependsOn: 'breed_id' },
      ],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [, sampleLine] = csv.split('\r\n');
    expect(sampleLine.split(',')[1]).toBe('');
  });

  it('falls back to a blank sample when the entity fetch fails, without throwing', async () => {
    (api.get as jest.Mock).mockRejectedValue(new Error('network down'));
    const config = cfg({
      fields: [{ key: 'breed_id', label: 'Breed', type: 'select-entity', entityEndpoint: '/breed', entityValueKey: 'breed_id', entityLabelKeys: ['breed_code'] }],
    });
    // generateMasterTemplateCsv must resolve rather than reject when an entity fetch fails —
    // awaiting it is itself the proof: a throw/rejection here would fail this test.
    const csv = await generateMasterTemplateCsv(config);
    const [, sampleLine] = csv.split('\r\n');
    expect(sampleLine).toBe('');
  });
});

describe('template round-trip — a filled-in downloaded template must re-import cleanly', () => {
  afterEach(() => jest.resetAllMocks());

  it('a select-entity value typed under its "... Code" header resolves, not just one typed under the raw key/label', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ breed_id: 'b-1', breed_code: 'LARGE_WHITE' }] });
    const config = cfg({
      fields: [{ key: 'breed_id', label: 'Breed', type: 'select-entity', required: true, entityEndpoint: '/breed', entityValueKey: 'breed_id', entityLabelKeys: ['breed_code'] }],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [headerLine] = csv.split('\r\n');
    expect(headerLine).toBe('Breed Code'); // the header this test's own row is filled in under

    const { rows } = parseCsvText(`${headerLine}\r\nLARGE_WHITE`);
    const cache = await prefetchGenericEntityOptions(config);
    const { payload, errors } = await parseGenericImportRow(config, rows[0], cache);

    expect(errors).toEqual([]);
    expect(payload.breed_id).toBe('b-1');
  });

  it('CSV-escapes a header or sample value that itself contains a comma, so columns do not shift', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ breed_id: 'b-1', breed_code: 'LARGE, WHITE' }] });
    const config = cfg({
      fields: [
        { key: 'label_template', label: 'Label Template', type: 'text', placeholder: 'Pick a format, or add parts below' },
        { key: 'breed_id', label: 'Breed', type: 'select-entity', entityEndpoint: '/breed', entityValueKey: 'breed_id', entityLabelKeys: ['breed_code'] },
      ],
    });
    const csv = await generateMasterTemplateCsv(config);
    const { rows } = parseCsvText(csv);
    expect(rows[0]['Label Template']).toBe('Pick a format, or add parts below');
    expect(rows[0]['Breed Code']).toBe('LARGE, WHITE');
  });
});

function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('exportMasterRowsToCsv — only what the edit form shows', () => {
  let capturedBlob: Blob | null = null;

  beforeEach(() => {
    capturedBlob = null;
    (globalThis as any).URL.createObjectURL = jest.fn((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    });
    (globalThis as any).URL.revokeObjectURL = jest.fn();
  });

  it('excludes a field the edit form never shows (hideInForm), even though it is a real stored column', async () => {
    const config = cfg({
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'book_value', label: 'Book Value', type: 'number', hideInForm: true },
      ],
    });
    await exportMasterRowsToCsv(config, [{ name: 'Widget A', book_value: 42 }]);
    const { rows } = parseCsvText(await readBlobAsText(capturedBlob!));
    expect(Object.keys(rows[0])).toEqual(['Name']);
  });

  it('keeps a read-only field the edit form still shows, just not editable', async () => {
    const config = cfg({
      fields: [
        { key: 'location_code', label: 'Code', type: 'text', readOnly: true, createOnly: true },
      ],
    });
    await exportMasterRowsToCsv(config, [{ location_code: 'MGH6' }]);
    const { rows } = parseCsvText(await readBlobAsText(capturedBlob!));
    expect(rows[0]['Code']).toBe('MGH6');
  });
});

describe('applyOperationalNobLob — shared by the generic reader and Breed Lifecycle Stage\'s bespoke one', () => {
  afterEach(() => localStorage.clear());

  it('fills nob_id/lob_id from the active area when the config (e.g. breed-lifecycle-stage) declares those keys', () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'OPERATIONAL_ADMIN' }));
    localStorage.setItem('active_workspace_scope', 'OPERATIONAL');
    localStorage.setItem('active_operational_area', JSON.stringify({ area_id: 'a-1', nob_id: 'nob-livestock', lob_id: 'lob-piggery' }));
    const payload: Record<string, any> = {};
    applyOperationalNobLob(payload, [{ key: 'nob_id' }, { key: 'lob_id' }]);
    expect(payload).toEqual({ nob_id: 'nob-livestock', lob_id: 'lob-piggery' });
  });

  it('no-ops outside an operational workspace', () => {
    const payload: Record<string, any> = {};
    applyOperationalNobLob(payload, [{ key: 'nob_id' }, { key: 'lob_id' }]);
    expect(payload).toEqual({});
  });
});

describe('createFormFields / genericImportFields — importable override', () => {
  it('still excludes a readOnly field with no importable flag (regression)', () => {
    const config = cfg({
      fields: [{ key: 'system_note', label: 'System Note', type: 'text', readOnly: true }],
    });
    expect(supportsGenericImport(config)).toBe(true); // optional unsupported-type field, not required
    // excluded from the template/parse field list: no column shows up for it
    return generateMasterTemplateCsv(config).then((csv) => {
      expect(csv.split('\r\n')[0]).toBe('');
    });
  });

  it('includes a readOnly field marked importable', async () => {
    const config = cfg({
      fields: [{ key: 'location_code', label: 'Code', type: 'text', readOnly: true, importable: true }],
    });
    const csv = await generateMasterTemplateCsv(config);
    expect(csv.split('\r\n')[0]).toBe('Code');
  });
});

describe('Location config — location_code is importable', () => {
  it('location_code is included in genericImportFields for the real Location config', async () => {
    const { getConfig } = await import('../configs');
    const location = getConfig('location');
    const csv = await generateMasterTemplateCsv(location!);
    expect(csv.split('\r\n')[0].split(',')).toContain('Code');
  });
});

describe('exportMasterRowsToCsv — select-entity resolution does not depend on the record being in the first page of its collection', () => {
  let capturedBlob: Blob | null = null;

  beforeEach(() => {
    capturedBlob = null;
    (globalThis as any).URL.createObjectURL = jest.fn((blob: Blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    });
    (globalThis as any).URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => jest.resetAllMocks());

  it('resolves a select-entity value by its own id even when a list fetch of the collection would not include it (e.g. a GRN past the first 500)', async () => {
    (api.get as jest.Mock).mockImplementation((ep: string) => {
      // The old approach fetched a flat, capped list of the whole collection — simulate a
      // collection large enough that the record this row actually references isn't in it.
      if (ep.startsWith('/goods-receipt?')) return Promise.resolve({ data: [{ receipt_id: 'other-1', receipt_no: 'GR-999999' }] });
      // The fix: resolve by the record's own id directly.
      if (ep === '/goods-receipt/0b7ba7c5-grn') return Promise.resolve({ data: { receipt_id: '0b7ba7c5-grn', receipt_no: 'GR-000001' } });
      return Promise.resolve({ data: [] });
    });
    const config = cfg({
      fields: [
        { key: 'source_receipt_id', label: 'Source GRN', type: 'select-entity', entityEndpoint: '/goods-receipt', entityValueKey: 'receipt_id', entityLabelKeys: ['receipt_no'], dependsOn: 'item_id', dependsOnMode: 'query' },
      ],
    });
    await exportMasterRowsToCsv(config, [{ source_receipt_id: '0b7ba7c5-grn' }]);
    const { rows } = parseCsvText(await readBlobAsText(capturedBlob!));
    expect(rows[0]['Source GRN']).toBe('GR-000001');
  });
});

describe('parseGenericImportRow — configured aliases', () => {
  it('resolves a field from its configured alias header', async () => {
    const config = cfg({
      fields: [{ key: 'location_code', label: 'Code', type: 'text', aliases: ['Master Code', 'Identifier'] }],
    });
    // "Master Code" should resolve via the alias, not via loose matching
    const { payload, errors } = await parseGenericImportRow(config, { 'Master Code': 'FARM-01' }, {});
    expect(payload.location_code).toBe('FARM-01');
    expect(errors).toEqual([]);
  });

  it('an exact field-key match wins over a same-named alias on another field', async () => {
    const config = cfg({
      fields: [
        { key: 'location_code', label: 'Code', type: 'text', aliases: ['ID'] },
        { key: 'external_ref', label: 'External Reference', type: 'text', aliases: [] },
      ],
    });
    // The raw row has a real "external_ref" column AND an "ID" column; "ID" must not steal
    // external_ref's value just because it is location_code's alias — location_code only reads
    // "ID" when there is no column literally named/labelled location_code/Code.
    const { payload } = await parseGenericImportRow(config, { location_code: 'LOC-1', ID: 'LOC-2', external_ref: 'REF-1' }, {});
    expect(payload.location_code).toBe('LOC-1');
    expect(payload.external_ref).toBe('REF-1');
  });
});

describe('resolveImportCodeDisplay', () => {
  it('shows the uploaded code when present in the payload', () => {
    const config = cfg({ codeField: 'stage_code', fields: [{ key: 'stage_code', label: 'Code', type: 'text' }] });
    const result = resolveImportCodeDisplay(config, { payload: { stage_code: 'GROWER' }, raw: {}, errors: [] });
    expect(result).toEqual({ text: 'GROWER', provenance: 'uploaded' });
  });

  it('shows the generated-on-import marker when blank and codeFieldGenerated is set', () => {
    const config = cfg({ codeField: 'stage_code', codeFieldGenerated: true, fields: [{ key: 'stage_code', label: 'Code', type: 'text' }] });
    const result = resolveImportCodeDisplay(config, { payload: {}, raw: {}, errors: [] });
    expect(result.provenance).toBe('generated');
  });

  it('shows the raw attempted value as invalid when a validation error dropped it', () => {
    const config = cfg({ codeField: 'stage_code', codeFieldGenerated: true, fields: [{ key: 'stage_code', label: 'Code', type: 'text' }] });
    const result = resolveImportCodeDisplay(config, {
      payload: {},
      raw: { Code: 'BAD CODE' },
      errors: ["Code 'BAD CODE' is invalid."],
    });
    expect(result).toEqual({ text: 'BAD CODE', provenance: 'invalid' });
  });

  it('is a no-op (provenance "none") for a config with no codeField', () => {
    const config = cfg({ fields: [{ key: 'x', label: 'X', type: 'text' }] });
    const result = resolveImportCodeDisplay(config, { payload: { x: '1' }, raw: {}, errors: [] });
    expect(result.provenance).toBe('none');
  });

  it('matches today\'s Breed preview behavior when driven by codeField', () => {
    const config = cfg({ key: 'breed', codeField: 'breed_code', fields: [{ key: 'breed_code', label: 'Code', type: 'text' }] });
    const result = resolveImportCodeDisplay(config, { payload: { breed_code: 'YORKSHIRE' }, raw: {}, errors: [] });
    expect(result.text).toBe('YORKSHIRE');
  });
});
