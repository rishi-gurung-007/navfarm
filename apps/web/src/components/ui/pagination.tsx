"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "../../hooks/useLanguage";
import { Select } from "./select";

const S = {
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Optional page-size selector; omit to keep pageSize fixed. */
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

/** Shared list-screen pagination — "Showing X–Y of Z" plus prev/next, used across
 * every table/list screen in the console instead of dumping the whole result set. */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100] }: PaginationProps) {
  const { t } = useLanguage();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2 text-xs" style={S.sub}>
      <div className="flex items-center gap-3">
        <span>
          {t("paginationShowing")} <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{from}–{to}</span> {t("paginationOf")}{" "}
          <span className="font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>{total}</span>
        </span>
        {onPageSizeChange && (
          <Select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label={t("gRowsPerPage")}
            fullWidth={false}
            className="nf-input-sm nf-select w-[7.5rem]"
            style={S.input}
          >
            {pageSizeOptions.map((n) => (<option key={n} value={n}>{t("paginationPerPage", { n })}</option>))}
          </Select>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="flex h-7 w-7 items-center justify-center rounded-lg border transition disabled:opacity-35"
          style={S.input}
          aria-label={t("paginationPrevious")}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[64px] text-center tabular-nums" style={S.muted}>{t("paginationPageOf", { page, totalPages })}</span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="flex h-7 w-7 items-center justify-center rounded-lg border transition disabled:opacity-35"
          style={S.input}
          aria-label={t("paginationNext")}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
