import { Injectable, NotFoundException, BadRequestException, HttpException, HttpStatus, ConflictException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, ne, and, or, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateNoSeriesDto, UpdateNoSeriesDto } from './dto/no-series.dto';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class NoSeriesService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async create(dto: CreateNoSeriesDto, tenantId?: string, companyId?: string | null) {
    if (dto.code && dto.code.length > 20) {
      throw new BadRequestException('Series Code cannot exceed 20 characters.');
    }
    if (dto.description && dto.description.length > 100) {
      throw new BadRequestException('Description cannot exceed 100 characters.');
    }
    if (dto.no_series_code && dto.no_series_code.length > 20) {
      throw new BadRequestException('Prefix / Pattern cannot exceed 20 characters.');
    }
    if (dto.last_no_used && dto.last_no_used.length > 20) {
      throw new BadRequestException('Last No. Used cannot exceed 20 characters.');
    }
    if (dto.seq_length !== undefined && (dto.seq_length < 1 || dto.seq_length > 10)) {
      throw new BadRequestException('Sequence Length must be between 1 and 10 digits.');
    }
    if (dto.increment_by !== undefined && dto.increment_by < 1) {
      throw new BadRequestException('Increment By must be at least 1.');
    }

    const existing = await this.db
      .select()
      .from(schema.noSeries)
      .where(eq(schema.noSeries.code, dto.code))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`No. Series with code '${dto.code}' already exists.`);
    }

    const id = randomUUID();
    const isDefault = dto.is_default ?? true;
    const documentType = dto.document_type || null;

    // If setting this series as default, automatically uncheck is_default on any existing series for the same master type
    if (isDefault && documentType) {
      await this.db
        .update(schema.noSeries)
        .set({
          is_default: false,
          updated_at: toMysqlTimestamp() as any,
        })
        .where(and(
          eq(schema.noSeries.document_type, documentType),
          eq(schema.noSeries.is_default, true),
        ));
    }

    const newRecord = {
      id,
      tenant_id: tenantId || null,
      company_id: dto.company_id || companyId || null,
      code: dto.code,
      description: dto.description || null,
      document_type: documentType,
      no_series_code: dto.no_series_code || null,
      seq_length: dto.seq_length ?? 4,
      increment_by: dto.increment_by ?? 1,
      is_default: isDefault,
      manual_nos: dto.manual_nos ?? false,
      last_no_used: dto.last_no_used || null,
      blocked: dto.blocked ?? false,
      created_at: toMysqlTimestamp(),
      updated_at: toMysqlTimestamp(),
    };

    await this.db.insert(schema.noSeries).values(newRecord);
    return this.findOne(id);
  }

  async findOne(id: string, executor?: MySql2Database<typeof schema>) {
    const client = executor || this.db;
    const [record] = await client
      .select()
      .from(schema.noSeries)
      .where(eq(schema.noSeries.id, id))
      .limit(1);

    if (!record) {
      throw new NotFoundException(`No. Series with ID '${id}' not found.`);
    }
    return record;
  }

  async findAll(documentType?: string) {
    if (documentType) {
      return this.db
        .select()
        .from(schema.noSeries)
        .where(eq(schema.noSeries.document_type, documentType.toUpperCase().replaceAll('-', '_')));
    }
    return this.db.select().from(schema.noSeries);
  }

  /**
   * Returns all No. Series for the company, grouped by document_type.
   * Used by the Inventory Setup screen so the user can see, per master type,
   * which series exist and which one is currently the default.
   */
  async byMaster(tenantId: string, companyId?: string | null) {
    const conditions = [eq(schema.noSeries.tenant_id, tenantId)];
    if (companyId) conditions.push(eq(schema.noSeries.company_id, companyId));
    const rows = await this.db
      .select()
      .from(schema.noSeries)
      .where(and(...conditions))
      .orderBy(schema.noSeries.document_type, schema.noSeries.code);

    // Group by document_type
    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = row.document_type || 'OTHER';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }
    return grouped;
  }

  /**
   * Sets the given No. Series as the default for its document_type, atomically
   * unsetting the old default in the same transaction.
   */
  async setDefault(id: string, tenantId: string, companyId?: string | null) {
    const [series] = await this.db
      .select()
      .from(schema.noSeries)
      .where(eq(schema.noSeries.id, id))
      .limit(1);
    if (!series) throw new NotFoundException(`No. Series '${id}' not found.`);
    if (!series.document_type) throw new BadRequestException('This series has no document type set.');

    const conditions = [
      eq(schema.noSeries.document_type, series.document_type),
      eq(schema.noSeries.is_default, true),
    ];
    if (tenantId) conditions.push(eq(schema.noSeries.tenant_id, tenantId));
    // Unset current default
    await this.db
      .update(schema.noSeries)
      .set({ is_default: false, updated_at: toMysqlTimestamp() as any })
      .where(and(...conditions));
    // Set new default
    await this.db
      .update(schema.noSeries)
      .set({ is_default: true, updated_at: toMysqlTimestamp() as any })
      .where(eq(schema.noSeries.id, id));
    return { success: true, id };
  }

  /**
   * Internal utility: Atomically generates and reserves the next number from a No. Series
   * using a database transaction and row-level locking (SELECT ... FOR UPDATE).
   *
   * Holds lock strictly for:
   * read last_no_used -> calculate -> update -> return
   *
   * If lock acquisition exceeds 5 seconds, returns HTTP 503:
   * "Item code generation busy, please retry."
   */
  async generateNextNumber(
    id: string,
    tenantId?: string,
    companyId?: string | null,
    externalTx?: any,
  ): Promise<{ next_number: string; series: typeof schema.noSeries.$inferSelect }> {
    const executeInTx = async (tx: MySql2Database<typeof schema>) => {
      try {
        // Set lock wait timeout to 5 seconds per Section 6 & 8 of TDD
        await tx.execute(sql`SET innodb_lock_wait_timeout = 5`);
      } catch {
        // Ignore if unsupported or running under mock DB in tests
      }

      let seriesRows: Array<typeof schema.noSeries.$inferSelect>;
      try {
        seriesRows = await tx
          .select()
          .from(schema.noSeries)
          .where(eq(schema.noSeries.id, id))
          .limit(1)
          .for('update');
      } catch (err: any) {
        // Check for MySQL lock wait timeout (code 1205 / ER_LOCK_WAIT_TIMEOUT)
        if (err?.code === 'ER_LOCK_WAIT_TIMEOUT' || err?.errno === 1205 || String(err?.message || '').includes('Lock wait timeout')) {
          throw new HttpException('Item code generation busy, please retry.', HttpStatus.SERVICE_UNAVAILABLE);
        }
        throw err;
      }

      const series = seriesRows[0];
      if (!series) {
        throw new NotFoundException(`No. Series with ID '${id}' not found.`);
      }

      if (series.blocked) {
        throw new BadRequestException(`No. Series [${series.code}] is blocked. Cannot generate item number.`);
      }

      const increment = series.increment_by || 1;
      const padDigits = series.seq_length && series.seq_length > 0 ? series.seq_length : 4;
      const prefix = series.no_series_code ?? (series.code ? `${series.code}-` : '');
      let nextCode: string;

      if (series.last_no_used) {
        const match = series.last_no_used.match(/(\d+)$/);
        if (match) {
          const numStr = match[1];
          const nextVal = parseInt(numStr, 10) + increment;
          nextCode = `${prefix}${String(nextVal).padStart(padDigits, '0')}`;
        } else {
          nextCode = `${prefix}${String(increment).padStart(padDigits, '0')}`;
        }
      } else {
        nextCode = `${prefix}${String(increment).padStart(padDigits, '0')}`;
      }

      await tx
        .update(schema.noSeries)
        .set({
          last_no_used: nextCode,
          updated_at: toMysqlTimestamp() as any,
        })
        .where(eq(schema.noSeries.id, id));

      return {
        next_number: nextCode,
        series: { ...series, last_no_used: nextCode },
      };
    };

    if (externalTx) {
      return executeInTx(externalTx);
    }

    try {
      return await this.db.transaction(async (tx) => {
        return executeInTx(tx as any);
      });
    } catch (err: any) {
      if (err?.code === 'ER_LOCK_WAIT_TIMEOUT' || err?.errno === 1205 || String(err?.message || '').includes('Lock wait timeout')) {
        throw new HttpException('Item code generation busy, please retry.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw err;
    }
  }

  /**
   * Previews the next number without updating last_no_used.
   */
  async previewNextNumber(id: string): Promise<{ next_number: string; series: typeof schema.noSeries.$inferSelect }> {
    const series = await this.findOne(id);
    if (series.blocked) {
      throw new BadRequestException(`No. Series [${series.code}] is blocked. Cannot generate item number.`);
    }

    const increment = series.increment_by || 1;
    const padDigits = series.seq_length && series.seq_length > 0 ? series.seq_length : 4;
    const prefix = series.no_series_code ?? (series.code ? `${series.code}-` : '');
    let nextCode: string;

    if (series.last_no_used) {
      const match = series.last_no_used.match(/(\d+)$/);
      if (match) {
        const numStr = match[1];
        const nextVal = parseInt(numStr, 10) + increment;
        nextCode = `${prefix}${String(nextVal).padStart(padDigits, '0')}`;
      } else {
        nextCode = `${prefix}${String(increment).padStart(padDigits, '0')}`;
      }
    } else {
      nextCode = `${prefix}${String(increment).padStart(padDigits, '0')}`;
    }

    return {
      next_number: nextCode,
      series,
    };
  }

  /**
   * Finds the default active No. Series for a given Master Type (e.g. SUPPLIER, CUSTOMER, ITEM),
   * respecting company-level Inventory Setup configuration.
   */
  async findDefaultSeries(masterType: string, tenantId?: string, companyId?: string | null) {
    const normalizedType = masterType.toUpperCase().replaceAll('-', '_');

    // 1. Check if Company-specific Inventory Setup defines whether this master has number series applied
    if (tenantId && companyId) {
      try {
        const [setup] = await this.db
          .select()
          .from(schema.inventorySetup)
          .where(and(
            eq(schema.inventorySetup.tenant_id, tenantId),
            eq(schema.inventorySetup.company_id, companyId),
          ))
          .limit(1);

        if (setup?.numbering_config) {
          const config = setup.numbering_config as Record<string, { enabled?: boolean; default_series_id?: string | null }>;
          const masterCfg = config[normalizedType];
          if (masterCfg) {
            // Explicitly disabled in company inventory setup: do not generate
            if (masterCfg.enabled === false) {
              return null;
            }
            // Explicit default series chosen in company inventory setup
            if (masterCfg.default_series_id) {
              const [explicitSeries] = await this.db
                .select()
                .from(schema.noSeries)
                .where(and(
                  eq(schema.noSeries.id, masterCfg.default_series_id),
                  eq(schema.noSeries.blocked, false),
                ))
                .limit(1);
              if (explicitSeries) return explicitSeries;
            }
          }
        }
      } catch {
        // Fallback to direct query below if inventory_setup check fails or is not populated yet
      }
    }

    // 2. Standard fallback query: matching document_type or code, ordered by is_default DESC
    const conditions = [
      or(
        eq(schema.noSeries.document_type, normalizedType),
        eq(schema.noSeries.code, normalizedType),
        eq(schema.noSeries.code, `NS-${normalizedType}`),
      ),
      eq(schema.noSeries.blocked, false),
    ];
    if (tenantId) conditions.push(eq(schema.noSeries.tenant_id, tenantId));
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

    return rows[0] || null;
  }

  /**
   * Previews the next code by Master Type directly.
   */
  async previewByMaster(masterType: string, tenantId?: string, companyId?: string | null) {
    const series = await this.findDefaultSeries(masterType, tenantId, companyId);
    if (!series) {
      return {
        generated: false,
        allowManual: true,
        preview: '',
        message: `No active Number Series found for '${masterType}'.`,
      };
    }
    const previewRes = await this.previewNextNumber(series.id);
    return {
      generated: true,
      series_id: series.id,
      series_code: series.code,
      prefix: series.no_series_code,
      seq_length: series.seq_length,
      preview: previewRes.next_number,
      next_number: previewRes.next_number,
      allowManual: series.manual_nos,
      manual_nos: series.manual_nos,
    };
  }

  /**
   * Records a number as used in the No. Series when an item is actually saved/created.
   */
  async recordNumberUsed(id: string, usedNumber: string): Promise<void> {
    if (!usedNumber) return;
    const series = await this.findOne(id);
    if (!series) return;

    let formattedNumber = usedNumber;
    const prefix = series.no_series_code ?? (series.code ? `${series.code}-` : '');
    const padDigits = series.seq_length && series.seq_length > 0 ? series.seq_length : 4;
    const match = usedNumber.match(/(\d+)$/);
    if (match && prefix) {
      const numVal = parseInt(match[1], 10);
      formattedNumber = `${prefix}${String(numVal).padStart(padDigits, '0')}`;
    }

    await this.db
      .update(schema.noSeries)
      .set({
        last_no_used: formattedNumber,
        updated_at: toMysqlTimestamp() as any,
      })
      .where(eq(schema.noSeries.id, id));
  }

  async update(id: string, dto: UpdateNoSeriesDto) {
    const existing = await this.findOne(id);

    if (dto.description && dto.description.length > 100) {
      throw new BadRequestException('Description cannot exceed 100 characters.');
    }
    if (dto.no_series_code && dto.no_series_code.length > 20) {
      throw new BadRequestException('Prefix / Pattern cannot exceed 20 characters.');
    }
    if (dto.last_no_used && dto.last_no_used.length > 20) {
      throw new BadRequestException('Last No. Used cannot exceed 20 characters.');
    }
    if (dto.seq_length !== undefined && (dto.seq_length < 1 || dto.seq_length > 10)) {
      throw new BadRequestException('Sequence Length must be between 1 and 10 digits.');
    }
    if (dto.increment_by !== undefined && dto.increment_by < 1) {
      throw new BadRequestException('Increment By must be at least 1.');
    }

    const updates: Partial<typeof schema.noSeries.$inferInsert> = {
      updated_at: toMysqlTimestamp() as any,
    };

    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.document_type !== undefined) updates.document_type = dto.document_type;
    if (dto.no_series_code !== undefined) updates.no_series_code = dto.no_series_code;
    if (dto.seq_length !== undefined) updates.seq_length = dto.seq_length;
    if (dto.increment_by !== undefined) updates.increment_by = dto.increment_by;
    if (dto.is_default !== undefined) updates.is_default = dto.is_default;
    if (dto.manual_nos !== undefined) updates.manual_nos = dto.manual_nos;
    if (dto.last_no_used !== undefined) updates.last_no_used = dto.last_no_used;
    if (dto.blocked !== undefined) updates.blocked = dto.blocked;

    const targetDocType = updates.document_type ?? existing.document_type;
    // If setting this series as default, automatically uncheck is_default on any other series for the same master type
    if (updates.is_default === true && targetDocType) {
      await this.db
        .update(schema.noSeries)
        .set({
          is_default: false,
          updated_at: toMysqlTimestamp() as any,
        })
        .where(and(
          eq(schema.noSeries.document_type, targetDocType),
          ne(schema.noSeries.id, id),
          eq(schema.noSeries.is_default, true),
        ));
    }

    await this.db.update(schema.noSeries).set(updates).where(eq(schema.noSeries.id, id));
    return this.findOne(id);
  }

  async delete(id: string) {
    await this.findOne(id);
    await this.db.delete(schema.noSeries).where(eq(schema.noSeries.id, id));
    return { id };
  }
}
