import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

/**
 * WP1g (decisions.md 2026-10-05): Requisition is its own top-level menu item
 * at /requisitions, for the common kinds only. The two old URLs redirect to it
 * and keep their query string; feed requisitions are on Feed Forecast only.
 */
const redirectTo = async (modulePath: string, search: Record<string, string | string[] | undefined>) => {
  const redirect = jest.fn(() => { throw new Error('NEXT_REDIRECT'); });
  jest.resetModules();
  jest.doMock('next/navigation', () => ({ redirect }));
  const page = (await import(modulePath)).default;
  await expect(page({ searchParams: Promise.resolve(search) })).rejects.toThrow('NEXT_REDIRECT');
  jest.dontMock('next/navigation');
  return (redirect.mock.calls[0] as unknown as [string])[0];
};

describe('Requisition navigation (WP1g)', () => {
  it('/approvals/requisitions redirects to /requisitions and keeps the query', async () => {
    expect(await redirectTo('../src/app/(app)/approvals/requisitions/page', { id: 'req-1', status: 'APPROVED' }))
      .toBe('/requisitions?id=req-1&status=APPROVED');
    expect(await redirectTo('../src/app/(app)/approvals/requisitions/page', {})).toBe('/requisitions');
  });

  it('/inventory/requisitions redirects to /requisitions and keeps the query', async () => {
    expect(await redirectTo('../src/app/(app)/inventory/requisitions/page', { id: 'req-2', doc_type: ['ITEM', 'FA'] }))
      .toBe('/requisitions?id=req-2&doc_type=ITEM&doc_type=FA');
    expect(await redirectTo('../src/app/(app)/inventory/requisitions/page', {})).toBe('/requisitions');
  });

  it('/requisitions is the hub page and is not under Approvals', () => {
    const page = read('src/app/(app)/requisitions/page.tsx');
    expect(page).toContain('RequisitionsHub');
    expect(page).not.toContain('requisitions-panel');
    expect(page).toContain('t("rhDesc")');
  });

  it('Inventory no longer lists Requisitions; the inbox sends people to /requisitions', () => {
    expect(read('src/components/console/inventory/inventory-page-shell.tsx')).not.toContain('href: "/inventory/requisitions"');
    expect(read('src/app/(app)/layout.tsx')).not.toContain('href: "/inventory/requisitions"');
    const inbox = read('src/components/console/approvals/approvals-page-shell.tsx');
    expect(inbox).toContain('router.push("/requisitions")');
    expect(inbox).not.toContain('"/approvals/requisitions"');
  });

  it('sends the old feed-requisitions bookmark to the Feed Forecast feed-requisition tab', () => {
    const page = read('src/app/(app)/inventory/feed-requisitions/page.tsx');
    expect(page).toContain('params.set("tab", "feed-requisition")');
    expect(page).toContain('redirect(`/inventory/feed-forecast?${params.toString()}`)');
  });

  it("the inbox's feed-requisition detail links to Feed Forecast, not the Requisition page", () => {
    const detail = read('src/components/console/approvals/feed-requisition-approval-detail.tsx');
    expect(detail).toContain('/inventory/feed-forecast?tab=feed-requisition&id=');
    expect(detail).not.toContain('/approvals/requisitions');
  });
});
