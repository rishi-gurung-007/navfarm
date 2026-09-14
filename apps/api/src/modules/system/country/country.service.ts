import { Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';
import { QueryCountryDto } from './dto/country.dto';

@Injectable()
export class CountryService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * The same list contract every other master answers: sort, filter[column],
   * limit/offset and a total. It used to return every active country with no
   * query at all, which is fine for filling a picker and useless as a screen.
   *
   * `isActive` is no longer forced on. A master list shows blocked rows so they
   * can be found and restored; the pickers that consume this pass
   * `isActive=true` themselves, as they already do everywhere else.
   */
  async listCountries(query: QueryCountryDto = {}) {
    const conditions: SQL[] = [];
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.countryMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(or(
        like(schema.countryMaster.iso2, `%${query.search}%`),
        like(schema.countryMaster.country_name, `%${query.search}%`),
      )!);
    }
    conditions.push(...listFilterConditions(schema.countryMaster, query.filter));
    return runMasterList(this.db, schema.countryMaster, conditions, query, schema.countryMaster.iso2);
  }

  async createCountry(data: any) {
    const countryId = data.country_id || randomUUID();
    await this.db.insert(schema.countryMaster).values({ ...data, country_id: countryId });
    const [newCountry] = await this.db.select().from(schema.countryMaster).where(eq(schema.countryMaster.country_id, countryId)).limit(1);
    return newCountry;
  }

  async updateCountry(id: string, data: any) {
    await this.db.update(schema.countryMaster).set(data).where(eq(schema.countryMaster.country_id, id));
    const [updated] = await this.db.select().from(schema.countryMaster).where(eq(schema.countryMaster.country_id, id)).limit(1);
    return updated;
  }

  async deleteCountry(id: string) {
    const [deleted] = await this.db.select().from(schema.countryMaster).where(eq(schema.countryMaster.country_id, id)).limit(1);
    await this.db.delete(schema.countryMaster).where(eq(schema.countryMaster.country_id, id));
    return deleted;
  }

  private async assertCountryExists(countryId: string) {
    const [country] = await this.db.select().from(schema.countryMaster).where(eq(schema.countryMaster.country_id, countryId)).limit(1);
    if (!country) {
      throw new NotFoundException(`Country with ID '${countryId}' not found.`);
    }
  }

  async listStates(countryId: string) {
    await this.assertCountryExists(countryId);
    return this.db
      .select()
      .from(schema.stateProvince)
      .where(and(eq(schema.stateProvince.country_id, countryId), eq(schema.stateProvince.is_active, true)));
  }

  async createState(countryId: string, data: any) {
    await this.assertCountryExists(countryId);
    const stateId = randomUUID();
    await this.db.insert(schema.stateProvince).values({ ...data, state_id: stateId, country_id: countryId });
    const [newState] = await this.db.select().from(schema.stateProvince).where(eq(schema.stateProvince.state_id, stateId)).limit(1);
    return newState;
  }

  async updateState(stateId: string, data: any) {
    await this.db.update(schema.stateProvince).set(data).where(eq(schema.stateProvince.state_id, stateId));
    const [updated] = await this.db.select().from(schema.stateProvince).where(eq(schema.stateProvince.state_id, stateId)).limit(1);
    return updated;
  }

  async deleteState(stateId: string) {
    const [deleted] = await this.db.select().from(schema.stateProvince).where(eq(schema.stateProvince.state_id, stateId)).limit(1);
    await this.db.delete(schema.stateProvince).where(eq(schema.stateProvince.state_id, stateId));
    return deleted;
  }
}
