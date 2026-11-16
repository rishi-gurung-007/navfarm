'use client';

import { formatDate } from '@/utils/date-short';
import { NA } from '@/utils/na';
import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Building2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  Users,
  Search,
  ChevronRight,
  Home,
} from 'lucide-react';

import { api } from '@/services/api-client';
import { Toast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Pagination } from '@/components/ui/pagination';
import { usePagination } from '@/hooks/usePagination';
import { PageHeader, StatTiles } from './breeding-header';
import { buildTree, statusOfNode, totalsOf, type FacilityNode, type FacilityStatus } from './facility-tree';
import { getActiveCompanyId } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { formatQuantity } from '@/lib/utils';

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : (res?.data ?? res)) as T;
}

const S = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  raised: {
    backgroundColor: 'var(--surface-raised)',
    borderColor: 'var(--border)',
  },
  primary: { color: 'var(--text-primary)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
  accent: { color: 'var(--accent)' },
  danger: {
    color: 'var(--danger)',
    borderColor: 'var(--danger)',
    backgroundColor: 'var(--danger-muted)',
  },
  warning: {
    color: 'var(--warning)',
    borderColor: 'var(--warning)',
    backgroundColor: 'var(--warning-muted)',
  },
  success: {
    color: 'var(--success)',
    borderColor: 'var(--success)',
    backgroundColor: 'var(--success-muted)',
  },
};

const TYPE_NAMES: Record<string, [string, string]> = {
  SHED: ['shed', 'sheds'],
  PEN: ['pen', 'pens'],
  CRATE: ['crate', 'crates'],
  ROOM: ['room', 'rooms'],
};
const plural = (type: string, count: number) => {
  const names = TYPE_NAMES[type] ?? [type.toLowerCase(), `${type.toLowerCase()}s`];
  return `${count} ${count === 1 ? names[0] : names[1]}`;
};
const headText = (n: number) => `${n.toLocaleString()} head`;

export default function FacilityOccupancyPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState<Row[]>([]);
  // Where the page is looking: nothing = every farm; a farm; a farm and one of its sheds.
  const [path, setPath] = useState<string[]>([]);

  const [viewingLocation, setViewingLocation] = useState<Row | null>(null);
  const [locationAnimals, setLocationAnimals] = useState<Row[]>([]);
  const [locationAnimalsLoading, setLocationAnimalsLoading] = useState(false);

  const openLocationAnimals = async (loc: Row) => {
    setViewingLocation(loc);
    setLocationAnimalsLoading(true);
    try {
      const res = await api.get(`/animal?companyId=${companyId}&currentLocationId=${loc.location_id}&limit=500`);
      setLocationAnimals(unwrap<Row[]>(res) || []);
    } catch {
      setLocationAnimals([]);
    } finally {
      setLocationAnimalsLoading(false);
    }
  };

  const loadOccupancy = async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/location/occupancy?companyId=${companyId}`);
      setLocations(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t('fopFailedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOccupancy();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useMemo(() => buildTree(locations), [locations]);
  // The trail, cut at the first place that is not there (a place gone since the page opened).
  const trail: FacilityNode[] = [];
  for (const id of path) {
    const n = tree.byId.get(id);
    if (!n) break;
    trail.push(n);
  }
  const here = trail[trail.length - 1] ?? null;
  const level = here ? here.kids : tree.roots;
  const scope = totalsOf(here ? [here] : tree.roots);
  const goTo = (depth: number) => setPath(trail.slice(0, depth).map((n) => n.id));
  const open = (n: FacilityNode) => setPath([...trail.map((x) => x.id), n.id]);

  const heads = level.filter((n) => !n.isOther);
  const others = level.filter((n) => n.isOther);

  return (
    <div className="space-y-6">
      <PageHeader icon={Building2} title={t('pigFacilityOccupancy')} subtitle={t('fopSubtitle')} />

      <Toast variant="danger" message={error} onClose={() => setError('')} />

      {/* ── Where we are: every farm, a farm, or a shed ── */}
      <nav aria-label="Location" className="flex flex-wrap items-center gap-1.5 text-sm">
        <button
          type="button"
          onClick={() => goTo(0)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold cursor-pointer hover:bg-[var(--surface-raised)]"
          style={here ? S.accent : S.primary}
          aria-current={here ? undefined : 'page'}
        >
          <Home className="h-3.5 w-3.5" /> All farms
        </button>
        {trail.map((n, i) => (
          <span key={n.id} className="inline-flex items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5" style={S.muted} />
            <button
              type="button"
              onClick={() => goTo(i + 1)}
              className="rounded-md px-2 py-1 font-semibold cursor-pointer hover:bg-[var(--surface-raised)]"
              style={i === trail.length - 1 ? S.primary : S.accent}
              aria-current={i === trail.length - 1 ? 'page' : undefined}
              title={n.place.location_name}
            >
              {n.place.location_code}
            </button>
          </span>
        ))}
        {here && here.directAnimals > 0 && (
          <button
            type="button"
            onClick={() => openLocationAnimals(here.place)}
            className="ml-auto text-xs underline decoration-dotted cursor-pointer"
            style={S.accent}
          >
            {here.directAnimals} {here.directAnimals === 1 ? 'animal' : 'animals'} standing in {here.place.location_code} itself
          </button>
        )}
      </nav>

      {/* ── Figures for what is being looked at ── */}
      <StatTiles
        stats={[
          {
            label: 'Head capacity',
            value: scope.capacity > 0 ? headText(scope.capacity) : NA,
            caption: here ? `${here.place.location_name}` : `${tree.roots.length} ${tree.roots.length === 1 ? 'farm' : 'farms'}`,
            icon: Building2,
            tone: 'info',
          },
          {
            label: t('fopCurrentOccupancy'),
            value: headText(scope.occupied),
            caption:
              `${scope.animals.toLocaleString()} ${scope.animals === 1 ? 'animal' : 'animals'}` +
              (scope.batchHead ? ` · ${scope.batchHead.toLocaleString()} head in batches` : '') +
              (scope.capacity > 0 ? ` · ${Math.round((scope.occupied / scope.capacity) * 100)}% full` : ''),
            icon: Users,
            tone: 'accent',
          },
          {
            label: t('fopBiosecurityAlert'),
            value: `${scope.placesSick} ${scope.placesSick === 1 ? 'place' : 'places'}`,
            caption: scope.placesSick > 0 ? t('fopActiveQuarantine') : t('fopAllPensNormal'),
            icon: scope.placesSick > 0 ? ShieldAlert : ShieldCheck,
            tone: scope.placesSick > 0 ? 'warning' : 'success',
          },
          {
            label: t('fopOverCapacityPens'),
            value: `${scope.placesOver} ${scope.placesOver === 1 ? 'place' : 'places'}`,
            caption: scope.placesOver > 0 ? t('fopRequiresRebalancing') : t('fopOptimalDensity'),
            icon: AlertTriangle,
            tone: scope.placesOver > 0 ? 'danger' : 'success',
          },
        ]}
      />

      {loading && (
        <div className="py-16 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" style={S.accent} />
          <p className="mt-3 text-sm" style={S.sub}>
            {t('fopLoadingMetrics')}
          </p>
        </div>
      )}

      {!loading && (
        <LevelGrid
          key={path.join('/')}
          nodes={heads}
          emptyText={
            locations.length === 0
              ? t('fopNoLocationsConfigured')
              : here
                ? `Nothing is set up under ${here.place.location_code}.`
                : 'No farm is set up.'
          }
          onOpen={open}
          onAnimals={openLocationAnimals}
          t={t}
        />
      )}

      {!loading && others.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide" style={S.sub}>
            Stores &amp; silos
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {others.map((n) => (
              <div key={n.id} className="min-w-0 rounded-[var(--radius-md)] border px-3 py-2 flex items-center justify-between gap-3 text-xs" style={S.surface}>
                <div className="min-w-0">
                  <p className="font-mono font-semibold truncate" style={S.primary} title={n.place.location_code}>
                    {n.place.location_code}
                  </p>
                  <p className="truncate" style={S.muted} title={n.place.location_name}>
                    {n.place.location_name}
                  </p>
                </div>
                <span className="shrink-0 text-right" style={S.sub}>
                  {n.place.location_type}
                  {n.place.max_capacity != null && (
                    <span className="block font-mono" style={S.primary}>
                      {formatQuantity(n.place.max_capacity)} {n.place.capacity_uom}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── MODAL: Animals at this location ── */}
      {viewingLocation && (
        <Dialog
          open={!!viewingLocation}
          onClose={() => setViewingLocation(null)}
          title={t('fopAnimalsAtLocationTitle', { code: viewingLocation.location_code })}
          maxWidth="md"
        >
          {locationAnimalsLoading ? (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" style={S.accent} />
            </div>
          ) : locationAnimals.length === 0 ? (
            <p className="py-8 text-center text-sm" style={S.sub}>
              {t('fopNoAnimalsAtLocation')}
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-[var(--radius-sm)] border" style={S.surface}>
              {locationAnimals.map((a) => (
                <div
                  key={a.animal_id}
                  className="flex items-center justify-between border-b px-3 py-2 text-xs last:border-b-0"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span className="font-mono font-semibold" style={S.accent}>
                    {a.rfid_tag || a.animal_code}
                  </span>
                  <span style={S.muted}>{a.animal_type}</span>
                  <span style={S.muted}>{a.status}</span>
                </div>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

/** One level of the hierarchy: its places as cards, found by search or status, a page at a time. Remounted (so reset) at every level. */
function LevelGrid({
  nodes,
  emptyText,
  onOpen,
  onAnimals,
  t,
}: {
  nodes: FacilityNode[];
  emptyText: string;
  onOpen: (n: FacilityNode) => void;
  onAnimals: (place: Row) => void;
  t: (key: any, params?: any) => string;
}) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | FacilityStatus>('');
  const needle = search.trim().toLowerCase();
  const shown = nodes.filter(
    (n) =>
      (!statusFilter || statusOfNode(n) === statusFilter) &&
      (!needle || [n.place.location_code, n.place.location_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle))),
  );
  const pager = usePagination(shown);

  return (
    <div className="space-y-4">
      {nodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or name…"
              aria-label="Search locations"
              className="nf-input-sm pl-8 pr-3 w-64"
              style={{ backgroundColor: 'var(--input-bg)', color: 'var(--input-text)', borderColor: 'var(--input-border)' }}
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | FacilityStatus)} aria-label="Status" className="nf-input-sm">
            <option value="">All statuses</option>
            <option value="OVER">Over capacity</option>
            <option value="QUARANTINE">Quarantine</option>
            <option value="CLEAN">Clean</option>
          </select>
          <span className="ml-auto text-xs" style={S.muted}>
            {shown.length === nodes.length ? `${nodes.length} places` : `${shown.length} of ${nodes.length} places`}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {pager.pageRows.map((n) => (
          <PlaceCard key={n.id} node={n} onOpen={onOpen} onAnimals={onAnimals} t={t} />
        ))}
      </div>

      {shown.length === 0 && (
        <div className="py-12 text-center rounded-[var(--radius-lg)] border" style={S.surface}>
          <p className="text-sm" style={S.sub}>
            {nodes.length === 0 ? emptyText : 'No place matches the search and filter.'}
          </p>
        </div>
      )}

      {shown.length > 0 && <Pagination {...pager.paginationProps} />}
    </div>
  );
}

/** A farm, shed, pen or crate: how full it is counting everything under it, and a way into what is under it. */
function PlaceCard({
  node,
  onOpen,
  onAnimals,
  t,
}: {
  node: FacilityNode;
  onOpen: (n: FacilityNode) => void;
  onAnimals: (place: Row) => void;
  t: (key: any, params?: any) => string;
}) {
  const loc = node.place;
  const status = statusOfNode(node);
  const isOver = status === 'OVER';
  const isQuarantine = status === 'QUARANTINE';
  const pct = node.capacity ? Math.round((node.occupied / node.capacity) * 100) : null;
  const canOpen = node.kids.length > 0;
  const below = Object.entries(node.below).filter(([, c]) => c > 0);
  const hint =
    node.declared != null && node.childCapacity > 0 && node.childCapacity !== node.declared
      ? `${headText(node.childCapacity)} set on what is under it`
      : node.declared == null && node.capacity != null
        ? 'No capacity set here: the total of what is under it'
        : null;

  const body = (
    <>
      {/* who it is, and whether it is clean */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold font-mono text-sm truncate" style={S.primary} title={loc.location_code}>
            {loc.location_code}
          </p>
          <p className="text-xs font-medium truncate" style={S.primary} title={loc.location_name}>
            {loc.location_name}
          </p>
        </div>
        {isQuarantine ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase rounded-[var(--radius-xs)] border px-2 py-0.5" style={S.warning}>
            <ShieldAlert className="h-3 w-3" /> {t('fopSickCount', { count: node.sick })}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase rounded-[var(--radius-xs)] border px-2 py-0.5" style={S.surface}>
            <CheckCircle2 className="h-3 w-3" style={S.accent} /> {t('fopClean')}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 min-w-0 text-[11px]" style={S.muted}>
        <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase" style={S.raised}>
          {loc.location_type || 'PEN'}
        </span>
        {below.length > 0 && <span className="truncate">{below.map(([type, c]) => plural(type, c)).join(' · ')}</span>}
      </div>

      {/* how full it is, counting everything under it */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs font-medium">
          <span style={S.sub}>Head</span>
          <span className="font-mono font-bold" style={S.primary}>
            {node.occupied.toLocaleString()} / {node.capacity != null ? `${node.capacity.toLocaleString()} HEAD` : '∞'}
          </span>
        </div>
        <div className="h-2.5 w-full rounded-full overflow-hidden" style={S.raised}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(pct ?? 0, 100)}%`,
              backgroundColor: isOver ? 'var(--danger)' : (pct ?? 0) >= 90 ? 'var(--warning)' : 'var(--accent)',
            }}
          />
        </div>
        <div className="flex justify-between text-[11px]" style={S.muted}>
          <span>
            {node.animals} {node.animals === 1 ? 'animal' : 'animals'}
            {node.batchHead > 0 && ` · ${node.batchHead.toLocaleString()} in batches`}
          </span>
          <span>{pct != null ? `${pct}%` : t('fopNoLimitSet')}</span>
        </div>
        {hint && (
          <p className="text-[10px]" style={S.muted}>
            {hint}
          </p>
        )}
        {node.placesOver > 0 && node.kids.length > 0 && (
          <p className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>
            {node.placesOver} {node.placesOver === 1 ? 'place' : 'places'} under it over capacity
          </p>
        )}
      </div>

      {(loc.last_cleaned_date || loc.last_disinfected_date) && (
        <div className="mt-auto pt-2 border-t text-[10px] flex justify-between gap-2" style={{ borderColor: 'var(--border)', ...S.muted }}>
          <span>{t('fopCleaned', { date: formatDate(loc.last_cleaned_date || '--') })}</span>
          <span>{t('fopDisinfected', { date: formatDate(loc.last_disinfected_date || '--') })}</span>
        </div>
      )}
    </>
  );

  const frame = `min-w-0 rounded-[var(--radius-lg)] border p-4 shadow-sm transition-all flex flex-col gap-3 text-left`;
  const tone = isOver ? S.danger : isQuarantine ? S.warning : S.surface;

  if (canOpen) {
    // A place with something under it opens it; the whole card is the way in.
    return (
      <button
        type="button"
        onClick={() => onOpen(node)}
        className={`${frame} cursor-pointer hover:brightness-110 focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
        style={tone}
        aria-label={`Open ${loc.location_code}`}
      >
        {body}
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={S.accent}>
          Open <ChevronRight className="h-3 w-3" />
        </span>
      </button>
    );
  }
  return (
    <div className={frame} style={tone}>
      {body}
      {node.directAnimals > 0 && (
        <button type="button" onClick={() => onAnimals(loc)} className="self-start text-[11px] font-semibold underline decoration-dotted cursor-pointer" style={S.accent}>
          View the {node.directAnimals} {node.directAnimals === 1 ? 'animal' : 'animals'}
        </button>
      )}
    </div>
  );
}
