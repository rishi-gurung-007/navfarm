'use client';

import { Pagination, type PaginationProps } from './pagination';

/**
 * The pager as the footer of a table card: "Showing X–Y of Z", rows per page, and previous/next,
 * on the same surface as the table header. Unlike a bare <Pagination> it is always shown when there
 * are rows, so a short list still says how many there are.
 */
export function TablePager(props: PaginationProps) {
  if (props.total === 0) return null;
  return (
    <div className="border-t border-[var(--row-border)] bg-[var(--surface-raised)] px-3">
      <Pagination {...props} />
    </div>
  );
}
