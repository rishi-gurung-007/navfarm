import { supportsGenericImport, parseGenericImportRow } from './master-csv';
import type { MasterDataConfig } from '../types';

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

  it('stays false for breed/breed-lifecycle-stage/BC-owned/number-series regardless of fields', () => {
    expect(supportsGenericImport(cfg({ key: 'breed', fields: [] }))).toBe(false);
    expect(supportsGenericImport(cfg({ key: 'breed-lifecycle-stage', fields: [] }))).toBe(false);
    expect(supportsGenericImport(cfg({ owner: 'BC', fields: [] }))).toBe(false);
    expect(supportsGenericImport(cfg({ key: 'number-series', fields: [] }))).toBe(false);
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
