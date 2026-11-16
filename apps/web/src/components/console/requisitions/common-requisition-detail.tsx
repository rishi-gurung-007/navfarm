'use client';

/**
 * The common requisition (Item / Fixed Asset / Service) document and its
 * actions: Save, Submit, Reopen, Release, Link PO, Ship and Receive (Part E,
 * Task 12). Approve and Reject are supplied by RequisitionDecision on the
 * Requisition page and by the shared approval request in the Approvals inbox;
 * workflow metadata does not expand the common requisition's field contract.
 *
 * The API's PUT /requisition/:id is a FULL REPLACE (omitted remarks,
 * required_date, justification, sender_department_id and direct_transfer
 * become null/false), so Save and Submit always send the whole draft — the
 * header and every line — never a partial body: `toRequisitionPayload` on
 * create, `toRequisitionUpdatePayload` (no company_id) on update.
 *
 * The draft is local state; the caller owns the last server view and is told
 * about each new one (`onView`), which also resets the draft to it.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/services/api-client';
import { showToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  DialogFooterActions,
  DialogHeaderActions,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { getStoredUser, hasPermission } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { unwrap } from '../inventory/feed-format';
import {
  CommonRequisitionDocument,
  type TrackingAssignment,
} from './common-requisition-document';
import StockTransferPanel from '../inventory/stock-transfer-panel';
import {
  commonActions,
  isCommonEditable,
  toRequisitionPayload,
  toRequisitionUpdatePayload,
  type CommonRequisitionOptions,
  type CommonRequisitionView,
} from './common-requisition-model';

const inputStyle = {
  backgroundColor: 'var(--input-bg)',
  color: 'var(--input-text)',
  borderColor: 'var(--input-border)',
};

export function CommonRequisitionDetail({
  initial,
  onView,
  onBack,
  embedded = false,
}: {
  initial: CommonRequisitionView;
  onView: (next: CommonRequisitionView, notice?: string) => void;
  onBack: () => void;
  /**
   * Task 18: true when a `<Dialog>` wraps this detail — see the identical
   * prop on FeedRequisitionDetail for why. `onBack` is unchanged; only the
   * internal Back + title strip is suppressed.
   */
  embedded?: boolean;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const [draft, setDraft] = useState<CommonRequisitionView>(initial);
  const [options, setOptions] = useState<CommonRequisitionOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [poNo, setPoNo] = useState('');
  const [showTransferOrder, setShowTransferOrder] = useState(false);

  // A new server view replaces the draft and closes whatever was half-entered against the old one.
  useEffect(() => {
    setDraft(initial);
    setPoNo('');
  }, [initial]);

  const u = getStoredUser();
  const can = {
    create: hasPermission(u, 'PROCUREMENT', 'REQUISITION', 'can_create'),
    approve: hasPermission(u, 'PROCUREMENT', 'REQUISITION', 'can_approve'),
    transfer: hasPermission(u, 'INVENTORY', 'STOCK_TRANSFER', 'can_edit'),
  };
  const actions = commonActions(draft, can);
  const editable = isCommonEditable(draft);
  const id = draft.requisition_id;

  // WP4a: a released Store document still needs the items' tracking flags,
  // for the Item Tracking button on lines with a balance to ship.
  const releasedStore =
    draft.purpose === 'STORE' &&
    (draft.document_status ?? 'OPEN') === 'RELEASED';
  const needsOptions = editable || releasedStore;

  useEffect(() => {
    setOptions(null);
    if (!needsOptions) return;
    let live = true;
    api
      .get(
        `/requisition/options?company_id=${draft.company_id}${draft.farm_id ? `&farm_id=${draft.farm_id}` : ''}`,
      )
      .then((res) => {
        if (!live) return;
        const nextOptions = unwrap<CommonRequisitionOptions>(res);
        setOptions(nextOptions);
        if (!id && nextOptions.requester) {
          const requester = nextOptions.requester;
          setDraft((current) => ({
            ...current,
            requester_user_id: requester.user_id,
            requester_login: requester.login,
            requester_name: requester.name,
            requester_department_id: requester.department_id,
            requester_department_name: requester.department_name,
          }));
        }
      })
      .catch(() => undefined); // without options the pickers stay empty; the rest of the document still edits
    return () => {
      live = false;
    };
  }, [needsOptions, draft.company_id, draft.farm_id, id]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err: any) {
      showToast.error(err?.message || tRef.current('crqActionFailed'));
    } finally {
      setBusy(false);
    }
  };
  const emit = (res: unknown, message: string) => {
    showToast.success(message);
    onView(unwrap<CommonRequisitionView>(res), message);
  };

  const save = () =>
    run(async () => {
      emit(
        id
          ? await api.put(
              `/requisition/${id}`,
              toRequisitionUpdatePayload(draft),
            )
          : await api.post('/requisition', toRequisitionPayload(draft)),
        tRef.current('crqSaved'),
      );
    });
  const submit = () =>
    run(async () => {
      await api.put(`/requisition/${id}`, toRequisitionUpdatePayload(draft));
      emit(
        await api.post(`/requisition/${id}/submit`, {}),
        tRef.current('crqSubmitted'),
      );
    });
  const reopen = () =>
    run(async () =>
      emit(
        await api.post(`/requisition/${id}/reopen`, {}),
        tRef.current('crqReopened'),
      ),
    );
  const release = () =>
    run(async () => {
      const res = unwrap<CommonRequisitionView>(
        await api.post(`/requisition/${id}/release`, {}),
      );
      const message =
        res.purpose === 'STORE'
          ? tRef.current('crqReleasedStore', {
              no: res.linked_transfer_no ?? '',
            })
          : tRef.current('crqReleasedPurchase');
      showToast.success(message);
      onView(res, message);
    });
  // WP4a: Item Tracking after release, for the unshipped balance. Refusals
  // (department, coverage, nothing left to ship) come back as the action error.
  const assignTracking = async (
    lineId: string,
    value: TrackingAssignment,
  ): Promise<boolean> => {
    let ok = false;
    await run(async () => {
      emit(
        await api.post(`/requisition/${id}/item-tracking`, {
          lines: [{ line_id: lineId, ...value }],
        }),
        tRef.current('crqTrackingSaved'),
      );
      ok = true;
    });
    return ok;
  };
  const linkPo = () =>
    run(async () =>
      emit(
        await api.post(`/requisition/${id}/link-po`, {
          linked_po_no: poNo.trim(),
        }),
        tRef.current('crqPoLinked'),
      ),
    );

  // Receive: shipments with something left, then that shipment's lines with something left.
  const openShipments = (draft.shipments ?? []).filter((s) =>
    s.lines.some((l) => l.remaining > 1e-9),
  );

  const actionBar = (
    <div className="flex flex-wrap items-end gap-2">
      {actions.includes('reopen') && (
        <Button size="sm" variant="outline" onClick={reopen} disabled={busy}>
          {t('crqReopen')}
        </Button>
      )}
      <Button
        size="sm"
        onClick={release}
        disabled={busy || !actions.includes('release')}
      >
        {t('crqRelease')}
      </Button>
      {draft.purpose === 'PURCHASE' && (
        <>
          <Field className="w-56" label={t('crqPoNo')} htmlFor="crq-po-no">
            <input
              id="crq-po-no"
              className="nf-input-sm"
              style={inputStyle}
              value={poNo}
              disabled={busy || !actions.includes('linkPo')}
              onChange={(e) => setPoNo(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            onClick={linkPo}
            disabled={busy || !actions.includes('linkPo') || !poNo.trim()}
          >
            {t('crqLinkPo')}
          </Button>
        </>
      )}
      {draft.purpose === 'STORE' && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowTransferOrder(true)}
            disabled={
              busy || !actions.includes('ship') || !draft.linked_transfer_id
            }
          >
            {t('crqShip')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowTransferOrder(true)}
            disabled={
              busy || !actions.includes('receive') || !draft.linked_transfer_id
            }
          >
            {t('crqReceive')}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <>
      {!embedded && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> {t('crqBack')}
          </Button>
          <h2
            className="text-base font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {draft.req_no}
          </h2>
        </div>
      )}
      <DialogHeaderActions>{actionBar}</DialogHeaderActions>
      {(draft.document_status ?? 'OPEN') === 'RELEASED' && (
        // W2D W12: the record the release created — the Store transfer order, or the Purchase's PO no.
        <div
          className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          {draft.purpose === 'STORE' ? (
            <span className="inline-flex gap-1.5">
              <span>{t('crqLinkedTransfer')}</span>
              {draft.linked_transfer_no ? (
                <>
                  <span
                    className="font-mono"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {draft.linked_transfer_no}
                  </span>
                  {draft.linked_transfer_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowTransferOrder(true)}
                    >
                      View Transfer Order
                    </Button>
                  )}
                </>
              ) : (
                t('crqNoLinkedTransfer')
              )}
            </span>
          ) : (
            <span className="inline-flex gap-1.5">
              <span>{t('crqLinkedPo')}</span>
              <span
                className="font-mono"
                style={{ color: 'var(--text-primary)' }}
              >
                {draft.linked_po_no || t('crqNoLinkedPo')}
              </span>
            </span>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <CommonRequisitionDocument
          view={draft}
          editable={editable}
          options={options}
          onChange={setDraft}
          onAssignTracking={
            releasedStore && can.transfer ? assignTracking : undefined
          }
        />
      </div>
      <div className="flex shrink-0 flex-col gap-3">
        {/* Keep action results after the affected lines and scroll them into
            view; drafting controls live in the dialog footer and later
            workflow controls live in the dialog header. */}
        {/* Review p1f, concern 5: a refusal goes in the same place, for the same reason. */}
      </div>
      {(actions.includes('save') || actions.includes('submit')) && (
        <DialogFooterActions>
          {actions.includes('save') && (
            <Button
              size="sm"
              variant={id ? 'outline' : undefined}
              onClick={save}
              disabled={busy}
            >
              {t(id ? 'crqSave' : 'crqCreate')}
            </Button>
          )}
          {id && actions.includes('submit') && (
            <Button size="sm" onClick={submit} disabled={busy}>
              {t('crqSubmit')}
            </Button>
          )}
        </DialogFooterActions>
      )}
      {showTransferOrder && draft.linked_transfer_id && (
        <StockTransferPanel
          embeddedTransferId={draft.linked_transfer_id}
          embeddedRequisition={{ id: id!, kind: 'COMMON' }}
          embeddedShipmentId={openShipments[0]?.shipment_id}
          onEmbeddedPosted={(result, kind) =>
            emit(
              result,
              tRef.current(kind === 'RECEIPT' ? 'crqReceived' : 'crqShipped'),
            )
          }
          onEmbeddedClose={() => setShowTransferOrder(false)}
        />
      )}
    </>
  );
}

export default CommonRequisitionDetail;
