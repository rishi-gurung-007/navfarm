import { withTenantTransaction } from '../../../common/tenant-transaction';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq } from 'drizzle-orm';
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
    );
    await this.batchService.activate(created.batch_id, tenantId, userPayload);
    return { batch_id: created.batch_id, batch_no: created.batch_no, lot_no: lotNo };
  }
}
