import { fireEvent, screen, within } from '@testing-library/react';

/**
 * Driving the shared Select (components/ui/select) the way a user does, since
 * 22 Oct it renders a searchable list behind a trigger button rather than a
 * native <select>: the trigger opens a listbox whose rows are role="option",
 * each named by its label. A field's <label htmlFor> still points at the
 * trigger, so getByLabelText finds it.
 */

// jsdom has no layout, so no scrollIntoView; the open list calls it to keep the highlighted row in view.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

export function openSelect(trigger: HTMLElement): HTMLElement {
  // The trigger toggles the list, so it is clicked only while the list is shut.
  if (trigger.getAttribute('aria-expanded') !== 'true')
    fireEvent.click(trigger);
  const lists = screen.getAllByRole('listbox');
  return lists[lists.length - 1];
}

/** The labels the select offers, in order; the list is closed again afterwards. */
export function optionLabels(trigger: HTMLElement): string[] {
  const list = openSelect(trigger);
  const labels = within(list)
    .getAllByRole('option')
    .map((o) => o.getAttribute('aria-label') ?? o.textContent ?? '');
  if (trigger.getAttribute('aria-expanded') === 'true')
    fireEvent.click(trigger);
  return labels;
}

/** Picks the option with this label, as a click on it would. */
export function chooseOption(
  trigger: HTMLElement,
  label: string | RegExp,
): void {
  const list = openSelect(trigger);
  fireEvent.click(within(list).getByRole('option', { name: label }));
}

/**
 * The option values behind a Select's trigger. The Select keeps its <option>
 * children in a hidden native <select> (id `<trigger id>-native`) that the
 * searchable list is built from, so the values read there are the ones offered.
 */
export function optionValues(trigger: HTMLElement): string[] {
  return Array.from(nativeOf(trigger).options).map((o) => o.value);
}

/** Picks the option with this value, by clicking its row in the list. */
export function chooseValue(trigger: HTMLElement, value: string): void {
  const option = Array.from(nativeOf(trigger).options).find(
    (o) => o.value === value,
  );
  if (!option)
    throw new Error(`No option with value '${value}' behind #${trigger.id}`);
  chooseOption(trigger, (option.textContent ?? '').replace(/\s+/g, ' ').trim());
}

function nativeOf(trigger: HTMLElement): HTMLSelectElement {
  const native = trigger.id
    ? document.getElementById(`${trigger.id}-native`)
    : null;
  if (!(native instanceof HTMLSelectElement))
    throw new Error(`#${trigger.id} is not a shared Select`);
  return native;
}

/** The value the Select holds now. */
export function selectedValue(trigger: HTMLElement): string {
  return nativeOf(trigger).value;
}
