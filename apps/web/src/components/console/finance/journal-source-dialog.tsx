'use client';

import { NA } from '@/utils/na';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/services/api-client';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useLanguage } from '@/hooks/useLanguage';
import { formatAmount, formatQuantity, formatRate } from '@/lib/utils';
import type { TranslationKeys } from '@/utils/translations';

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  primary: { color: 'var(--text-primary)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
};

type Format = 'text' | 'quantity' | 'amount' | 'rate';
type Field = { key: string; label: TranslationKeys; format?: Format };

const TITLE: Record<string, TranslationKeys> = {
  GOODS_RECEIPT: 'jsdGoodsReceipt',
  STOCK_ADJUSTMENT: 'jsdStockAdjustment',
  BATCH: 'jsdBatch',
  EXPENSE: 'jsdExpense',
  MILL_PRODUCTION_OUTPUT: 'jsdMillOutput',
};

// The header fields each source document's own page shows, in the same order.
const HEADER: Record<string, Field[]> = {
  GOODS_RECEIPT: [
    { key: 'posting_date', label: 'jpPostingDate' },
    { key: 'warehouse', label: 'jsdWarehouse' },
    { key: 'supplier', label: 'jsdSupplier' },
    { key: 'reference', label: 'jsdReference' },
    { key: 'posted_at', label: 'jsdPostedAt' },
    { key: 'remarks', label: 'jsdRemarks' },
  ],
  STOCK_ADJUSTMENT: [
    { key: 'posting_date', label: 'jpPostingDate' },
    { key: 'warehouse', label: 'jsdWarehouse' },
    { key: 'reason', label: 'jsdReason' },
    { key: 'posted_at', label: 'jsdPostedAt' },
    { key: 'remarks', label: 'jsdRemarks' },
  ],
  STOCK_TRANSFER: [
    { key: 'date', label: 'jsdDate' },
    { key: 'transfer_no', label: 'jsdTransferNo' },
    { key: 'from_warehouse', label: 'jsdFromWarehouse' },
    { key: 'to_warehouse', label: 'jsdToWarehouse' },
    { key: 'vehicle_no', label: 'jsdVehicleNo' },
  ],
  BATCH: [
    { key: 'breed', label: 'jsdBreed' },
    { key: 'stage', label: 'jsdStage' },
    { key: 'shed', label: 'jsdShed' },
    { key: 'start_date', label: 'jsdStartDate' },
    { key: 'expected_end_date', label: 'jsdExpectedEndDate' },
    { key: 'actual_end_date', label: 'jsdActualEndDate' },
    { key: 'opening_quantity', label: 'jsdOpeningQuantity', format: 'quantity' },
    { key: 'closing_quantity', label: 'jsdClosingQuantity', format: 'quantity' },
    { key: 'uom', label: 'jsdUom' },
    { key: 'costing_method', label: 'jsdCostingMethod' },
    { key: 'total_cost', label: 'jsdTotalCost', format: 'amount' },
    { key: 'unit_cost', label: 'jsdUnitCost', format: 'rate' },
  ],
  EXPENSE: [
    { key: 'posting_date', label: 'jpPostingDate' },
    { key: 'payee', label: 'jsdPayee' },
    { key: 'description', label: 'jpDescription' },
    { key: 'amount', label: 'jsdAmount', format: 'amount' },
    { key: 'expense_account', label: 'jsdExpenseAccount' },
    { key: 'payment_account', label: 'jsdPaymentAccount' },
    { key: 'location', label: 'jsdLocation' },
    { key: 'sub_location', label: 'jsdSubLocation' },
    { key: 'remarks', label: 'jsdRemarks' },
  ],
  MILL_PRODUCTION_OUTPUT: [
    { key: 'production_date', label: 'jsdProductionDate' },
    { key: 'mill', label: 'jsdMill' },
    { key: 'bin', label: 'jsdBin' },
    { key: 'remarks', label: 'jsdRemarks' },
  ],
};

const LINE_TRACKING: Field[] = [
  { key: 'lot_no', label: 'jsdLotNo' },
  { key: 'serial_no', label: 'jsdSerialNo' },
];

const LINES: Record<string, Field[]> = {
  GOODS_RECEIPT: [
    { key: 'rate', label: 'jsdRate', format: 'rate' },
    { key: 'amount', label: 'jsdTotalCost', format: 'amount' },
    ...LINE_TRACKING,
  ],
  STOCK_ADJUSTMENT: [{ key: 'rate', label: 'jsdRate', format: 'rate' }, ...LINE_TRACKING],
  STOCK_TRANSFER: LINE_TRACKING,
  MILL_PRODUCTION_OUTPUT: [
    { key: 'rate', label: 'jsdRate', format: 'rate' },
    { key: 'amount', label: 'jsdValue', format: 'amount' },
    { key: 'lot_no', label: 'jsdLotNo' },
  ],
};

function shown(value: unknown, format: Format = 'text', uom?: string) {
  if (value === null || value === undefined || value === '') return NA;
  if (format === 'quantity') return formatQuantity(value, uom);
  if (format === 'amount') return formatAmount(value);
  if (format === 'rate') return formatRate(value);
  return String(value);
}

/** The document a system journal was posted from, read-only, opened from the journal's Source. */
export function JournalSourceDialog({
  journalId,
  documentNo,
  onClose,
}: {
  journalId: string | null;
  documentNo: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [doc, setDoc] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!journalId) return;
    let live = true;
    setDoc(null);
    setError('');
    setLoading(true);
    api
      .get(`/journal/${journalId}/source-document`)
      .then((res: any) => live && setDoc(res?.data ?? res))
      .catch((e: any) => live && setError(e?.message || t('jsdLoadFailed')))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [journalId, t]);

  const type = doc?.type as string | undefined;
  const titleKey =
    type === 'STOCK_TRANSFER'
      ? doc?.header?.kind === 'RECEIPT'
        ? 'jsdTransferReceipt'
        : 'jsdTransferShipment'
      : type && TITLE[type];
  const lineFields = type ? LINES[type] : undefined;

  return (
    <Dialog
      open={!!journalId}
      onClose={onClose}
      title={titleKey ? `${t(titleKey)} — ${documentNo}` : documentNo}
      maxWidth="xl"
    >
      {loading && (
        <div className="flex items-center justify-center py-10" style={S.muted}>
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {error && (
        <p className="py-6 text-center text-sm" style={S.sub}>
          {error}
        </p>
      )}
      {doc && type && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            <div>
              <p className="font-semibold uppercase tracking-wider" style={S.muted}>
                {t('jpStatus')}
              </p>
              <Badge
                variant={doc.header.status === 'POSTED' ? 'success' : 'neutral'}
                className="mt-1"
              >
                {doc.header.status}
              </Badge>
            </div>
            {(HEADER[type] || []).map((f) => (
              <div key={f.key}>
                <p className="font-semibold uppercase tracking-wider" style={S.muted}>
                  {t(f.label)}
                </p>
                <p style={S.primary}>
                  {shown(doc.header[f.key], f.format, doc.header.uom)}
                </p>
              </div>
            ))}
          </div>

          {lineFields && (
            <div
              className="overflow-x-auto rounded-[var(--radius-sm)] border"
              style={S.surface}
            >
              <table className="w-full border-collapse text-left text-xs">
                <TableHeader>
                  <tr className="border-b border-(--row-border)">
                    <TableHead className="h-auto px-3 py-2">{t('jsdItemNo')}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t('jsdItemName')}</TableHead>
                    <TableHead className="h-auto px-3 py-2 text-right">{t('jsdQuantity')}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t('jsdUom')}</TableHead>
                    {lineFields.map((f) => (
                      <TableHead
                        key={f.key}
                        className={`h-auto px-3 py-2 ${f.format && f.format !== 'text' ? 'text-right' : ''}`}
                      >
                        {t(f.label)}
                      </TableHead>
                    ))}
                  </tr>
                </TableHeader>
                <TableBody>
                  {(doc.lines as Row[]).map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="px-3 py-2 whitespace-nowrap" style={S.primary}>
                        {shown(l.item_code)}
                      </TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>
                        {shown(l.item_name)}
                      </TableCell>
                      <TableCell className="px-3 py-2 text-right font-mono" style={S.primary}>
                        {shown(l.quantity, 'quantity', l.uom)}
                      </TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>
                        {shown(l.uom)}
                      </TableCell>
                      {lineFields.map((f) => (
                        <TableCell
                          key={f.key}
                          className={`px-3 py-2 ${f.format && f.format !== 'text' ? 'text-right font-mono' : 'font-mono'}`}
                          style={S.primary}
                        >
                          {shown(l[f.key], f.format)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
