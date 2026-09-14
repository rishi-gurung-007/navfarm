import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, isNull, desc, like, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { QueryCurrencyDto, CreateExchangeRateDto, UpdateExchangeRateRowDto } from './dto/currency.dto';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

@Injectable()
export class CurrencyService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /** The USD row every rate is quoted against. */
  private async usdCurrencyId(): Promise<string> {
    const [usd] = await this.db
      .select({ id: schema.currencyMaster.currency_id })
      .from(schema.currencyMaster)
      .where(eq(schema.currencyMaster.iso_code, 'USD'))
      .limit(1);
    if (!usd) throw new NotFoundException('No USD currency row — run db-sync-currency-master.');
    return usd.id;
  }

  /**
   * Was unfiltered and active-only: it returned every row and ignored the
   * search box, and a currency someone deactivated could never be found again
   * to reactivate. The master-data list shows both states behind its toggle,
   * so is_active is now filtered only when the caller asks for it — which the
   * lookup pickers do, with isActive=true.
   */
  async listCurrencies(query: QueryCurrencyDto = {}) {
    const conditions: any[] = [];
    conditions.push(...listFilterConditions(schema.currencyMaster, query.filter));
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.currencyMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.currencyMaster.iso_code, `%${query.search}%`),
          like(schema.currencyMaster.currency_name, `%${query.search}%`),
        ),
      );
    }
    return this.db
      .select()
      .from(schema.currencyMaster)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(listOrderBy(schema.currencyMaster, query, schema.currencyMaster.iso_code))
      .limit(query.limit || 50)
      .offset(query.offset || 0);
  }

  /**
   * Newest first, and scoped to the company asking. A rate with no company is a
   * legacy tenant-wide row and stays visible to everyone, so nothing recorded
   * before scoping existed disappears.
   *
   * Only the from-currency was joined before, so a row read "26.5 USD" without
   * saying what it converted to. Both sides are named now.
   */
  async listExchangeRates(companyId?: string | null) {
    const to = alias(schema.currencyMaster, 'to_currency');
    const conditions = companyId
      ? [or(eq(schema.exchangeRate.company_id, companyId), isNull(schema.exchangeRate.company_id))!]
      : [];
    return this.db
      .select({
        rate_id: schema.exchangeRate.rate_id,
        rate: schema.exchangeRate.rate,
        rate_date: schema.exchangeRate.rate_date,
        rate_source: schema.exchangeRate.rate_source,
        company_id: schema.exchangeRate.company_id,
        from_currency_id: schema.exchangeRate.from_currency_id,
        to_currency_id: schema.exchangeRate.to_currency_id,
        from_currency: schema.currencyMaster.iso_code,
        to_currency: to.iso_code,
      })
      .from(schema.exchangeRate)
      .innerJoin(schema.currencyMaster, eq(schema.exchangeRate.from_currency_id, schema.currencyMaster.currency_id))
      .innerJoin(to, eq(schema.exchangeRate.to_currency_id, to.currency_id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.exchangeRate.rate_date));
  }

  async updateExchangeRate(fromCurrencyId: string, toCurrencyId: string, rate: number, source?: string, rateDate?: string, companyId?: string | null) {
    const rateId = randomUUID();
    await this.db
      .insert(schema.exchangeRate)
      .values({
        rate_id: rateId,
        company_id: companyId || null,
        from_currency_id: fromCurrencyId,
        to_currency_id: toCurrencyId,
        rate: rate.toString(),
        // A dated row, not an overwrite: restating a past period needs the rate
        // as at that date, so each entry is kept rather than replacing the last.
        rate_date: rateDate || new Date().toISOString().split('T')[0],
        rate_source: source || 'MANUAL',
      });
    
    const [newRate] = await this.db
      .select()
      .from(schema.exchangeRate)
      .where(eq(schema.exchangeRate.rate_id, rateId))
      .limit(1);
    return newRate;
  }

  async createCurrency(data: any) {
    const currencyId = data.currency_id || randomUUID();
    const iso_code = String(data.iso_code || '').toUpperCase();
    // iso_code is UNIQUE, so without this the screen surfaced a raw
    // ER_DUP_ENTRY as a 500 instead of saying which code was taken.
    const [clash] = await this.db
      .select({ id: schema.currencyMaster.currency_id })
      .from(schema.currencyMaster)
      .where(eq(schema.currencyMaster.iso_code, iso_code))
      .limit(1);
    if (clash) throw new ConflictException(`Currency '${iso_code}' already exists.`);
    await this.db.insert(schema.currencyMaster).values({
      ...data,
      iso_code,
      currency_id: currencyId,
    });
    const [newCurr] = await this.db
      .select()
      .from(schema.currencyMaster)
      .where(eq(schema.currencyMaster.currency_id, currencyId))
      .limit(1);
    return newCurr;
  }

  async updateCurrency(id: string, data: any) {
    const updates = { ...data };
    if (updates.iso_code !== undefined) {
      updates.iso_code = String(updates.iso_code).toUpperCase();
      const [clash] = await this.db
        .select({ id: schema.currencyMaster.currency_id })
        .from(schema.currencyMaster)
        .where(and(
          eq(schema.currencyMaster.iso_code, updates.iso_code),
          ne(schema.currencyMaster.currency_id, id),
        ))
        .limit(1);
      if (clash) throw new ConflictException(`Currency '${updates.iso_code}' already exists.`);
    }
    await this.db
      .update(schema.currencyMaster)
      .set(updates)
      .where(eq(schema.currencyMaster.currency_id, id));
    
    const [updatedCurr] = await this.db
      .select()
      .from(schema.currencyMaster)
      .where(eq(schema.currencyMaster.currency_id, id))
      .limit(1);
    return updatedCurr;
  }

  /**
   * Deactivates rather than destroys.
   *
   * exchange_rate cascades on delete, so removing a currency silently took its
   * whole rate history with it — and company_currency_config restricts, so the
   * same call raised a raw FK error for any currency a company had configured.
   * A retired currency has to stay readable because past transactions and rates
   * still point at it. is_active = false is the retirement; the master-data
   * screen's restore toggle turns it back on.
   */
  async deleteCurrency(id: string) {
    const [existing] = await this.db
      .select()
      .from(schema.currencyMaster)
      .where(eq(schema.currencyMaster.currency_id, id))
      .limit(1);
    if (!existing) throw new NotFoundException(`Currency '${id}' not found.`);

    await this.db
      .update(schema.currencyMaster)
      .set({ is_active: false })
      .where(eq(schema.currencyMaster.currency_id, id));

    return { ...existing, is_active: false };
  }

  /** The other half of deleteCurrency's deactivate — the list's Active toggle. */
  async restoreCurrency(id: string) {
    const [existing] = await this.db
      .select()
      .from(schema.currencyMaster)
      .where(eq(schema.currencyMaster.currency_id, id))
      .limit(1);
    if (!existing) throw new NotFoundException(`Currency '${id}' not found.`);

    await this.db
      .update(schema.currencyMaster)
      .set({ is_active: true })
      .where(eq(schema.currencyMaster.currency_id, id));

    return { ...existing, is_active: true };
  }

  /**
   * Exchange-rate CRUD for the Currencies screen's Exchange Rates tab.
   *
   * The pre-existing POST /currency/rate stays as it was for its own callers;
   * these are the list/create/update/delete a master-data tab needs, which it
   * did not have. Rates are anchored to USD and read "1 USD = <rate>", so
   * from_currency_id defaults to the USD row (Rishi, 2026-09-11).
   */
  async createRate(dto: CreateExchangeRateDto, companyId?: string | null) {
    const rateId = randomUUID();
    const from = dto.from_currency_id || (await this.usdCurrencyId());
    if (from === dto.to_currency_id) {
      throw new ConflictException('A currency cannot have an exchange rate against itself.');
    }
    await this.db.insert(schema.exchangeRate).values({
      rate_id: rateId,
      company_id: companyId || null,
      from_currency_id: from,
      to_currency_id: dto.to_currency_id,
      rate: String(dto.rate),
      rate_date: dto.rate_date || new Date().toISOString().split('T')[0],
      rate_source: dto.rate_source || 'MANUAL',
    });
    const [created] = await this.db
      .select()
      .from(schema.exchangeRate)
      .where(eq(schema.exchangeRate.rate_id, rateId))
      .limit(1);
    return created;
  }

  async updateRate(id: string, dto: UpdateExchangeRateRowDto) {
    const [existing] = await this.db
      .select()
      .from(schema.exchangeRate)
      .where(eq(schema.exchangeRate.rate_id, id))
      .limit(1);
    if (!existing) throw new NotFoundException(`Exchange rate '${id}' not found.`);

    const updates: Record<string, unknown> = {};
    if (dto.to_currency_id !== undefined) updates.to_currency_id = dto.to_currency_id;
    if (dto.from_currency_id !== undefined) updates.from_currency_id = dto.from_currency_id;
    if (dto.rate !== undefined) updates.rate = String(dto.rate);
    if (dto.rate_date !== undefined) updates.rate_date = dto.rate_date;
    if (dto.rate_source !== undefined) updates.rate_source = dto.rate_source;

    const from = (updates.from_currency_id as string) ?? existing.from_currency_id;
    const to = (updates.to_currency_id as string) ?? existing.to_currency_id;
    if (from === to) {
      throw new ConflictException('A currency cannot have an exchange rate against itself.');
    }

    if (Object.keys(updates).length) {
      await this.db
        .update(schema.exchangeRate)
        .set(updates)
        .where(eq(schema.exchangeRate.rate_id, id));
    }
    const [updated] = await this.db
      .select()
      .from(schema.exchangeRate)
      .where(eq(schema.exchangeRate.rate_id, id))
      .limit(1);
    return updated;
  }

  /**
   * A hard delete, unlike a currency: a rate row is a dated observation, not
   * something other tables reference, so a mistyped one is removed outright.
   */
  async deleteRate(id: string) {
    const [existing] = await this.db
      .select()
      .from(schema.exchangeRate)
      .where(eq(schema.exchangeRate.rate_id, id))
      .limit(1);
    if (!existing) throw new NotFoundException(`Exchange rate '${id}' not found.`);
    await this.db.delete(schema.exchangeRate).where(eq(schema.exchangeRate.rate_id, id));
    return existing;
  }
}
