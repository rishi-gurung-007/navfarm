/**
 * usePagination pages a list that is already in memory: the rows of the current page, and the props
 * <TablePager> takes. The page is clamped to the rows that exist.
 */
import { act, renderHook } from '@testing-library/react';
import { usePagination } from '../src/hooks/usePagination';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('usePagination', () => {
  it('starts on the first page with page-size rows', () => {
    const { result } = renderHook(() => usePagination(rows(60), 25));
    expect(result.current.pageRows).toEqual(rows(25));
    expect(result.current.paginationProps).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 60,
    });
  });

  it('moves to another page and returns the rows after it', () => {
    const { result } = renderHook(() => usePagination(rows(60), 25));
    act(() => result.current.paginationProps.onPageChange(3));
    expect(result.current.pageRows).toEqual(rows(60).slice(50));
    expect(result.current.paginationProps.page).toBe(3);
  });

  it('goes back to page 1 when the page size changes', () => {
    const { result } = renderHook(() => usePagination(rows(60), 25));
    act(() => result.current.paginationProps.onPageChange(3));
    act(() => result.current.paginationProps.onPageSizeChange(10));
    expect(result.current.paginationProps).toMatchObject({
      page: 1,
      pageSize: 10,
    });
    expect(result.current.pageRows).toEqual(rows(10));
  });

  it('follows a list that shrinks instead of leaving an empty page past the end', () => {
    const { result, rerender } = renderHook(
      ({ list }) => usePagination(list, 25),
      { initialProps: { list: rows(60) } },
    );
    act(() => result.current.paginationProps.onPageChange(3));
    rerender({ list: rows(30) });
    expect(result.current.paginationProps).toMatchObject({
      page: 2,
      total: 30,
    });
    expect(result.current.pageRows).toEqual(rows(30).slice(25));
  });

  it('is empty on page 1 for an empty list', () => {
    const { result } = renderHook(() => usePagination([], 25));
    expect(result.current.pageRows).toEqual([]);
    expect(result.current.paginationProps).toMatchObject({
      page: 1,
      total: 0,
    });
  });
});
