'use client';

import { useEffect, useRef, useState } from 'react';
import { Truck } from 'lucide-react';
import { api } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { useLanguage } from '@/hooks/useLanguage';
import { showToast } from '@/components/ui/toast';
import { unwrap } from './feed-format';
import { RecordLink, itemHref, locationHref } from './feed-requisition-header';
import { LOADING_STATUS_LABEL, labelOf } from './requisition-labels';
import { formatDateShort, formatStampShort } from '@/utils/date-short';
import { requisitionHref } from './transfer-source-links';
import { Dialog } from '@/components/ui/dialog';

type LoadingSheet = {
  loading_sheet_id: string;
  loading_sheet_no: string;
  requisition_id: string;
  requisition_no: string | null;
  requested_qty_kg: string | number;
  mill_approved_qty_kg: string | number;
  scheduled_qty_kg: string | number;
  compartment_no: string | null;
  kg_loaded: string | number | null;
  status: string;
  shipment_no?: string | null;
  farm_id: string;
  farm_code: string | null;
  farm_name: string | null;
  destination_silo_id: string | null;
  destination_silo_code: string | null;
  destination_silo_name: string | null;
  item_id: string;
  item_code: string | null;
  item_name: string | null;
  diet_no: number | null;
  mill_loading_bin_id: string | null;
  mill_loading_bin_code: string | null;
  mill_loading_bin_name: string | null;
  adjustment_reason: string | null;
  requested_delivery_date: string | null;
  loaded_by_name: string | null;
  loaded_at: string | null;
  transfer_id: string | null;
  transfer_no: string | null;
  truck_no?: string | null;
  compartments?: Array<{
    compartment_id?: string;
    line_no?: number;
    compartment_no: string;
    kg_loaded: string | number;
    loaded_by?: string | null;
    loaded_by_name?: string | null;
    loaded_at?: string | null;
  }>;
  dispatch_notification_status?: 'SENT' | 'NOT_SENT';
  dispatch_notification_message?: string | null;
  dispatch_notification_at?: string | null;
  estimated_arrival_at?: string | null;
};
type CompartmentDraft = {
  compartmentId?: string;
  compartmentNo: string;
  kgLoaded: string;
  loadedBy: string;
};
type Draft = { compartments: CompartmentDraft[] };
const quantity = (value: string | number | null, na: string) =>
  value == null
    ? na
    : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })} KG`;

/** W5 (10 Oct): routes for the records a loading sheet names. */
export const transferHref = (id: string) =>
  `/inventory/transfers?id=${encodeURIComponent(id)}`;
/** A loading sheet opens in the Feed Forecast → Loading Instructions tab. */
export const loadingSheetHref = (id: string) =>
  `/inventory/feed-forecast?tab=loading-instructions&id=${encodeURIComponent(id)}`;

/** The `?id=` this tab should open: only when the URL names this tab, or no tab (the legacy route). */
export function deepLinkIdFor(tab: string): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const named = params.get('tab');
    return !named || named === tab ? params.get('id') : null;
  } catch {
    return null;
  }
}

const TH =
  'sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)';
const TD = 'border-b border-(--border) px-3 py-2 align-top text-sm';
const NUM = 'whitespace-nowrap text-right tabular-nums';
const DOT: Record<string, string> = {
  DISPATCHED: 'bg-(--success)',
  RECEIVED: 'bg-(--success)',
  LOADED: 'bg-(--warning)',
};

/** Feed Loading Instructions content shared by the query-param tab and legacy route. */
export function FeedLoadingPanel() {
  const { t } = useLanguage();
  const na = t('fcsNotAvailable');
  const [rows, setRows] = useState<LoadingSheet[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [eta, setEta] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId] = useState(() => deepLinkIdFor('loading-instructions'));
  const openRow = useRef<HTMLTableRowElement | null>(null);
  const valuesOf = (row: LoadingSheet): Draft =>
    draft[row.loading_sheet_id] || {
      compartments: row.compartments?.length
        ? row.compartments.map((line) => ({
            compartmentId: line.compartment_id,
            compartmentNo: line.compartment_no,
            kgLoaded: String(line.kg_loaded),
            loadedBy: line.loaded_by_name || line.loaded_by || '',
          }))
        : row.compartment_no || row.kg_loaded != null
          ? [
              {
                compartmentNo: row.compartment_no || '',
                kgLoaded: row.kg_loaded == null ? '' : String(row.kg_loaded),
                loadedBy: row.loaded_by_name || '',
              },
            ]
          : [],
    };
  const load = () =>
    api
      .get('/feed-requisition/loading-sheets')
      .then((response) => setRows(unwrap<LoadingSheet[]>(response)))
      .catch((err: any) => showToast.error(err?.message || t('flsLoadFailed')));
  useEffect(() => {
    load();
  }, []);
  // Opened by link: ?tab=loading-instructions&id=<loading sheet> (or /inventory/feed-loading?id=).
  useEffect(() => {
    if (openId && rows.some((row) => row.loading_sheet_id === openId))
      openRow.current?.scrollIntoView?.({ block: 'center' });
  }, [openId, rows]);
  const save = async (row: LoadingSheet) => {
    const values = valuesOf(row);
    const first = values.compartments[0];
    setSaving(row.loading_sheet_id);
    try {
      await api.put(
        `/feed-requisition/loading-sheets/${row.loading_sheet_id}`,
        {
          compartmentNo: first?.compartmentNo || undefined,
          kgLoaded:
            first?.kgLoaded === '' ? undefined : Number(first?.kgLoaded),
          loadedBy: first?.loadedBy.trim() || undefined,
          compartments: values.compartments.map((line) => ({
            compartmentId: line.compartmentId,
            compartmentNo: line.compartmentNo,
            kgLoaded: Number(line.kgLoaded),
            loadedBy: line.loadedBy.trim() || undefined,
          })),
        },
      );
      showToast.success(t('flsSaved'));
      await load();
      return true;
    } catch (err: any) {
      showToast.error(err?.message || t('flsSaveFailed'));
      return false;
    } finally {
      setSaving(null);
    }
  };
  const dispatch = async (row: LoadingSheet) => {
    setSaving(row.loading_sheet_id);
    try {
      await api.post(
        `/feed-requisition/loading-sheets/${row.loading_sheet_id}/dispatch`,
        eta[row.loading_sheet_id]
          ? { estimatedArrivalAt: eta[row.loading_sheet_id] }
          : {},
      );
      showToast.success(t('flsDispatched'));
      await load();
    } catch (err: any) {
      showToast.error(err?.message || t('flsDispatchFailed'));
    } finally {
      setSaving(null);
    }
  };
  return (
    <div data-fill-body className="min-h-0 overflow-y-auto">
      {rows.length === 0 ? (
        <EmptyState icon={Truck} title={t('flsEmpty')} />
      ) : (
        <div className="max-h-[65vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)">
          <table
            aria-label={t('flsListLabel')}
            className="w-max min-w-full border-separate border-spacing-0 text-left"
          >
            <thead>
              <tr>
                {(
                  [
                    ['flsColSheet', 'min-w-40'],
                    ['flsColRequisition', ''],
                    ['flsColFarm', 'min-w-44'],
                    ['flsColDeliveryDate', ''],
                    ['flsColItem', 'min-w-52'],
                    ['flsColRequested', 'text-right'],
                    ['flsColApproved', 'text-right'],
                    ['flsColReason', 'min-w-44'],
                    ['flsColCompartment', 'min-w-40'],
                    ['flsColLoaded', 'min-w-36'],
                    ['flsColLoadedBy', 'min-w-44'],
                    ['flsColLoadedAt', ''],
                    ['flsColStatus', ''],
                    ['flsColEta', 'whitespace-nowrap'],
                    ['flsColNotification', 'min-w-56'],
                    ['flsColActions', 'min-w-44'],
                  ] as const
                ).map(([key, cls]) => (
                  <th key={key} className={`${TH} ${cls}`}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const values = valuesOf(row);
                const locked =
                  row.status === 'DISPATCHED' || row.status === 'RECEIVED';
                const opened = row.loading_sheet_id === openId;
                return (
                  <tr
                    key={row.loading_sheet_id}
                    ref={opened ? openRow : undefined}
                    aria-selected={opened}
                    className={opened ? 'bg-(--surface-raised)' : undefined}
                  >
                    <td className={`${TD} whitespace-nowrap font-medium`}>
                      <RecordLink
                        code={row.loading_sheet_no}
                        href={loadingSheetHref(row.loading_sheet_id)}
                      />
                      <div className="max-w-56 whitespace-normal text-xs font-normal text-(--text-secondary)">
                        {row.transfer_no ? (
                          <RecordLink
                            code={row.transfer_no}
                            href={
                              row.transfer_id
                                ? transferHref(row.transfer_id)
                                : null
                            }
                          />
                        ) : null}
                        {row.transfer_no ? ' · ' : ''}
                        {row.shipment_no || t('flsShipmentPending')}
                        {row.truck_no ? (
                          <div>
                            {t('flsTruck')}: {row.truck_no}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {row.requisition_no ? (
                        <RecordLink
                          code={row.requisition_no}
                          href={requisitionHref('FEED', row.requisition_id)}
                        />
                      ) : (
                        na
                      )}
                    </td>
                    <td className={TD}>
                      <div className="font-medium">
                        {row.farm_code ? (
                          <RecordLink
                            code={row.farm_code}
                            href={locationHref(row.farm_id)}
                          />
                        ) : (
                          na
                        )}
                      </div>
                      <div className="text-xs text-(--text-secondary)">
                        {row.farm_name || ''}
                      </div>
                      <div className="mt-1 text-xs">
                        {row.destination_silo_code ? (
                          <RecordLink
                            code={row.destination_silo_code}
                            href={
                              row.destination_silo_id
                                ? locationHref(row.destination_silo_id)
                                : null
                            }
                          />
                        ) : (
                          t('flsNoDestination')
                        )}
                        <span className="text-(--text-secondary)">
                          {row.destination_silo_name
                            ? ` · ${row.destination_silo_name}`
                            : ''}
                        </span>
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {row.requested_delivery_date
                        ? formatDateShort(row.requested_delivery_date)
                        : na}
                    </td>
                    <td className={`${TD} whitespace-normal break-words`}>
                      <div className="font-medium">
                        {row.item_code ? (
                          <RecordLink
                            code={row.item_code}
                            href={itemHref(row.item_id)}
                          />
                        ) : (
                          na
                        )}
                        {row.diet_no == null ? null : (
                          <span className="ml-1 text-xs font-normal text-(--text-secondary)">
                            {t('fcdDiet', { no: row.diet_no })}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-(--text-secondary)">
                        {row.item_name || t('fcsNoDescription')}
                      </div>
                      <div className="mt-1 text-xs">
                        {t('flsBin')}:{' '}
                        {row.mill_loading_bin_code ? (
                          <RecordLink
                            code={row.mill_loading_bin_code}
                            href={
                              row.mill_loading_bin_id
                                ? locationHref(row.mill_loading_bin_id)
                                : null
                            }
                          />
                        ) : (
                          t('flsNotConfigured')
                        )}
                        <span className="text-(--text-secondary)">
                          {row.mill_loading_bin_name
                            ? ` · ${row.mill_loading_bin_name}`
                            : ''}
                        </span>
                      </div>
                    </td>
                    <td className={`${TD} ${NUM}`}>
                      {quantity(row.requested_qty_kg, na)}
                    </td>
                    <td className={`${TD} ${NUM}`}>
                      {quantity(row.mill_approved_qty_kg, na)}
                    </td>
                    <td className={`${TD} whitespace-normal break-words`}>
                      {row.adjustment_reason || t('fcsNoAdjustment')}
                    </td>
                    <td className={`${TD} min-w-56 whitespace-normal`}>
                      <div className="flex max-w-72 flex-wrap gap-1">
                        {values.compartments.length ? (
                          values.compartments.map((line, index) => (
                            <span
                              key={line.compartmentId || index}
                              className="inline-flex items-center rounded-full border border-(--border) bg-(--surface-raised) px-2 py-1 text-xs whitespace-nowrap"
                            >
                              {line.compartmentNo ||
                                t('flsUnassignedCompartment')}{' '}
                              ·{' '}
                              {line.kgLoaded === ''
                                ? na
                                : quantity(line.kgLoaded, na)}
                            </span>
                          ))
                        ) : (
                          <span className="text-(--text-muted)">
                            {t('flsNotLoaded')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${TD} ${NUM}`}>
                      {values.compartments.length
                        ? quantity(
                            values.compartments.reduce(
                              (total, line) =>
                                total + (Number(line.kgLoaded) || 0),
                              0,
                            ),
                            na,
                          )
                        : na}
                    </td>
                    <td className={`${TD} min-w-44 whitespace-normal`}>
                      <div className="max-w-56 break-words">
                        {values.compartments
                          .map((line) => line.loadedBy)
                          .filter(Boolean)
                          .filter(
                            (name, index, names) =>
                              names.indexOf(name) === index,
                          )
                          .join(', ') || na}
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {row.loaded_at
                        ? formatStampShort(row.loaded_at, true)
                        : t('flsNotLoaded')}
                    </td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--text-secondary)">
                        <span
                          aria-hidden
                          className={`h-2 w-2 rounded-full ${DOT[row.status] ?? 'bg-(--text-muted)'}`}
                        />
                        {labelOf(LOADING_STATUS_LABEL, row.status, t)}
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {row.estimated_arrival_at
                        ? formatStampShort(row.estimated_arrival_at)
                        : na}
                    </td>
                    <td className={`${TD} whitespace-normal break-words`}>
                      <div className="text-xs font-medium">
                        {row.dispatch_notification_status === 'SENT'
                          ? t('flsNotificationSent')
                          : t('flsNotificationNotSent')}
                        {row.dispatch_notification_at ? (
                          <span className="ml-1 font-normal text-(--text-secondary)">
                            {formatStampShort(
                              row.dispatch_notification_at,
                              true,
                            )}
                          </span>
                        ) : null}
                      </div>
                      {row.dispatch_notification_message ? (
                        <div className="max-w-64 text-xs text-(--text-secondary)">
                          {row.dispatch_notification_message}
                        </div>
                      ) : null}
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(row.loading_sheet_id)}
                        >
                          {locked
                            ? t('flsViewCompartments')
                            : t('flsEditCompartments')}
                        </Button>
                        {row.status === 'LOADED' && (
                          <input
                            type="datetime-local"
                            aria-label={t('flsEtaFor', {
                              no: row.loading_sheet_no,
                            })}
                            className="nf-input-sm h-9 w-48"
                            value={eta[row.loading_sheet_id] || ''}
                            onChange={(event) =>
                              setEta({
                                ...eta,
                                [row.loading_sheet_id]: event.target.value,
                              })
                            }
                          />
                        )}
                        {row.status === 'LOADED' && (
                          <Button
                            size="sm"
                            onClick={() => dispatch(row)}
                            disabled={saving === row.loading_sheet_id}
                          >
                            {t('flsDispatch')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editingId &&
        (() => {
          const row = rows.find(
            (candidate) => candidate.loading_sheet_id === editingId,
          );
          if (!row) return null;
          const values = valuesOf(row);
          const locked =
            row.status === 'DISPATCHED' || row.status === 'RECEIVED';
          const editLine = (index: number, patch: Partial<CompartmentDraft>) =>
            setDraft({
              ...draft,
              [row.loading_sheet_id]: {
                compartments: values.compartments.map((line, lineIndex) =>
                  lineIndex === index ? { ...line, ...patch } : line,
                ),
              },
            });
          const addLine = () =>
            setDraft({
              ...draft,
              [row.loading_sheet_id]: {
                compartments: [
                  ...values.compartments,
                  { compartmentNo: '', kgLoaded: '', loadedBy: '' },
                ],
              },
            });
          const removeLine = (index: number) =>
            setDraft({
              ...draft,
              [row.loading_sheet_id]: {
                compartments: values.compartments.filter(
                  (_, lineIndex) => lineIndex !== index,
                ),
              },
            });
          return (
            <Dialog
              open
              onClose={() =>
                saving !== row.loading_sheet_id && setEditingId(null)
              }
              title={t('flsCompartmentLines')}
              description={row.loading_sheet_no}
              maxWidth="lg"
              footer={
                <>
                  <Button
                    variant="outline"
                    onClick={() => setEditingId(null)}
                    disabled={saving === row.loading_sheet_id}
                  >
                    {t('cancel')}
                  </Button>
                  {!locked && (
                    <Button
                      onClick={async () => {
                        if (await save(row)) setEditingId(null);
                      }}
                      disabled={saving === row.loading_sheet_id}
                    >
                      {t('flsSave')}
                    </Button>
                  )}
                </>
              }
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-(--text-secondary)">
                    {t('flsDialogTotal')}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {quantity(
                      values.compartments.reduce(
                        (total, line) => total + (Number(line.kgLoaded) || 0),
                        0,
                      ),
                      na,
                    )}{' '}
                    / {quantity(row.scheduled_qty_kg, na)}
                  </span>
                </div>
                {values.compartments.map((line, index) => (
                  <div
                    key={line.compartmentId || index}
                    className="grid gap-2 rounded-md border border-(--border) p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
                  >
                    <label className="text-xs text-(--text-secondary)">
                      {t('flsColCompartment')}
                      <input
                        aria-label={`${t('flsCompartmentFor', { no: row.loading_sheet_no })}${index ? ` ${index + 1}` : ''}`}
                        className="nf-input-sm mt-1 h-9 w-full"
                        value={line.compartmentNo}
                        disabled={locked}
                        onChange={(event) =>
                          editLine(index, { compartmentNo: event.target.value })
                        }
                      />
                    </label>
                    <label className="text-xs text-(--text-secondary)">
                      {t('flsColLoaded')}
                      <input
                        aria-label={`${t('flsLoadedFor', { no: row.loading_sheet_no })}${index ? ` ${index + 1}` : ''}`}
                        className="nf-input-sm mt-1 h-9 w-full text-right tabular-nums"
                        type="number"
                        min="0"
                        max={Number(row.scheduled_qty_kg)}
                        value={line.kgLoaded}
                        disabled={locked}
                        onChange={(event) =>
                          editLine(index, { kgLoaded: event.target.value })
                        }
                      />
                    </label>
                    <label className="text-xs text-(--text-secondary)">
                      {t('flsColLoadedBy')}
                      <input
                        aria-label={`${t('flsLoadedByFor', { no: row.loading_sheet_no })}${index ? ` ${index + 1}` : ''}`}
                        className="nf-input-sm mt-1 h-9 w-full"
                        maxLength={36}
                        value={line.loadedBy}
                        disabled={locked}
                        onChange={(event) =>
                          editLine(index, { loadedBy: event.target.value })
                        }
                      />
                    </label>
                    {!locked && (
                      <button
                        type="button"
                        aria-label={t('flsRemoveCompartment')}
                        className="h-9 px-2 text-sm text-(--danger)"
                        onClick={() => removeLine(index)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {!locked && (
                  <Button variant="outline" size="sm" onClick={addLine}>
                    {t('flsAddCompartment')}
                  </Button>
                )}
              </div>
            </Dialog>
          );
        })()}
    </div>
  );
}
