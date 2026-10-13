import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useSystemSchedulerPrompt, SchedulerSource } from '../src/components/console/production/system-scheduler-prompt';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const get = api.get as jest.Mock;

/** Calls ask() with the given options on click and shows what it resolved to. */
function Host({ opts }: { opts: Parameters<ReturnType<typeof useSystemSchedulerPrompt>['ask']>[0] }) {
  const prompt = useSystemSchedulerPrompt();
  const [answer, setAnswer] = useState<string>('pending');
  return (
    <>
      <button onClick={async () => {
        const result: SchedulerSource | null | undefined = await prompt.ask(opts);
        setAnswer(result === undefined ? 'undefined' : String(result));
      }}>go</button>
      <p data-testid="answer">{answer}</p>
      {prompt.element}
    </>
  );
}

const match = [{ stage_id: 's-gest', stage_code: 'GESTATION', stage_name: 'Gestation', system_scheduler_id: 'sys-1', scheduler_name: 'Gestation standard', line_count: 3 }];

beforeEach(() => jest.clearAllMocks());

describe('useSystemSchedulerPrompt', () => {
  it('asks nothing — and resolves undefined — when no system scheduler matches the stage', async () => {
    get.mockResolvedValue({ data: [] });
    render(<Host opts={{ companyId: 'co-1', stageIds: ['s-gest'], breedId: 'b-1' }} />);
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByTestId('answer').textContent).toBe('undefined'));
    expect(get).toHaveBeenCalledWith('/system-scheduler/match?companyId=co-1&stageIds=s-gest&breedId=b-1');
    expect(screen.queryByText('sysSchPromptTitle')).toBeNull();
  });

  it('does not call the API with no stage to ask about', async () => {
    render(<Host opts={{ companyId: 'co-1', stageIds: [null, ''] }} />);
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByTestId('answer').textContent).toBe('undefined'));
    expect(get).not.toHaveBeenCalled();
  });

  it('names a transfer destination by LOB and stage code', async () => {
    get.mockResolvedValue({ data: [] });
    render(<Host opts={{ companyId: 'co-1', lobId: 'lob-1', stageCodes: ['FARROWING'] }} />);
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/system-scheduler/match?companyId=co-1&lobId=lob-1&stageCodes=FARROWING'));
  });

  it.each([
    ['sysSchPromptYes', 'SYSTEM'],
    ['sysSchPromptNo', 'EMPTY'],
  ])('shows the matching system scheduler and resolves %s to %s', async (button, expected) => {
    get.mockResolvedValue({ data: match });
    render(<Host opts={{ companyId: 'co-1', stageIds: ['s-gest'] }} />);
    fireEvent.click(screen.getByText('go'));
    await screen.findByText('sysSchPromptTitle');
    expect(screen.getByText('Gestation')).toBeTruthy();
    expect(screen.getByText(/Gestation standard/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: button })); });
    expect(screen.getByTestId('answer').textContent).toBe(expected);
    expect(screen.queryByText('sysSchPromptTitle')).toBeNull();
  });

  it('resolves null when the dialog is closed, so the caller creates nothing', async () => {
    get.mockResolvedValue({ data: match });
    render(<Host opts={{ companyId: 'co-1', stageIds: ['s-gest'] }} />);
    fireEvent.click(screen.getByText('go'));
    await screen.findByText('sysSchPromptTitle');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'close' })); });
    expect(screen.getByTestId('answer').textContent).toBe('null');
  });
});
