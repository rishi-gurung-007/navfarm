"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";

type Row = Record<string, any>;

export interface PagedOptions {
  /** The rows loaded so far for the current search. */
  options: Row[];
  /** The unsearched first page in flight (the select shows "Loading records…"). */
  loading: boolean;
  /** A search's first page in flight; the open list stays open while it loads. */
  searching: boolean;
  /** The first page has answered (rows or none) at least once. */
  ready: boolean;
  /** The first page failed; its message. */
  error: string;
  /** A further page in flight (the list shows a row at its foot). */
  loadingMore: boolean;
  hasMore: boolean;
  /** Re-queries the server from the first page; '' is the unfiltered list. */
  search: (query: string) => void;
  /** Appends the next page, if there is one. */
  loadMore: () => void;
  /** Reloads the current search from the first page. */
  reload: () => void;
}

/**
 * Options for a SearchableSelect read from a list endpoint a page at a time,
 * so a picker is never silently capped at whatever limit it first asked for.
 * Scrolling to the foot of the list asks for the next page, and typing asks
 * the server — so the search covers every record, not only the loaded ones.
 *
 * `params` are the endpoint's own filters (companyId, status…); `path` with
 * no params is fine. Pass `enabled: false` while a required filter is unset.
 */
export function usePagedOptions({
  path,
  params,
  pageSize = 100,
  searchParam = "search",
  idKey,
  enabled = true,
}: {
  path: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  pageSize?: number;
  searchParam?: string;
  /** Drops a row a later page repeats, should the list shift between pages. */
  idKey?: string;
  enabled?: boolean;
}): PagedOptions {
  const [options, setOptions] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const offsetRef = useRef(0);
  // The offset a further page is already being read for: the scroll handler and
  // the short-list check can both ask before React has re-rendered.
  const moreAtRef = useRef<number | null>(null);
  // Only the newest request may write: a slow first page must not land over a newer search.
  const requestRef = useRef(0);
  const paramKey = JSON.stringify(params ?? {});

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const request = ++requestRef.current;
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(JSON.parse(paramKey) as Record<string, unknown>)) {
        if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
      }
      qs.set("limit", String(pageSize));
      qs.set("offset", String(offset));
      if (query.trim()) qs.set(searchParam, query.trim());
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res: any = await api.get(`${path}?${qs.toString()}`);
        if (request !== requestRef.current) return;
        const page: Row[] = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        const total = typeof res?.total === "number" ? res.total : null;
        offsetRef.current = offset + page.length;
        setOptions((prev) => {
          if (!append) return page;
          if (!idKey) return [...prev, ...page];
          const seen = new Set(prev.map((r) => String(r[idKey])));
          return [...prev, ...page.filter((r) => !seen.has(String(r[idKey])))];
        });
        setHasMore(total !== null ? offset + page.length < total : page.length === pageSize);
        if (!append) setError("");
      } catch (e: unknown) {
        if (request !== requestRef.current) return;
        if (!append) {
          setOptions([]);
          setError(e instanceof Error ? e.message : String(e));
        }
        setHasMore(false);
      } finally {
        if (request === requestRef.current && !append) setReady(true);
        if (request === requestRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [path, paramKey, pageSize, searchParam, query, idKey],
  );

  useEffect(() => {
    if (!enabled) {
      requestRef.current++;
      setOptions([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    offsetRef.current = 0;
    void fetchPage(0, false);
  }, [enabled, fetchPage]);

  const loadMore = useCallback(() => {
    if (!enabled || loading || loadingMore || !hasMore) return;
    if (moreAtRef.current === offsetRef.current) return;
    const at = offsetRef.current;
    moreAtRef.current = at;
    void fetchPage(at, true).finally(() => {
      if (moreAtRef.current === at) moreAtRef.current = null;
    });
  }, [enabled, loading, loadingMore, hasMore, fetchPage]);

  const reload = useCallback(() => {
    if (enabled) void fetchPage(0, false);
  }, [enabled, fetchPage]);

  return {
    options,
    // Only the unfiltered load disables the select: one that disabled itself
    // per keystroke would close its own panel mid-search.
    loading: loading && !query.trim(),
    searching: loading && !!query.trim(),
    ready,
    error,
    loadingMore,
    hasMore,
    search: setQuery,
    loadMore,
    reload,
  };
}

/**
 * The row a paged picker currently holds. It is read from the loaded pages
 * when it is there and fetched by id when it is not (a deep link, a default,
 * or a search that has moved on), so a screen that shows the picked record's
 * details keeps working however far down the list that record sits.
 */
export function usePickedRow({
  path,
  idParam,
  idKey,
  id,
  loaded,
  params,
}: {
  path: string;
  /** The list endpoint's filter for one id, e.g. `batchId`. */
  idParam: string;
  idKey: string;
  id: string | null | undefined;
  loaded: Row[];
  params?: Record<string, string | number | boolean | null | undefined>;
}): Row | null {
  const inLoaded = id ? loaded.find((r) => String(r[idKey]) === String(id)) ?? null : null;
  const [fetched, setFetched] = useState<Row | null>(null);
  const paramKey = JSON.stringify(params ?? {});

  useEffect(() => {
    if (!id || inLoaded) return;
    if (fetched && String(fetched[idKey]) === String(id)) return;
    let live = true;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(JSON.parse(paramKey) as Record<string, unknown>)) {
      if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
    }
    qs.set(idParam, String(id));
    qs.set("limit", "1");
    api
      .get(`${path}?${qs.toString()}`)
      .then((res: any) => {
        const rows: Row[] = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        if (live) setFetched(rows[0] ?? null);
      })
      .catch(() => live && setFetched(null));
    return () => {
      live = false;
    };
  }, [id, inLoaded, fetched, idKey, idParam, path, paramKey]);

  if (!id) return null;
  return inLoaded ?? (fetched && String(fetched[idKey]) === String(id) ? fetched : null);
}

/** The loaded options plus the picked row when it is not among them, so the
 * closed select can still name it. */
export function withPicked(options: Row[], picked: Row | null, idKey: string): Row[] {
  if (!picked || options.some((r) => String(r[idKey]) === String(picked[idKey]))) return options;
  return [picked, ...options];
}

/**
 * Every row of a list endpoint, read a page at a time. For lists a screen
 * looks records up in (an animal's batch, a location's name) rather than
 * only offers in a picker, where a single capped page silently drops the
 * records past it.
 */
export async function fetchAllPages(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>,
  pageSize = 500,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; ) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== null && v !== undefined && v !== "") qs.set(k, String(v));
    }
    qs.set("limit", String(pageSize));
    qs.set("offset", String(offset));
    const res: any = await api.get(`${path}?${qs.toString()}`);
    const page: Row[] = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
    rows.push(...page);
    offset += page.length;
    const total = typeof res?.total === "number" ? res.total : null;
    if (!page.length || (total !== null ? offset >= total : page.length < pageSize)) return rows;
  }
}
