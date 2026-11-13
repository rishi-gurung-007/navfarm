'use client';

import { formatDate } from '@/utils/date-short';
import { NA } from '@/utils/na';
import { useEffect, useState } from 'react';
import { Search, Loader2, Inbox, Ban, Eye } from 'lucide-react';
import QRCode from 'react-qr-code';
import { api } from '@/services/api-client';
import { Dialog } from '@/components/ui/dialog';
import { Toast } from '@/components/ui/toast';
import { Pagination } from '@/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getActiveCompanyId } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { Badge } from '@/components/ui/badge';
import { confirmAction } from '@/components/ui/confirm-dialog';
import { formatQuantity } from '@/lib/utils';
import type { TranslationKeys } from '@/utils/translations';

interface ChainNode {
  batch_no?: string;
  start_date?: string | null;
  costing_method?: string | null;
  parents?: ChainNode[];
}

/** The batches a pack came from: its own batch, then each batch that fed it, indented under it. */
function OriginChain({
  node,
  t,
}: {
  node: ChainNode;
  t: (k: TranslationKeys, p?: Record<string, string | number>) => string;
}) {
  const method = node.costing_method
    ? node.costing_method
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase())
    : null;
  return (
    <div>
      <div>
        <span
          className="font-mono font-semibold"
          style={{ color: 'var(--text-primary)' }}
        >
          {node.batch_no ?? NA}
        </span>
        {node.start_date && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {' '}
            ·{' '}
            {t('pkChainStarted', {
              date: formatDate(node.start_date),
            })}
          </span>
        )}
        {method && (
          <span style={{ color: 'var(--text-muted)' }}> · {method}</span>
        )}
      </div>
      {node.parents && node.parents.length > 0 && (
        <div
          className="mt-1 ml-3 border-l pl-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="text-[10px] uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('pkChainFrom')}
          </div>
          {node.parents.map((parent, i) => (
            <OriginChain key={`${parent.batch_no}-${i}`} node={parent} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 25;

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  primary: { color: 'var(--text-primary)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
  accent: { color: 'var(--accent)' },
  input: {
    backgroundColor: 'var(--input-bg)',
    color: 'var(--input-text)',
    borderColor: 'var(--input-border)',
  },
};

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : (res?.data ?? res)) as T;
}

export default function PacksPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Row[]>([]);
  const [batches, setBatches] = useState<Row[]>([]);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const companyId = getActiveCompanyId();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      params.set('limit', '200');
      const res = await api.get(`/qr-code?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t('pkFailedToLoadPacks'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    params.set('limit', '500');
    const qs = params.toString();
    api
      .get(`/item?${qs}&isActive=true&isBlocked=false`)
      .then((r) =>
        setItems(
          (unwrap<Row[]>(r) || []).filter(
            (i) => !i.is_blocked && i.is_active !== false,
          ),
        ),
      )
      .catch(() => {});
    api
      .get(`/batch?${qs}`)
      .then((r) => setBatches(unwrap<Row[]>(r) || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itemLabel = (id: string) =>
    items.find((i) => i.item_id === id)?.item_code || NA;
  const batchLabel = (id: string) =>
    batches.find((b) => b.batch_id === id)?.batch_no || NA;

  const filtered = search
    ? rows.filter(
        (r) =>
          (r.pack_no || '').toLowerCase().includes(search.toLowerCase()) ||
          (r.lot_no || '').toLowerCase().includes(search.toLowerCase()),
      )
    : rows;

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);
  const pagedFiltered = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleVoid = async (row: Row) => {
    if (
      !(await confirmAction({
        title: t('cfVoidPackTitle'),
        message: t('pkVoidPackConfirm', { packNo: row.pack_no }),
        tone: 'danger',
      }))
    )
      return;
    setVoidingId(row.qr_id);
    setError('');
    try {
      await api.post(`/qr-code/${row.qr_id}/void`, {});
      await load();
      if (viewing?.qr_id === row.qr_id)
        setViewing((v) => (v ? { ...v, is_voided: true } : v));
    } catch (err: any) {
      setError(err?.message || t('pkFailedToVoidPack'));
    } finally {
      setVoidingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>
            {t('pkPacks')}
          </h2>
          <p className="mt-0.5 text-xs" style={S.sub}>
            {t('pkPacksDescription')}
          </p>
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={S.muted}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('pkSearchPackLotPlaceholder')}
            className="nf-input-sm pl-8 pr-3"
            style={S.input}
          />
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError('')} />

      {loading ? (
        <div
          className="rounded-[var(--radius-md)] border py-10 text-center text-xs"
          style={S.surface}
        >
          <Loader2
            className="mx-auto mb-2 h-5 w-5 animate-spin"
            style={S.accent}
          />{' '}
          {t('pkLoading')}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-[var(--radius-md)] border py-10 text-center text-xs"
          style={{ ...S.surface, ...S.sub }}
        >
          <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} />{' '}
          {t('pkNoPacksGeneratedYet')}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pkColPack')}</TableHead>
              <TableHead>{t('pkItem')}</TableHead>
              <TableHead>{t('pkLotNo')}</TableHead>
              <TableHead>{t('pkBatch')}</TableHead>
              <TableHead>{t('pkColQuantity')}</TableHead>
              <TableHead>{t('pkColProduced')}</TableHead>
              <TableHead>{t('pkColExpiry')}</TableHead>
              <TableHead>{t('pkGradeLabel')}</TableHead>
              <TableHead>{t('pkStatus')}</TableHead>
              <TableHead className="text-right">{t('action')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedFiltered.map((row) => (
              <TableRow
                key={row.qr_id}
                onClick={() => setViewing(row)}
                className="cursor-pointer"
                style={{ opacity: row.is_voided ? 0.55 : 1 }}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 rounded bg-white p-1">
                      <QRCode value={JSON.stringify(row.qr_data)} size={36} />
                    </div>
                    <span
                      className="whitespace-nowrap font-mono font-semibold"
                      style={S.primary}
                    >
                      {row.pack_no}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {itemLabel(row.item_id)}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono">
                  {row.lot_no || NA}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {batchLabel(row.batch_id)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatQuantity(row.net_weight)} {row.pack_uom}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.production_date ? formatDate(row.production_date) : NA}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.expiry_date ? formatDate(row.expiry_date) : NA}
                </TableCell>
                <TableCell>
                  {row.grade ? (
                    <Badge variant="accent">{row.grade}</Badge>
                  ) : (
                    NA
                  )}
                </TableCell>
                <TableCell>
                  {row.is_voided ? (
                    <Badge variant="danger">{t('pkVoided2')}</Badge>
                  ) : (
                    <Badge variant="success">{t('pkActive')}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewing(row);
                    }}
                  >
                    <Eye className="h-3.5 w-3.5" /> {t('pkView')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!loading && filtered.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}

      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? t('pkPackTitle', { packNo: viewing.pack_no }) : ''}
        footer={
          viewing && !viewing.is_voided ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => viewing && handleVoid(viewing)}
              disabled={voidingId === viewing.qr_id}
              className="gap-1.5"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              <Ban className="h-4 w-4" />{' '}
              {voidingId === viewing.qr_id
                ? t('pkVoidingEllipsis')
                : t('pkVoidPack')}
            </Button>
          ) : undefined
        }
      >
        {viewing && (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-[var(--radius-sm)] bg-white p-4">
              <QRCode value={JSON.stringify(viewing.qr_data)} size={200} />
            </div>
            <div className="grid w-full grid-cols-2 gap-3 text-xs">
              <div>
                <p
                  className="font-semibold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('pkItem')}
                </p>
                <p style={S.primary}>{itemLabel(viewing.item_id)}</p>
              </div>
              <div>
                <p
                  className="font-semibold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('pkBatch')}
                </p>
                <p style={S.primary}>{batchLabel(viewing.batch_id)}</p>
              </div>
              <div>
                <p
                  className="font-semibold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('pkLotNo')}
                </p>
                <p style={S.primary}>{viewing.lot_no || NA}</p>
              </div>
              <div>
                <p
                  className="font-semibold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('pkGradeLabel')}
                </p>
                <p style={S.primary}>{viewing.grade || NA}</p>
              </div>
              <div>
                <p
                  className="font-semibold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('pkNetGrossWeight')}
                </p>
                <p style={S.primary}>
                  {formatQuantity(viewing.net_weight)} /{' '}
                  {viewing.gross_weight != null
                    ? formatQuantity(viewing.gross_weight)
                    : NA}{' '}
                  {viewing.pack_uom}
                </p>
              </div>
              <div>
                <p
                  className="font-semibold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('pkProductionExpiry')}
                </p>
                <p style={S.primary}>
                  {formatDate(viewing.production_date)}{' '}
                  {viewing.expiry_date ? `→ ${formatDate(viewing.expiry_date)}` : ''}
                </p>
              </div>
              <div>
                <p
                  className="font-semibold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('pkQcLink')}
                </p>
                <p style={S.primary}>
                  {viewing.qc_id
                    ? t('pkLinkedResult', {
                        result: viewing.qr_data?.qc?.overall_result || NA,
                      })
                    : t('pkNotLinked')}
                </p>
              </div>
              <div>
                <p
                  className="font-semibold uppercase tracking-wider"
                  style={S.muted}
                >
                  {t('pkStatus')}
                </p>
                <p
                  style={
                    viewing.is_voided
                      ? { color: 'var(--danger)' }
                      : { color: 'var(--success)' }
                  }
                >
                  {viewing.is_voided ? t('pkVoided2') : t('pkActive')}
                </p>
              </div>
            </div>
            {viewing.qr_data?.type === 'SEMEN_LOT' &&
              (viewing.qr_data.label ||
                viewing.qr_data.colorant ||
                viewing.qr_data.week ||
                viewing.qr_data.destination_farm) && (
                <div className="grid w-full grid-cols-2 gap-3 text-xs">
                  {(
                    [
                      [t('pkSemenLabel'), viewing.qr_data.label],
                      [t('pkSemenColorant'), viewing.qr_data.colorant],
                      [
                        t('pkSemenWeek'),
                        viewing.qr_data.week
                          ? `${viewing.qr_data.week}${viewing.qr_data.week_year ? ` / ${viewing.qr_data.week_year}` : ''}`
                          : null,
                      ],
                      [
                        t('pkSemenFor'),
                        typeof viewing.qr_data.destination_farm === 'object'
                          ? [
                              viewing.qr_data.destination_farm?.code,
                              viewing.qr_data.destination_farm?.name,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : viewing.qr_data.destination_farm,
                      ],
                    ] as Array<[string, string | null | undefined]>
                  ).map(([label, value]) => (
                    <div key={label}>
                      <p
                        className="font-semibold uppercase tracking-wider"
                        style={S.muted}
                      >
                        {label}
                      </p>
                      <p style={S.primary}>{value || NA}</p>
                    </div>
                  ))}
                </div>
              )}
            {viewing.origin_batch_chain && (
              <div className="w-full">
                <p
                  className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
                  style={S.sub}
                >
                  {t('pkOriginChain')}
                </p>
                <div
                  className="rounded-[var(--radius-sm)] border p-3 text-[11px]"
                  style={S.surface}
                >
                  <OriginChain node={viewing.origin_batch_chain} t={t} />
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
