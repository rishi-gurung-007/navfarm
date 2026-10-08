import { BadRequestException } from '@nestjs/common';

/**
 * A master's code is its identity. Items, batches, ledger rows and journals
 * all hold it (sometimes as a plain string with no foreign key), so changing
 * it after the record exists orphans or mislabels everything that points at it.
 *
 * Call this at the top of every master's update path with the stored code and
 * whatever code the request carried. A request that repeats the stored code
 * (case and spacing aside) is harmless; one that differs is refused.
 */
export function assertCodeUnchanged(
  label: string,
  current: string | null | undefined,
  supplied: string | null | undefined,
): void {
  const next = supplied?.trim();
  if (!next) return;
  if (!current) return;
  if (next.toUpperCase() === current.trim().toUpperCase()) return;
  throw new BadRequestException(
    `The ${label} code cannot be changed after it is created. Keep '${current}', or create a new ${label.toLowerCase()} instead.`,
  );
}
