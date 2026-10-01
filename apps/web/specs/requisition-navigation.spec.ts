import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('common requisitions navigation', () => {
  it('does not list requisitions in Inventory and routes the common request action to Approvals/Requisitions', () => {
    expect(read('src/components/console/inventory/inventory-page-shell.tsx')).not.toContain('href: "/inventory/requisitions"');
    expect(read('src/components/console/approvals/approvals-page-shell.tsx')).toContain('router.push("/approvals/requisitions")');
  });

  it('keeps old inventory URLs as redirects to the common requisition screen', () => {
    expect(read('src/app/(app)/inventory/requisitions/page.tsx')).toContain('redirect(`/approvals/requisitions${query}`)');
    expect(read('src/app/(app)/inventory/feed-requisitions/page.tsx')).toContain('redirect(`/approvals/requisitions${query}`)');
  });
});
