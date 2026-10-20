import type { TranslationKeys } from "@/utils/translations";
import { columnGroups, FARROWING_COLUMNS, NA, type FarrowingReport } from "./farrowing-report-columns";

type T = (key: TranslationKeys, params?: Record<string, string | number>) => string;

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
      ...columnGroups(FARROWING_COLUMNS).map((g) => ({ content: t(g.group), colSpan: g.span })),
    ],
    FARROWING_COLUMNS.map((c) => t(c.sub)),
  ];
  const body = report.rows.map((row) => [
    row.is_total ? t("rptFarmTotal") : report.farm.farm_name,
    row.is_total ? "" : `${row.batch_no}\n${t("rptPriorBatch", { batch: row.prior_batch_no ?? NA })}`,
    ...FARROWING_COLUMNS.map((c) => c.cell(row, t)),
  ]);

  autoTable(doc, {
    head,
    body,
    startY: 26,
    margin: { left: 6, right: 6 },
    styles: { fontSize: 4.5, cellPadding: 0.5, halign: "right", lineWidth: 0.1 },
    headStyles: { fillColor: [235, 238, 242], textColor: 30, halign: "center", valign: "middle", fontStyle: "bold" },
    columnStyles: { 0: { halign: "left" }, 1: { halign: "left" } },
    theme: "grid",
    didParseCell: (data: any) => {
      if (data.section === "body" && report.rows[data.row.index]?.is_total) data.cell.styles.fontStyle = "bold";
    },
  });

  const y = (doc as any).lastAutoTable?.finalY ?? 26;
  doc.setFontSize(7);
  doc.text(t("rptPriorYearNote"), 6, y + 5);

  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-");
  doc.save(`farrowing-report_${safe(report.farm.farm_name)}_${report.filters.date_from}_${report.filters.date_to}.pdf`);
}
