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
  Dialog,
  DialogFooterActions,
  DialogHeaderActions,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
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
import { FEED_TYPE_LABEL, labelOf } from './requisition-labels';
import { RecordLink, itemHref } from './feed-requisition-header';
import { loadingSheetHref } from './feed-loading-panel';

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
/** Silo TO Receipt row 24 / checkpoint 27: bag count x bag size within 1 percent of the KG received (the API decides). */
const BAG_TOLERANCE = 0.01;
const transferHref = (transferId: string) =>
  `/inventory/transfers?id=${encodeURIComponent(transferId)}`;

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
  const [panel, setPanel] = useState<'ship' | 'receive' | null>(null);
  const [postingDate, setPostingDate] = useState(todayIso());
  const [transferId, setTransferId] = useState('');
  const [shipmentId, setShipmentId] = useState('');
  const [shipQty, setShipQty] = useState<Record<string, string>>({});
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  // W2T: per requisition line — variance reason, bag count, delivery note no.
  const [receiveReason, setReceiveReason] = useState<Record<string, string>>(
    {},
  );
  const [receiveBags, setReceiveBags] = useState<Record<string, string>>({});
  const [receiveNote, setReceiveNote] = useState<Record<string, string>>({});
  const [lastReceipt, setLastReceipt] = useState<FeedPostedReceipt | null>(
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
      ...(edit.priority !== undefined ? { priority: edit.priority } : {}),
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
  const chosenTransfer =
    transfers.find((transfer) => transfer.transfer_id === transferId) ?? null;
  const chosenShipment =
    chosenTransfer?.open_shipments.find(
      (shipment) => shipment.shipment_id === shipmentId,
    ) ?? null;
  useEffect(() => {
    const candidates =
      panel === 'receive'
        ? transfers.filter((transfer) => transfer.open_shipments.length > 0)
        : transfers;
    if (candidates.length !== 1) return;
    const candidate = candidates[0];
    if (transferId !== candidate.transfer_id)
      setTransferId(candidate.transfer_id);
    if (
      panel === 'receive' &&
      candidate.open_shipments.length === 1 &&
      shipmentId !== candidate.open_shipments[0].shipment_id
    ) {
      setShipmentId(candidate.open_shipments[0].shipment_id);
    }
  }, [panel, transfers, transferId, shipmentId]);
  const entered = (value: string | undefined) => {
    if (!value?.trim()) return null;
    const quantity = Number(value);
    return Number.isFinite(quantity) ? quantity : null;
  };
  const withinCap = (value: string | undefined, cap: number) => {
    const quantity = entered(value);
    return quantity === null || (quantity > 0 && quantity <= cap);
  };
  const shipLines = (chosenTransfer?.lines ?? []).filter(
    (line) => !!line.requisition_line_id && line.balance_to_ship > 1e-9,
  );
  const shipBody = shipLines.flatMap((line) => {
    const quantity = entered(shipQty[line.requisition_line_id!]);
    return quantity !== null && quantity > 0
      ? [{ requisition_line_id: line.requisition_line_id!, quantity }]
      : [];
  });
  const shipValid =
    !!chosenTransfer &&
    shipLines.every((line) =>
      withinCap(shipQty[line.requisition_line_id!], line.balance_to_ship),
    ) &&
    shipBody.length > 0;
  const shipNowTotal = shipBody.reduce(
    (total, line) => total + line.quantity,
    0,
  );
  const shipRemainingTotal = shipLines.reduce(
    (total, line) => total + line.balance_to_ship,
    0,
  );
  const fillRemainingShipQty = () =>
    setShipQty(
      Object.fromEntries(
        shipLines.map((line) => [
          line.requisition_line_id!,
          String(line.balance_to_ship),
        ]),
      ),
    );
  const receiveLines = (chosenShipment?.lines ?? []).filter(
    (line) => !!line.requisition_line_id && line.remaining_to_receive > 1e-9,
  );
  const bagSizeKg = Number(view.header?.bag_size_kg ?? 50) || 50;
  // W2T: what each receipt line shows and checks (Requisition rows 139-148).
  const receiptRows = receiveLines.map((line, index) => {
    const key = line.requisition_line_id!;
    const reqLine = lines.find((l) => l.line_id === key) ?? null;
    const transferLine =
      chosenTransfer?.lines.find(
        (tl) => tl.transfer_line_id === line.line_id,
      ) ?? null;
    const shipped = Number(transferLine?.qty_shipped ?? line.quantity);
    const previouslyReceived = Number(
      transferLine?.qty_received ?? line.qty_received,
    );
    const outstanding = Number(
      transferLine?.remaining_to_receive ?? line.remaining_to_receive,
    );
    const quantity = entered(receiveQty[key]);
    const bagged = reqLine?.feed_type === 'BAGGED';
    // Requisition row 145: shipped minus everything received once this posting lands.
    const variance =
      quantity === null
        ? null
        : Math.round((shipped - previouslyReceived - quantity) * 10000) / 10000;
    const short = variance !== null && variance > 1e-9;
    const bags = entered(receiveBags[key]);
    const bagsOk =
      !bagged ||
      quantity === null ||
      (bags !== null &&
        Number.isInteger(bags) &&
        bags > 0 &&
        Math.abs(bags * bagSizeKg - quantity) <=
          quantity * BAG_TOLERANCE + 1e-9);
    // Rishi, 11 Oct: every short receipt needs a reason, even with more still to come. The delivery note is optional.
    const reasonNeeded = short;
    const reasonOk = !reasonNeeded || !!receiveReason[key]?.trim();
    return {
      line,
      key,
      index,
      reqLine,
      transferLine,
      shipped,
      previouslyReceived,
      outstanding,
      quantity,
      bagged,
      variance,
      short,
      reasonNeeded,
      bags,
      bagsOk,
      reasonOk,
    };
  });
  const receiveBody = receiptRows.flatMap((row) =>
    row.quantity !== null && row.quantity > 0
      ? [
          {
            requisition_line_id: row.key,
            quantity: row.quantity,
            ...(receiveNote[row.key]?.trim()
              ? { delivery_note_no: receiveNote[row.key].trim() }
              : {}),
            ...(row.reasonNeeded
              ? { variance_reason: receiveReason[row.key]?.trim() ?? '' }
              : {}),
            ...(row.bagged && row.bags !== null ? { bag_count: row.bags } : {}),
          },
        ]
      : [],
  );
  const receiveValid =
    !!chosenTransfer &&
    !!chosenShipment &&
    receiveLines.every((line) =>
      withinCap(
        receiveQty[line.requisition_line_id!],
        line.remaining_to_receive,
      ),
    ) &&
    receiptRows.every(
      (row) => row.quantity === null || (row.bagsOk && row.reasonOk),
    ) &&
    receiveBody.length > 0;
  const resetReceiptInputs = () => {
    setReceiveQty({});
    setReceiveReason({});
    setReceiveBags({});
    setReceiveNote({});
  };
  const lineNumber = (requisitionLineId: string, fallback: number) =>
    lines.find((line) => line.line_id === requisitionLineId)?.line_seq ??
    fallback;
  const receiveNowTotal = receiptRows.reduce(
    (total, row) => total + (row.quantity ?? 0),
    0,
  );
  const outstandingTotal = receiptRows.reduce(
    (total, row) => total + row.outstanding,
    0,
  );

  const release = () =>
    run(async () => {
      const result = unwrap<RequisitionView>(
        await api.post(`/feed-requisition/${view.requisition_id}/release`, {}),
      );
      showToast.success(tRef.current('rqReleased'));
      onView(result);
    });
  const postShipment = () =>
    run(async () => {
      const result = unwrap<RequisitionView>(
        await api.post(`/feed-requisition/${view.requisition_id}/shipments`, {
          transfer_id: transferId,
          posting_date: postingDate,
          lines: shipBody,
        }),
      );
      setShipQty({});
      setPanel(null);
      showToast.success(tRef.current('crqShipped'));
      onView(result);
    });
  const postReceipt = () =>
    run(async () => {
      const result = unwrap<RequisitionView>(
        await api.post(`/feed-requisition/${view.requisition_id}/receipts`, {
          transfer_id: transferId,
          shipment_id: shipmentId,
          posting_date: postingDate,
          lines: receiveBody,
        }),
      );
      resetReceiptInputs();
      setPanel(null);
      setLastReceipt(result?.receipt ?? null);
      showToast.success(
        result?.receipt?.receipt_no
          ? tRef.current('w2tReceiptPosted', {
              receipt: result.receipt.receipt_no,
            })
          : tRef.current('crqReceived'),
      );
      onView(result);
    });

  const chooseTransfer = (value: string) => {
    setTransferId(value);
    setShipmentId('');
    setShipQty({});
    resetReceiptInputs();
  };

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
        onClick={() => setPanel('ship')}
        disabled={busy || !actions.shipment.enabled}
        title={actions.shipment.reason ?? undefined}
      >
        {t('crqShip')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setPanel('receive')}
        disabled={busy || !actions.receipt.enabled}
        title={actions.receipt.reason ?? undefined}
      >
        {t('crqReceive')}
      </Button>
    </div>
  );

  const transferField = (
    <Field
      className="w-48"
      label={t('rqTransfer')}
      htmlFor={`feed-${panel}-transfer`}
    >
      <div className="relative w-48">
        <SearchableSelect
          value={transferId}
          onChange={(val) => chooseTransfer(val)}
          options={[
            { value: '', label: t('crqChoose') },
            ...transfers.map((transfer) => ({
              value: transfer.transfer_id,
              label: transfer.transfer_no,
            })),
          ]}
          columnHeaders={false}
          triggerClassName="nf-input-sm w-48 h-9"
        />
        <select
          id={`feed-${panel}-transfer`}
          className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
          tabIndex={-1}
          value={transferId}
          onChange={(event) => chooseTransfer(event.target.value)}
        >
          <option value="">{t('crqChoose')}</option>
          {transfers.map((transfer) => (
            <option key={transfer.transfer_id} value={transfer.transfer_id}>
              {transfer.transfer_no}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );

  const dateField = (
    <Field
      className="w-40"
      label={t('crqPostingDate')}
      htmlFor={`feed-${panel}-posting-date`}
    >
      <input
        id={`feed-${panel}-posting-date`}
        type="date"
        className="nf-input-sm"
        value={postingDate}
        onChange={(event) => setPostingDate(event.target.value)}
      />
    </Field>
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
        />
      </div>
      {/* Rishi, 11 Oct: Transfer Shipment opens in its own dialog stacked on the requisition. */}
      <Dialog
        open={panel === 'ship' && actions.shipment.enabled}
        onClose={() => setPanel(null)}
        title={t('crqShip')}
        presentation="compact"
        maxWidth="xl"
        className="w-[min(96vw,78rem)]"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-(--text-secondary)">
              {t('crqShipSummary', {
                lines: shipLines.length,
                remaining: kgText(shipRemainingTotal, '0'),
                selected: kgText(shipNowTotal, '0'),
              })}
            </span>
            <Button
              size="sm"
              onClick={postShipment}
              disabled={busy || !shipValid}
            >
              {t('crqPostShipment')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 rounded-md border border-(--border) bg-(--surface-raised) p-3 sm:grid-cols-2 lg:grid-cols-3">
            {dateField}
            {transferField}
            <div className="flex items-end">
              <Button
                variant="outline"
                size="sm"
                onClick={fillRemainingShipQty}
                disabled={!shipLines.length}
              >
                {t('crqFillRemaining')}
              </Button>
            </div>
          </div>
          {shipLines.length ? (
            <div className="space-y-3" aria-label={t('crqShipmentLines')}>
              {shipLines.map((line, index) => {
                const key = line.requisition_line_id!;
                const reqLine = lines.find(
                  (candidate) => candidate.line_id === key,
                );
                const enteredQty = entered(shipQty[key]);
                const remainingAfter =
                  enteredQty === null
                    ? line.balance_to_ship
                    : Math.max(0, line.balance_to_ship - enteredQty);
                const invalid =
                  enteredQty !== null &&
                  (enteredQty <= 0 || enteredQty > line.balance_to_ship);
                return (
                  <section
                    key={key}
                    className="rounded-md border border-(--border) p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-(--text-secondary)">
                          {t('w2tColLine')} {lineNumber(key, index + 1)}
                        </div>
                        <div className="font-mono text-sm">
                          {line.item_code ? (
                            <RecordLink
                              code={line.item_code}
                              href={
                                line.item_id ? itemHref(line.item_id) : null
                              }
                            />
                          ) : (
                            t('rqNotApplicable')
                          )}
                        </div>
                        <div className="text-sm text-(--text-secondary)">
                          {line.item_name || t('rqNotApplicable')}
                        </div>
                        <div className="mt-1 text-xs">
                          {labelOf(
                            FEED_TYPE_LABEL,
                            reqLine?.feed_type ?? null,
                            t,
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-right text-xs sm:grid-cols-4">
                        <div>
                          <div className="text-(--text-secondary)">
                            {t('w2tColRequested')}
                          </div>
                          <div className="font-semibold">
                            {kgText(
                              reqLine?.requested_qty_kg ?? line.quantity,
                              '0',
                            )}{' '}
                            KG
                          </div>
                        </div>
                        <div>
                          <div className="text-(--text-secondary)">
                            {t('w2tColMillApproved')}
                          </div>
                          <div className="font-semibold">
                            {kgText(
                              reqLine?.mill_approved_qty_kg,
                              t('rqNotApplicable'),
                            )}{' '}
                            KG
                          </div>
                        </div>
                        <div>
                          <div className="text-(--text-secondary)">
                            {t('crqAlreadyShipped')}
                          </div>
                          <div className="font-semibold">
                            {kgText(line.qty_shipped, '0')} KG
                          </div>
                        </div>
                        <div>
                          <div className="text-(--text-secondary)">
                            {t('crqRemainingToShip')}
                          </div>
                          <div className="font-semibold text-(--accent)">
                            {kgText(line.balance_to_ship, '0')} KG
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,16rem)_1fr] lg:items-end">
                      <Field
                        label={t('crqShipQtyFor', {
                          line: lineNumber(key, index + 1),
                        })}
                        htmlFor={`feed-ship-${key}`}
                        error={
                          invalid
                            ? t('crqShipQtyHint', {
                                remaining: kgText(line.balance_to_ship, '0'),
                              })
                            : undefined
                        }
                      >
                        <input
                          id={`feed-ship-${key}`}
                          type="number"
                          min={0}
                          max={line.balance_to_ship}
                          className="nf-input-sm text-right"
                          value={shipQty[key] ?? ''}
                          onChange={(event) =>
                            setShipQty((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <div className="text-xs text-(--text-secondary)">
                        {t('crqRemainingAfter', {
                          quantity: kgText(remainingAfter, '0'),
                        })}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-(--border) p-6 text-center text-sm text-(--text-secondary)">
              {t('crqNoShipmentLines')}
            </div>
          )}
        </div>
      </Dialog>
      <Dialog
        open={panel === 'receive' && actions.receipt.enabled}
        onClose={() => setPanel(null)}
        title={t('crqReceive')}
        presentation="compact"
        maxWidth="xl"
        className="w-[min(96vw,78rem)]"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-(--text-secondary)">
              {receiptRows.length
                ? t('w2tReceiptSummary', {
                    lines: receiptRows.length,
                    outstanding: kgText(outstandingTotal, '0'),
                    receiving: kgText(receiveNowTotal, '0'),
                  })
                : t('w2tChooseShipment')}
            </span>
            <Button
              size="sm"
              onClick={postReceipt}
              disabled={busy || !receiveValid}
            >
              {t('crqPostReceipt')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 rounded-md border border-(--border) bg-(--surface-raised) p-3 sm:grid-cols-2 lg:grid-cols-4">
            {dateField}
            {transferField}
            <Field
              className="w-full"
              label={t('crqShipment')}
              htmlFor="feed-shipment"
            >
              <div className="relative w-full">
                <SearchableSelect
                  value={shipmentId}
                  onChange={(val) => {
                    setShipmentId(val);
                    resetReceiptInputs();
                  }}
                  disabled={!chosenTransfer}
                  options={[
                    { value: '', label: t('crqChoose') },
                    ...(chosenTransfer?.open_shipments ?? []).map(
                      (shipment) => ({
                        value: shipment.shipment_id,
                        label: shipment.shipment_no,
                      }),
                    ),
                  ]}
                  columnHeaders={false}
                  triggerClassName="nf-input-sm h-9 w-full"
                />
                <select
                  id="feed-shipment"
                  className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
                  tabIndex={-1}
                  value={shipmentId}
                  onChange={(event) => {
                    setShipmentId(event.target.value);
                    resetReceiptInputs();
                  }}
                  disabled={!chosenTransfer}
                >
                  <option value="">{t('crqChoose')}</option>
                  {(chosenTransfer?.open_shipments ?? []).map((shipment) => (
                    <option
                      key={shipment.shipment_id}
                      value={shipment.shipment_id}
                    >
                      {shipment.shipment_no}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <div className="flex flex-wrap items-end gap-2 text-xs">
              {chosenTransfer && (
                <a
                  className="font-medium underline"
                  style={{ color: 'var(--accent)' }}
                  href={transferHref(chosenTransfer.transfer_id)}
                >
                  {t('w2tOpenTransfer', { no: chosenTransfer.transfer_no })}
                </a>
              )}
              {chosenTransfer && chosenShipment && (
                <a
                  className="font-medium underline"
                  style={{ color: 'var(--accent)' }}
                  href={transferHref(chosenTransfer.transfer_id)}
                >
                  {t('w2tOpenShipment', { no: chosenShipment.shipment_no })}
                </a>
              )}
            </div>
          </div>
          {receiptRows.length > 0 ? (
            <div className="space-y-3" aria-label={t('w2tReceiptLines')}>
              {receiptRows.map((row) => {
                const n = lineNumber(row.key, row.index + 1);
                const na = t('rqNotApplicable');
                const compartments = row.line.compartments?.length
                  ? row.line.compartments
                  : row.line.compartment_no
                    ? row.line.compartment_no
                        .split(',')
                        .map((compartment_no) => ({
                          compartment_no: compartment_no.trim(),
                          kg_loaded: 0,
                          loaded_by: null,
                        }))
                    : [];
                return (
                  <section
                    key={row.key}
                    className="rounded-md border border-(--border) p-3 sm:p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-(--text-secondary)">
                          {t('w2tColLine')} {n}
                        </div>
                        <div className="font-mono text-sm">
                          {(row.reqLine?.item_code ??
                          row.transferLine?.item_code) ? (
                            <RecordLink
                              code={
                                row.reqLine?.item_code ??
                                row.transferLine?.item_code
                              }
                              href={
                                (row.reqLine?.item_id ??
                                row.transferLine?.item_id)
                                  ? itemHref(
                                      (row.reqLine?.item_id ??
                                        row.transferLine?.item_id)!,
                                    )
                                  : null
                              }
                            />
                          ) : (
                            na
                          )}
                        </div>
                        <div className="text-sm text-(--text-secondary)">
                          {row.reqLine?.item_description ??
                            row.transferLine?.item_name ??
                            na}
                        </div>
                        <div className="mt-1 text-xs">
                          {labelOf(
                            FEED_TYPE_LABEL,
                            row.reqLine?.feed_type ?? null,
                            t,
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-right text-xs sm:grid-cols-3 lg:grid-cols-6">
                        <div>
                          <div className="text-(--text-secondary)">
                            {t('w2tColRequested')}
                          </div>
                          <div className="font-semibold">
                            {kgText(
                              row.reqLine?.requested_qty_kg ??
                                row.reqLine?.quantity,
                              na,
                            )}{' '}
                            KG
                          </div>
                        </div>
                        <div>
                          <div className="text-(--text-secondary)">
                            {t('w2tColMillApproved')}
                          </div>
                          <div className="font-semibold">
                            {kgText(row.reqLine?.mill_approved_qty_kg, na)} KG
                          </div>
                        </div>
                        <div>
                          <div className="text-(--text-secondary)">
                            {t('w2tColShipped')}
                          </div>
                          <div className="font-semibold">
                            {kgText(row.shipped, na)} KG
                          </div>
                        </div>
                        <div>
                          <div className="text-(--text-secondary)">
                            {t('w2tColPrevReceived')}
                          </div>
                          <div className="font-semibold">
                            {kgText(row.previouslyReceived, na)} KG
                          </div>
                        </div>
                        <div>
                          <div className="text-(--text-secondary)">
                            {t('w2tColOutstanding')}
                          </div>
                          <div className="font-semibold text-(--accent)">
                            {kgText(row.outstanding, na)} KG
                          </div>
                        </div>
                        <div>
                          <div className="text-(--text-secondary)">
                            {t('w2tColVariance')}
                          </div>
                          <div
                            className={`font-semibold ${row.variance && row.variance > 0 ? 'text-(--danger)' : ''}`}
                          >
                            {row.variance === null
                              ? na
                              : `${kgText(row.variance, na)} KG`}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-(--text-secondary)">
                        {t('w2tColCompartment')}:
                      </span>
                      {compartments.length ? (
                        compartments.map((compartment, index) => (
                          <span
                            key={`${compartment.compartment_no}-${index}`}
                            className="rounded-full border border-(--border) bg-(--surface-raised) px-2 py-1 whitespace-nowrap"
                          >
                            {compartment.compartment_no}
                            {compartment.kg_loaded > 0
                              ? ` · ${kgText(compartment.kg_loaded, na)} KG`
                              : ''}
                          </span>
                        ))
                      ) : (
                        <span>{na}</span>
                      )}
                      {row.line.loading_sheet_no && (
                        <>
                          <span className="text-(--text-secondary)">
                            {t('w2tLoadingSheet')}:
                          </span>
                          <RecordLink
                            code={row.line.loading_sheet_no}
                            href={
                              row.line.loading_sheet_id
                                ? loadingSheetHref(row.line.loading_sheet_id)
                                : null
                            }
                          />
                        </>
                      )}
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field
                        label={t('crqReceiveQtyFor', { line: n })}
                        htmlFor={`feed-receive-${row.key}`}
                        error={
                          row.quantity !== null &&
                          (row.quantity <= 0 || row.quantity > row.outstanding)
                            ? t('w2tReceiveQtyHint', {
                                outstanding: kgText(row.outstanding, '0'),
                              })
                            : undefined
                        }
                      >
                        <input
                          id={`feed-receive-${row.key}`}
                          type="number"
                          min={0}
                          max={row.line.remaining_to_receive}
                          className="nf-input-sm text-right"
                          value={receiveQty[row.key] ?? ''}
                          onChange={(event) =>
                            setReceiveQty((current) => ({
                              ...current,
                              [row.key]: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Field
                        label={t('w2tDeliveryNoteFor', { line: n })}
                        htmlFor={`feed-receive-note-${row.key}`}
                      >
                        <input
                          id={`feed-receive-note-${row.key}`}
                          type="text"
                          maxLength={80}
                          className="nf-input-sm"
                          value={receiveNote[row.key] ?? ''}
                          onChange={(event) =>
                            setReceiveNote((current) => ({
                              ...current,
                              [row.key]: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      {row.bagged && (
                        <Field
                          label={t('w2tBagCountFor', { line: n })}
                          htmlFor={`feed-receive-bags-${row.key}`}
                          error={
                            row.bagsOk
                              ? undefined
                              : t('w2tBagCountHint', { size: bagSizeKg })
                          }
                        >
                          <input
                            id={`feed-receive-bags-${row.key}`}
                            type="number"
                            min={1}
                            step={1}
                            className="nf-input-sm text-right"
                            value={receiveBags[row.key] ?? ''}
                            onChange={(event) =>
                              setReceiveBags((current) => ({
                                ...current,
                                [row.key]: event.target.value,
                              }))
                            }
                          />
                        </Field>
                      )}
                      {row.reasonNeeded && (
                        <Field
                          className="sm:col-span-2 lg:col-span-1"
                          label={t('w2tVarianceReasonFor', { line: n })}
                          htmlFor={`feed-receive-reason-${row.key}`}
                          error={
                            row.reasonOk
                              ? undefined
                              : t('w2tVarianceReasonRequired')
                          }
                        >
                          <input
                            id={`feed-receive-reason-${row.key}`}
                            type="text"
                            maxLength={500}
                            className="nf-input-sm"
                            value={receiveReason[row.key] ?? ''}
                            onChange={(event) =>
                              setReceiveReason((current) => ({
                                ...current,
                                [row.key]: event.target.value,
                              }))
                            }
                          />
                        </Field>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-(--border) p-6 text-center text-sm text-(--text-secondary)">
              {t('w2tChooseShipment')}
            </div>
          )}
        </div>
      </Dialog>
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
          <a
            className="font-medium underline"
            style={{ color: 'var(--accent)' }}
            href={transferHref(lastReceipt.transfer_id)}
          >
            {t('w2tOpenTransferPlain')}
          </a>
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
    </>
  );
}

export default FeedRequisitionDetail;
