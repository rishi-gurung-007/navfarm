import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Field, ReadField } from '../src/components/ui/field';
import { Input } from '../src/components/ui/input';

describe('Field + Input', () => {
  it('associates the label with its input via htmlFor/id', () => {
    render(
      <Field label="Company Code" htmlFor="company-code">
        <Input id="company-code" value="" onChange={jest.fn()} />
      </Field>
    );
    // getByLabelText only succeeds if the label is programmatically associated.
    const input = screen.getByLabelText('Company Code');
    expect(input.tagName).toBe('INPUT');
  });

  it('renders a required marker on Field when required is true', () => {
    render(
      <Field label="Legal Entity Name" htmlFor="legal-name" required>
        <Input id="legal-name" value="" onChange={jest.fn()} />
      </Field>
    );
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('omits the required marker when required is false/omitted', () => {
    render(
      <Field label="Display Name" htmlFor="display-name">
        <Input id="display-name" value="" onChange={jest.fn()} />
      </Field>
    );
    expect(screen.queryByText('*')).toBeNull();
  });

  it('keeps native required validation on the input itself, independent of Field', () => {
    render(
      <Field label="City" htmlFor="city" required>
        <Input id="city" value="" onChange={jest.fn()} required />
      </Field>
    );
    const input = screen.getByLabelText(/^City/) as HTMLInputElement;
    expect(input.required).toBe(true);
  });

  it('does not silently imply native required from Field alone', () => {
    // Regression guard: Field's asterisk is visual only. If a caller forgets
    // to also pass `required` to Input, native constraint validation is lost —
    // this must never be silently true.
    render(
      <Field label="Tax ID" htmlFor="tax-id" required>
        <Input id="tax-id" value="" onChange={jest.fn()} />
      </Field>
    );
    const input = screen.getByLabelText(/^Tax ID/) as HTMLInputElement;
    expect(input.required).toBe(false);
  });

  it('preserves disabled state', () => {
    render(
      <Field label="Company Code (Read Only)" htmlFor="ro-code">
        <Input id="ro-code" value="GVF" disabled onChange={jest.fn()} />
      </Field>
    );
    const input = screen.getByLabelText('Company Code (Read Only)') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('preserves input type', () => {
    render(
      <Field label="Support Email" htmlFor="support-email">
        <Input id="support-email" type="email" value="" onChange={jest.fn()} />
      </Field>
    );
    const input = screen.getByLabelText('Support Email') as HTMLInputElement;
    expect(input.type).toBe('email');
  });

  it('preserves value/onChange as a controlled input', () => {
    const onChange = jest.fn();
    render(
      <Field label="Website URL" htmlFor="website">
        <Input id="website" value="https://navfarm.com" onChange={onChange} />
      </Field>
    );
    const input = screen.getByLabelText('Website URL') as HTMLInputElement;
    expect(input.value).toBe('https://navfarm.com');
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('preserves maxLength, name, readOnly, and autoFocus', () => {
    render(
      <Field label="Country Code" htmlFor="country-code">
        <Input
          id="country-code"
          name="country_code"
          value="IND"
          onChange={jest.fn()}
          maxLength={3}
          readOnly
          autoFocus
        />
      </Field>
    );
    const input = screen.getByLabelText('Country Code') as HTMLInputElement;
    expect(input.maxLength).toBe(3);
    expect(input.name).toBe('country_code');
    expect(input.readOnly).toBe(true);
  });

  it('shows hint text when provided and no error is present', () => {
    render(
      <Field label="Subdomain" htmlFor="subdomain" hint="Lowercase letters only">
        <Input id="subdomain" value="" onChange={jest.fn()} />
      </Field>
    );
    expect(screen.getByText('Lowercase letters only')).toBeTruthy();
  });

  it('shows error text instead of hint when both are present', () => {
    render(
      <Field label="Subdomain" htmlFor="subdomain" hint="Lowercase letters only" error="Already taken">
        <Input id="subdomain" value="" onChange={jest.fn()} />
      </Field>
    );
    expect(screen.getByText('Already taken')).toBeTruthy();
    expect(screen.queryByText('Lowercase letters only')).toBeNull();
  });

  it('carries a visible focus-visible ring on Input', () => {
    render(
      <Field label="Search" htmlFor="search">
        <Input id="search" value="" onChange={jest.fn()} />
      </Field>
    );
    const input = screen.getByLabelText('Search');
    expect(input.className).toContain('focus-visible:ring-2');
  });
});

describe('ReadField', () => {
  it('can present a copyable value with the same control shape without becoming a disabled input', () => {
    render(<ReadField label="Requisition Type" value="Item" appearance="control" />);

    const value = screen.getByRole('textbox', { name: 'Requisition Type' });
    expect(value.getAttribute('aria-readonly')).toBe('true');
    expect(value.textContent).toBe('Item');
    expect(value.tagName).not.toBe('INPUT');
    expect(value.className).toContain('min-h-11');
    expect(value.className).toContain('border');
  });

  it('uses the caller\'s human empty-state text instead of a dash', () => {
    render(<ReadField label="Requisition No." value={null} appearance="control" emptyText="Assigned when saved" />);

    expect(screen.getByRole('textbox', { name: 'Requisition No.' }).textContent).toBe('Assigned when saved');
    expect(screen.queryByText('—')).toBeNull();
  });
});
