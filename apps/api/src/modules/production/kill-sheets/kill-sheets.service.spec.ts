import { reconcileKillSheet } from './kill-sheets.service';
import * as XLSX from 'xlsx';
import { KillSheetsService } from './kill-sheets.service';

describe('Kill Sheet reconciliation', () => {
  const individual = { records: [{ serial_number: '1', ear_tag: 'E1', grade: null, warm_mass_kg: '10', cold_mass_kg: '9', sex: null, fat_mm: null, meat_mm: null, meat_percentage: null, sick_code: null, slaughtered_at: null }], issues: [], metadata: {}, expected: { animal_count: '1', warm_mass_kg: '10', cold_mass_kg: '9' } };
  it('keeps a cross-report discrepancy as a warning rather than changing source values', () => {
    const summary = { records: [{ category: 'A', product_code: 'P1', description: 'Product', quantity: '1', warm_mass_kg: '11', cold_mass_kg: '9', average_mass_kg: null, reported_price: '2', reported_value: '22' }], issues: [], metadata: {}, expected: { quantity: '1', warm_mass_kg: '11', cold_mass_kg: '9', value: '22' } };
    const result = reconcileKillSheet(individual, summary);
    expect(result.reconciliation).toBe('WARNING');
    expect(result.actualWarm).toBe(10);
    expect(result.issues.map((issue) => issue.message)).toContain('Summary warm mass differs from individual records by 1 kg.');
  });
  it('makes parser errors non-confirmable', () => {
    const result = reconcileKillSheet({ ...individual, issues: [{ severity: 'ERROR' as const, message: 'broken row' }] }, null);
    expect(result.reconciliation).toBe('INVALID');
  });
});

describe('Kill Sheet service safeguards', () => {
  const individualFile = () => Buffer.from(XLSX.write({ SheetNames: ['Kill'], Sheets: { Kill: XLSX.utils.aoa_to_sheet([['SN', 'Warm Mass', 'Cold Mass 3%'], ['1', 10, 9]]) } }, { type: 'buffer', bookType: 'xlsx' }));

  it('returns invalid previews without storing a file or creating an import', async () => {
    const storage = { store: jest.fn(), validateUpload: jest.fn(), read: jest.fn(), remove: jest.fn(), path: jest.fn() } as any;
    const cls = { get: jest.fn() } as any;
    const service = new KillSheetsService(cls, storage);
    jest.spyOn(service as any, 'batchFor').mockResolvedValue({ company_id: 'company-1' });
    jest.spyOn(service as any, 'parseIndividual').mockResolvedValue({ records: [], issues: [{ severity: 'ERROR', message: 'No rows' }], metadata: {}, expected: {} });
    const result = await service.preview({ farm_id: 'farm-1', batch_id: 'batch-1' }, {} as any, undefined, 'tenant-1');
    expect((result as any).persisted).toBe(false);
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('does not update an import when a transactional confirmation insert fails', async () => {
    const insert = jest.fn(() => ({ values: jest.fn().mockRejectedValue(new Error('insert failed')) }));
    const update = jest.fn();
    const db = { insert, update } as any;
    const cls = { get: jest.fn((key: string) => key === 'tenantPostingTransaction' ? true : db) } as any;
    const storage = { read: jest.fn().mockResolvedValue(individualFile()) } as any;
    const service = new KillSheetsService(cls, storage);
    jest.spyOn(service as any, 'importFor').mockResolvedValue({ status: 'PREVIEW_READY', validation_json: [], reconciliation_status: 'MATCHED', individual_storage_key: 'tenant-1/import-1/individual.xlsx', summary_storage_key: null });
    await expect(service.confirm('import-1', {}, 'tenant-1')).rejects.toThrow('insert failed');
    expect(update).not.toHaveBeenCalled();
  });
});
