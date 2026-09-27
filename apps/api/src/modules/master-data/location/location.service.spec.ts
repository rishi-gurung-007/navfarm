import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SiloFeedService } from '../../inventory/silo-feed/silo-feed.service';
import { LocationService, siloCapacityForDisplay, siloCapacityToKg } from './location.service';

describe('LocationService canonical hierarchy', () => {
  let service: LocationService;
  const selectResults: any[][] = [];
  const txInsert = jest.fn();
  const txUpdate = jest.fn();
  const txDelete = jest.fn();
  const audit = { log: jest.fn() };
  const numberSeries = { generateNext: jest.fn(), lockSeries: jest.fn() };
  // D9 (which item may live where) is SiloFeedService's rule, not
  // LocationService's — these tests only need to know it was asked, and
  // whether it allowed or refused, not the item logic behind that answer.
  const siloFeedService = { assertAttachable: jest.fn(), currentItems: jest.fn() };

  const makeSelectBuilder = (rows: any[]) => {
    const builder: any = {};
    builder.from = jest.fn(() => builder);
    builder.where = jest.fn(() => builder);
    builder.orderBy = jest.fn(() => builder);
    builder.offset = jest.fn(() => builder);
    builder.leftJoin = jest.fn(() => builder);
    builder.limit = jest.fn(async () => rows);
    builder.then = (resolve: (value: any[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return builder;
  };

  // tx.select shares the same selectResults queue as db.select — both represent
  // the same sequential stream of SELECTs the real code issues, whichever
  // connection (pool vs. transaction) actually executes them.
  const tx = {
    insert: txInsert,
    update: txUpdate,
    delete: txDelete,
    select: jest.fn(() => makeSelectBuilder(selectResults.shift() || [])),
  };
  const db = {
    select: jest.fn(() => makeSelectBuilder(selectResults.shift() || [])),
    insert: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(async (callback: (executor: typeof tx) => unknown) => callback(tx)),
  };

  const company = { company_id: 'comp-1', tenant_id: 'tenant-1' };
  const farmType = {
    type_code: 'FARM', type_name: 'Farm', code_prefix: 'FARM',
    allowed_parent_types: [], company_id: null,
  };
  const shedType = {
    type_code: 'SHED', type_name: 'Shed / House', code_prefix: 'SHED',
    allowed_parent_types: ['FARM'], company_id: null,
  };
  // allowed_parent_types deliberately still lists SHED: it is tenant-editable
  // configuration, and the rule "a silo hangs off the farm" has to hold even
  // where the configuration disagrees. The refusal test below is that case.
  const siloType = {
    type_code: 'SILO', type_name: 'Silo', code_prefix: 'SILO',
    allowed_parent_types: ['FARM', 'SHED'], company_id: null,
  };
  const uom = { uom_code: 'HEAD' };
  /** The farm a silo hangs off. No area_size or max_capacity, so the parent-fit
   *  checks return before issuing a SELECT and the queue above stays readable. */
  const farmParent = () => ({
    location_id: 'farm-1', company_id: 'comp-1', location_type: 'FARM', location_code: 'FARM-001',
    location_level: 1, farm_id: 'farm-1', shed_id: null, warehouse_id: null,
  });
  /** A shed on that same farm, free to attach. */
  const shedRow = () => ({
    location_id: 'shed-1', location_code: 'FARM-001/SHED-001', location_type: 'SHED',
    parent_location_id: 'farm-1', farm_id: 'farm-1',
  });
  /** The location_master row the create actually inserted. */
  const inserted = () => (txInsert.mock.results[0].value.values as jest.Mock).mock.calls[0][0];
  // One LOCATION series now covers every type; LOCATION_FARM was the old
  // one-series-per-type naming this consolidation removed.
  const series = { series_code: 'LOCATION' };

  beforeEach(async () => {
    selectResults.length = 0;
    jest.clearAllMocks();
    txInsert.mockImplementation(() => ({ values: jest.fn().mockResolvedValue({}) }));
    txUpdate.mockImplementation(() => ({ set: jest.fn(() => ({ where: jest.fn().mockResolvedValue({}) })) }));
    txDelete.mockImplementation(() => ({ where: jest.fn().mockResolvedValue({}) }));
    audit.log.mockResolvedValue({});
    numberSeries.generateNext.mockResolvedValue('FARM-001');
    numberSeries.lockSeries.mockResolvedValue({ series_id: 'series-1', seq_length: 3 });
    siloFeedService.assertAttachable.mockResolvedValue(undefined);
    siloFeedService.currentItems.mockResolvedValue(new Map());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationService,
        { provide: ClsService, useValue: { get: jest.fn(() => db) } },
        { provide: AuditLogService, useValue: audit },
        { provide: NumberSeriesService, useValue: numberSeries },
        { provide: SiloFeedService, useValue: siloFeedService },
      ],
    }).compile();
    service = module.get(LocationService);
  });

  it('requires company scope because numbering is per company', async () => {
    await expect(service.create({
      location_name: 'Main Farm', location_address: 'Farm Road', location_type: 'FARM',
      max_capacity: 100, capacity_uom: 'HEAD',
    }, 'tenant-1')).rejects.toThrow(ConflictException);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('generates FARM-001 for a root farm as a single location_master insert', async () => {
    selectResults.push(
      [company], [farmType], [uom], [series],
      [{ location_id: 'loc-1', location_code: 'FARM-001', location_type: 'FARM', location_level: 1 }],
    );

    const result = await service.create({
      company_id: 'comp-1',
      location_name: 'Main Farm', location_address: 'Farm Road', location_type: 'FARM',
      max_capacity: 100, capacity_uom: 'HEAD',
    }, 'tenant-1', { userId: 'user-1' });

    // Root-level generation is unchanged: generateNext still receives the
    // series code / tenant / company, now also the tx executor it runs
    // inside so the row lock is held until the insert below it commits.
    expect(numberSeries.generateNext).toHaveBeenCalledWith('LOCATION', 'tenant-1', 'comp-1', tx, expect.any(Object));
    // One insert, not two. farm_master/shed_master/warehouse_master are gone —
    // a farm is a location_master row, so there is no mirror to write.
    expect(txInsert).toHaveBeenCalledTimes(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(result.location_code).toBe('FARM-001');
  });

  it('retries once with a freshly computed sequence when the first insert collides on a duplicate location code', async () => {
    selectResults.push(
      [company], [farmType], [uom], [series],
      [{ location_id: 'loc-1', location_code: 'FARM-002', location_type: 'FARM', location_level: 1 }],
    );
    numberSeries.generateNext
      .mockResolvedValueOnce('FARM-001')
      .mockResolvedValueOnce('FARM-002');

    const dupErr = Object.assign(
      new Error("Duplicate entry 'tenant-1-comp-1-FARM-001' for key 'uq_location_master_tenant_company_code'"),
      { code: 'ER_DUP_ENTRY', errno: 1062 },
    );
    txInsert
      .mockImplementationOnce(() => ({ values: jest.fn().mockRejectedValue(dupErr) })) // attempt 1 -> collides
      .mockImplementationOnce(() => ({ values: jest.fn().mockResolvedValue({}) })); // attempt 2 -> succeeds

    const result = await service.create({
      company_id: 'comp-1', location_name: 'Main Farm', location_address: 'Farm Road',
      location_type: 'FARM', max_capacity: 100, capacity_uom: 'HEAD',
    }, 'tenant-1', { userId: 'user-1' });

    expect(numberSeries.generateNext).toHaveBeenCalledTimes(2);
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(txInsert).toHaveBeenCalledTimes(2);
    const secondAttemptLocationInsert = (txInsert.mock.results[1].value.values as jest.Mock).mock.calls[0][0];
    expect(secondAttemptLocationInsert.location_code).toBe('FARM-002');
    expect(result.location_code).toBe('FARM-002');
  });

  it('rejects a generated code that would exceed 255 characters, without attempting any insert', async () => {
    selectResults.push([company], [farmType], [uom], [series]);
    numberSeries.generateNext.mockResolvedValue('FARM-' + '9'.repeat(252)); // 257 chars total

    await expect(service.create({
      company_id: 'comp-1', location_name: 'Main Farm', location_address: 'Farm Road',
      location_type: 'FARM', max_capacity: 100, capacity_uom: 'HEAD',
    }, 'tenant-1')).rejects.toThrow(BadRequestException);

    expect(txInsert).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('derives a shed level and farm ancestry from its canonical parent, prefixed with the parent code', async () => {
    const parent = {
      location_id: 'farm-1', company_id: 'comp-1', location_type: 'FARM', location_code: 'FARM-001',
      location_level: 1, farm_id: 'farm-1', shed_id: null, warehouse_id: null,
    };
    selectResults.push(
      [company], [shedType], [parent], [uom], [{ series_code: 'LOCATION' }],
      [], // no existing SHED siblings under this parent yet
      [{ location_id: 'shed-1', location_code: 'FARM-001/SHED-001', location_type: 'SHED', location_level: 2 }],
    );

    const result = await service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'House A', location_address: 'Farm Road', location_type: 'SHED',
      max_capacity: 60, capacity_uom: 'HEAD',
    }, 'tenant-1');

    expect(numberSeries.lockSeries).toHaveBeenCalledWith('LOCATION', 'tenant-1', 'comp-1', tx);
    expect(result.location_level).toBe(2);
    expect(txInsert).toHaveBeenCalledTimes(1);
    // Confirm the code actually written carries the parent's code as its prefix.
    const locationMasterInsertArgs = (txInsert.mock.results[0].value.values as jest.Mock).mock.calls[0][0];
    expect(locationMasterInsertArgs.location_code).toBe('FARM-001/SHED-001');
  });

  it('rejects a non-root type without a parent', async () => {
    selectResults.push([company], [shedType]);
    await expect(service.create({
      company_id: 'comp-1', location_name: 'House A', location_address: 'Farm Road',
      location_type: 'SHED', max_capacity: 60, capacity_uom: 'HEAD',
    }, 'tenant-1')).rejects.toThrow('requires a parent location');
  });

  it('rejects a parent outside the allowed type hierarchy', async () => {
    selectResults.push(
      [company], [shedType],
      [{ location_id: 'pen-1', company_id: 'comp-1', location_type: 'PEN', location_level: 2 }],
    );
    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'pen-1', location_name: 'House A',
      location_address: 'Farm Road', location_type: 'SHED', max_capacity: 60, capacity_uom: 'HEAD',
    }, 'tenant-1')).rejects.toThrow('must be created under FARM');
  });

  it('rejects a SILO until the template tracking fields are supplied', async () => {
    selectResults.push(
      [company], [siloType],
      [{ location_id: 'farm-1', company_id: 'comp-1', location_type: 'FARM', location_level: 1 }],
    );
    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1', location_name: 'Feed Silo',
      location_address: 'Farm Road', location_type: 'SILO', max_capacity: 2000, capacity_uom: 'KG',
      low_level_kg: 200, high_level_kg: 1800,
    }, 'tenant-1')).rejects.toThrow(ConflictException);
  });

  it('refuses a SILO under a SHED — a silo hangs off the farm, whatever the type configuration allows', async () => {
    // One silo serves many sheds (client, 2026-09-24). Parenting it under one
    // of them would make whichever shed it stands beside look like the one it
    // feeds; the sheds it actually feeds are the attached_sheds set.
    const shedParent = {
      location_id: 'shed-1', company_id: 'comp-1', location_type: 'SHED', location_code: 'FARM-001/SHED-001',
      location_level: 2, farm_id: 'farm-1', shed_id: 'shed-1', warehouse_id: null,
    };
    selectResults.push([company], [siloType], [shedParent]);

    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'shed-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      low_level_kg: 200, high_level_kg: 1800,
      capacity_uom: 'KG', silo_capacity_kg: 2000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
    }, 'tenant-1')).rejects.toThrow('must be created under a FARM');

    expect(txInsert).not.toHaveBeenCalled();
  });

  it('requires the capacity unit on a SILO, because a bare number could be either KG or TON', async () => {
    selectResults.push([company], [siloType], [farmParent()]);

    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      low_level_kg: 200, high_level_kg: 1800,
      capacity_uom: 'KG', silo_capacity_kg: 40, silo_reorder_days: 7,
    }, 'tenant-1')).rejects.toThrow('silo_capacity_uom');
  });

  it('stores a TON capacity as canonical kilograms and reads it back in tonnes', async () => {
    selectResults.push(
      [company], [siloType], [farmParent()], [uom], [series],
      [], // no existing SILO siblings under this farm yet
      [{
        location_id: 'silo-1', location_code: 'FARM-001/SILO-001', location_type: 'SILO', location_level: 2,
        silo_capacity_kg: '40000.00', silo_capacity_uom: 'TON',
      }],
      [], // no sheds attached to it
    );

    const result = await service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      low_level_kg: 200, high_level_kg: 1800,
      capacity_uom: 'KG', silo_capacity_kg: 40, silo_capacity_uom: 'TON', silo_reorder_days: 7,
    }, 'tenant-1');

    // 40 TON typed -> 40,000 KG written. Every stock comparison downstream
    // reads silo_capacity_kg without consulting the unit, so the row has to be
    // in one unit already.
    const inserted = (txInsert.mock.results[0].value.values as jest.Mock).mock.calls[0][0];
    expect(inserted.silo_capacity_kg).toBe('40000');
    expect(inserted.silo_capacity_uom).toBe('TON');
    // ...and the edit form gets back the 40 that was typed, not the 40,000
    // stored, or re-saving it untouched would store 40,000 TON.
    expect(result.silo_capacity_kg).toBe('40');
  });

  it('a silo read returns current_feed_item_code and current_feed_item_name from SiloFeedService.currentItems', async () => {
    selectResults.push(
      [{
        location_id: 'silo-1', tenant_id: 'tenant-1', company_id: 'comp-1',
        location_type: 'SILO', location_code: 'FARM-001/SILO-001',
      }],
      [], // no sheds attached
    );
    siloFeedService.currentItems.mockResolvedValueOnce(new Map([
      ['silo-1', { item_id: 'item-1', item_code: 'STARTER', item_description: 'Starter Feed', on_hand_qty: 500 }],
    ]));

    const result = await service.findOne('silo-1', 'tenant-1');

    expect(siloFeedService.currentItems).toHaveBeenCalledWith(['silo-1'], 'comp-1', 'tenant-1');
    expect(result.current_feed_item_code).toBe('STARTER');
    expect(result.current_feed_item_name).toBe('Starter Feed');
  });

  it('an empty silo reads current_feed_item_code and current_feed_item_name as null', async () => {
    selectResults.push(
      [{
        location_id: 'silo-1', tenant_id: 'tenant-1', company_id: 'comp-1',
        location_type: 'SILO', location_code: 'FARM-001/SILO-001',
      }],
      [],
    );
    siloFeedService.currentItems.mockResolvedValueOnce(new Map([['silo-1', null]]));

    const result = await service.findOne('silo-1', 'tenant-1');

    expect(result.current_feed_item_code).toBeNull();
    expect(result.current_feed_item_name).toBeNull();
  });

  it('links the listed sheds in silo_shed_link, after SiloFeedService clears the attach', async () => {
    selectResults.push(
      [company], [siloType], [farmParent()], [uom], [series],
      [], // no existing SILO siblings
      [shedRow()], // the attached_sheds lookup
      [], // no existing links yet for this brand-new silo
      [{ location_id: 'silo-1', location_code: 'FARM-001/SILO-001', location_type: 'SILO', location_level: 2, company_id: 'comp-1' }],
      [{ shed_id: 'shed-1' }], // read back off silo_shed_link
    );

    const result = await service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      low_level_kg: 200, high_level_kg: 1800,
      capacity_uom: 'KG', silo_capacity_kg: 2000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      attached_sheds: ['shed-1'],
    }, 'tenant-1');

    // D9 (may this silo feed this shed the same item another silo already
    // does?) is SiloFeedService's call, made once per attach, not assumed.
    expect(siloFeedService.assertAttachable).toHaveBeenCalledWith({
      siloId: inserted().location_id, shedIds: ['shed-1'], companyId: 'comp-1', tenantId: 'tenant-1',
    });
    // One delete (stale links) and one insert (missing links) on the link
    // table, in the same transaction as the silo insert.
    expect(txDelete).toHaveBeenCalledTimes(1);
    expect(txInsert).toHaveBeenCalledTimes(2); // the location row, then the silo_shed_link row
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(result.attached_sheds).toEqual(['shed-1']);
  });

  it('allows attaching a shed to a second silo — a shed may now draw from several silos, one per feed item (D7)', async () => {
    // The old model refused this outright, reading the shed's own
    // feed_silo_id; that check is gone from syncAttachedSheds. Whether two
    // silos may share a shed is SiloFeedService.assertAttachable's call now
    // (D9, item-based), and it is asked, not assumed to refuse.
    selectResults.push(
      [company], [siloType], [farmParent()], [uom], [series], [],
      [shedRow()],
      [], // no existing links yet for this silo
      [{ location_id: 'silo-2', location_code: 'FARM-001/SILO-002', location_type: 'SILO', location_level: 2, company_id: 'comp-1' }],
      [{ shed_id: 'shed-1' }],
    );

    const result = await service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 2', location_address: 'Farm Road', location_type: 'SILO',
      low_level_kg: 200, high_level_kg: 1800,
      capacity_uom: 'KG', silo_capacity_kg: 2000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      attached_sheds: ['shed-1'],
    }, 'tenant-1');

    expect(siloFeedService.assertAttachable).toHaveBeenCalledTimes(1);
    expect(result.attached_sheds).toEqual(['shed-1']);
  });

  it("propagates SiloFeedService's refusal without writing anything to silo_shed_link", async () => {
    selectResults.push(
      [company], [siloType], [farmParent()], [uom], [series], [],
      [shedRow()],
    );
    siloFeedService.assertAttachable.mockRejectedValueOnce(new BadRequestException(
      "Cannot attach silo 'FARM-001/SILO-002' to shed 'FARM-001/SHED-001' — silo 'FARM-001/SILO-001' already draws 'STARTER' from there.",
    ));

    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 2', location_address: 'Farm Road', location_type: 'SILO',
      low_level_kg: 200, high_level_kg: 1800,
      capacity_uom: 'KG', silo_capacity_kg: 2000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      attached_sheds: ['shed-1'],
    }, 'tenant-1')).rejects.toThrow('already draws');

    expect(txDelete).not.toHaveBeenCalled();
    expect(txInsert).toHaveBeenCalledTimes(1); // the location row only — nothing on the link table
  });

  it('refuses to attach a location that is not a SHED', async () => {
    selectResults.push(
      [company], [siloType], [farmParent()], [uom], [series], [],
      [{ ...shedRow(), location_type: 'PEN', location_code: 'FARM-001/SHED-001/PEN-001' }],
    );

    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      low_level_kg: 200, high_level_kg: 1800,
      capacity_uom: 'KG', silo_capacity_kg: 2000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      attached_sheds: ['shed-1'],
    }, 'tenant-1')).rejects.toThrow(BadRequestException);
  });

  it('refuses to attach a shed on another farm, because that delivery cannot happen', async () => {
    selectResults.push(
      [company], [siloType], [farmParent()], [uom], [series], [],
      [{ ...shedRow(), farm_id: 'farm-2', parent_location_id: 'farm-2' }],
    );

    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      low_level_kg: 200, high_level_kg: 1800,
      capacity_uom: 'KG', silo_capacity_kg: 2000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      attached_sheds: ['shed-1'],
    }, 'tenant-1')).rejects.toThrow('not on the same farm');
  });

  it('refuses to attach a shed that was never created', async () => {
    selectResults.push(
      [company], [siloType], [farmParent()], [uom], [series], [],
      [], // the shed lookup finds nothing
    );

    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      low_level_kg: 200, high_level_kg: 1800,
      capacity_uom: 'KG', silo_capacity_kg: 2000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      attached_sheds: ['ghost-shed'],
    }, 'tenant-1')).rejects.toThrow(BadRequestException);
  });

  it('refuses attached sheds on anything that is not a SILO, rather than ignoring them', async () => {
    selectResults.push([company], [farmType]);

    await expect(service.create({
      company_id: 'comp-1', location_name: 'Main Farm', location_address: 'Farm Road',
      location_type: 'FARM', max_capacity: 100, capacity_uom: 'HEAD',
      attached_sheds: ['shed-1'],
    }, 'tenant-1')).rejects.toThrow('Only a SILO can have attached sheds');
  });

  it('refuses to re-parent a SILO under a SHED, so an edit cannot undo what create refused', async () => {
    const silo = {
      location_id: 'silo-1', tenant_id: 'tenant-1', company_id: 'comp-1', location_code: 'FARM-001/SILO-001',
      location_type: 'SILO', location_level: 2, parent_location_id: 'farm-1', farm_id: 'farm-1',
      low_level_kg: '200.00', high_level_kg: '1800.00',
      storage_type: 'SILO', silo_capacity_kg: '2000.00', silo_capacity_uom: 'KG', silo_reorder_days: 7,
    };
    const shedParent = {
      location_id: 'shed-1', company_id: 'comp-1', location_type: 'SHED', location_code: 'FARM-001/SHED-001',
      location_level: 2, farm_id: 'farm-1', shed_id: 'shed-1', warehouse_id: null,
    };
    selectResults.push(
      [silo], [siloType], [shedParent],
      [{ parent_location_id: 'farm-1' }], [{ parent_location_id: null }], // the cycle walk to the root
    );

    await expect(service.update('silo-1', { parent_location_id: 'shed-1' }, 'tenant-1'))
      .rejects.toThrow('must be placed under a FARM');
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('detaches every shed when the silo is saved with an empty attached list', async () => {
    const silo = {
      location_id: 'silo-1', tenant_id: 'tenant-1', company_id: 'comp-1', location_code: 'FARM-001/SILO-001',
      location_type: 'SILO', location_level: 2, parent_location_id: 'farm-1', farm_id: 'farm-1',
      low_level_kg: '200.00', high_level_kg: '1800.00',
      storage_type: 'SILO', silo_capacity_kg: '40000.00', silo_capacity_uom: 'TON', silo_reorder_days: 7,
    };
    selectResults.push(
      [silo], [siloType], [farmParent()],
      [{ parent_location_id: null }], // the hierarchy-cycle walk reaches the root
      [silo], // the findOne that follows the write
      [], // ...and it now feeds nothing
    );

    const result = await service.update('silo-1', { attached_sheds: [] }, 'tenant-1', { userId: 'user-1' });

    // The silo row itself is one update; detaching everything is a delete on
    // silo_shed_link, not a second update — a shed dropped from the list still
    // carries a link otherwise, and the set could only ever grow. An empty
    // list means no shedIds to validate or clear through SiloFeedService.
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(txDelete).toHaveBeenCalledTimes(1);
    expect(siloFeedService.assertAttachable).not.toHaveBeenCalled();
    expect(result.attached_sheds).toEqual([]);
  });

  it('keeps location type and generated identity immutable', async () => {
    selectResults.push([{
      location_id: 'loc-1', company_id: 'comp-1', location_code: 'FARM-001',
      location_type: 'FARM', location_level: 1, parent_location_id: null,
    }]);
    await expect(service.update('loc-1', { location_type: 'SHED' }, 'tenant-1'))
      .rejects.toThrow('Location Type cannot be changed');
  });

  it('does not deactivate a location that still has active children', async () => {
    selectResults.push(
      [{ location_id: 'farm-1', company_id: 'comp-1', location_name: 'Main Farm', location_type: 'FARM' }],
      [{ location_id: 'shed-1' }],
    );
    await expect(service.remove('farm-1', 'tenant-1')).rejects.toThrow(ConflictException);
  });

  it('reports an unknown company before any hierarchy work', async () => {
    selectResults.push([]);
    await expect(service.create({
      company_id: 'missing-company', location_name: 'Main Farm', location_address: 'Farm Road',
      location_type: 'FARM', max_capacity: 100, capacity_uom: 'HEAD',
    }, 'tenant-1')).rejects.toThrow(NotFoundException);
  });

  it('rejects switching an existing location to SILO', async () => {
    selectResults.push([{
      location_id: 'loc-1', company_id: 'comp-1', location_type: 'STORE',
      location_level: 1, parent_location_id: null,
    }]);
    await expect(service.update('loc-1', { location_type: 'SILO' }, 'tenant-1'))
      .rejects.toThrow('Location Type cannot be changed');
  });

  it('rejects an area_unit that does not resolve in uom_master', async () => {
    selectResults.push(
      [{ location_id: 'loc-1', tenant_id: 'tenant-1', company_id: 'comp-1', location_type: 'FARM', parent_location_id: null, location_level: 1 }],
      [farmType],
      [], // area_unit UOM lookup finds nothing
    );
    await expect(service.update('loc-1', { area_unit: 'BOGUS' }, 'tenant-1'))
      .rejects.toThrow(NotFoundException);
  });

  it('soft-deletes a location and writes an audit log entry', async () => {
    selectResults.push(
      [{ location_id: 'loc-1', tenant_id: 'tenant-1', company_id: 'comp-1', location_name: 'Pen 1', location_type: 'PEN' }],
      [], // no active children blocking the delete
    );

    const result = await service.remove('loc-1', 'tenant-1', { userId: 'user-1' });

    expect(txUpdate).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE', entityName: 'location_master', entityId: 'loc-1',
    }));
    expect(result.success).toBe(true);
  });

  it('restores a soft-deleted location and clears deleted_at', async () => {
    selectResults.push(
      [{ location_id: 'loc-1', company_id: 'comp-1', location_type: 'PEN', deleted_at: '2026-01-01 00:00:00' }],
      [{ location_id: 'loc-1', company_id: 'comp-1', location_type: 'PEN', deleted_at: null }],
    );

    const result = await service.restore('loc-1', 'tenant-1', { userId: 'user-1' });

    expect(txUpdate).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RESTORE', entityName: 'location_master', entityId: 'loc-1',
    }));
    expect(result.deleted_at).toBeNull();
  });

  it('stores a silo low and high feed level in kilograms (Master Setup §1 rows 10 and 12)', async () => {
    selectResults.push(
      [company], [siloType], [farmParent()], [uom], [series],
      [], // no existing SILO siblings under this farm yet
      [{ location_id: 'silo-1', location_code: 'FARM-001/SILO-001', location_type: 'SILO', location_level: 2,
         silo_capacity_kg: '12000.00', silo_capacity_uom: 'KG', low_level_kg: '1000.00', high_level_kg: '10800.00' }],
      [], // no sheds attached to it
    );

    await service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      capacity_uom: 'KG', silo_capacity_kg: 12000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      low_level_kg: 1000, high_level_kg: 10800,
    } as any, 'tenant-1');

    expect(inserted().low_level_kg).toBe('1000');
    expect(inserted().high_level_kg).toBe('10800');
  });

  it('refuses a low feed level that is not below the high level', async () => {
    selectResults.push([company], [siloType], [farmParent()]);
    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      capacity_uom: 'KG', silo_capacity_kg: 12000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      low_level_kg: 5000, high_level_kg: 5000,
    } as any, 'tenant-1')).rejects.toThrow('The low feed level must be below the high feed level.');
    expect(txInsert).not.toHaveBeenCalled();
  });

  it('refuses a high feed level above the silo capacity, in kilograms even when capacity was typed in tonnes', async () => {
    selectResults.push([company], [siloType], [farmParent()]);
    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      capacity_uom: 'KG', silo_capacity_kg: 12, silo_capacity_uom: 'TON', silo_reorder_days: 7,
      low_level_kg: 1000, high_level_kg: 12500,
    } as any, 'tenant-1')).rejects.toThrow('The high feed level cannot exceed the silo capacity.');
  });

  // L13: the create-path checks above cover the happy path and the two
  // refusals; the update path re-validates the pair too — the brief's
  // service comment on assertSiloLevels promises "either may be blank …
  // when both are given the low must sit below the high", and that promise
  // has to hold when only one side of an existing pair is edited, not only
  // when both arrive together on create.
  it('refuses raising the silo above a low level that already exists on the row, on update', async () => {
    const silo = {
      location_id: 'silo-1', tenant_id: 'tenant-1', company_id: 'comp-1', location_code: 'FARM-001/SILO-001',
      location_type: 'SILO', location_level: 2, parent_location_id: 'farm-1', farm_id: 'farm-1',
      storage_type: 'SILO', silo_capacity_kg: '12000.00', silo_capacity_uom: 'KG', silo_reorder_days: 7,
      low_level_kg: '1000.00', high_level_kg: null,
    };
    selectResults.push(
      [silo], [siloType], [farmParent()],
      [{ parent_location_id: null }], // the cycle walk to the root
    );

    await expect(service.update('silo-1', { high_level_kg: 500 }, 'tenant-1'))
      .rejects.toThrow('The low feed level must be below the high feed level.');
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('refuses a new silo without both feed levels (D22)', async () => {
    selectResults.push([company], [siloType], [farmParent()]);
    await expect(service.create({
      company_id: 'comp-1', parent_location_id: 'farm-1',
      location_name: 'Feed Silo 1', location_address: 'Farm Road', location_type: 'SILO',
      capacity_uom: 'KG', silo_capacity_kg: 12000, silo_capacity_uom: 'KG', silo_reorder_days: 7,
      low_level_kg: 2400,
    } as any, 'tenant-1')).rejects.toThrow('A silo needs both a Below Feed Level and an Above Threshold.');
    expect(txInsert).not.toHaveBeenCalled();
  });

  it('refuses saving a silo that still has no levels, whatever else the edit changes (D22)', async () => {
    const silo = {
      location_id: 'silo-1', tenant_id: 'tenant-1', company_id: 'comp-1', location_code: 'FARM-001/SILO-001',
      location_type: 'SILO', location_level: 2, parent_location_id: 'farm-1', farm_id: 'farm-1',
      storage_type: 'SILO', silo_capacity_kg: '12000.00', silo_capacity_uom: 'KG', silo_reorder_days: 7,
      low_level_kg: null, high_level_kg: null,
    };
    selectResults.push([silo], [siloType], [farmParent()], [{ parent_location_id: null }]);
    await expect(service.update('silo-1', { location_name: 'Feed Silo 1b' }, 'tenant-1'))
      .rejects.toThrow('A silo needs both a Below Feed Level and an Above Threshold.');
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('does not require levels on a pen that carries a legacy SILO storage type (Review Focus 1)', async () => {
    const pen = {
      location_id: 'pen-1', tenant_id: 'tenant-1', company_id: 'comp-1', location_code: 'FARM-001/SHED-001/PEN-001',
      location_type: 'PEN', location_level: 3, parent_location_id: 'shed-1', farm_id: 'farm-1',
      storage_type: 'SILO', silo_capacity_kg: null, silo_capacity_uom: null, silo_reorder_days: null,
      low_level_kg: null, high_level_kg: null,
    };
    selectResults.push([pen], [{ ...siloType, type_code: 'PEN', type_name: 'Pen', code_prefix: 'PEN' }], [farmParent()], [{ parent_location_id: null }]);
    const outcome = await service.update('pen-1', { location_name: 'Pen 1b' }, 'tenant-1').then(() => null, (e: Error) => e);
    expect(outcome?.message ?? '').not.toContain('Below Feed Level');
  });

  it('getLocationOccupancy aggregates headcounts, capacity utilization, and biosecurity status', async () => {
    selectResults.push(
      [{
        location: {
          location_id: 'loc-pen-1', location_code: 'PEN-01A', location_name: 'Pen 1A',
          location_type: 'PEN', max_capacity: '20.0000', capacity_uom: 'HEAD', shed_id: null,
          last_cleaned_date: null, last_disinfected_date: null,
        },
        farm: { farm_name: 'Main Farm' },
        shed: { shed_name: 'Grower Shed 1' },
      }],
      [
        { animal_id: 'a-1', current_location_id: 'loc-pen-1', status: 'ACTIVE' },
        { animal_id: 'a-2', current_location_id: 'loc-pen-1', status: 'QUARANTINE' },
      ],
      [], // no active batches
    );

    const res = await service.getLocationOccupancy('tenant-1', 'comp-1');

    expect(res).toHaveLength(1);
    expect(res[0].location_code).toBe('PEN-01A');
    expect(res[0].current_occupancy).toBe(2);
    expect(res[0].max_capacity).toBe(20);
    expect(res[0].utilization_pct).toBe(10); // 2 / 20 = 10%
    expect(res[0].biosecurity_status).toBe('QUARANTINE_ACTIVE');
    expect(res[0].sick_animal_count).toBe(1);
  });
});

describe('hierarchical location codes', () => {
  // Unit-level tests for LocationService.generateLocationCode (private) — the
  // rule: a code carries its ancestry, so the code alone tells you where a
  // location sits. A root location keeps the flat per-company counter; a
  // child location is `<parent code>/<TYPE>-<seq>`, and <seq> counts only
  // the siblings sharing that exact parent, never a company-wide total.
  let service: LocationService;
  const numberSeries = { generateNext: jest.fn(), lockSeries: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    numberSeries.lockSeries.mockResolvedValue({ series_id: 'series-1', seq_length: 3 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationService,
        { provide: ClsService, useValue: { get: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: NumberSeriesService, useValue: numberSeries },
        { provide: SiloFeedService, useValue: { assertAttachable: jest.fn(), currentItems: jest.fn() } },
      ],
    }).compile();
    service = module.get(LocationService);
  });

  /** Builds a fake tx executor whose only role here is answering the sibling-count SELECT. */
  const makeExecutor = (siblingCodes: string[] = []) => ({
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve(siblingCodes.map((code) => ({ code })))),
      })),
    })),
  });

  const gen = (opts: {
    typePrefix: string;
    parent: { location_code: string } | null;
    siblingCodes?: string[];
  }) => {
    const type = { type_code: opts.typePrefix, code_prefix: opts.typePrefix } as any;
    const parent = opts.parent ? { location_id: 'parent-1', location_code: opts.parent.location_code } as any : undefined;
    if (!parent) numberSeries.generateNext.mockResolvedValue(`${opts.typePrefix}-001`);
    const executor = makeExecutor(opts.siblingCodes) as any;
    return (service as any).generateLocationCode('SERIES_CODE', type, 'tenant-1', 'comp-1', parent, executor);
  };

  /**
   * The other half of the same decision: a LOCATION series that says how to
   * build the code is used, and the composite path above is the floor for when
   * it does not. Without this the fold would be untested and the guarantee
   * tests below would look like the whole story.
   */
  it('hands the code to the series when the series carries segments', async () => {
    const type = { type_code: 'SHED', code_prefix: 'SHED' } as any;
    const parent = { location_id: 'parent-1', location_code: 'FARM-001' } as any;
    numberSeries.lockSeries.mockResolvedValue({ seq_length: 3, code_segments: ['parent_location_id', 'location_type'] } as any);
    numberSeries.generateNext.mockResolvedValue('FARM001-SHED-001');

    await expect((service as any).generateLocationCode('SERIES_CODE', type, 'tenant-1', 'comp-1', parent, makeExecutor() as any))
      .resolves.toBe('FARM001-SHED-001');

    expect(numberSeries.generateNext).toHaveBeenCalledWith(
      'SERIES_CODE', 'tenant-1', 'comp-1', expect.anything(),
      { parent_location_id: 'parent-1', location_type: 'SHED' },
    );
  });

  it('generates a root code from the type prefix', async () => {
    // no parent -> PREFIX-NNN, via the existing flat per-company counter
    await expect(gen({ typePrefix: 'FARM', parent: null })).resolves.toBe('FARM-001');
  });

  it('prefixes a child code with its parent code', async () => {
    await expect(gen({ typePrefix: 'SHED', parent: { location_code: 'FARM-001' } }))
      .resolves.toBe('FARM-001/SHED-001');
  });

  it('counts siblings within the parent, not globally', async () => {
    // FARM-001 already has two sheds -> its third shed is SHED-003 there.
    await expect(gen({
      typePrefix: 'SHED', parent: { location_code: 'FARM-001' },
      siblingCodes: ['FARM-001/SHED-001', 'FARM-001/SHED-002'],
    })).resolves.toBe('FARM-001/SHED-003');

    // FARM-002 has no sheds of its own yet -> its first is SHED-001 there,
    // not SHED-003 (which a global counter would have produced).
    await expect(gen({ typePrefix: 'SHED', parent: { location_code: 'FARM-002' } }))
      .resolves.toBe('FARM-002/SHED-001');
  });

  it('nests to a third level', async () => {
    await expect(gen({ typePrefix: 'PEN', parent: { location_code: 'FARM-001/SHED-001' } }))
      .resolves.toBe('FARM-001/SHED-001/PEN-001');
  });

  it('nests to a fourth level', async () => {
    await expect(gen({ typePrefix: 'SLO', parent: { location_code: 'FARM-001/SHED-001/PEN-001' } }))
      .resolves.toBe('FARM-001/SHED-001/PEN-001/SLO-001');
  });
});

describe('silo capacity units', () => {
  /**
   * The client enters a silo in KG or in TON; the column is always KG. The
   * conversion is the whole rule, so it lives in two pure functions and is
   * tested without a database — as sumAreasInUnit is.
   */
  it('multiplies a TON figure into canonical kilograms on the way in', () => {
    expect(siloCapacityToKg(40, 'TON')).toBe('40000');
    expect(siloCapacityToKg(2.5, 'TON')).toBe('2500');
  });

  it('leaves a KG figure alone', () => {
    expect(siloCapacityToKg(40, 'KG')).toBe('40');
  });

  it('divides back out for the edit form, so an untouched re-save stores the same capacity', () => {
    // Reopening a 40 TON silo must show 40. Showing the stored 40,000 would
    // come back as 40,000 TON on the next save.
    expect(siloCapacityForDisplay('40000.00', 'TON')).toBe('40');
    expect(siloCapacityToKg(siloCapacityForDisplay('40000.00', 'TON'), 'TON')).toBe('40000');
  });

  it('reads a row with no unit recorded as KG, because that is what the column already meant', () => {
    // silo_capacity_uom was added after those rows were written; their number
    // is canonical kilograms, so this is the true reading rather than a guess.
    expect(siloCapacityForDisplay('2000.00', null)).toBe('2000');
  });

  it('does not treat an absent capacity as zero', () => {
    expect(siloCapacityToKg(null, 'TON')).toBeNull();
    expect(siloCapacityForDisplay(undefined, 'KG')).toBeNull();
    expect(siloCapacityForDisplay('not-a-number', 'TON')).toBeNull();
  });
});
