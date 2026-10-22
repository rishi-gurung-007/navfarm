import * as React from 'react';
import SearchableSelect from './searchable-select';

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return '';
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  /** Form fields fill their parent by default; compact controls can opt out. */
  fullWidth?: boolean;
};

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, onChange, value, defaultValue, disabled, required, id, name, 'aria-label': ariaLabel, fullWidth = true, ...props }, ref) => {
    const options = React.Children.toArray(children)
      .filter((child): child is React.ReactElement<{ value?: string | number; children?: React.ReactNode }> =>
        React.isValidElement(child) && child.type === 'option')
      .map((option) => ({
        value: String(option.props.value ?? ''),
        label: textOf(option.props.children).replace(/\s+/g, ' ').trim(),
      }));
    const selectedValue = value !== undefined ? String(value) : defaultValue !== undefined ? String(defaultValue) : '';
    const handleChange = (next: string) => {
      onChange?.({ target: { value: next }, currentTarget: { value: next } } as React.ChangeEvent<HTMLSelectElement>);
    };

    return (
      <>
        <SearchableSelect
          id={id}
          ariaLabel={ariaLabel || name || id || 'Select option'}
          value={selectedValue}
          onChange={handleChange}
          options={options}
          valueKey="value"
          labelKey="label"
          placeholder={options.find((option) => option.value === '')?.label || 'Select…'}
          disabled={disabled}
          fullWidth={fullWidth}
          triggerClassName={className}
          triggerStyle={props.style as React.CSSProperties | undefined}
        />
        <select
          ref={ref}
          {...props}
          id={id ? `${id}-native` : undefined}
          name={name}
          value={selectedValue}
          onChange={(event) => handleChange(event.target.value)}
          disabled={disabled}
          required={required}
          tabIndex={-1}
          aria-hidden="true"
          className="absolute h-px w-px overflow-hidden opacity-0"
        >
          {children}
        </select>
      </>
    );
  }
);
Select.displayName = 'Select';

export { Select };
