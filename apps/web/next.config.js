//@ts-check

const { join } = require('path');
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

/** Page file extensions Next.js recognises as routes. Next's default list. */
const PRODUCTION_PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];

/**
 * Dev-only routes are named `*.dev.tsx` (e.g. `dev/shell-harness/page.dev.tsx`).
 * That suffix is only a page extension under the development-server phase, so
 * the App Router discovers those files when running `next dev` and does not see
 * them as pages at all during `next build`. The harness therefore keeps its
 * real URL for local work and the Playwright suite, while being absent from the
 * production route manifest rather than merely 404-ing at request time.
 */
const DEVELOPMENT_PAGE_EXTENSIONS = [...PRODUCTION_PAGE_EXTENSIONS, 'dev.tsx'];

function apiUpstreamOrigin() {
  const mode = process.env.NAVFARM_API_MODE || 'proxy';
  if (mode !== 'proxy') {
    throw new Error(`Unsupported NAVFARM_API_MODE: ${mode}. The current web application supports proxy mode.`);
  }

  const configured = process.env.NAVFARM_API_UPSTREAM_URL || 'http://127.0.0.1:2877';
  const upstream = new URL(configured);
  if (!['http:', 'https:'].includes(upstream.protocol)) {
    throw new Error('NAVFARM_API_UPSTREAM_URL must use http or https.');
  }
  if (upstream.username || upstream.password) {
    throw new Error('NAVFARM_API_UPSTREAM_URL must not contain credentials.');
  }
  if (upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('NAVFARM_API_UPSTREAM_URL must be an origin without a path, query, or fragment.');
  }
  return upstream.origin;
}

/**
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
/**
 * The operational-scope routes were renamed to match how the work actually
 * runs: everything in an area revolves around a batch, so the batch lifecycle
 * lives under /batches, the animal-centric screens under /livestock, and the
 * three configuration screens under /settings. The old paths leaked the
 * backend's module layout (/production/*, /piggery/*) rather than the domain,
 * and /piggery in particular was wrong the moment a second line of business
 * existed.
 *
 * These are permanent redirects so existing bookmarks, and any link already
 * shared with a customer, land on the new route instead of a 404.
 */
const LEGACY_ROUTE_REDIRECTS = [
  ['/production/batches/animal-assignment', '/batches/animals'],
  ['/production/batches/daily-entry', '/batches/entry'],
  ['/production/batches/transfers', '/batches/transfers'],
  ['/production/batches/stages', '/batches/stages'],
  ['/production/batches', '/batches'],
  ['/production/feed-management', '/batches/records'],
  ['/production/mortality-health', '/livestock/health'],
  ['/production/qc-parameters', '/settings/qc'],
  ['/production/parameters', '/settings/parameters'],
  ['/production/scheduler', '/schedulers'],
  ['/production/alerts', '/alerts'],
  ['/production/packs', '/traceability'],
  ['/production', '/batches'],
  ['/piggery/facility-occupancy', '/livestock/facility'],
  ['/piggery/herd-analytics', '/livestock/analytics'],
  ['/piggery/breeding', '/livestock/breeding'],
  ['/piggery/animals', '/livestock'],
  ['/piggery', '/livestock'],
  ['/area-settings', '/settings/area'],
  // /settings has no index of its own; Area Settings is its landing screen.
  ['/settings', '/settings/area'],
];

module.exports = (phase) => ({
  turbopack: {
    root: join(__dirname, '../..'),
  },
  async redirects() {
    return LEGACY_ROUTE_REDIRECTS.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }));
  },
  async rewrites() {
    const upstream = apiUpstreamOrigin();
    return [
      { source: '/api/v1/:path*', destination: `${upstream}/api/v1/:path*` },
      { source: '/uploads/:path*', destination: `${upstream}/uploads/:path*` },
    ];
  },
  pageExtensions:
    phase === PHASE_DEVELOPMENT_SERVER
      ? DEVELOPMENT_PAGE_EXTENSIONS
      : PRODUCTION_PAGE_EXTENSIONS,
});
