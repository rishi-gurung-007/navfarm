import { AnimalService } from './animal.service';
import { transactionCls } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';

describe('recorded treatment withdrawal', () => {
  let service: AnimalService;
  let animal: any;
  let medicationRows: any[];
  let treatmentRows: any[];
  let db: any;
  let events: string[];
  let audit: any;

  beforeEach(() => {
    animal = { animal_id: 'animal', tenant_id: 'tenant', company_id: 'company',
      animal_code: 'animal-code', is_active: true, book_value: null };
    medicationRows = [];
    treatmentRows = [];
    events = [];
    db = {
      transaction: jest.fn(async work => {
        const before = { ...animal };
        try { return await work(db); }
        catch (error) { animal = before; throw error; }
      }),
      select: () => ({ from: (table: unknown) => {
        const rows = () => table === schema.animalMedicationLog ? medicationRows : treatmentRows;
        const query: any = {
          innerJoin: () => query,
          leftJoin: () => query,
          where: () => query,
          for: async () => { events.push('lock-animal'); return [animal]; },
          limit: async () => [{ animal, breed: null, stage: null, batch: null }],
          then: (resolve: any, reject: any) => {
            events.push(table === schema.animalMedicationLog ? 'read-medication' : 'read-treatment');
            return Promise.resolve(rows()).then(resolve, reject);
          },
        };
        return query;
      } }),
      update: jest.fn(() => ({ set: (values: any) => ({ where: async () => {
        Object.assign(animal, values);
        events.push('dispose');
      } }) })),
    };
    audit = { log: jest.fn().mockResolvedValue({}) };
    service = new AnimalService(transactionCls(db), audit, {} as any, {} as any);
    jest.spyOn(service, 'findOne').mockImplementation(async () => ({ ...animal }));
  });

  const dose = (date: string, recordedDays: number | null, masterDays = 3) => ({
    item_id: 'medicine', item_name: 'Medicine', item_type: 'MEDICINE',
    administered_date: date, withdrawal_days: recordedDays, master_withdrawal_days: masterDays,
  });
  const slaughter = (date: string) => ({ disposal_type: 'SLAUGHTERED', disposal_date: date } as const);

  it('blocks slaughter using recorded treatment days even without a medication-log row', async () => {
    treatmentRows = [dose('2026-09-01', 14)];
    await expect(service.dispose('animal', slaughter('2026-09-10'), 'tenant')).rejects.toThrow('5 day(s) remaining');
    expect(db.update).not.toHaveBeenCalled();
    expect(events).toEqual(['lock-animal', 'read-medication', 'read-treatment']);
    expect(animal.is_active).toBe(true);
  });

  it('allows slaughter on the recorded expiry date', async () => {
    treatmentRows = [dose('2026-09-01', 14)];
    await service.dispose('animal', slaughter('2026-09-15'), 'tenant');
    expect(animal.is_active).toBe(false);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('falls back to master days only when treatment days are absent', async () => {
    treatmentRows = [dose('2026-09-01', null, 14)];
    await expect(service.dispose('animal', slaughter('2026-09-10'), 'tenant')).rejects.toThrow('5 day(s) remaining');
  });

  it('honors an explicit zero-day treatment withdrawal', async () => {
    treatmentRows = [dose('2026-09-01', 0, 14)];
    await service.dispose('animal', slaughter('2026-09-02'), 'tenant');
    expect(animal.is_active).toBe(false);
  });

  it('retains the earlier longer withdrawal when a later dose expires sooner', async () => {
    treatmentRows = [dose('2026-09-01', 20), dose('2026-09-10', 2)];
    await expect(service.dispose('animal', slaughter('2026-09-15'), 'tenant')).rejects.toThrow('6 day(s) remaining, last dose 2026-09-01');
  });

  it('retains withdrawal from the existing medication log alongside shorter treatments', async () => {
    medicationRows = [dose('2026-09-01', 20)];
    treatmentRows = [dose('2026-09-10', 2)];
    await expect(service.dispose('animal', slaughter('2026-09-15'), 'tenant')).rejects.toThrow('6 day(s) remaining');
  });

  it('shows the same treatment withdrawal on animal lookup', async () => {
    const today = new Date().toISOString().slice(0, 10);
    treatmentRows = [dose(today, 14), dose(today, 3)];
    const result = await service.lookupByTag('animal-code', 'tenant');
    expect(result.hasActiveWithdrawal).toBe(true);
    expect(result.activeWithdrawals).toEqual([{ item_name: 'Medicine', daysRemaining: 14, lastDose: today }]);
  });

  it('rolls back disposal when auditing fails', async () => {
    audit.log.mockRejectedValue(new Error('Audit failed'));
    await expect(service.dispose('animal', slaughter('2026-09-15'), 'tenant')).rejects.toThrow('Audit failed');
    expect(animal.is_active).toBe(true);
  });
});
