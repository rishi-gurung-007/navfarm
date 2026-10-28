import { withTenantTransaction } from '../../../common/tenant-transaction';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, isNull, or } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { BatchService, UserContext } from './batch.service';
import { CreateBatchDto } from './dto/batch.dto';

export interface PigletLot {
  batch_id: string;
  batch_no: string;
  lot_no: string;
}

/**
 * The piglets of a litter, held as a lot of the piglet bio-asset item in a batch-wise batch (decision of 9 Oct). The
 * batch is the lot's home: it carries the head count, can be transferred to any stage or batch, and takes mortality
 * like any other batch-wise batch. Animals are not registered one by one.
 *
 * A birth has no value yet. A bio-asset batch records its input lines as an acquisition at their rate, which posts a
 * purchase journal; that would be wrong for a birth, so the rate is nil until the accounting for births is decided.
 */
@Injectable()
export class PigletLotService {
  constructor(
    private readonly cls: ClsService,
    private readonly batchService: BatchService,
    private readonly numberSeriesService: NumberSeriesService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async createLot(
    params: {
      sow: typeof schema.animalRegister.$inferSelect;
      farrowing_date: string;
      quantity: number;
      item_id: string;
      stage_id?: string | null;
    },
    tenantId: string,
    userPayload?: UserContext,
  ) : Promise<PigletLot> {
    // The number is drawn from the series inside this transaction, so a failure after it (a ledger or GL write, a bad
    // reference) rolls the counter back instead of burning the number. Joins the caller's transaction when one is open.
    return withTenantTransaction(this.cls, () => this.createLotRecord(params, tenantId, userPayload));
  }

  private async createLotRecord(
    params: {
      sow: typeof schema.animalRegister.$inferSelect;
      farrowing_date: string;
      quantity: number;
      item_id: string;
      stage_id?: string | null;
    },
    tenantId: string,
    userPayload?: UserContext,
  ) : Promise<PigletLot> {
    const { sow, quantity } = params;
    if (!(quantity > 0)) throw new BadRequestException('A piglet lot needs at least one piglet.');

    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_id, params.item_id), eq(schema.itemMaster.tenant_id, tenantId)))
      .limit(1);
    if (!item) throw new NotFoundException(`Piglet item '${params.item_id}' not found.`);
    if (!item.is_biological_asset) {
      throw new BadRequestException(
        `'${item.item_name}' is not a bio-asset item. Piglets are held as a lot of a bio-asset item.`,
      );
    }

    // They are born where the sow is: her batch's shed and farm, else her own pen.
    const [sowBatch] = sow.current_batch_id
      ? await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, sow.current_batch_id)).limit(1)
      : [];

    const lotNo = await this.numberSeriesService.generateNext('ITEM_LOT', tenantId, sow.company_id);
    const created = await this.batchService.create(
      {
        company_id: sow.company_id,
        lob_id: sow.lob_id,
        costing_method: 'BIO_ASSET',
        tracking_mode: 'BATCH_WISE',
        breed_id: sow.breed_id,
        // The stage the piglets start in: the one named, else the sow's own (they are suckling with her).
        stage_id: params.stage_id || sow.current_stage_id || undefined,
        shed_id: sowBatch?.shed_id || undefined,
        location_id: sowBatch?.location_id || sow.current_location_id || undefined,
        operational_area_id: sowBatch?.operational_area_id || sow.operational_area_id || undefined,
        start_date: params.farrowing_date,
        uom: item.uom_primary || 'HEAD',
        opening_quantity: quantity,
        input_lines: [{ item_id: item.item_id, quantity, uom: item.uom_primary || 'HEAD', rate: 0, lot_no: lotNo }],
        remarks: `Piglets of ${sow.animal_code}, farrowed ${params.farrowing_date}`,
      } as CreateBatchDto,
      tenantId,
      userPayload,
      { litterLot: true },
    );
    await this.batchService.activate(created.batch_id, tenantId, userPayload, { bornOnFarm: true });
    return { batch_id: created.batch_id, batch_no: created.batch_no, lot_no: lotNo };
  }

  /**
   * The weaner batch a weaning creates for the piglets it moves on. It copies the lot's item, company, line of business, breed, farm,
   * shed and operational area; the stage and pen come from the weaning form. It is created and activated EMPTY — the weaned head
   * arrive by the ordinary head-count transfer straight after, which moves their value with them — so nothing is counted twice.
   * A pen has to be one of the lot's own shed's pens, so the batch's shed and pen agree.
   */
  async createWeanerBatch(
    params: { lot_batch_id: string; stage_code: string; pen_id?: string | null; start_date: string; remarks?: string },
    tenantId: string,
    userPayload?: UserContext,
  ): Promise<{ batch_id: string; batch_no: string }> {
    return withTenantTransaction(this.cls, () => this.createWeanerBatchRecord(params, tenantId, userPayload));
  }

  private async createWeanerBatchRecord(
    params: { lot_batch_id: string; stage_code: string; pen_id?: string | null; start_date: string; remarks?: string },
    tenantId: string,
    userPayload?: UserContext,
  ): Promise<{ batch_id: string; batch_no: string }> {
    const lot = await this.batchService.findOne(params.lot_batch_id);
    const lotLine = lot.input_lines?.[0];
    if (!lotLine) throw new BadRequestException(`${lot.batch_no} has no input line, so there is no piglet item to copy to the new batch.`);

    // The company's own stage row, else the tenant template — never another company's.
    const candidates = await this.db
      .select({ stage_id: schema.stageMaster.stage_id, company_id: schema.stageMaster.company_id })
      .from(schema.stageMaster)
      .where(and(
        eq(schema.stageMaster.lob_id, lot.lob_id),
        eq(schema.stageMaster.stage_code, params.stage_code.toUpperCase()),
        eq(schema.stageMaster.is_active, true),
        isNull(schema.stageMaster.deleted_at),
        or(eq(schema.stageMaster.company_id, lot.company_id), isNull(schema.stageMaster.company_id)),
      ))
      .limit(5);
    const stage = candidates.find((c) => c.company_id === lot.company_id) ?? candidates.find((c) => (c.company_id ?? null) === null);
    if (!stage) throw new BadRequestException(`'${params.stage_code}' is not a stage of the line of business the piglet lot runs in.`);

    if (params.pen_id) {
      const [pen] = await this.db.select().from(schema.locationMaster).where(eq(schema.locationMaster.location_id, params.pen_id)).limit(1);
      if (!pen || pen.location_type !== 'PEN') throw new BadRequestException('Choose a pen for the new weaner batch.');
      const inLotShed = !lot.shed_id || pen.parent_location_id === lot.shed_id || pen.shed_id === lot.shed_id;
      if (!inLotShed) throw new BadRequestException(`That pen is not in ${lot.batch_no}'s shed. The new batch keeps the lot's shed, so choose one of its pens.`);
    }

    const uom = lotLine.uom || 'HEAD';
    const created = await this.batchService.create(
      {
        company_id: lot.company_id,
        lob_id: lot.lob_id,
        costing_method: 'BIO_ASSET',
        tracking_mode: 'BATCH_WISE',
        breed_id: lot.breed_id || undefined,
        stage_id: stage.stage_id,
        shed_id: lot.shed_id || undefined,
        location_id: params.pen_id || undefined,
        operational_area_id: lot.operational_area_id || undefined,
        start_date: params.start_date,
        uom,
        opening_quantity: 0,
        input_lines: [{ item_id: lotLine.item_id, quantity: 0, uom, rate: 0 }],
        remarks: params.remarks,
      } as CreateBatchDto,
      tenantId,
      userPayload,
      { opensEmpty: true },
    );
    await this.batchService.activate(created.batch_id, tenantId, userPayload);
    return { batch_id: created.batch_id, batch_no: created.batch_no };
  }
}
