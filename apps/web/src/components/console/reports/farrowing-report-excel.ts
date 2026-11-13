import type { TranslationKeys } from '@/utils/translations';
import { downloadExcel } from '@/utils/excel-export';
import {
  changeTone,
  columnGroups,
  FARROWING_COLUMNS,
  type FarrowingReport,
} from './farrowing-report-columns';

type T = (
  key: TranslationKeys,
  params?: Record<string, string | number>,
) => string;

/**
 * The Farrowing Report as an Excel sheet (Rishi, 2 Nov: reports export to Excel only): the same rows and columns
 * as the screen, under the same column groups, the farm total in bold, and change / YoY % coloured as on the screen.
 */
export async function exportFarrowingExcel(
  report: FarrowingReport,
  t: T,
): Promise<void> {
  const batchType =
    report.filters.batch_status === 'ACTIVE'
      ? t('rptBatchTypeActive')
      : report.filters.batch_status === 'CLOSED'
        ? t('rptBatchTypeClosed')
        : t('rptAll');
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-');
  await downloadExcel(
    `farrowing-report_${safe(report.farm.farm_name)}_${report.filters.date_from}_${report.filters.date_to}.xlsx`,
    {
      name: t('rptFarrowingReport'),
      title: t('rptFarrowingReport'),
      info: [
        `${t('rptFarm')}: ${report.farm.farm_code} - ${report.farm.farm_name}`,
        `${t('rptDateFrom')}: ${report.filters.date_from}   ${t('rptDateTo')}: ${report.filters.date_to}`,
        `${t('rptBatchType')}: ${batchType}   ${t('rptBatch')}: ${report.filters.batch_no ?? t('rptAll')}   ${t('rptParity')}: ${report.filters.parity ?? t('rptAll')}   ${t('rptSow')}: ${report.filters.sow_code ?? t('rptAll')}`,
        t('rptGeneratedAt', {
          at: new Date(report.generated_at).toLocaleString(),
        }),
      ],
      lead: [t('rptSowBatch')],
      groups: columnGroups(FARROWING_COLUMNS).map((g) => ({
        label: t(g.group),
        span: g.span,
      })),
      headers: FARROWING_COLUMNS.map((c) => t(c.sub)),
      rows: report.rows.map((row) => [
        row.is_total ? t('rptFarmTotal') : row.batch_no,
        ...FARROWING_COLUMNS.map((c) => c.cell(row, t)),
      ]),
      boldRows: new Set(
        report.rows.flatMap((row, i) => (row.is_total ? [i] : [])),
      ),
      tone: (_r, c, value) =>
        c > 0
          ? changeTone(FARROWING_COLUMNS[c - 1], String(value ?? ''))
          : null,
      note: t('rptPriorYearNote'),
    },
  );
}
