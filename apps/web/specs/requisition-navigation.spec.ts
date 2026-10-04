import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('common requisitions navigation', () => {
  it('does not list requisitions in Inventory and routes the common request action to Approvals/Requisitions', () => {
    expect(read('src/components/console/inventory/inventory-page-shell.tsx')).not.toContain('href: "/inventory/requisitions"');
    expect(read('src/components/console/approvals/approvals-page-shell.tsx')).toContain('router.push("/approvals/requisitions")');
  });

  it('keeps the common inventory URL as a redirect to the common requisition screen', () => {
    expect(read('src/app/(app)/inventory/requisitions/page.tsx')).toContain('redirect(`/approvals/requisitions${query}`)');
  });

  it('sends the old feed-requisitions bookmark to the Feed Forecast feed-requisition tab', () => {
    // It used to point at the common Requisitions screen, which is a different
    // document — feed orders are a Feed Forecast tab now.
    const page = read('src/app/(app)/inventory/feed-requisitions/page.tsx');
    expect(page).not.toContain('redirect(`/approvals/requisitions${query}`)');
    expect(page).toContain('params.set("tab", "feed-requisition")');
    expect(page).toContain('redirect(`/inventory/feed-forecast?${params.toString()}`)');
  });

  it('Approvals -> Requisitions is the all-types hub, not the feed-only panel (spec §6a)', () => {
    const page = read('src/app/(app)/approvals/requisitions/page.tsx');
    expect(page).toContain('RequisitionsHub');
    expect(page).not.toContain('requisitions-panel');
    // The feed-only description ("Feed orders to the mill…") no longer describes this page.
    expect(page).toContain('t("rhDesc")');
    expect(page).not.toContain('invRequisitionsDesc');
  });
});
