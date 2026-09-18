import { Injectable, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { UpdateInventorySetupDto } from './dto/inventory-setup.dto';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

export interface MasterMeta {
  key: string;
  label: string;
  description: string;
  category: string;
}

export const INVENTORY_MASTER_TYPES: MasterMeta[] = [
  { key: 'ITEM', label: 'Item', description: 'Raw materials, feeds, medicines, and finished goods', category: 'Inventory' },
  { key: 'SUPPLIER', label: 'Supplier', description: 'Vendors and feed/medicine suppliers', category: 'Procurement' },
  { key: 'CUSTOMER', label: 'Customer', description: 'Buyers, traders, and slaughterhouses', category: 'Sales' },
  { key: 'LOCATION', label: 'Location', description: 'Farms, sheds, barns, warehouses, and storage silos', category: 'Infrastructure' },
  { key: 'LOCATION_TYPE', label: 'Location Type', description: 'Classification of physical structures', category: 'Infrastructure' },
  { key: 'ANIMAL', label: 'Animal', description: 'Individual animals and breeding stock registry', category: 'Livestock' },
  { key: 'SPECIES', label: 'Species', description: 'Animal species classification', category: 'Livestock' },
  { key: 'BREED', label: 'Breed', description: 'Breed genetics and bloodlines', category: 'Livestock' },
  { key: 'BREED_LIFECYCLE_STAGE', label: 'Breed Lifecycle Stage', description: 'Growth and parity lifecycle steps', category: 'Livestock' },
  { key: 'FEED_FORMULA', label: 'Feed Formula', description: 'Ration formulations and recipes', category: 'Feed & Nutrition' },
  { key: 'DISEASE', label: 'Disease', description: 'Veterinary health and diagnosis catalog', category: 'Health' },
  { key: 'REASON', label: 'Reason', description: 'Movement, disposal, and adjustment reasons', category: 'Operations' },
  { key: 'RESOURCE', label: 'Resource', description: 'Farm equipment, machinery, and labour resources', category: 'Operations' },
  { key: 'STAGE', label: 'Stage', description: 'Production stages and batch lifecycles', category: 'Production' },
  { key: 'UOM', label: 'Unit of Measure', description: 'Measurement units for inventory and dosages', category: 'Inventory' },
  { key: 'UOM_CONVERSION', label: 'UOM Conversion', description: 'Ratio conversions between UOMs', category: 'Inventory' },
  { key: 'ITEM_CATEGORY', label: 'Item Category', description: 'Category taxonomy for item hierarchy', category: 'Inventory' },
  { key: 'ITEM_TYPE', label: 'Item Type', description: 'Classification of items (Feed, Medicine, Bio-Asset, etc.)', category: 'Inventory' },
  { key: 'ITEM_ATTRIBUTE', label: 'Item Attribute', description: 'Dynamic properties and specifications', category: 'Inventory' },
  { key: 'GL_ACCOUNT', label: 'GL Account', description: 'General ledger chart of accounts', category: 'Finance' },
  { key: 'GL_MAPPING', label: 'GL Mapping', description: 'Transaction to account posting rules', category: 'Finance' },
  { key: 'COST_CENTER', label: 'Cost Center', description: 'Department and profit center codes', category: 'Finance' },
  { key: 'BATCH', label: 'Batch', description: 'Production and processing batch lots', category: 'Production' },
];

@Injectable()
export class InventorySetupService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * Retrieves the Inventory Setup for the specified company.
   * Merges persisted configuration with live No. Series definitions.
   */
  async getSetup(tenantId: string, companyId: string) {
    if (!companyId) {
      throw new BadRequestException('Company ID is required to retrieve Inventory Setup.');
    }

    // 1. Fetch existing inventory_setup record for this company
    const setupRows = await this.db
      .select()
      .from(schema.inventorySetup)
      .where(and(
        eq(schema.inventorySetup.tenant_id, tenantId),
        eq(schema.inventorySetup.company_id, companyId),
      ))
      .limit(1);

    const setupRecord = setupRows[0] || null;
    const rawNumbering = (setupRecord?.numbering_config as Record<string, { enabled?: boolean; default_series_id?: string | null }>) || {};

    // 2. Fetch all No. Series available to this company (company-specific or tenant-wide fallback)
    const seriesRows = await this.db
      .select()
      .from(schema.noSeries)
      .where(and(
        eq(schema.noSeries.tenant_id, tenantId),
        or(
          eq(schema.noSeries.company_id, companyId),
          sql`${schema.noSeries.company_id} IS NULL`,
        ),
      ))
      .orderBy(schema.noSeries.document_type, schema.noSeries.code);

    // Group series by document_type
    const seriesByMaster: Record<string, Array<typeof schema.noSeries.$inferSelect>> = {};
    for (const s of seriesRows) {
      const type = (s.document_type || 'OTHER').toUpperCase();
      if (!seriesByMaster[type]) seriesByMaster[type] = [];
      seriesByMaster[type].push(s);
    }

    // 3. Build unified configuration map for all available masters
    const numberingConfig: Record<string, {
      enabled: boolean;
      default_series_id: string | null;
      series_count: number;
    }> = {};

    for (const master of INVENTORY_MASTER_TYPES) {
      const key = master.key;
      const seriesList = seriesByMaster[key] || [];
      const saved = rawNumbering[key];

      let enabled: boolean;
      let defaultSeriesId: string | null = null;

      if (saved !== undefined) {
        enabled = saved.enabled !== false;
        defaultSeriesId = saved.default_series_id ?? null;
      } else {
        // Defaults: if any series exists for this master, enable by default
        enabled = seriesList.length > 0;
        const defaultSeries = seriesList.find((s) => s.is_default) || seriesList[0];
        defaultSeriesId = defaultSeries ? defaultSeries.id : null;
      }

      // Verify that defaultSeriesId is actually in the seriesList, if not, find the series marked is_default
      if (defaultSeriesId && !seriesList.some((s) => s.id === defaultSeriesId)) {
        const fallback = seriesList.find((s) => s.is_default) || seriesList[0];
        defaultSeriesId = fallback ? fallback.id : null;
      }

      numberingConfig[key] = {
        enabled,
        default_series_id: defaultSeriesId,
        series_count: seriesList.length,
      };
    }

    const defaultGeneralConfig = {
      automatic_cost_posting: true,
      expected_cost_posting: false,
      default_costing_method: 'FIFO',
      prevent_negative_inventory: true,
      location_mandatory: false,
      default_feed_uom: 'KG',
      inventory_period_lock: false,
      quarantine_on_receipt: false,
      batch_mandatory_on_feed: true,
      batch_mandatory_on_med: true,
      batch_mandatory_on_bio: true,
      direct_transfer_allowed: true,
    };
    const generalConfig = {
      ...defaultGeneralConfig,
      ...((setupRecord?.general_config as Record<string, any>) || {}),
    };

    return {
      company_id: companyId,
      setup_id: setupRecord?.id || null,
      numbering_config: numberingConfig,
      general_config: generalConfig,
      series_by_master: seriesByMaster,
      available_masters: INVENTORY_MASTER_TYPES,
      updated_at: setupRecord?.updated_at || null,
    };
  }

  /**
   * Saves or updates the inventory setup for a company and synchronizes the
   * `is_default` flag on `no_series` records accordingly.
   */
  async updateSetup(tenantId: string, companyId: string, dto: UpdateInventorySetupDto) {
    const targetCompanyId = dto.company_id || companyId;
    if (!targetCompanyId) {
      throw new BadRequestException('Company ID is required to update Inventory Setup.');
    }

    const numberingConfig = dto.numbering_config;
    const generalConfig = dto.general_config;

    // 1. Check if an inventory_setup record exists for this company
    const existing = await this.db
      .select()
      .from(schema.inventorySetup)
      .where(and(
        eq(schema.inventorySetup.tenant_id, tenantId),
        eq(schema.inventorySetup.company_id, targetCompanyId),
      ))
      .limit(1);

    const now = toMysqlTimestamp();

    if (existing[0]) {
      const updates: any = { updated_at: now };
      if (numberingConfig !== undefined) updates.numbering_config = numberingConfig;
      if (generalConfig !== undefined) updates.general_config = generalConfig;

      await this.db
        .update(schema.inventorySetup)
        .set(updates)
        .where(eq(schema.inventorySetup.id, existing[0].id));
    } else {
      await this.db.insert(schema.inventorySetup).values({
        id: randomUUID(),
        tenant_id: tenantId,
        company_id: targetCompanyId,
        numbering_config: numberingConfig || {},
        general_config: generalConfig || null,
        created_at: now as any,
        updated_at: now as any,
      });
    }

    // 2. Synchronize is_default flag on no_series for each configured master type
    if (numberingConfig) {
      for (const [masterType, cfg] of Object.entries(numberingConfig)) {
      if (cfg.default_series_id) {
        // Unset old default for this master type
        await this.db
          .update(schema.noSeries)
          .set({ is_default: false, updated_at: now as any })
          .where(and(
            eq(schema.noSeries.tenant_id, tenantId),
            eq(schema.noSeries.document_type, masterType),
            or(
              eq(schema.noSeries.company_id, targetCompanyId),
              sql`${schema.noSeries.company_id} IS NULL`,
            ),
          ));

        // Set new default
        await this.db
          .update(schema.noSeries)
          .set({ is_default: true, updated_at: now as any })
          .where(eq(schema.noSeries.id, cfg.default_series_id));
      }
    }
  }

    return this.getSetup(tenantId, targetCompanyId);
  }

  /**
   * Internal lookup to resolve whether number series is applied and which series to use.
   */
  async resolveNumberSeriesForMaster(masterType: string, tenantId: string, companyId?: string | null) {
    const norm = masterType.toUpperCase().replaceAll('-', '_');
    if (companyId) {
      const [setup] = await this.db
        .select()
        .from(schema.inventorySetup)
        .where(and(
          eq(schema.inventorySetup.tenant_id, tenantId),
          eq(schema.inventorySetup.company_id, companyId),
        ))
        .limit(1);

      if (setup?.numbering_config) {
        const configMap = setup.numbering_config as Record<string, { enabled?: boolean; default_series_id?: string | null }>;
        const cfg = configMap[norm];
        if (cfg) {
          if (cfg.enabled === false) {
            return { enabled: false, series: null };
          }
          if (cfg.default_series_id) {
            const [series] = await this.db
              .select()
              .from(schema.noSeries)
              .where(eq(schema.noSeries.id, cfg.default_series_id))
              .limit(1);
            if (series && !series.blocked) {
              return { enabled: true, series };
            }
          }
        }
      }
    }

    // Default fallback: look for is_default series
    const conditions = [
      eq(schema.noSeries.tenant_id, tenantId),
      eq(schema.noSeries.document_type, norm),
      eq(schema.noSeries.blocked, false),
    ];
    if (companyId) {
      conditions.push(or(
        eq(schema.noSeries.company_id, companyId),
        sql`${schema.noSeries.company_id} IS NULL`,
      )!);
    }

    const rows = await this.db
      .select()
      .from(schema.noSeries)
      .where(and(...conditions))
      .orderBy(sql`${schema.noSeries.is_default} DESC, ${schema.noSeries.created_at} ASC`);

    return { enabled: rows.length > 0, series: rows[0] || null };
  }
}
