/**
 * Contracts for the Phase 3 demo chapters (docs/superpowers/plans/2026-09-15-phase-03-demo-data-rebuild.md,
 * Task 2). A chapter is a named step of the demo rebuild that posts operational
 * rows by calling the application's own services inside a CLS context — never
 * raw inserts — so the demo proves the write path it shows.
 */
import type { INestApplicationContext } from '@nestjs/common';

export interface DemoContext {
  app: INestApplicationContext;
  tenantId: string;
  companyId: string;
  /** COMPANY_ADMIN actor the chapters post as — batch transfers refuse a caller without an admin userType. */
  actor: {
    userId: string;
    userType: 'COMPANY_ADMIN';
    tenantId: string;
    email: string;
  };
  /** Farm location ids, resolved by location_code (MUL100 / POR100). */
  farms: { grasmere: string; kintyre: string };
  log(line: string): void;
}

/**
 * A chapter step. Most chapters post rows and return nothing; a few (01
 * stores, 03 batches) hand the ids they created to the chapters that follow,
 * so the result type is a parameter. The runner holds them as
 * `DemoChapter[]` — i.e. `DemoChapter<unknown>` — which every chapter
 * satisfies whatever it returns.
 */
export interface DemoChapter<TResult = unknown> {
  name: string;
  run(ctx: DemoContext): Promise<TResult>;
}
