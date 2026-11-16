import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { farmOfLocation } from '../../../common/farm-scope';
import { BreedingLineSetupService } from './breeding-line-setup.service';
import { destinationVerdict, Restriction } from '../../piggery/breeding/semen-lot-label.rules';

type Lot = typeof schema.semenBatch.$inferSelect;

export interface DestinationCheck {
  verdict: 'OK' | 'WARN' | 'BLOCK';
  message: string | null;
}

/**
 * Where a semen lot's doses may go (plan 2026-11-02-ai-station-semen-collection, Phase 5). The lot is for the destination its plan
 * named, else for the farms its line's setup lists; whether using or moving it anywhere else only warns or stops is the setup's
 * `restrict_to_destination`. Read when doses are issued to a mating and when a stock transfer names a lot.
 */
@Injectable()
export class SemenDestinationService {
  constructor(
    private readonly cls: ClsService,
    private readonly lineSetups: BreedingLineSetupService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /** The lot's breeding line: the one stored on it, else the line of the boar it was collected from (a lot older than Phase 5). */
  private async lineOf(lot: Lot): Promise<string | null> {
    if (lot.breed_id) return lot.breed_id;
    const [boar] = await this.db
      .select({ breed_id: schema.animalRegister.breed_id })
      .from(schema.animalRegister)
      .where(eq(schema.animalRegister.animal_id, lot.boar_animal_id))
      .limit(1);
    return boar?.breed_id ?? null;
  }

  async check(lot: Lot, targetFarmId: string | null, tenantId: string): Promise<DestinationCheck> {
    const ok: DestinationCheck = { verdict: 'OK', message: null };
    if (!targetFarmId) return ok;
    const setup = await this.lineSetups.findEffective(await this.lineOf(lot), tenantId, lot.company_id);
    if (!setup || setup.restrict_to_destination === 'NONE') return ok;
    const { verdict, allowed } = destinationVerdict({
      restriction: setup.restrict_to_destination as Restriction,
      lotDestination: lot.destination_farm_id,
      lineFarms: setup.destination_farm_ids ?? null,
      targetFarm: targetFarmId,
    });
    if (verdict === 'OK') return ok;
    const farms = await this.db
      .select({ id: schema.locationMaster.location_id, code: schema.locationMaster.location_code })
      .from(schema.locationMaster)
      .where(inArray(schema.locationMaster.location_id, [...allowed, targetFarmId]));
    const code = (id: string) => farms.find((f) => f.id === id)?.code ?? id;
    return {
      verdict,
      message: `Semen lot ${lot.lot_no ?? lot.semen_batch_id} is for ${allowed.map(code).join(', ')}; ${code(targetFarmId)} is not ${allowed.length === 1 ? 'its destination' : 'one of its destinations'}.`,
    };
  }

  /** A stop is thrown; a warning is returned for the caller to pass on. Lines whose lot number is no semen lot are not looked at. */
  async assertTransferAllowed(toLocationId: string, lotNos: (string | null | undefined)[], tenantId: string): Promise<string[]> {
    const wanted = [...new Set(lotNos.filter((n): n is string => !!n))];
    if (!wanted.length) return [];
    const lots = await this.db
      .select()
      .from(schema.semenBatch)
      .where(and(eq(schema.semenBatch.tenant_id, tenantId), inArray(schema.semenBatch.lot_no, wanted)));
    if (!lots.length) return [];
    const targetFarm = await farmOfLocation(this.db, toLocationId);
    const warnings: string[] = [];
    for (const lot of lots) {
      const { verdict, message } = await this.check(lot, targetFarm, tenantId);
      if (verdict === 'BLOCK') throw new BadRequestException(message!);
      if (verdict === 'WARN') warnings.push(message!);
    }
    return warnings;
  }
}
