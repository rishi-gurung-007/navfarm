import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { QcSourceHandlers, type QcSettledInspection } from './qc-source-handlers';
import { SemenQcSource } from '../../piggery/breeding/semen-qc-source';
import type { NumberSeriesService } from '../../system/number-series/number-series.service';

const inspection = (over: Partial<QcSettledInspection> = {}): QcSettledInspection => ({
  inspection_id: 'insp-1', inspection_no: 'QC-000001', tenant_id: 't-1', company_id: 'co-1', source_doc_type: 'SEMEN_COLLECTION',
  source_line_id: 'sb-1', item_id: 'item-s', warehouse_id: 'store-1', lot_no: 'LOT-00011', quantity: '40.0000', ...over,
});
const db = {} as any;

describe('QcSourceHandlers', () => {
  it('tells the handler registered for the inspection\'s source, and no other', async () => {
    const handlers = new QcSourceHandlers();
    const semen = { settled: jest.fn(), scrapped: jest.fn() };
    const other = { settled: jest.fn(), scrapped: jest.fn() };
    handlers.register('SEMEN_COLLECTION', semen);
    handlers.register('GOODS_RECEIPT', other);
    await handlers.settled(db, inspection(), 30, true);
    expect(semen.settled).toHaveBeenCalledWith(db, inspection(), 30, true);
    expect(other.settled).not.toHaveBeenCalled();
  });

  it('does nothing for a source that registered no handler (a transfer receipt keeps no state of its own)', async () => {
    const handlers = new QcSourceHandlers();
    await expect(handlers.settled(db, inspection({ source_doc_type: 'TRANSFER_EVENT' }), 1, true)).resolves.toBeUndefined();
    await expect(handlers.scrapped(db, { inspection: inspection({ source_doc_type: 'TRANSFER_EVENT' }), quantity: 1, date: '2026-11-26' })).resolves.toBeUndefined();
  });

  it('tells a scrap only for a positive quantity', async () => {
    const handlers = new QcSourceHandlers();
    const semen = { scrapped: jest.fn() };
    handlers.register('SEMEN_COLLECTION', semen);
    await handlers.scrapped(db, { inspection: inspection(), quantity: 0, date: '2026-11-26' });
    expect(semen.scrapped).not.toHaveBeenCalled();
    await handlers.scrapped(db, { inspection: inspection(), quantity: 4, date: '2026-11-26' });
    expect(semen.scrapped).toHaveBeenCalledTimes(1);
  });

  it('refuses a second, different handler for the same source', () => {
    const handlers = new QcSourceHandlers();
    const one = { settled: jest.fn() };
    handlers.register('SEMEN_COLLECTION', one);
    expect(() => handlers.register('SEMEN_COLLECTION', one)).not.toThrow();
    expect(() => handlers.register('SEMEN_COLLECTION', { settled: jest.fn() })).toThrow(/already registered/);
  });
});

describe('SemenQcSource', () => {
  it('registers itself for semen collections when the module starts', () => {
    const handlers = new QcSourceHandlers();
    const source = new SemenQcSource(handlers, {} as NumberSeriesService);
    source.onModuleInit();
    expect(() => handlers.register('SEMEN_COLLECTION', { settled: jest.fn() })).toThrow(/already registered/);
  });

  it('marks the lot as stock and cuts its doses to what QC accepted, then follows it on the QR pack', async () => {
    const sets: any[] = [];
    const tx: any = { update: jest.fn(() => ({ set: (v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue(undefined) }; } })) };
    await new SemenQcSource(new QcSourceHandlers(), {} as NumberSeriesService).settled(tx, inspection(), 30, true);
    expect(sets[0]).toMatchObject({ inventory_posted: true, doses_collected: '30' });
    expect(sets[1]).toMatchObject({ net_weight: '30' });
  });
});

/** #4 of the 26 Nov review: the generic QC module must not reach into a domain module again. */
describe('the QC module stays generic', () => {
  it('imports nothing from piggery', () => {
    const dir = __dirname;
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .filter((f) => /from ['"][^'"]*\/piggery\//.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
