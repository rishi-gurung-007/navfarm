import { Badge, type BadgeProps } from './badge';

/**
 * The single place a domain status maps to a semantic color.
 *
 * Before this, nine panels each declared their own `STATUS_STYLE: Record<string, any>`
 * with hand-written CSS-variable triples, and they disagreed: the same "locked" or
 * "closed" idea read as danger-red in one screen and neutral grey in another, which
 * made an ordinary lifecycle state look like an error. apple.design.md §6 asks for
 * restrained semantic color used as meaning, not decoration — that only holds if one
 * table decides what each state means.
 *
 * Rule of thumb for extending this: `danger` is for something that went wrong or was
 * revoked, `warning` for something needing attention, `success` for a completed good
 * outcome, `accent` for a noteworthy-but-normal state, `neutral` for the rest —
 * including every terminal/expected state (closed, locked, dead, sold), which is the
 * distinction the old per-file maps kept getting wrong.
 */
const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  // Document lifecycle
  DRAFT: 'neutral',
  POSTED: 'success',
  CANCELLED: 'danger',
  CLOSED: 'neutral',
  LOCKED: 'neutral',
  OPEN: 'accent',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',

  // Batch / production lifecycle
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  // Deliberate and reversible, but it changes what the record can be used for —
  // attention, not a failure and not a quiet terminal state.
  BLOCKED: 'warning',
  COMPLETED: 'success',
  SUSPENDED: 'warning',

  // Alert severity
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'danger',

  // Animal lifecycle / health
  QUARANTINE: 'warning',
  SICK: 'danger',
  PREGNANT: 'accent',
  LACTATING: 'accent',
  DRY: 'neutral',
  CULLED: 'neutral',
  DEAD: 'neutral',
  SOLD: 'neutral',
  SLAUGHTERED: 'neutral',

  // Ledger movement direction
  POSITIVE: 'success',
  NEGATIVE: 'danger',

  // Bio-asset ledger entry types
  ACQUISITION: 'accent',
  AMORTIZATION: 'warning',
  TRANSFORMATION: 'danger',
  DISPOSAL: 'danger',
  // Batch-to-batch livestock movement: a reclassification, not a loss —
  // neutral on both legs so a transfer never reads like a mortality.
  TRANSFER_IN: 'neutral',
  TRANSFER_OUT: 'neutral',
};

export function statusVariant(status?: string | null): BadgeProps['variant'] {
  if (!status) return 'neutral';
  return STATUS_VARIANT[status.toUpperCase()] ?? 'neutral';
}

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant' | 'children'> {
  status?: string | null;
  /** Display text, when it differs from the raw status (e.g. a translated label). */
  label?: string;
}

export function StatusBadge({ status, label, ...props }: StatusBadgeProps) {
  return (
    <Badge variant={statusVariant(status)} {...props}>
      {label ?? (status || '').replace(/_/g, ' ')}
    </Badge>
  );
}
