import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RequisitionNewDialog } from '../src/components/console/inventory/requisition-new-dialog';
import { api } from '../src/services/api-client';
import { translations } from '../src/utils/translations';
jest.mock('../src/components/ui/toast', () => ({ showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }, Toast: () => null }));
import { showToast } from '../src/components/ui/toast';
beforeEach(() => { for (const fn of Object.values(showToast)) (fn as jest.Mock).mockClear(); });

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({
  getActiveCompanyId: () => 'co-1',
  getStoredUser: () => ({ userId: 'u-requester', email: 'requester@triplec.local', fullName: 'Requesting User' }),
}));
jest.mock('../src/utils/date-short', () => ({ formatDateShort: (v: string | null) => v ?? '' }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
// Every test here passes farmId explicitly, so the farm-select branch never
// renders; mocked only so useFeedFarm's own module-level fetch of
// /feed-forecast/farms (unconditional per the hooks rule) does not register
// on the shared api.get mock and upset the "no load before Feed is chosen"
// assertions below — the same pattern requisitions-panel.spec.tsx and
// feed-forecast-panel.spec.tsx use for the same hook.
let mockFarm: any;
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({ useFeedFarm: () => mockFarm }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

const destinationLabel: Record<string, string> = {
  s1: 'VIL100/SILO-001 — Weaner silo',
  st: 'VIL100/STORE-001 — Main store',
  sb: 'VIL100/SILO-002',
  sx: 'VIL100/STORE-002',
};

async function pickSearchable(label: string, optionName: string | RegExp) {
  const trigger = await screen.findByRole('button', { name: label });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: optionName }));
}

async function waitForSearchable(label: string) {
  const trigger = await screen.findByRole('button', { name: label });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  return trigger;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFarm = { farmId: null, setFarmId: jest.fn(), farms: [], loaded: true, failed: false, isFixed: false, fixedFarm: null };
  // F3: one feed-scoped read, not the two Master Data ones.
  get.mockImplementation(async (url: string) => {
    if (String(url).startsWith('/feed-settings')) return { data: { truckTargetKg: 30000, bulkMultipleKg: 3000, bagSizeKg: 50 } };
    if (String(url).startsWith('/reason')) return { data: [{ reason_id: 'reason-1', reason_code: 'REQ-01', reason_name: 'Diet exception', category: 'REQUISITION', is_active: true }] };
    return {
    data: {
      farmId: 'farm-vil',
      companyId: 'co-1',
      destinations: [
        { location_id: 's1', location_code: 'VIL100/SILO-001', location_name: 'Weaner silo', location_type: 'SILO' },
        { location_id: 'st', location_code: 'VIL100/STORE-001', location_name: 'Main store', location_type: 'STORE' },
      ],
      items: [{ item_id: 'i1', item_code: 'FEED-R1', item_name: 'Weaner Diet R1' }],
    },
    };
  });
  post.mockResolvedValue({ data: { requisition_id: 'req-9', req_no: 'REQ-VIL100-2026-00009', lines: [] } });
});

describe('RequisitionNewDialog (D26)', () => {
  it('offers only the farm\'s silos and store, and creates the requisition', async () => {
    const onCreated = jest.fn();
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={onCreated} />);
    // Task 19: the Feed Forecast tab's New opens the feed form at once — no
    // "what is this for?" step, no Feed button to click.
    expect(screen.queryByText('rqNewPurposePrompt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'rqNewPurposeFeed' })).toBeNull();
    expect(screen.getByText('rqNewTitle')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'rqNewCancel' })).toBeNull();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition/options?farmId=farm-vil'));
    // The Master Data routes are not reachable for a farm login, and answer
    // with templates in the tenant-wide workspace (F3, review I3).
    expect(get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/location') || u.startsWith('/item'))).toEqual([]);
    const dest = await waitForSearchable('rqNewDestination:{"line":1}');
    fireEvent.click(dest);
    expect(screen.getByRole('option', { name: destinationLabel.s1 })).toBeTruthy();
    expect(screen.getByRole('option', { name: destinationLabel.st })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: destinationLabel.s1 }));
    await pickSearchable('rqNewItem:{"line":1}', 'FEED-R1 — Weaner Diet R1');
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: '2099-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewCreate' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition', {
      farmId: 'farm-vil', lines: [{ destination_location_id: 's1', item_id: 'i1', quantity_kg: 3000, proposed_delivery_date: '2099-10-01' }],
    }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ requisition_id: 'req-9' }));
  });

  it('keeps Create off until every line is complete, and shows the API refusal', async () => {
    post.mockRejectedValue({ message: 'Destination VIL100/SILO-001 has the same feed item on two lines.' });
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    // Task 19: already on the feed form, no picker step to click through.
    const create = await screen.findByRole('button', { name: 'rqNewCreate' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await pickSearchable('rqNewDestination:{"line":1}', destinationLabel.s1);
    await pickSearchable('rqNewItem:{"line":1}', 'FEED-R1 — Weaner Diet R1');
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: '2099-10-01' } });
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await waitFor(() => expect(showToast.error).toHaveBeenCalledWith('Destination VIL100/SILO-001 has the same feed item on two lines.'));
  });
});

describe('RequisitionNewDialog — every requisition type (spec §6a)', () => {
  it('offers Item, Fixed Asset and Service when asked; Item chooses Store or Purchase; FA and Service go straight to Purchase', () => {
    const onCommon = jest.fn();
    render(<RequisitionNewDialog open farmId="farm-vil" types={['FEED', 'ITEM', 'FA', 'SERVICE']} onClose={jest.fn()} onCreated={jest.fn()} onCommon={onCommon} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeFa' }));
    expect(onCommon).toHaveBeenLastCalledWith({ docType: 'FA', purpose: 'PURCHASE' });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeService' }));
    expect(onCommon).toHaveBeenLastCalledWith({ docType: 'SERVICE', purpose: 'PURCHASE' });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeItem' }));
    expect(onCommon).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewItemStore' }));
    expect(onCommon).toHaveBeenLastCalledWith({ docType: 'ITEM', purpose: 'STORE' });
  });

  it('lets the user return from the Item purpose step to the requisition type choices', () => {
    render(<RequisitionNewDialog open farmId="farm-vil" types={['FEED', 'ITEM', 'FA', 'SERVICE']} onClose={jest.fn()} onCreated={jest.fn()} onCommon={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeItem' }));
    const dialog = screen.getByRole('dialog');
    const header = dialog.querySelector('header') as HTMLElement;
    fireEvent.click(within(header).getByRole('button', { name: 'crqBack' }));
    expect(screen.getByRole('button', { name: 'rqNewPurposeFeed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'rqNewPurposeItem' })).toBeTruthy();
  });

  it('lets the user return from Feed creation when it was opened from the common requisition picker', async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" types={['FEED', 'ITEM', 'FA', 'SERVICE']} onClose={jest.fn()} onCreated={jest.fn()} onCommon={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeFeed' }));
    const dialog = screen.getByRole('dialog');
    const header = dialog.querySelector('header') as HTMLElement;
    fireEvent.click(within(header).getByRole('button', { name: 'crqBack' }));
    expect(screen.getByRole('button', { name: 'rqNewPurposeFeed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'rqNewPurposeItem' })).toBeTruthy();
  });

  it('vertically centres the feed line controls and calculated values', async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    await waitForSearchable('rqNewDestination:{"line":1}');
    const cells = Array.from(screen.getByRole('dialog').querySelectorAll('tbody td'));
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((cell) => cell.className.includes('align-middle'))).toBe(true);
  });

  it('offers only Feed on the Feed Forecast tab (default types)', () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'rqNewPurposeItem' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'crqBack' })).toBeNull();
  });

  // Task 19: the Feed Forecast tab's New only ever creates Feed (decisions
  // 2026-10-04 "Where each requisition kind is created"), so the "what is
  // this for?" choice is pointless there — it must open the feed form at
  // once, with no picker and no Feed button for the farm to click.
  it("skips the \"what is this for?\" step on the Feed Forecast tab, opening the feed form immediately (Task 19)", async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.queryByText('rqNewPurposePrompt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'rqNewPurposeFeed' })).toBeNull();
    // Straight to the feed mini-form: its destination field is already on screen.
    await waitForSearchable('rqNewDestination:{"line":1}');
  });

  // Approvals -> Requisitions passes every kind (Task 13); the picker must
  // still stand there, unaffected by Task 19's single-type skip.
  it('still shows the four-kind picker from Approvals -> Requisitions (every type passed)', () => {
    render(<RequisitionNewDialog open farmId="farm-vil" types={['FEED', 'ITEM', 'FA', 'SERVICE']} onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.getByText('rqNewPurposePrompt')).toBeTruthy();
    for (const name of ['rqNewPurposeFeed', 'rqNewPurposeItem', 'rqNewPurposeFa', 'rqNewPurposeService']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  // Fix round 1: a single-line fixture could not catch setLine(0, ...) being
  // hardcoded in place of setLine(i, ...) for the reason field specifically —
  // the same class of gap Task 9 was sent back to fix. Two lines, reason on
  // the second only, and the first line's body is checked to have NO
  // reason_id key at all (not merely a falsy one).
  it('sends a Reason Master id scoped to the line it was set on', async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    // Task 19: already on the feed form.
    await pickSearchable('rqNewDestination:{"line":1}', destinationLabel.s1);
    await pickSearchable('rqNewItem:{"line":1}', 'FEED-R1 — Weaner Diet R1');
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: '2099-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewAddLine' }));
    await pickSearchable('rqNewDestination:{"line":2}', destinationLabel.st);
    await pickSearchable('rqNewItem:{"line":2}', 'FEED-R1 — Weaner Diet R1');
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":2}'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":2}'), { target: { value: '2099-10-02' } });
    await pickSearchable('rqNewException:{"line":2}', 'REQ-01 — Diet exception');
    fireEvent.click(screen.getByRole('button', { name: 'rqNewCreate' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]).not.toHaveProperty('reason_id');
    expect(body.lines[1].reason_id).toBe('reason-1');
  });

  it('selects a feed-line reason from Reason Master and sends its stable id', async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    const reasonTrigger = screen.getByRole('button', { name: 'rqNewException:{"line":1}' });
    fireEvent.click(reasonTrigger);
    fireEvent.click(await screen.findByRole('option', { name: 'REQ-01 — Diet exception' }));
    await pickSearchable('rqNewDestination:{"line":1}', destinationLabel.s1);
    await pickSearchable('rqNewItem:{"line":1}', 'FEED-R1 — Weaner Diet R1');
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: '2099-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewCreate' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls.at(-1)[1].lines[0]).toMatchObject({ reason_id: 'reason-1' });
    expect(post.mock.calls.at(-1)[1].lines[0]).not.toHaveProperty('exception_reason');
  });

  // Fix round 1 (Important, inherited from the design's own §5 code): no
  // caller gives `types` a stable reference — requisitions-hub.tsx passes
  // `types={[...TYPES]}`, a fresh array literal every render. The dialog's
  // own step-selection effect used to depend on `types` by reference, so
  // ANY re-render of the parent while the dialog stays open — for a reason
  // having nothing to do with this dialog — re-ran that effect and
  // recomputed `step` from `types.length`, which for this four-type case is
  // always "choose": it silently snapped back to the picker and discarded
  // whatever the farm had already filled in, with no error and no trace.
  it("keeps the chosen step through a parent re-render, even though `types` is a fresh array every time (fix round 1)", async () => {
    const FOUR_TYPES = ['FEED', 'ITEM', 'FA', 'SERVICE'] as const;
    function Harness() {
      const [tick, setTick] = React.useState(0);
      return (
        <div>
          <button type="button" onClick={() => setTick((n) => n + 1)}>rerender {tick}</button>
          {/* A fresh array literal every render of Harness — requisitions-hub.tsx:234's own `types={[...TYPES]}` pattern, not a stable reference. */}
          <RequisitionNewDialog open farmId="farm-vil" types={[...FOUR_TYPES]} onClose={jest.fn()} onCreated={jest.fn()} onCommon={jest.fn()} />
        </div>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeFeed' }));
    expect(screen.getByText('rqNewTitle')).toBeTruthy();
    expect(screen.queryByText('rqNewPurposePrompt')).toBeNull();
    // Let the FEED step's options fetch settle before re-rendering, so its
    // state update lands inside this act(), not as a dangling one after.
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition/options?farmId=farm-vil'));
    // The parent re-renders for a reason unrelated to this dialog, more than once.
    fireEvent.click(screen.getByText(/^rerender/));
    fireEvent.click(screen.getByText(/^rerender/));
    // Still on the feed form: the chosen step must not snap back to the picker.
    expect(screen.queryByText('rqNewPurposePrompt')).toBeNull();
    expect(screen.getByText('rqNewTitle')).toBeTruthy();
  });
});

describe('RequisitionNewDialog — farm chosen on the header when the caller has none (Task 10 review, fix round 1)', () => {
  it('shows a farm select when farmId is absent, and the chosen farm — not undefined — drives the options fetch', async () => {
    mockFarm = {
      farmId: null,
      setFarmId: jest.fn((id: string | null) => { mockFarm = { ...mockFarm, farmId: id }; }),
      farms: [{ farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Triple C' }],
      loaded: true,
      failed: false,
      isFixed: false,
      fixedFarm: null,
    };
    const { rerender } = render(<RequisitionNewDialog open types={['FEED']} onClose={jest.fn()} onCreated={jest.fn()} />);
    // Task 19: a single type ("FEED") opens the feed form directly.
    const select = screen.getByLabelText('rqFarm') as HTMLSelectElement;
    expect(select).toBeTruthy();
    // No farm chosen yet: effectiveFarmId is empty, so the options endpoint
    // must not be read with an undefined/empty farmId — the bug a select
    // that merely *renders* would not catch.
    expect(get).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: 'farm-vil' } });
    expect(mockFarm.setFarmId).toHaveBeenCalledWith('farm-vil');
    // setFarmId is a prop handed to the mocked hook, not component state, so
    // the dialog only sees the new farmId once it re-renders against the
    // hook's updated return value — exactly what a real selection does when
    // the shared hook's own state changes.
    rerender(<RequisitionNewDialog open types={['FEED']} onClose={jest.fn()} onCreated={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition/options?farmId=farm-vil'));
  });
});

// Gap #16 (audit, Req r43-r56): the manual-create mini-form used its own
// ad hoc words ("Silo or store", "Feed", "Kg", "Deliver by") rather than the
// workbook's. Pinned against the real dictionary, not the spec's stable-key
// mock, since that mock answers with the key name regardless of its value.
describe('RequisitionNewDialog — manual line labels match the workbook (gap #16, Req r43-r56)', () => {
  const en = translations.en;
  it("uses the workbook's own words for Silo Code, Feed Item No. to Order, Requested Qty KG and Proposed Delivery Date", () => {
    expect(en.rqNewDestination).toBe('Silo Code, line {{line}}');
    expect(en.rqNewItem).toBe('Feed Item No. to Order, line {{line}}');
    expect(en.rqNewKg).toBe('Requested Qty KG, line {{line}}');
    expect(en.rqNewDate).toBe('Proposed Delivery Date, line {{line}}');
  });
});

// Task 18b (Rishi 4 Oct: "I can't see the header fields for the feed
// requisition, only lines"): the New feed dialog is laid out like the
// document — the workbook's §1 header first, then the §2 lines as a table.
describe('RequisitionNewDialog — header first, then lines (Task 18b)', () => {
  const VIL = { farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Triple C' };
  beforeEach(() => {
    mockFarm = { ...mockFarm, farms: [VIL] };
  });

  const fillLine = async (n: number, dest: string, kg: string, date: string) => {
    const destinationCode = { s1: 'VIL100/SILO-001', st: 'VIL100/STORE-001', sb: 'VIL100/SILO-002', sx: 'VIL100/STORE-002' }[dest];
    await pickSearchable(`rqNewDestination:{"line":${n}}`, new RegExp(`^${destinationCode}(?: —|$)`));
    await pickSearchable(`rqNewItem:{"line":${n}}`, 'FEED-R1 — Weaner Diet R1');
    fireEvent.change(screen.getByLabelText(`rqNewKg:{"line":${n}}`), { target: { value: kg } });
    fireEvent.change(screen.getByLabelText(`rqNewDate:{"line":${n}}`), { target: { value: date } });
  };

  it('shows the workbook header values for a manual requisition, before the lines', async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    const dialog = screen.getByRole('dialog');
    const header = within(dialog).getByText('rqdReqNo');
    const lines = within(dialog).getByText('rqdLinesTitle');
    expect(header.compareDocumentPosition(lines) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).queryByText('rqdHeaderTitle')).toBeNull();
    const valueOf = (label: string) => within(dialog).getByText(label).parentElement!.textContent;
    expect(valueOf('rqdReqNo')).toContain('rqnAssignedOnSave');
    expect(valueOf('rqdReqType')).toContain('reqDocItem');
    expect(valueOf('rqdSource')).toContain('reqSourceManual');
    expect(valueOf('rqdFarmCode')).toContain('VIL100');
    expect(valueOf('rqdFarmName')).toContain('Villa Franca');
    expect(valueOf('rqdSupply')).toContain('reqSupplyMill');
    expect(valueOf('rqdPurpose')).toContain('reqPurposeTransfer');
    expect(valueOf('rqdStatus')).toContain('reqStatusDraft');
    expect(valueOf('rqdPriority')).toContain('rqnDerivedOnSave');
    expect(valueOf('rqdDeadline')).toContain('rqnSetOnSave');
    // Required Delivery Date is derived from the lines (Rishi 4 Oct): read-only, nothing to type.
    expect(valueOf('rqdRequiredDate')).toContain('rqnFromLines');
    const requiredDate = within(dialog).getByRole('textbox', { name: 'rqdRequiredDate' });
    expect(requiredDate.getAttribute('aria-readonly')).toBe('true');
    expect(requiredDate.tagName).not.toBe('INPUT');
    // Remarks stay editable and sit in the header.
    expect(within(dialog).getByLabelText('rqRemarks')).toBeTruthy();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition/options?farmId=farm-vil'));
  });

  it('lists the lines as a table in workbook columns, one row per line, with a 10000-step line number', async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewAddLine' }));
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'rqdColLineNo', 'rqdColSilo', 'rqdColItemNo', 'rqdColItemDesc', 'rqdColFeedType', 'rqdColNextDiet',
      'rqdColDaysBefore', 'rqdColLifecycle', 'rqdColSystemBalance', 'rqdColDaily', 'rqdColDaysRemaining',
      'rqdColRecommended', 'rqdColRequested', 'rqdColBags', 'rqdColDelivery', 'rqnColException', '',
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('10000')).toBeTruthy();
    expect(within(rows[1]).getByText('20000')).toBeTruthy();
    await waitForSearchable('rqNewDestination:{"line":1}');
    // Choosing a feed item fills its description and a silo makes the line Bulk.
    await fillLine(1, 's1', '3000', '2099-10-05');
    expect(within(rows[0]).getByText('Weaner Diet R1')).toBeTruthy();
    expect(within(rows[0]).getByText('reqFeedBulk')).toBeTruthy();
    await fillLine(2, 'st', '500', '2099-10-02');
    expect(within(rows[1]).getByText('reqFeedBagged')).toBeTruthy();
  });

  it('keeps the bulk total, truck target, bulk multiple and the earliest line date live from the lines', async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-settings?companyId=co-1&farmId=farm-vil'));
    fireEvent.click(screen.getByRole('button', { name: 'rqNewAddLine' }));
    await waitForSearchable('rqNewDestination:{"line":1}');
    await fillLine(1, 's1', '3000', '2099-10-05');
    await fillLine(2, 'st', '500', '2099-10-02');
    const dialog = screen.getByRole('dialog');
    const valueOf = (label: string) => within(dialog).getByText(label).parentElement!.textContent;
    // The bagged line is not part of the bulk total (Req. r26 counts bulk only).
    await waitFor(() => expect(valueOf('rqdFarmTotal')).toContain('rqdFarmTotalValue:{"total":"3,000"}'));
    expect(valueOf('rqdTruckTarget')).toContain('rqdTruckTargetValue:{"target":"30,000","trips":1}');
    expect(valueOf('rqdBulkMultiple')).toContain('rqdKgValue:{"kg":"3,000"}');
    expect(valueOf('rqdRequiredDate')).toContain('2099-10-02');
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '45000' } });
    expect(valueOf('rqdFarmTotal')).toContain('rqdFarmTotalValue:{"total":"45,000"}');
    expect(valueOf('rqdTruckTarget')).toContain('"trips":2');
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":2}'), { target: { value: '2099-10-09' } });
    expect(valueOf('rqdRequiredDate')).toContain('2099-10-05');
  });

  it('without a fixed farm (hub), the farm is chosen in the header and its code and name follow', async () => {
    render(<RequisitionNewDialog open onClose={jest.fn()} onCreated={jest.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('rqFarm')).toBeTruthy();
    expect(within(dialog).queryByText('rqdHeaderTitle')).toBeNull();
    expect(within(dialog).getByText('rqdFarmCode').parentElement!.textContent).not.toContain('VIL100');
  });

  it('still posts the same body when created from the new layout', async () => {
    const onCreated = jest.fn();
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={onCreated} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewAddLine' }));
    await waitForSearchable('rqNewDestination:{"line":1}');
    await fillLine(1, 's1', '3000', '2099-10-05');
    await fillLine(2, 'st', '500', '2099-10-02');
    fireEvent.change(screen.getByLabelText('rqRemarks'), { target: { value: 'Urgent' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewCreate' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition', {
      farmId: 'farm-vil',
      remarks: 'Urgent',
      lines: [
        { destination_location_id: 's1', item_id: 'i1', quantity_kg: 3000, proposed_delivery_date: '2099-10-05' },
        { destination_location_id: 'st', item_id: 'i1', quantity_kg: 500, proposed_delivery_date: '2099-10-02' },
      ],
    }));
  });
  // Fix round 1: Feed Type follows the server's feedTypeOf — location_master.feed_in_bags
  // first (true = BAGGED, false = BULK), the location type only when it is null.
  it('applies feed_in_bags before the location type: a bagged silo is Bagged, outside the bulk total and the trips, and its bags are shown', async () => {
    get.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/feed-settings')) return { data: { truckTargetKg: 30000, bulkMultipleKg: 3000, bagSizeKg: 50 } };
      return { data: { farmId: 'farm-vil', companyId: 'co-1', items: [{ item_id: 'i1', item_code: 'FEED-R1', item_name: 'Weaner Diet R1' }],
        destinations: [
          { location_id: 's1', location_code: 'VIL100/SILO-001', location_type: 'SILO', feed_in_bags: null },
          { location_id: 'sb', location_code: 'VIL100/SILO-002', location_type: 'SILO', feed_in_bags: true },
          { location_id: 'st', location_code: 'VIL100/STORE-001', location_type: 'STORE', feed_in_bags: null },
          { location_id: 'sx', location_code: 'VIL100/STORE-002', location_type: 'STORE', feed_in_bags: false },
        ] } };
    });
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    await waitForSearchable('rqNewDestination:{"line":1}');
    for (const n of [2, 3, 4]) fireEvent.click(screen.getByRole('button', { name: 'rqNewAddLine' }));
    await fillLine(1, 's1', '3000', '2099-10-05'); // silo, null -> Bulk
    await fillLine(2, 'sb', '120', '2099-10-05'); // silo, feed_in_bags -> Bagged
    await fillLine(3, 'st', '500', '2099-10-05'); // store, null -> Bagged
    await fillLine(4, 'sx', '2000', '2099-10-05'); // store, feed_in_bags false -> Bulk
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('reqFeedBulk')).toBeTruthy();
    expect(within(rows[1]).getByText('reqFeedBagged')).toBeTruthy();
    expect(within(rows[2]).getByText('reqFeedBagged')).toBeTruthy();
    expect(within(rows[3]).getByText('reqFeedBulk')).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    const valueOf = (label: string) => within(dialog).getByText(label).parentElement!.textContent;
    // Bulk = 3000 + 2000 only; 5000 kg on a 30,000 target is one trip.
    await waitFor(() => expect(valueOf('rqdFarmTotal')).toContain('rqdFarmTotalValue:{"total":"5,000"}'));
    expect(valueOf('rqdTruckTarget')).toContain('"trips":1');
    // Bagged = 120 + 500 kg -> 3 + 10 bags of 50 kg.
    expect(valueOf('rqdBaggedTotal')).toContain('rqdBaggedTotalValue:{"kg":"620","bags":"13","size":"50"}');
  });

  it('shows no Bagged total while no line is bagged', async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    await waitForSearchable('rqNewDestination:{"line":1}');
    await fillLine(1, 's1', '3000', '2099-10-05');
    expect(within(screen.getByRole('dialog')).queryByText('rqdBaggedTotal')).toBeNull();
  });
});
