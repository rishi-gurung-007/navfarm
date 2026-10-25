import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { alias } from 'drizzle-orm/mysql-core';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { farmScope } from '../../../common/farm-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { CreateMillOutputDto, QueryMillOutputDto } from './dto/mill-output.dto';

/**
 * Mill Production Output (Rishi, 20 Oct; spec 2026-10-03 §4.2 step 1, R5). The mill records the feed it produced into
 * a loading BIN: the BIN's diet assignment for the production date names the BIN and the feed item, the mill enters the
 * KG. Posting puts the KG into the BIN's stock through the shared inventory ledger at the item's standard cost and
 * journals it through the MILL_OUTPUT GL mapping (refused, with nothing written, until finance sets that mapping up).
 * No raw-material consumption. A BIN is company stock under a MILL, not a farm's.
 */
@Injectable()
export class MillOutputService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly glPostingService: GlPostingService,
    private readonly numberSeriesService: NumberSeriesService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb)
      throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /**
   * The company the mill work is for: the workspace's (a farm-bound login acts for its farm's company, as on the
   * consolidation and loading screens — the MILL_OUTPUT grant is what lets someone post), else the one asked for.
   */
  private companyOf(requested?: string): string {
    const scope = farmScope(this.cls);
    if (scope.companyId && requested && requested !== scope.companyId) {
      throw new ForbiddenException('The company must match the workspace.');
    }
    const companyId = scope.companyId || requested;
    if (!companyId)
      throw new BadRequestException('Select a company workspace first.');
    return companyId;
  }

  /** The BIN diet assignments of a production date — what the mill may produce into that day. */
  async listAssignments(tenantId: string, query: QueryMillOutputDto) {
    const companyId = this.companyOf(query.companyId);
    if (!query.productionDate)
      throw new BadRequestException('Choose the production date.');
    const A = schema.binDietAssignment;
    const bin = alias(
      schema.locationMaster,
      'bin',
    ) as unknown as typeof schema.locationMaster;
    const mill = alias(
      schema.locationMaster,
      'mill',
    ) as unknown as typeof schema.locationMaster;
    const I = schema.itemMaster;
    return this.db
      .select({
        assignment_id: A.assignment_id,
        production_date: A.production_date,
        diet_priority: A.diet_priority,
        bin_location_id: bin.location_id,
        bin_code: bin.location_code,
        bin_name: bin.location_name,
        mill_location_id: mill.location_id,
        mill_code: mill.location_code,
        mill_name: mill.location_name,
        item_id: I.item_id,
        item_code: I.item_code,
        item_name: I.item_name,
        diet_no: I.diet_no,
        uom: I.uom_primary,
        standard_cost: I.standard_cost,
        is_lot_tracked: I.is_lot_tracked,
        tracking_series_id: I.tracking_series_id,
        bin_balance_kg: sql<string>`(SELECT COALESCE(SUM(l.remaining_quantity), 0) FROM inventory_ledger l
          WHERE l.warehouse_id = ${bin.location_id} AND l.item_id = ${I.item_id} AND l.entry_type = 'POSITIVE')`,
      })
      .from(A)
      .innerJoin(bin, eq(bin.location_id, A.bin_location_id))
      .leftJoin(mill, eq(mill.location_id, bin.parent_location_id))
      .innerJoin(I, eq(I.item_id, A.feed_item_id))
      .where(
        and(
          eq(A.tenant_id, tenantId),
          eq(A.company_id, companyId),
          eq(A.production_date, query.productionDate),
          eq(A.is_active, true),
          eq(A.status, 'ACTIVE'),
          isNull(A.deleted_at),
        ),
      )
      .orderBy(A.diet_priority, bin.location_code);
  }

  async list(tenantId: string, query: QueryMillOutputDto) {
    const companyId = this.companyOf(query.companyId);
    const O = schema.millProductionOutput;
    const bin = alias(
      schema.locationMaster,
      'bin',
    ) as unknown as typeof schema.locationMaster;
    const mill = alias(
      schema.locationMaster,
      'mill',
    ) as unknown as typeof schema.locationMaster;
    const conditions = [eq(O.tenant_id, tenantId), eq(O.company_id, companyId)];
    if (query.productionDate)
      conditions.push(eq(O.production_date, query.productionDate));
    return this.db
      .select({
        output_id: O.output_id,
        output_no: O.output_no,
        production_date: O.production_date,
        bin_code: bin.location_code,
        bin_name: bin.location_name,
        mill_code: mill.location_code,
        mill_name: mill.location_name,
        item_code: schema.itemMaster.item_code,
        item_name: schema.itemMaster.item_name,
        diet_no: schema.itemMaster.diet_no,
        quantity_kg: O.quantity_kg,
        rate: O.rate,
        amount: O.amount,
        lot_no: O.lot_no,
        remarks: O.remarks,
        journal_no: schema.journalHeader.journal_no,
        status: O.status,
        created_by_name: schema.userMaster.full_name,
        created_at: O.created_at,
      })
      .from(O)
      .innerJoin(bin, eq(bin.location_id, O.bin_location_id))
      .innerJoin(mill, eq(mill.location_id, O.mill_location_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, O.item_id))
      .leftJoin(
        schema.journalHeader,
        eq(schema.journalHeader.journal_id, O.journal_id),
      )
      .leftJoin(schema.userMaster, eq(schema.userMaster.user_id, O.created_by))
      .where(and(...conditions))
      .orderBy(desc(O.created_at), desc(O.output_no))
      .limit(200);
  }

  async create(
    dto: CreateMillOutputDto,
    tenantId: string,
    user?: { userId?: string },
  ) {
    const companyId = this.companyOf(dto.company_id);

    const [assignment] = await this.db
      .select()
      .from(schema.binDietAssignment)
      .where(
        and(
          eq(schema.binDietAssignment.assignment_id, dto.assignment_id),
          eq(schema.binDietAssignment.tenant_id, tenantId),
        ),
      )
      .limit(1);
    if (!assignment || assignment.company_id !== companyId)
      throw new NotFoundException('BIN diet assignment not found.');
    if (
      !assignment.is_active ||
      assignment.status !== 'ACTIVE' ||
      assignment.deleted_at
    ) {
      throw new BadRequestException('That BIN diet assignment is not active.');
    }
    if (
      String(assignment.production_date).slice(0, 10) !== dto.production_date
    ) {
      throw new BadRequestException(
        `That BIN is assigned for ${String(assignment.production_date).slice(0, 10)}, not ${dto.production_date}.`,
      );
    }

    const [bin] = await this.db
      .select()
      .from(schema.locationMaster)
      .where(eq(schema.locationMaster.location_id, assignment.bin_location_id))
      .limit(1);
    const active = (l?: typeof schema.locationMaster.$inferSelect) =>
      Boolean(l && l.is_active && !l.deleted_at);
    if (
      !bin ||
      bin.location_type !== 'BIN' ||
      !active(bin) ||
      bin.company_id !== companyId
    ) {
      throw new BadRequestException(
        "The assignment's BIN is not an active BIN of this company.",
      );
    }
    const [mill] = bin.parent_location_id
      ? await this.db
          .select()
          .from(schema.locationMaster)
          .where(eq(schema.locationMaster.location_id, bin.parent_location_id))
          .limit(1)
      : [];
    if (!mill || mill.location_type !== 'MILL' || !active(mill)) {
      throw new BadRequestException(
        `BIN ${bin.location_code} has no active MILL above it.`,
      );
    }

    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(eq(schema.itemMaster.item_id, assignment.feed_item_id))
      .limit(1);
    if (!item || item.is_active === false || item.is_blocked)
      throw new BadRequestException('The assigned feed item is not active.');
    if (item.is_serial_tracked)
      throw new BadRequestException(
        `${item.item_code} — ${item.item_name} is serial-tracked; mill output is recorded in KG.`,
      );
    if ((item.uom_primary || '').toUpperCase() !== 'KG') {
      throw new BadRequestException(
        `${item.item_code} — ${item.item_name} is kept in ${item.uom_primary}, not KG.`,
      );
    }
    const rate = Number(item.standard_cost ?? 0);
    if (!(rate > 0)) {
      throw new BadRequestException(
        `${item.item_code} — ${item.item_name} has no standard cost. Set it on the item before posting mill output.`,
      );
    }

    let lotNo = dto.lot_no?.trim() || null;
    if (item.is_lot_tracked && !lotNo) {
      if (!item.tracking_series_id)
        throw new BadRequestException(
          `${item.item_code} is lot-tracked — enter a lot number.`,
        );
      lotNo = (
        await this.numberSeriesService.generateNextNumberById(
          item.tracking_series_id,
          tenantId,
        )
      ).next_number;
    }

    const quantity = Number(dto.quantity_kg);
    const amount = Math.round(quantity * rate * 10000) / 10000;

    const outputId = randomUUID();
    const created = await withTenantTransaction(this.cls, async () => {
      const [row] = await this.db
        .select({
          maxSeq: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${schema.millProductionOutput.output_no}, 5) AS UNSIGNED)), 0)`,
        })
        .from(schema.millProductionOutput)
        .where(
          and(
            eq(schema.millProductionOutput.tenant_id, tenantId),
            eq(schema.millProductionOutput.company_id, companyId),
          ),
        )
        .for('update');
      const outputNo = `MPO-${String(Number(row?.maxSeq || 0) + 1).padStart(6, '0')}`;

      await this.db.insert(schema.millProductionOutput).values({
        output_id: outputId,
        tenant_id: tenantId,
        company_id: companyId,
        output_no: outputNo,
        production_date: dto.production_date,
        mill_location_id: mill.location_id,
        bin_location_id: bin.location_id,
        assignment_id: assignment.assignment_id,
        item_id: item.item_id,
        quantity_kg: quantity.toString(),
        rate: rate.toString(),
        amount: amount.toString(),
        lot_no: lotNo,
        remarks: dto.remarks?.trim() || null,
        status: 'POSTED',
        created_by: user?.userId || null,
      });

      const ledgerEntry = await this.ledgerService.writePositiveEntry({
        tenantId,
        companyId,
        itemId: item.item_id,
        documentType: 'MILL_PRODUCTION_OUTPUT',
        documentNo: outputNo,
        documentLineId: outputId,
        postingDate: dto.production_date,
        transactionType: 'MILL_OUTPUT',
        quantity,
        uom: 'KG',
        rate,
        amount,
        lotNo: lotNo || undefined,
        warehouseId: bin.location_id,
        userId: user?.userId,
      });
      // Throws when the company has no MILL_OUTPUT GL mapping — the whole posting is then rolled back.
      const journal: any = await this.glPostingService.postInventoryLedgerEntry(
        ledgerEntry,
        user?.userId,
      );

      await this.db
        .update(schema.millProductionOutput)
        .set({
          ledger_id: ledgerEntry.ledger_id,
          journal_id: journal?.journal_id ?? null,
        })
        .where(eq(schema.millProductionOutput.output_id, outputId));

      await this.auditService.log({
        tenantId,
        companyId,
        userId: user?.userId,
        action: 'POST',
        entityName: 'mill_production_output',
        entityId: outputId,
        newValues: {
          output_no: outputNo,
          production_date: dto.production_date,
          bin_code: bin.location_code,
          item_code: item.item_code,
          quantity_kg: quantity,
          rate,
          amount,
          lot_no: lotNo,
        },
      });
      return outputNo;
    });

    const [out] = (await this.list(tenantId, { companyId })).filter(
      (o) => o.output_no === created,
    );
    return out;
  }
}
