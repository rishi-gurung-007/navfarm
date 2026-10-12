import React, { useState } from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ConfirmHost, confirmAction, ConfirmOptions } from '../src/components/ui/confirm-dialog';

jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string) => key;
  return { useLanguage: () => ({ t: stableT }) };
});

function Asker({ options }: { options: ConfirmOptions }) {
  const [answer, setAnswer] = useState('pending');
  return (
    <>
      <button onClick={async () => setAnswer(String(await confirmAction(options)))}>ask</button>
      <p data-testid="answer">{answer}</p>
    </>
  );
}

const renderWithHost = (options: ConfirmOptions) => render(<><Asker options={options} /><ConfirmHost /></>);

describe('confirmAction / ConfirmHost', () => {
  it('shows the title and message with Yes / No, and resolves true for Yes', async () => {
    renderWithHost({ title: 'Delete system scheduler?', message: 'Batch schedulers keep their activities.', tone: 'danger' });
    fireEvent.click(screen.getByText('ask'));
    expect(await screen.findByText('Delete system scheduler?')).toBeTruthy();
    expect(screen.getByText('Batch schedulers keep their activities.')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'cfYes' })); });
    expect(screen.getByTestId('answer').textContent).toBe('true');
    expect(screen.queryByText('Delete system scheduler?')).toBeNull();
  });

  it.each([
    ['No', () => fireEvent.click(screen.getByRole('button', { name: 'cfNo' }))],
    ['the close button', () => fireEvent.click(screen.getByRole('button', { name: 'close' }))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ])('resolves false for %s', async (_label, dismiss) => {
    renderWithHost({ message: 'Discard?' });
    fireEvent.click(screen.getByText('ask'));
    await screen.findByText('Discard?');
    expect(screen.getByText('cfTitle')).toBeTruthy(); // default title
    await act(async () => { dismiss(); });
    await waitFor(() => expect(screen.getByTestId('answer').textContent).toBe('false'));
  });

  it('uses the labels it is given', async () => {
    renderWithHost({ message: 'Void pack P-1?', confirmLabel: 'Void', cancelLabel: 'Keep' });
    fireEvent.click(screen.getByText('ask'));
    expect(await screen.findByRole('button', { name: 'Void' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeTruthy();
  });
});

/**
 * Browser popups (window.confirm / alert / prompt) are unstyled, block the tab
 * and cannot be translated or themed. Confirmations go through confirmAction,
 * messages through showToast.
 */
describe('no browser popups in the web app', () => {
  const root = join(__dirname, '../src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|jsx?)$/.test(name)) files.push(path);
    }
  };
  walk(root);

  it('calls none of window.confirm, window.alert or window.prompt', () => {
    const POPUP = /(?:\bwindow\.|[^.\w])(confirm|alert|prompt)\(/;
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line: line.trim(), at: `${relative(root, file)}:${i + 1}` }))
        .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*') && POPUP.test(` ${line}`)) // the space lets a call at the start of a line match
        .map(({ at, line }) => `${at}  ${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
