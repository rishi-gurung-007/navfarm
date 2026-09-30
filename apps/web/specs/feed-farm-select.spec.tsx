import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeedFarmSelect, feedFarmLabel } from '../src/components/console/inventory/feed-farm-select';

const farm = (code: string, company: string) => ({ farmId: `f-${code}`, code, name: `${code} Farm`, companyId: company, companyName: company });

describe('FeedFarmSelect (A5, S3)', () => {
  it('labels each farm "CODE — Name" in the order given, flat for one company', () => {
    render(<FeedFarmSelect id="x" label="Farm" farms={[farm('LEX100', 'Triple C'), farm('VIL100', 'Triple C')]} farmId="f-VIL100" onChange={jest.fn()} />);
    const select = screen.getByLabelText('Farm') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['LEX100 — LEX100 Farm', 'VIL100 — VIL100 Farm']);
    expect(select.querySelectorAll('optgroup')).toHaveLength(0);
    expect(select.value).toBe('f-VIL100');
  });

  it('groups by company when there are several (tenant workspace)', () => {
    render(<FeedFarmSelect id="x" label="Farm" farms={[farm('AAA100', 'Colcom'), farm('BBB100', 'Triple C')]} farmId={null} onChange={jest.fn()} />);
    const groups = [...(screen.getByLabelText('Farm') as HTMLSelectElement).querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Colcom', 'Triple C']);
  });

  it('reports a choice, and shows a fixed farm read-only', () => {
    const onChange = jest.fn();
    const { rerender } = render(<FeedFarmSelect id="x" label="Farm" farms={[farm('LEX100', 'T'), farm('VIL100', 'T')]} farmId="f-LEX100" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Farm'), { target: { value: 'f-VIL100' } });
    expect(onChange).toHaveBeenCalledWith('f-VIL100');
    rerender(<FeedFarmSelect id="x" label="Farm" farms={[]} farmId="f-VIL100" onChange={onChange} fixedLabel="VIL100 — Villa Franca" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('VIL100 — Villa Franca')).toBeTruthy();
    expect(feedFarmLabel({ code: 'VIL100', name: 'Villa Franca' })).toBe('VIL100 — Villa Franca');
  });
});
