'use client';

import { useMemo, useState } from 'react';

/**
 * Pages a list that is already in memory. The props go straight to <TablePager> / <Pagination>.
 * The page is clamped to the rows that exist, so a list that shrinks (a filter, a deleted row)
 * never leaves the table on an empty page past the end.
 */
export function usePagination<T>(rows: T[], initialPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const total = rows.length;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, lastPage);

  const pageRows = useMemo(
    () => rows.slice((current - 1) * pageSize, current * pageSize),
    [rows, current, pageSize],
  );

  return {
    pageRows,
    paginationProps: {
      page: current,
      pageSize,
      total,
      onPageChange: setPage,
      onPageSizeChange: (size: number) => {
        setPageSize(size);
        setPage(1);
      },
    },
  };
}
