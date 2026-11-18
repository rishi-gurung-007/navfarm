'use client';

/**
 * A feed requisition opened for edit and submit (Task 11, moved out of
 * FeedRequisitionPanel without behaviour change). Owns the edits, remarks and
 * silo/item options (GET /feed-requisition/options?farmId=<view.farm_id>),
 * Save (PUT /feed-requisition/:id), Submit (POST /feed-requisition/:id/submit)
 * and the submitted-state message — everything the workbook document
 * (FeedRequisitionDocument) needs around it.
 *
 * Presentational the same way FeedRequisitionDocument is, one level up: the
 * caller owns `view` and is told about a new one (`onView`) so it can update
 * its own list/notice state. That is what lets one component serve both
 * entry points — Inventory → Requisitions (D26) today and, later, Approvals →
 * Requisitions (Task 13) — rendering the identical document from the
 * identical API (Rishi 4 Oct; spec §6a).
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/services/api-client';
import { InlineAlert } from '@/components/ui/alert';
import { showToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  DialogFooterActions,
  DialogHeaderActions,
} from '@/components/ui/dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { todayIso, unwrap } from './feed-format';
import {
  FeedRequisitionDocument,
  isLineExceptioned,
  needsRemarks,
  remarksRequiredMessage,
  requestedKgOf,
  type FeedLineEdit,
  type FeedPostedReceipt,
  type FeedRequisitionLine,
  type FeedRequisitionOptions,
  type RequisitionView,
} from './feed-requisition-document';
import StockTransferPanel from './stock-transfer-panel';

/** D25: what the farm may still change — mirrors isEditableFeedRequisition in the API. */
export const isEditable = (v: {
  status: string;
  approval_request_id: string | null;
}) =>
  v.status === 'AUTO_DRAFT' ||
  v.status === 'DRAFT' ||
  (v.status === 'PENDING_APPROVAL' && !v.approval_request_id);

const num = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? null : Number(v);
const kgText = (v: string | number | null | undefined, empty: string) => {
  const n = num(v);
  return n === null || !Number.isFinite(n)
    ? empty
    : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
};
export function FeedRequisitionDetail({
  view,
  onView,
  onBack,
  embedded = false,
}: {
  view: RequisitionView;
  onView: (next: RequisitionView) => void;
  onBack: () => void;
  /**
   * Task 18: true when a `<Dialog>` wraps this detail — the dialog already
   * shows the req_no as its own title and offers its own close control, so
   * the Back button + h2 strip this component otherwise renders on top
   * would be a second one. `onBack` still drives the dialog's close (the
   * caller wires it to the same handler as `onClose`); only the strip itself
   * is suppressed.
   */
  embedded?: boolean;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const [edits, setEdits] = useState<Record<string, FeedLineEdit>>({});
  const [options, setOptions] = useState<FeedRequisitionOptions | null>(null);
  const [remarks, setRemarks] = useState(view.remarks ?? '');
  const [busy, setBusy] = useState(false);
  // The receipt the embedded Transfer Order dialog last posted: shown under the document with each line's variance and silo balance.
  const [lastReceipt, setLastReceipt] = useState<FeedPostedReceipt | null>(
    null,
  );
  const [embeddedTransferId, setEmbeddedTransferId] = useState<string | null>(
    null,
  );

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err: any) {
      showToast.error(err?.message || tRef.current('rqActionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const editLine = (lineId: string, patch: FeedLineEdit) =>
    setEdits((cur) => ({ ...cur, [lineId]: { ...cur[lineId], ...patch } }));
  const lineEdits = () =>
    Object.entries(edits).map(([line_id, edit]) => ({
      line_id,
      ...(edit.quantity !== undefined
        ? { quantity_kg: Number(edit.quantity) }
        : {}),
      ...(edit.date !== undefined ? { proposed_delivery_date: edit.date } : {}),
      ...(edit.destinationId !== undefined
        ? { destination_location_id: edit.destinationId }
        : {}),
      ...(edit.itemId !== undefined ? { item_id: edit.itemId } : {}),
      ...(edit.reasonId !== undefined ? { reason_id: edit.reasonId } : {}),
    }));

  const editable = isEditable(view);
  const lines: FeedRequisitionLine[] = Array.isArray(view.lines)
    ? view.lines
    : [];
  const deviating = lines.filter((l) =>
    needsRemarks(num(l.recommended_qty_kg), requestedKgOf(l, edits[l.line_id])),
  );
  // Req. row 29: a delivery date moved off the forecast's needs remarks too (the API checks it at submit).
  const dateOf = (l: FeedRequisitionLine) =>
    edits[l.line_id]?.date ?? l.proposed_delivery_date ?? '';
  const moved = lines.filter(
    (l) =>
      !!l.recommended_delivery_date &&
      dateOf(l) !== l.recommended_delivery_date,
  );
  // Requisition row 36: Remarks are also required on an item exception (the API checks it at submit, approvalProblems).
  // M2: derived the way the document does (edited item vs required_item_id), not from the
  // PERSISTED exception_reason — the API decides this AFTER applying edits, so a farm that
  // changes an item and submits in the same action must see the warning before it submits.
  const exceptioned = lines.filter((l) =>
    isLineExceptioned(l, edits[l.line_id]),
  );
  const late =
    !!view.submission_deadline && todayIso() > view.submission_deadline;
  // 9d F2: which causes, on which lines — so the error can say so rather than naming a fixed two.
  const remarksError =
    editable && !remarks.trim()
      ? remarksRequiredMessage(t, {
          deviating: deviating.map((l) => l.line_seq),
          moved: moved.map((l) => l.line_seq),
          exceptioned: exceptioned.map((l) => l.line_seq),
          late,
        })
      : null;
  const remarksMissing = remarksError !== null;
  // The silos and feed items a line may be moved to — only needed while the document is editable.
  useEffect(() => {
    setOptions(null);
    if (!view.requisition_id || !editable || !view.farm_id) return;
    let live = true;
    api
      .get(
        `/feed-requisition/options?farmId=${encodeURIComponent(view.farm_id)}`,
      )
      .then((res) => {
        const opts = unwrap<FeedRequisitionOptions>(res);
        if (
          live &&
          opts &&
          Array.isArray(opts.destinations) &&
          Array.isArray(opts.items)
        )
          setOptions(opts);
      })
      .catch(() => undefined); // without options the silo and item stay read-only; quantity and date still edit
    return () => {
      live = false;
    };
  }, [view.requisition_id, editable, view.farm_id]);

  const save = () =>
    run(async () => {
      const result = unwrap<RequisitionView>(
        await api.put(`/feed-requisition/${view.requisition_id}`, {
          remarks,
          lines: lineEdits(),
        }),
      );
      setEdits({});
      setRemarks(result.remarks ?? '');
      showToast.success(tRef.current('rqSaved'));
      onView(result);
    });

  const submit = () =>
    run(async () => {
      const result = unwrap<RequisitionView>(
        await api.post(`/feed-requisition/${view.requisition_id}/submit`, {
          remarks,
          lines: lineEdits(),
        }),
      );
      setEdits({});
      setRemarks(result.remarks ?? '');
      showToast.success(tRef.current('rqSubmitted'));
      onView(result);
    });

  const actions = view.actions ?? {
    release: { enabled: false, reason: t('rqActionUnavailable') },
    shipment: { enabled: false, reason: t('rqActionUnavailable') },
    receipt: { enabled: false, reason: t('rqActionUnavailable') },
  };
  const releaseComplete =
    view.document_status === 'RELEASED' ||
    view.document_status === 'RECEIVED' ||
    actions.release.reason?.toLowerCase().includes('already released');
  // A finished step with a next action is a success/info message; only a blocked step is a warning.
  const workflowNotice: {
    variant: 'success' | 'warning';
    text: string;
  } | null = releaseComplete
    ? !actions.shipment.enabled && actions.shipment.reason
      ? {
          variant: 'warning',
          text: `Release completed. Transfer Shipment is unavailable: ${actions.shipment.reason}`,
        }
      : {
          variant: 'success',
          text: 'Release completed. Post the Transfer Shipment to continue.',
        }
    : !actions.release.enabled && actions.release.reason
      ? {
          variant: 'warning',
          text: `Release is unavailable: ${actions.release.reason}`,
        }
      : !actions.shipment.enabled && actions.shipment.reason
        ? {
            variant: 'warning',
            text: `Transfer Shipment is unavailable: ${actions.shipment.reason}`,
          }
        : !actions.receipt.enabled && actions.receipt.reason
          ? {
              variant: 'warning',
              text: `Transfer Receipt is unavailable: ${actions.receipt.reason}`,
            }
          : null;
  const needsBinDietAssignment =
    !actions.release.enabled &&
    Boolean(actions.release.reason?.includes('mill BIN assignment'));
  const transfers = view.transfers ?? [];
  const lineNumber = (requisitionLineId: string, fallback: number) =>
    lines.find((line) => line.line_id === requisitionLineId)?.line_seq ??
    fallback;

  const release = () =>
    run(async () => {
      const result = unwrap<RequisitionView>(
        await api.post(`/feed-requisition/${view.requisition_id}/release`, {}),
      );
      showToast.success(tRef.current('rqReleased'));
      onView(result);
    });
  const actionBar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        onClick={release}
        disabled={busy || !actions.release.enabled}
        title={actions.release.reason ?? undefined}
      >
        {t('crqRelease')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const target =
            transfers.find((tr) =>
              tr.lines.some((l) => l.balance_to_ship > 1e-9),
            ) ?? transfers[0];
          if (target) setEmbeddedTransferId(target.transfer_id);
        }}
        disabled={busy || !actions.shipment.enabled || transfers.length === 0}
        title={actions.shipment.reason ?? undefined}
      >
        {t('crqShip')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const target = transfers.find((tr) => tr.open_shipments.length > 0);
          if (target) setEmbeddedTransferId(target.transfer_id);
        }}
        disabled={busy || !actions.receipt.enabled}
        title={actions.receipt.reason ?? undefined}
      >
        {t('crqReceive')}
      </Button>
    </div>
  );

  return (
    <>
      {!embedded && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> {t('rqBack')}
          </Button>
          <h2
            className="text-base font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {view.req_no}
          </h2>
        </div>
      )}
      <DialogHeaderActions>{actionBar}</DialogHeaderActions>
      {workflowNotice && (
        <div className="mb-4 shrink-0" data-testid="feed-workflow-notice">
          <InlineAlert variant={workflowNotice.variant}>
            {workflowNotice.text}
            {needsBinDietAssignment && (
              <>
                {' '}
                <a
                  className="font-medium underline"
                  href="/master-data/bin-diet-assignment"
                >
                  Open BIN Diet Assignments
                </a>
              </>
            )}
          </InlineAlert>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <FeedRequisitionDocument
          view={view}
          editable={editable}
          edits={edits}
          onLineEdit={editLine}
          remarks={remarks}
          onRemarksChange={setRemarks}
          remarksMissing={remarksMissing}
          remarksError={remarksError}
          options={options}
          onOpenTransfer={(id) => setEmbeddedTransferId(id)}
        />
      </div>
      {lastReceipt && (
        <div
          className="shrink-0 pt-3 text-xs"
          role="status"
          aria-label={t('w2tLastReceipt')}
          style={{ color: 'var(--text-primary)' }}
        >
          <span className="font-semibold">
            {t('w2tReceiptPosted', { receipt: lastReceipt.receipt_no })}
          </span>{' '}
          <button
            type="button"
            className="font-medium underline"
            style={{ color: 'var(--accent)' }}
            onClick={() => setEmbeddedTransferId(lastReceipt.transfer_id)}
          >
            {t('w2tOpenTransferPlain')}
          </button>
          {lastReceipt.lines.map((line) => (
            <div key={line.line_id}>
              {t('w2tReceiptLineResult', {
                line: line.requisition_line_id
                  ? lineNumber(line.requisition_line_id, 0)
                  : '',
                kg: kgText(line.qty_received, '0'),
                variance: kgText(line.variance_qty ?? 0, '0'),
                balance: kgText(line.silo_balance_after, t('rqNotApplicable')),
              })}
            </div>
          ))}
        </div>
      )}
      {editable ? (
        <DialogFooterActions>
          <Button size="sm" variant="outline" onClick={save} disabled={busy}>
            {t('rqSave')}
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || remarksMissing}>
            {t('rqSubmit')}
          </Button>
        </DialogFooterActions>
      ) : view.status === 'PENDING_APPROVAL' ? (
        <p
          className="shrink-0 text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          {t('rqWaiting')}
        </p>
      ) : null}
      {embeddedTransferId && (
        <StockTransferPanel
          embeddedTransferId={embeddedTransferId}
          embeddedRequisition={{ id: view.requisition_id, kind: 'FEED' }}
          embeddedFeed={{
            bagSizeKg: Number(view.header?.bag_size_kg ?? 50) || 50,
            baggedRequisitionLineIds: lines
              .filter((l) => l.feed_type === 'BAGGED')
              .map((l) => l.line_id),
          }}
          embeddedShipmentId={
            transfers.find(
              (transfer) => transfer.transfer_id === embeddedTransferId,
            )?.open_shipments[0]?.shipment_id
          }
          onEmbeddedPosted={(result) => {
            const next = result as RequisitionView & {
              receipt?: FeedPostedReceipt | null;
            };
            setLastReceipt(next?.receipt ?? null);
            onView(next);
          }}
          onEmbeddedClose={() => setEmbeddedTransferId(null)}
        />
      )}
    </>
  );
}

export default FeedRequisitionDetail;
