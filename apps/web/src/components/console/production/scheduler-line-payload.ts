/**
 * A scheduler activity line as `CreateSchedulerLineDto` takes it.
 *
 * The line editor holds a form row, which is not the same shape as the API's line: it carries boxes the API has no
 * field for (`line_seq`, which the server numbers itself, and `resource_name`, which it reads from the resource), and
 * it holds "" for every box the user has not filled. The API validates with `forbidNonWhitelisted`, so an extra field
 * is a 400 ("Line Seq is not a field this form accepts"), and `@IsOptional()` only passes over null/undefined — an
 * `item_id: ""` reaches `@IsUUID()` and comes back as "Select an Item", even on a KPI line that has no item.
 *
 * So the payload is built by naming the fields the DTO accepts and leaving out what the user never set, rather than
 * by spreading the form row.
 */
export const SCHEDULER_LINE_API_FIELDS = [
  'line_type', 'activity_name', 'occurrence', 'start_day', 'end_day', 'day_of_week', 'custom_days', 'is_mandatory',
  'item_id', 'item_description', 'standard_qty', 'qty_basis', 'allow_qty_edit', 'lot_required', 'creates_inventory',
  'output_lot_auto', 'output_basis', 'kpi_metric', 'kpi_uom', 'std_value', 'lower_alert_limit', 'upper_alert_limit',
  'alert_severity', 'capture_per', 'overhead_category', 'gl_account', 'estimated_cost', 'resource_id',
  'auto_triggers_stage', 'extension_config', 'lifecycle_ref_id',
] as const;

type Row = Record<string, any>;

const blank = (v: unknown) => v === '' || v === null || v === undefined;
const numberOrNull = (v: unknown) => (blank(v) ? null : Number(v));

/** The day numbers of a CUSTOM line, written "3, 10" in the box or already a list. */
function customDayList(value: unknown): number[] {
  const parts = Array.isArray(value)
    ? value.map((d) => (d && typeof d === 'object' ? (d as Row).day_number : d))
    : String(value ?? '').split(',');
  return parts.map((d) => Number(String(d).trim())).filter((n) => Number.isFinite(n));
}

export function toApiLine(line: Row): Row {
  const dayField = line.occurrence === 'WEEKLY' || line.occurrence === 'MONTHLY';
  const sent: Row = {
    // The numeric and list boxes, normalised: an unset one is null, which the DTO passes over.
    start_day: Number(line.start_day) || 1,
    end_day: blank(line.end_day) || Number(line.end_day) === 0 ? null : Number(line.end_day),
    day_of_week: dayField ? numberOrNull(line.day_of_week) : null,
    custom_days: line.occurrence === 'CUSTOM' ? customDayList(line.custom_days) : null,
    standard_qty: numberOrNull(line.standard_qty),
    std_value: numberOrNull(line.std_value),
    lower_alert_limit: numberOrNull(line.lower_alert_limit),
    upper_alert_limit: numberOrNull(line.upper_alert_limit),
    estimated_cost: numberOrNull(line.estimated_cost),
    // The switches are always one or the other, never unset.
    is_mandatory: !!line.is_mandatory,
    allow_qty_edit: line.allow_qty_edit !== false,
    lot_required: !!line.lot_required,
    creates_inventory: line.creates_inventory !== false,
    output_lot_auto: line.output_lot_auto !== false,
    auto_triggers_stage: !!line.auto_triggers_stage,
    // What the line is, always set by the editor.
    line_type: line.line_type,
    activity_name: line.activity_name,
    occurrence: line.occurrence,
  };
  // An id, a name or a card the user did not set is left out: "" is not a UUID and not one of an enum's values.
  for (const field of ['item_id', 'resource_id', 'item_description', 'qty_basis', 'output_basis', 'kpi_metric',
    'kpi_uom', 'alert_severity', 'capture_per', 'overhead_category', 'gl_account', 'extension_config',
    'lifecycle_ref_id'] as const) {
    if (!blank(line[field])) sent[field] = line[field];
  }
  return sent;
}
