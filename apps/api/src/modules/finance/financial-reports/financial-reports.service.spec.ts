import { Test, TestingModule } from '@nestjs/testing';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { FinancialReportsService } from './financial-reports.service';
import { ClsService } from 'nestjs-cls';
import { FARM_SCOPE_KEY, FarmScope } from '../../../common/farm-scope';

describe('FinancialReportsService', () => {
  let service: FinancialReportsService;

  const mockDbSelect = jest.fn();

  const mockDb = {
    select: mockDbSelect,
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialReportsService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn().mockReturnValue(mockDb),
          },
        },
      ],
    }).compile();

    service = module.get<FinancialReportsService>(FinancialReportsService);
  });

  describe('getBiologicalAssetRollForward', () => {
    it('computes opening value, movements, closing value, and GL reconciliation', async () => {
      // 1. Mock bio_asset_ledger query
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue([
              // Prior period entry (Opening)
              {
                entry_id: 'e-1',
                entry_type: 'ACQUISITION',
                posting_date: '2025-12-01',
                cost_amount: '10000.0000',
                quantity: '10.0000',
                batch_id: 'batch-1',
                animal_id: null,
              },
              // Current period entries (Movements)
              {
                entry_id: 'e-2',
                entry_type: 'CONSUMPTION',
                posting_date: '2026-02-15',
                cost_amount: '2500.0000',
                quantity: '10.0000',
                batch_id: 'batch-1',
                animal_id: null,
              },
              {
                entry_id: 'e-3',
                entry_type: 'AMORTIZATION',
                posting_date: '2026-03-31',
                cost_amount: '-500.0000',
                quantity: '10.0000',
                batch_id: 'batch-1',
                animal_id: null,
              },
              {
                entry_id: 'e-4',
                entry_type: 'TRANSFORMATION',
                posting_date: '2026-05-20',
                cost_amount: '-3000.0000',
                quantity: '-3.0000',
                batch_id: 'batch-1',
                animal_id: null,
              },
              {
                entry_id: 'e-5',
                entry_type: 'ACQUISITION',
                posting_date: '2026-04-01',
                cost_amount: '3500.0000',
                quantity: '1.0000',
                batch_id: null,
                animal_id: 'animal-1',
              },
            ]),
          }),
        }),
      });

      // 2. Mock GL journal account balances
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                groupBy: jest.fn().mockResolvedValue([
                  {
                    gl_account_id: 'gl-1050',
                    account_code: '1050',
                    account_name: 'Biological Assets - Pre-mature',
                    account_type: 'ASSET',
                    parent_account_id: null,
                    total_debit: '12500.0000',
                    total_credit: '0.0000',
                  },
                ]),
              }),
            }),
          }),
        }),
      });

      const res = await service.getBiologicalAssetRollForward('tenant-1', 'comp-1', '2026-01-01', '2026-12-31');

      expect(res.openingCarryingValue).toBe(10000);
      expect(res.movements.growthCapitalization).toBe(2500);
      expect(res.movements.amortization).toBe(-500);
      expect(res.movements.harvestTransfers).toBe(-3000);
      expect(res.movements.acquisitions).toBe(3500);
      expect(res.movements.netMovement).toBe(2500); // 2500 - 500 - 3000 + 3500
      expect(res.closingCarryingValue).toBe(12500); // 10000 + 2500
      expect(res.glReconciliation.totalGlBalance).toBe(12500);
      expect(res.glReconciliation.isReconciled).toBe(true);
      expect(res.assetTypeBreakdown.batchCarryingValue).toBe(9000);
      expect(res.assetTypeBreakdown.animalCarryingValue).toBe(3500);
    });

    it('excludes another LOB on the selected farm and marks GL reconciliation unavailable', async () => {
      let capturedLedgerWhere: any;
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn((condition) => {
            capturedLedgerWhere = condition;
            return { orderBy: jest.fn().mockResolvedValue([]) };
          }),
        }),
      });

      const scopedService = await serviceWithScope({
        farmId: 'farm-1',
        restricted: true,
        companyId: 'comp-1',
        lobId: 'lob-piggery',
      });

      const res = await scopedService.getBiologicalAssetRollForward(
        'tenant-1',
        'comp-1',
        '2026-01-01',
        '2026-12-31',
      );

      const rendered = new MySqlDialect().sqlToQuery(capturedLedgerWhere);
      expect(rendered.sql).toContain('`bio_asset_ledger`.`lob_id` = ?');
      expect(rendered.sql).toContain('FROM batch_header bf WHERE bf.farm_id = ?');
      expect(rendered.params).toEqual(expect.arrayContaining(['lob-piggery', 'farm-1']));
      expect(mockDbSelect).toHaveBeenCalledTimes(1);
      expect(res.glReconciliation).toMatchObject({
        available: false,
        status: 'UNAVAILABLE',
        reason: 'GL journal lines do not carry a farm dimension.',
        glAccounts: [],
        totalGlBalance: null,
        variance: null,
        isReconciled: false,
      });
    });

    it('bounds both ledger and GL to the active LOB for an operational admin without a farm', async () => {
      let capturedLedgerWhere: any;
      let capturedGlWhere: any;
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn((condition) => {
            capturedLedgerWhere = condition;
            return { orderBy: jest.fn().mockResolvedValue([]) };
          }),
        }),
      });
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn((condition) => {
                capturedGlWhere = condition;
                return { groupBy: jest.fn().mockResolvedValue([]) };
              }),
            }),
          }),
        }),
      });

      const scopedService = await serviceWithScope({
        farmId: null,
        restricted: true,
        companyId: 'comp-1',
        lobId: 'lob-piggery',
      });

      const res = await scopedService.getBiologicalAssetRollForward(
        'tenant-1',
        'comp-1',
        '2026-01-01',
        '2026-12-31',
      );

      const dialect = new MySqlDialect();
      const renderedLedger = dialect.sqlToQuery(capturedLedgerWhere);
      const renderedGl = dialect.sqlToQuery(capturedGlWhere);
      expect(renderedLedger.sql).toContain('`bio_asset_ledger`.`lob_id` = ?');
      expect(renderedLedger.params).toContain('lob-piggery');
      expect(renderedGl.sql).toContain('`journal_line`.`lob_id` = ?');
      expect(renderedGl.params).toContain('lob-piggery');
      expect(res.glReconciliation).toMatchObject({
        available: true,
        status: 'AVAILABLE',
        totalGlBalance: 0,
        variance: 0,
        isReconciled: true,
      });
    });
  });

  describe('getPiggeryHerdAnalytics', () => {
    it('aggregates headcount, parity curve, productivity, and disposals', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                {
                  animal: {
                    animal_id: 'a-1',
                    is_active: true,
                    gender: 'F',
                    animal_type: 'GILT',
                    parity_count: 0,
                    total_opening_asset_value: '3000.0000',
                    book_value: '3000.0000',
                    current_stage_id: 'st-gilt',
                    breed_id: 'br-york',
                    total_piglets_born_live: 0,
                    total_piglets_weaned: 0,
                  },
                  breed: { breed_name: 'Large White Yorkshire' },
                  stage: { stage_name: 'Gilt Grower' },
                },
                {
                  animal: {
                    animal_id: 'a-2',
                    is_active: true,
                    gender: 'F',
                    animal_type: 'SOW',
                    parity_count: 3,
                    total_opening_asset_value: '4000.0000',
                    book_value: '2800.0000',
                    current_stage_id: 'st-sow',
                    breed_id: 'br-land',
                    total_piglets_born_live: 36,
                    total_piglets_weaned: 32,
                  },
                  breed: { breed_name: 'Landrace' },
                  stage: { stage_name: 'Productive Sow' },
                },
                {
                  animal: {
                    animal_id: 'a-3',
                    is_active: true,
                    gender: 'M',
                    animal_type: 'BOAR',
                    parity_count: 0,
                    total_opening_asset_value: '5000.0000',
                    book_value: '4200.0000',
                    current_stage_id: 'st-boar',
                    breed_id: 'br-duroc',
                    total_piglets_born_live: 0,
                    total_piglets_weaned: 0,
                  },
                  breed: { breed_name: 'Duroc' },
                  stage: { stage_name: 'Boar Active' },
                },
                {
                  animal: {
                    animal_id: 'a-4',
                    is_active: false,
                    gender: 'F',
                    animal_type: 'SOW',
                    parity_count: 6,
                    disposal_type: 'CULLED',
                    gain_loss_on_disposal: '150.0000',
                    total_piglets_born_live: 70,
                    total_piglets_weaned: 65,
                  },
                  breed: { breed_name: 'Landrace' },
                  stage: { stage_name: 'Culled' },
                },
              ]),
            }),
          }),
        }),
      });

      const res = await service.getPiggeryHerdAnalytics('tenant-1', 'comp-1');

      expect(res.totalHeadcount).toBe(3);
      expect(res.totalBookValue).toBe(10000); // 3000 + 2800 + 4200
      expect(res.genderBreakdown.Female).toBe(2);
      expect(res.genderBreakdown.Male).toBe(1);
      expect(res.parityDistribution['Parity 0 (Gilt)']).toBe(1);
      expect(res.parityDistribution['Parity 3']).toBe(1);
      expect(res.productivity.totalPigletsBornLive).toBe(106); // 36 + 70
      expect(res.productivity.totalPigletsWeaned).toBe(97); // 32 + 65
      expect(res.disposals.totalDisposed).toBe(1);
    });
  });

  describe('getBatchCostVarianceReport', () => {
    it('pivots per-type variance rows into a per-batch summary', async () => {
      const batch = {
        batch_id: 'batch-1',
        batch_no: 'PIG-B-2026-01',
        costing_method: 'BIO_ASSET',
        // The cost columns come from the batch's own accumulated cost, not from
        // summing std_value/actual_value — those hold a rate on a PRICE row and
        // a quantity on a USAGE row, so adding them across types is meaningless.
        total_cost: '52000.0000',
      };

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([
                {
                  variance: {
                    variance_id: 'var-1',
                    batch_id: 'batch-1',
                    variance_type: 'PRICE',
                    std_value: '25000.0000',
                    actual_value: '26200.0000',
                    variance_amount: '1200.0000',
                    is_favorable: false,
                    created_at: '2026-06-30 10:00:00',
                  },
                  batch,
                },
                {
                  variance: {
                    variance_id: 'var-2',
                    batch_id: 'batch-1',
                    variance_type: 'USAGE',
                    std_value: '25000.0000',
                    actual_value: '25800.0000',
                    variance_amount: '800.0000',
                    is_favorable: false,
                    created_at: '2026-06-30 10:00:01',
                  },
                  batch,
                },
              ]),
            }),
          }),
        }),
      });

      const res = await service.getBatchCostVarianceReport('tenant-1', 'comp-1');

      expect(res).toHaveLength(1);
      expect(res[0].batch_no).toBe('PIG-B-2026-01');
      expect(res[0].actual_cost).toBe(52000);          // the batch's actual accumulated cost
      expect(res[0].standard_cost).toBe(50000);        // actual net of what the variances explain
      expect(res[0].price_variance).toBe(1200);
      expect(res[0].usage_variance).toBe(800);
      expect(res[0].total_variance).toBe(2000);
      expect(res[0].variance_pct).toBe(4);
      expect(res[0].is_favorable).toBe(false);
    });
  });

  /**
   * C3: the reports controller trusted the client-supplied companyId and never
   * applied the farm/animal scope, so a Grasmere standard user's herd-analytics
   * call returned the whole company's herd even though /animal correctly gave
   * them zero rows. These tests pin the two halves of the fix: the query sent
   * to MySQL actually carries the farm predicate, and a caller whose scope
   * already names a company cannot override it via the query string.
   */
  async function serviceWithScope(scope: FarmScope): Promise<FinancialReportsService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialReportsService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn((key: string) => (key === FARM_SCOPE_KEY ? scope : mockDb)),
          },
        },
      ],
    }).compile();
    return module.get<FinancialReportsService>(FinancialReportsService);
  }

  describe('getPiggeryHerdAnalytics — farm scope (C3)', () => {
    it('renders the farm predicate in the animal_register query for a farm-restricted caller', async () => {
      let capturedWhere: any;
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn((cond) => {
                capturedWhere = cond;
                return Promise.resolve([]);
              }),
            }),
          }),
        }),
      });

      const scopedService = await serviceWithScope({
        farmId: 'farm-grasmere',
        restricted: true,
        companyId: 'comp-1',
        lobId: 'lob-piggery',
      });

      await scopedService.getPiggeryHerdAnalytics('tenant-1', 'comp-1');

      expect(capturedWhere).toBeDefined();
      const { sql: renderedSql, params } = new MySqlDialect().sqlToQuery(capturedWhere);
      // Fails if animalScopeConditions is dropped from the query: without it
      // the where-clause never references location_master or the farm id,
      // and this predicate — the actual leak in C3 — would be gone again.
      expect(renderedSql.toLowerCase()).toContain('location_master');
      expect(renderedSql.toLowerCase()).toMatch(/ and | or /);
      expect(params).toContain('farm-grasmere');
    });
  });

  describe('report company resolution (C3)', () => {
    it('rejects a query companyId that does not match the caller\'s scoped company with 403', async () => {
      const scopedService = await serviceWithScope({
        farmId: null,
        restricted: false,
        companyId: 'comp-1',
        lobId: null,
      });

      await expect(
        scopedService.getTrialBalance('tenant-1', 'comp-OTHER', '2026-08-06'),
      ).rejects.toThrow('Report company must match the workspace.');
    });

    it('trusts the query companyId only when the caller has no company in scope (tenant/system admin)', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                groupBy: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

      const scopedService = await serviceWithScope({ farmId: null, restricted: false, companyId: null, lobId: null });

      const res = await scopedService.getTrialBalance('tenant-1', 'comp-any', '2026-08-06');
      expect(res.asOfDate).toBe('2026-08-06');
    });
  });
});
