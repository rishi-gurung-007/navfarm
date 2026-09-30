/**
 * What KIND an item type is, decided from the type's own code and name rather
 * than from one hard-coded string.
 *
 * Found on the test server (Porta Farm, 29 Sep): the Animal Register's "Item
 * (Living Asset)" picker was empty because the code asked for
 * `item_type = 'LIVESTOCK'` while that tenant's living-asset type is code
 * "LA-001", name "Living Asset" — and its feed type is "FEED-001", not "FEED".
 * Tenants name their own item types (item_type_master is a master like any
 * other), so every FEED / LIVESTOCK decision goes through here.
 *
 * MEDICINE and VACCINE are deliberately left exact: they gate the withdrawal
 * rules, where a loose match would be the wrong risk to take, and no client
 * type has been seen naming them differently.
 */
export const ITEM_KINDS = ['FEED', 'LIVESTOCK'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

interface Matchers {
  /** Exact type codes. */
  codes: string[];
  /** Type codes starting with these — the client workbook writes FEED BULK, FEED BAG, LA-001. */
  codePrefixes: string[];
  /** Whole words looked for in the type NAME, lower-cased. */
  nameFragments: string[];
}

const MATCHERS: Record<ItemKind, Matchers> = {
  FEED: {
    codes: ['FEED'],
    codePrefixes: ['FEED'],
    nameFragments: ['feed'],
  },
  LIVESTOCK: {
    codes: ['LIVESTOCK'],
    codePrefixes: ['LA-', 'LA_', 'LIVESTOCK', 'LIVING'],
    nameFragments: ['living asset', 'livestock'],
  },
};

export function kindMatchers(kind: ItemKind): Matchers {
  return MATCHERS[kind];
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();

/**
 * A name matches on a whole word, so "Feeder trough" is not a feed type while
 * "Pig Feed" is. A code matches on a prefix, because the client's own codes are
 * FEED-001 / FEED BULK / LA-001.
 */
function nameHas(name: string | null | undefined, fragment: string): boolean {
  const haystack = (name ?? '').toLowerCase();
  const pattern = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^a-z])${pattern}([^a-z]|$)`).test(haystack);
}

/** The kind of an item type, or null when it is neither feed nor livestock. */
export function itemKindOf(typeCode: string | null | undefined, typeName: string | null | undefined): ItemKind | null {
  const code = norm(typeCode);
  for (const kind of ITEM_KINDS) {
    const m = MATCHERS[kind];
    if (code && (m.codes.includes(code) || m.codePrefixes.some((p) => code.startsWith(p)))) return kind;
    if (m.nameFragments.some((fragment) => nameHas(typeName, fragment))) return kind;
  }
  return null;
}
