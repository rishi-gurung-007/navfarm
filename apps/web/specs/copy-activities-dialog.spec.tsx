import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import CopyActivitiesDialog from '../src/components/console/production/copy-activities-dialog';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const get = api.get as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation(async (url: string) => url.startsWith('/system-scheduler')
    ? { data: [
      { system_scheduler_id: 'sys-q', scheduler_name: 'Quarantine standard', stage_name: 'Quarantine', is_active: true, line_count: 4 },
      { system_scheduler_id: 'sys-empty', scheduler_name: 'Unfinished', stage_name: 'Quarantine', is_active: true, line_count: 0 },
      { system_scheduler_id: 'sys-off', scheduler_name: 'Switched off', stage_name: 'Quarantine', is_active: false, line_count: 2 },
    ] }
    : { data: [
      { scheduler_id: 'target', batch_no: 'BATCH-000002', stage_name: 'Quarantine', line_count: 0 },
      { scheduler_id: 'b-flush', batch_no: 'BATCH-000002', stage_name: 'Flush', line_count: 4 },
      { scheduler_id: 'b-q', batch_no: 'BATCH-000001', stage_name: 'Quarantine', line_count: 2 },
    ] });
});

describe('CopyActivitiesDialog', () => {
  it('offers active system schedulers and batch schedulers that have activities, never the target, same stage first', async () => {
    render(<CopyActivitiesDialog open onClose={jest.fn()} companyId="co-1" targetId="target" stageName="Quarantine" onCopy={jest.fn()} />);
    await screen.findByText('Quarantine standard');
    expect(screen.queryByText('Unfinished')).toBeNull();
    expect(screen.queryByText('Switched off')).toBeNull();
    const batchRows = screen.getAllByRole('row').filter((r) => /BATCH-00000/.test(r.textContent || ''));
    // The target itself is not offered; BATCH-000001's Quarantine sorts ahead of BATCH-000002's Flush.
    expect(batchRows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['BATCH-000001', 'BATCH-000002']);
  });

  it('copies from the picked source and closes', async () => {
    const onCopy = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(<CopyActivitiesDialog open onClose={onClose} companyId="co-1" targetId="target" stageName="Quarantine" onCopy={onCopy} />);
    const row = (await screen.findByText('Quarantine standard')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'scCopyAction' }));
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith('SYSTEM', 'sys-q'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('stays open when the copy resolves false (the user kept the activities they had)', async () => {
    const onCopy = jest.fn().mockResolvedValue(false);
    const onClose = jest.fn();
    render(<CopyActivitiesDialog open onClose={onClose} companyId="co-1" targetId="" stageName="Quarantine" onCopy={onCopy} />);
    const row = (await screen.findByText('Quarantine standard')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'scCopyAction' }));
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith('SYSTEM', 'sys-q'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the reason when the copy is refused', async () => {
    const onCopy = jest.fn().mockRejectedValue(new Error('This scheduler already has activities.'));
    const onClose = jest.fn();
    render(<CopyActivitiesDialog open onClose={onClose} companyId="co-1" targetId="target" stageName="Quarantine" onCopy={onCopy} />);
    const row = (await screen.findByText('BATCH-000001')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'scCopyAction' }));
    await screen.findByText('This scheduler already has activities.');
    expect(onCopy).toHaveBeenCalledWith('BATCH', 'b-q');
    expect(onClose).not.toHaveBeenCalled();
  });
});
