import type { TranslationKeys } from "@/utils/translations";
import { changeTone, columnGroups, FARROWING_COLUMNS, groupStarts, NA, type FarrowingReport } from "./farrowing-report-columns";

type T = (key: TranslationKeys, params?: Record<string, string | number>) => string;

// jsPDF's built-in fonts cover Latin-1 only: a dash or ≤ / ≥ outside it prints as "�".
const latin1 = (text: string) => text.replace(/[–—]/g, "-").replace(/≤ ?/g, "<=").replace(/≥ ?/g, ">=");

/**
 * The Farrowing Report as a PDF: the same rows and columns as the screen, landscape A3 so the 40-odd columns
 * stay readable. jsPDF is loaded only when someone exports.
 */
export async function exportFarrowingPdf(report: FarrowingReport, t: T): Promise<void> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });

  const filters = [
    `${t("rptFarm")}: ${report.farm.farm_name}`,
    `${t("rptDateFrom")}: ${report.filters.date_from}`,
    `${t("rptDateTo")}: ${report.filters.date_to}`,
    `${t("rptBatch")}: ${report.filters.batch_no ?? t("rptAll")}`,
    `${t("rptParity")}: ${report.filters.parity ?? t("rptAll")}`,
    `${t("rptSow")}: ${report.filters.sow_code ?? t("rptAll")}`,
  ].join("   ");

  doc.setFontSize(14);
  doc.text(t("rptFarrowingReport"), 10, 12);
  doc.setFontSize(8);
  doc.text(filters, 10, 18);
  doc.text(t("rptGeneratedAt", { at: new Date(report.generated_at).toLocaleString() }), 10, 22);

  const head = [
    [
      { content: t("rptFarmCol"), rowSpan: 2 },
      { content: t("rptSowBatch"), rowSpan: 2 },
      ...columnGroups(FARROWING_COLUMNS).map((g) => ({ content: latin1(t(g.group)), colSpan: g.span })),
    ],
    FARROWING_COLUMNS.map((c) => latin1(t(c.sub))),
  ];
  const body = report.rows.map((row) => [
    row.is_total ? t("rptFarmTotal") : report.farm.farm_name,
    row.is_total ? "" : `${row.batch_no}\n${t("rptPriorBatch", { batch: row.prior_batch_no ?? NA })}`,
    ...FARROWING_COLUMNS.map((c) => latin1(c.cell(row, t))),
  ]);

  const starts = groupStarts(FARROWING_COLUMNS);
  autoTable(doc, {
    head,
    body,
    startY: 26,
    margin: { left: 6, right: 6 },
    styles: { fontSize: 4, cellPadding: 0.4, halign: "right", lineWidth: 0.1 },
    headStyles: { fillColor: [235, 238, 242], textColor: 30, halign: "center", valign: "middle", fontStyle: "bold" },
    columnStyles: { 0: { halign: "left" }, 1: { halign: "left" } },
    theme: "grid",
    didParseCell: (data: any) => {
      if (data.section === "body" && report.rows[data.row.index]?.is_total) data.cell.styles.fontStyle = "bold";
      // A wider, light line before each group of columns, as on the screen (columns 0 and 1 are the Farm and the Sow Batch).
      if (starts.has(data.column.index - 2)) {
        data.cell.styles.lineWidth = { top: 0.1, right: 0.1, bottom: 0.1, left: 0.5 };
        data.cell.styles.lineColor = [190, 194, 202];
      }
      // Change and YoY %: good news green, bad news red, as on the screen.
      const column = FARROWING_COLUMNS[data.column.index - 2];
      const tone = data.section === "body" && column ? changeTone(column, String(data.cell.raw ?? "")) : null;
      if (tone) data.cell.styles.textColor = tone === "good" ? [47, 125, 91] : [183, 41, 62];
    },
  });

  const y = (doc as any).lastAutoTable?.finalY ?? 26;
  doc.setFontSize(7);
  doc.text(t("rptPriorYearNote"), 6, y + 5);

  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-");
  doc.save(`farrowing-report_${safe(report.farm.farm_name)}_${report.filters.date_from}_${report.filters.date_to}.pdf`);
}
