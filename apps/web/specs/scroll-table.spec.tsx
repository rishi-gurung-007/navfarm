import React from 'react';
import { render, screen } from '@testing-library/react';
import { ScrollTable } from '../src/components/ui/scroll-table';
import { ConsolePage } from '../src/components/ui/console-page';

describe('ScrollTable and the fixed-height page (Plan S design)', () => {
  it('wraps a separate-border table in its own scroll box, labelled for assistive tech', () => {
    render(<ScrollTable label="Feed forecast"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></ScrollTable>);
    const table = screen.getByRole('table', { name: 'Feed forecast' });
    expect(table.className).toContain('border-separate');
    expect(table.parentElement!.hasAttribute('data-table-scroll')).toBe(true);
  });

  it('marks a fill page so the shell stops scrolling <main>, and leaves normal pages alone', () => {
    const { container, rerender } = render(<ConsolePage fill><p>x</p></ConsolePage>);
    expect(container.firstElementChild!.hasAttribute('data-fill-height')).toBe(true);
    rerender(<ConsolePage><p>x</p></ConsolePage>);
    expect(container.firstElementChild!.hasAttribute('data-fill-height')).toBe(false);
  });
});
