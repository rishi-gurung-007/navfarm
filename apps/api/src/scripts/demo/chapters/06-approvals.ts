/**
 * Chapter `06-approvals` — Phase 3 Task 8. A populated approvals queue on the
 * approval engine the console pages already drive, all through
 * `ApprovalService` (Ruling 1):
 *
 *   - FEED_RATION (PENDING): ration rise on the Grasmere Count-Only grower
 *     batch — 2.5 → 2.6 kg/head/day.
 *   - MEDICINE_REQUISITION (PENDING): 5 vials of antibiotic from the Grasmere
 *     Demo Medicine Store for the registered batch (LOB-specific doc type).
 *   - STOCK_TRANSFER (APPROVED): created and then approved through
 *     `ApprovalService.approve`, so the demo queue holds a decided row too.
 *
 * Resume semantics: each request is located by its unique DEMO title and
 * skipped; the approved one is approved only while still PENDING (the service
 * refuses to decide twice, which the skip honours).
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=06-approvals
 */
import { eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { ApprovalService } from '../../../modules/production/approval/approval.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';

const FEED_RATION_TITLE = 'DEMO — Raise Grasmere grower ration to 2.6 kg/head/day';
const MEDICINE_TITLE = 'DEMO — Requisition 5 vials antibiotic for Grasmere breeding stock';
const TRANSFER_TITLE = 'DEMO — Move 10 gilts from Kintyre quarantine into gestation';

export const approvalsChapter: DemoChapter = {
  name: '06-approvals',

  async run(ctx: DemoContext): Promise<void> {
    const approvals = ctx.app.get(ApprovalService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('06-approvals: tenantDb is not set — run through the harness.');

    const actor = { userId: ctx.actor.userId, userType: ctx.actor.userType, email: ctx.actor.email, fullName: 'Company Administrator' };

    const [registered] = await db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.remarks, 'DEMO-BATCH-REG-GRASMERE'))
      .limit(1);
    const [grower] = await db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.remarks, 'DEMO-BATCH-CO-GRASMERE'))
      .limit(1);
    if (!registered || !grower) throw new Error('06-approvals: demo batches not found — run 03-batches-and-animals first.');

    async function ensureRequest(spec: {
      title: string;
      doc_type: string;
      batch_id?: string;
      item_or_stage?: string;
      requested_qty?: string;
      uom?: string;
      cost_impact?: number;
      justification: string;
      urgency?: string;
    }): Promise<string> {
      const [existing] = await db
        .select({ request_id: schema.approvalRequest.request_id, status: schema.approvalRequest.status })
        .from(schema.approvalRequest)
        .where(eq(schema.approvalRequest.title, spec.title))
        .limit(1);
      if (existing) {
        ctx.log(`approvals: '${spec.title.slice(6, 46)}…' already ${existing.status} — skipped`);
        return existing.request_id;
      }
      const created = await approvals.create(
        {
          company_id: ctx.companyId,
          doc_type: spec.doc_type,
          title: spec.title,
          location_label: spec.batch_id ? undefined : 'Grasmere (MUL100)',
          batch_id: spec.batch_id,
          urgency: spec.urgency ?? 'MEDIUM',
          item_or_stage: spec.item_or_stage,
          requested_qty: spec.requested_qty,
          uom: spec.uom,
          cost_impact: spec.cost_impact,
          justification: spec.justification,
        },
        ctx.tenantId,
        actor,
      );
      ctx.log(`approvals: raised ${spec.doc_type} — '${spec.title.slice(6, 46)}…'`);
      return created.request_id;
    }

    // 1. Pending: the feed ration change on the Grasmere grower batch.
    await ensureRequest({
      title: FEED_RATION_TITLE,
      doc_type: 'FEED_RATION',
      batch_id: grower.batch_id,
      item_or_stage: 'Gestation Feed',
      requested_qty: '2.6',
      uom: 'KG',
      cost_impact: 0.1 * 120 * 28 * 28.0,
      justification: 'Growth check: raise the ration from 2.5 to 2.6 kg/head/day for the next weigh-in period.',
      urgency: 'LOW',
    });

    // 2. Pending: a medicine requisition-style request for the breeding batch.
    await ensureRequest({
      title: MEDICINE_TITLE,
      doc_type: 'MEDICINE_REQUISITION',
      batch_id: registered.batch_id,
      item_or_stage: 'Antibiotic',
      requested_qty: '5',
      uom: 'VIAL',
      justification: 'Routine course for the breeding stock from the Grasmere Demo Medicine Store.',
      urgency: 'MEDIUM',
    });

    // 3. Created and then approved — the queue shows a decided row.
    const transferId = await ensureRequest({
      title: TRANSFER_TITLE,
      doc_type: 'STOCK_TRANSFER',
      item_or_stage: 'Quarantine → Gestation',
      requested_qty: '10',
      uom: 'HEAD',
      justification: 'Quarantine elapsed; clear the gilts into the gestation house.',
      urgency: 'HIGH',
    });
    const [transfer] = await db
      .select({ status: schema.approvalRequest.status })
      .from(schema.approvalRequest)
      .where(eq(schema.approvalRequest.request_id, transferId))
      .limit(1);
    if (transfer?.status === 'PENDING') {
      await approvals.approve(transferId, ctx.tenantId, actor);
      ctx.log('approvals: approved the STOCK_TRANSFER request');
    }
  },
};
