import type { MasterDataConfig } from "./types";

/**
 * Several catalogs are, per the client's own documents, sourced from Microsoft
 * Business Central. That integration is not built, so rather than lock the
 * screens against a system nothing currently talks to, they stay locally
 * editable and this notice states both halves: where the records are meant to
 * come from, and where they are actually coming from today. Rishi's call,
 * 2026-09-06.
 *
 * Each master supplies its own citation through `bcNote` — one hardcoded
 * sentence about Items and the COA would be wrong on every other screen. That
 * citation moved to the tooltip: it is provenance worth keeping and worth
 * reading once, not a paragraph to re-read on every visit to the screen.
 */
export function BcOwnershipNotice({ config }: { config: MasterDataConfig }) {
  return <p role="note" title={config.bcNote} className="text-sm text-(--text-secondary)">
    Managed in Business Central. Held locally until the integration is connected.
  </p>;
}
