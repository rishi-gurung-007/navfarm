import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DateInput } from '../src/components/ui/date-input';

function Harness({ initial = '', min, max, required }: { initial?: string; min?: string; max?: string; required?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateInput aria-label="when" value={value} onChange={(e) => setValue(e.target.value)} min={min} max={max} required={required} />
      <output data-testid="stored">{value}</output>
    </>
  );
}
const field = () => screen.getByLabelText('when') as HTMLInputElement;
const stored = () => screen.getByTestId('stored').textContent;
const type = (text: string) => {
  fireEvent.focus(field());
  fireEvent.change(field(), { target: { value: text } });
};

describe('the date field', () => {
  it('shows the stored date as DD/MM/YY', () => {
    render(<Harness initial="2026-11-03" />);
    expect(field().value).toBe('03/11/26');
  });

  it('puts the slashes in as the digits are typed and hands the form the stored date when the field is left', () => {
    render(<Harness />);
    type('031126');
    expect(field().value).toBe('03/11/26');
    expect(stored()).toBe('');
    fireEvent.blur(field());
    expect(stored()).toBe('2026-11-03');
    expect(field().value).toBe('03/11/26');
  });

  it('takes DD/MM/YYYY at once, and a pasted stored date as it is', () => {
    render(<Harness />);
    type('03111998');
    expect(stored()).toBe('1998-11-03');
    fireEvent.change(field(), { target: { value: '2027-01-05' } });
    expect(stored()).toBe('2027-01-05');
    expect(field().value).toBe('05/01/27');
  });

  it('goes back to the last good value for what is not a real date', () => {
    render(<Harness initial="2026-11-03" />);
    type('31/02/26');
    fireEvent.blur(field());
    expect(stored()).toBe('2026-11-03');
    expect(field().value).toBe('03/11/26');
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps to min and max', () => {
    render(<Harness initial="2026-11-03" max="2026-11-03" />);
    type('04/11/26');
    fireEvent.blur(field());
    expect(stored()).toBe('2026-11-03');
  });

  it('can be emptied', () => {
    render(<Harness initial="2026-11-03" />);
    type('');
    fireEvent.blur(field());
    expect(stored()).toBe('');
  });

  it('offers a calendar whose day sets the date', () => {
    render(<Harness initial="2026-11-03" />);
    fireEvent.click(screen.getByLabelText('Open the calendar'));
    expect(screen.getByTestId('date-calendar')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('15/11/26'));
    expect(stored()).toBe('2026-11-15');
    expect(field().value).toBe('15/11/26');
  });

  it('does not offer a day outside max, and clears when the field is not required', () => {
    render(<Harness initial="2026-11-03" max="2026-11-10" />);
    fireEvent.click(screen.getByLabelText('Open the calendar'));
    expect((screen.getByLabelText('11/11/26') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Clear'));
    expect(stored()).toBe('');
  });

  it('has no Clear when the field is required', () => {
    render(<Harness initial="2026-11-03" required />);
    fireEvent.click(screen.getByLabelText('Open the calendar'));
    expect(screen.queryByText('Clear')).toBeNull();
  });
});
