/** True only for MySQL "table doesn't exist" (ER_NO_SUCH_TABLE / errno 1146). */
export function isMissingTableError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number } | null;
  return !!e && (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146);
}

/**
 * Decides whether the canonical tenant migration folder may run.
 * A missing journal table (empty database) is journal 0, the canonical baseline.
 */
export function assertCanonicalLineage(latestId: number, hasFeedLoading: boolean): void {
  const canonicalBaseline = latestId === 0 || (latestId <= 142 && !hasFeedLoading);
  const canonicalComplete = latestId >= 164;
  if (!canonicalBaseline && !canonicalComplete) {
    throw new Error(
      `Unsupported tenant migration lineage (latest journal id ${latestId}, feed_loading_sheet=${hasFeedLoading}). ` +
      'This database requires a reviewed conversion path and was not modified.',
    );
  }
}
