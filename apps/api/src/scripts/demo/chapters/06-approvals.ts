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
import { and, eq, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { ApprovalService } from '../../../modules/production/approval/approval.service';
import { BatchTransferService } from '../../../modules/production/batch/batch-transfer.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';

/** The demo STANDARD_USER seed-dev-tenant creates — the approval flow's requestor. */
const WORKER_EMAIL = 'user@triplec.local';

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

    // 4. The farm worker's batch transfer, end to end — the flow the Batch
    // panel drives: a STANDARD_USER raises a PARTIAL transfer, the API parks
    // it as a DRAFT with a PENDING BATCH_TRANSFER approval, and an admin's
    // approval posts the movement. Written through the real services so the
    // demo proves the gate, not a shortcut around it.
    const batchTransfers = ctx.app.get(BatchTransferService);
    const [worker] = await db
      .select({ user_id: schema.userMaster.user_id, email: schema.userMaster.email })
      .from(schema.userMaster)
      .where(eq(schema.userMaster.email, WORKER_EMAIL))
      .limit(1);
    if (!worker) throw new Error(`06-approvals: demo worker '${WORKER_EMAIL}' not found — seed-dev-tenant must run first.`);
    const workerActor = { userId: worker.user_id, userType: 'STANDARD_USER' as const, email: worker.email, fullName: 'Standard User' };

    const [workerSource] = await db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no, status: schema.batchHeader.status })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.remarks, 'DEMO-BATCH-REG-KINTYRE'))
      .limit(1);
    const [workerDest] = await db
      .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no, status: schema.batchHeader.status })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.remarks, 'DEMO-BATCH-REG-GRASMERE'))
      .limit(1);
    if (!workerSource || !workerDest) throw new Error('06-approvals: Kintyre/Grasmere registered batches not found — run 03-batches-and-animals first.');

    const WORKER_TRANSFER_TITLE = 'DEMO — Transfer 2 sows Kintyre breeding to Grasmere grower (worker)';
    const [existingWorkerTransfer] = await db
      .select({ transfer_id: schema.batchTransfer.transfer_id, status: schema.batchTransfer.status })
      .from(schema.batchTransfer)
      .where(eq(schema.batchTransfer.reason, WORKER_TRANSFER_TITLE))
      .limit(1);

    if (!existingWorkerTransfer) {
      // Farm-to-farm is refused for every role, so the worker moves within
      // Kintyre: source and destination must share a farm. Find a second
      // registered batch on the same farm for the destination.
      const sameFarm = await db
        .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no, farm_id: schema.batchHeader.farm_id, status: schema.batchHeader.status })
        .from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.farm_id, sql`(SELECT farm_id FROM batch_header WHERE batch_id = '${workerSource.batch_id}')`), eq(schema.batchHeader.status, 'ACTIVE')));
      const destination = sameFarm.find((b) => b.batch_id !== workerSource.batch_id);
      if (!destination) throw new Error('06-approvals: no second ACTIVE batch on the worker source farm — cannot demo the approval flow.');

      const created = await batchTransfers.create(
        {
          company_id: ctx.companyId,
          to_batch_id: destination.batch_id,
          transfer_date: new Date().toISOString().slice(0, 10),
          transfer_type: 'PARTIAL',
          reason: WORKER_TRANSFER_TITLE,
          remarks: 'Raised by the demo standard user; posts when the approval is granted.',
          post_immediately: true,
        } as any,
        ctx.tenantId,
        workerSource.batch_id,
        workerActor,
      );
      ctx.log(`approvals: worker raised PARTIAL transfer ${(created as any).transfer_no} — DRAFT + PENDING approval`);

      // The admin decides it from the Approvals queue: approve posts the
      // movement through the same post() a direct post uses.
      const [pending] = await db
        .select({ request_id: schema.approvalRequest.request_id })
        .from(schema.approvalRequest)
        .where(and(eq(schema.approvalRequest.reference_id, (created as any).transfer_id), eq(schema.approvalRequest.status, 'PENDING')))
        .limit(1);
      if (!pending) throw new Error('06-approvals: the worker transfer did not raise a PENDING approval — the gate failed.');
      await approvals.approve(pending.request_id, ctx.tenantId, actor);
      ctx.log('approvals: admin approved the BATCH_TRANSFER request — worker transfer posted');
    } else {
      ctx.log(`approvals: worker batch transfer already ${existingWorkerTransfer.status} — skipped`);
    }
  },
};
