import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { randomUUID } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { farmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { buildFeedPlanCode, isoProductionWeek } from './feed-plan.rules';

export interface FeedPlanVersionLineInput {
  itemId: string;
  projectedTargetKg: number;
  adjustmentFactor: number;
  tentativeKg: number;
  requestedKg: number | null;
  millApprovedKg: number | null;
  history: Array<{ from: string; to: string; actualKg: number; expectedKg: number }>;
}

export interface CreateFeedPlanVersionInput {
  tenantId: string;
  companyId: string;
  farmId: string;
  farmCode: string;
  sourceRunId: string;
  productionDate: string;
  planType: 'TENTATIVE' | 'ACTUAL';
  sourceFrom: string;
  sourceTo: string;
  lines: FeedPlanVersionLineInput[];
}

@Injectable()
export class FeedPlanService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  async createVersion(input: CreateFeedPlanVersionInput, actor?: { userId?: string }) {
    if (!actor?.userId) throw new UnauthorizedException('An authenticated creator is required to generate a feed plan.');
    const creatorId = actor.userId;
    if (!input.lines.length) throw new ConflictException('The saved calculation has no feed demand for this production week.');

    return withTenantTransaction(this.cls, async () => {
      const [farm] = await this.db.select({ id: schema.locationMaster.location_id })
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.location_id, input.farmId),
          eq(schema.locationMaster.company_id, input.companyId),
          eq(schema.locationMaster.tenant_id, input.tenantId),
          eq(schema.locationMaster.location_type, 'FARM'),
        )).limit(1).for('update');
      if (!farm) throw new NotFoundException('Farm not found.');

      const planWeek = isoProductionWeek(input.productionDate);
      const [latest] = await this.db.select({ version: schema.feedPlan.version })
        .from(schema.feedPlan)
        .where(and(
          eq(schema.feedPlan.tenant_id, input.tenantId),
          eq(schema.feedPlan.company_id, input.companyId),
          eq(schema.feedPlan.farm_id, input.farmId),
          eq(schema.feedPlan.plan_week, planWeek),
        )).orderBy(desc(schema.feedPlan.version)).limit(1).for('update');
      const version = (latest?.version ?? 0) + 1;
      const planId = randomUUID();
      const planCode = buildFeedPlanCode(input.farmCode, input.productionDate, version);
      await this.db.insert(schema.feedPlan).values({
        plan_id: planId,
        plan_code: planCode,
        tenant_id: input.tenantId,
        company_id: input.companyId,
        farm_id: input.farmId,
        source_run_id: input.sourceRunId,
        production_date: input.productionDate,
        plan_week: planWeek,
        plan_type: input.planType,
        version,
        source_from: input.sourceFrom,
        source_to: input.sourceTo,
        created_by: creatorId,
      });
      await this.db.insert(schema.feedPlanLine).values(input.lines.map((line) => ({
        plan_line_id: randomUUID(),
        plan_id: planId,
        item_id: line.itemId,
        projected_target_kg: String(line.projectedTargetKg),
        adjustment_factor: String(line.adjustmentFactor),
        tentative_qty_kg: String(line.tentativeKg),
        requested_qty_kg: line.requestedKg === null ? null : String(line.requestedKg),
        mill_approved_qty_kg: line.millApprovedKg === null ? null : String(line.millApprovedKg),
        variance_qty_kg: String((line.requestedKg ?? line.tentativeKg) - line.tentativeKg),
        history_snapshot: line.history,
      })));
      return { planId, planCode, planWeek, planType: input.planType, version };
    });
  }

  async list(farmId: string, companyId: string, tenantId: string) {
    return this.db.select().from(schema.feedPlan).where(and(
      eq(schema.feedPlan.tenant_id, tenantId),
      eq(schema.feedPlan.company_id, companyId),
      eq(schema.feedPlan.farm_id, farmId),
    )).orderBy(desc(schema.feedPlan.created_at));
  }

  async findOne(planId: string, tenantId: string) {
    const [plan] = await this.db.select().from(schema.feedPlan).where(and(
      eq(schema.feedPlan.plan_id, planId),
      eq(schema.feedPlan.tenant_id, tenantId),
    )).limit(1);
    if (!plan) throw new NotFoundException('Feed plan not found.');
    const scope = farmScope(this.cls);
    if ((scope.companyId && scope.companyId !== plan.company_id) || (scope.farmId && scope.farmId !== plan.farm_id)) {
      throw new NotFoundException('Feed plan not found.');
    }
    const lines = await this.db.select({
      plan_line_id: schema.feedPlanLine.plan_line_id,
      item_id: schema.feedPlanLine.item_id,
      item_code: schema.itemMaster.item_code,
      item_name: schema.itemMaster.item_name,
      projected_target_kg: schema.feedPlanLine.projected_target_kg,
      adjustment_factor: schema.feedPlanLine.adjustment_factor,
      tentative_qty_kg: schema.feedPlanLine.tentative_qty_kg,
      requested_qty_kg: schema.feedPlanLine.requested_qty_kg,
      mill_approved_qty_kg: schema.feedPlanLine.mill_approved_qty_kg,
      variance_qty_kg: schema.feedPlanLine.variance_qty_kg,
      history_snapshot: schema.feedPlanLine.history_snapshot,
    }).from(schema.feedPlanLine)
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.feedPlanLine.item_id))
      .where(eq(schema.feedPlanLine.plan_id, planId));
    return { ...plan, lines };
  }
}
