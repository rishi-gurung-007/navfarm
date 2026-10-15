/**
 * What the Create Scheduler form sends must be what CreateSchedulerHeaderDto takes (15 Oct).
 *
 * The form's activities are filled in from the breed lifecycle stage, and it used to send its form rows straight
 * through: every unset box as "" and two boxes of its own (`line_seq`, `resource_name`). The API validates with
 * `forbidNonWhitelisted`, so creating a scheduler failed with "Line Seq is not a field this form accepts" and, on
 * every KPI line, "Select an Item" — the "" reaching `@IsUUID()`. The form now names the fields it sends
 * (web: scheduler-line-payload.ts); this is the other half of that contract.
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { formatValidationErrors } from '../../../common/validation-messages';
import { CreateSchedulerHeaderDto } from './dto/scheduler-header.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
  exceptionFactory: (errors) => new BadRequestException({ statusCode: 400, message: formatValidationErrors(errors), error: 'Bad Request' }),
});

async function messagesFor(body: unknown): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype: CreateSchedulerHeaderDto });
  } catch (err) {
    return ((err as BadRequestException).getResponse() as { message?: string[] }).message ?? [];
  }
  return [];
}

const BATCH = '6f1b0c2e-0000-4000-8000-00000000b001';
const STAGE = '6f1b0c2e-0000-4000-8000-00000000s001'.replace(/s/g, '5');
const FEED_ITEM = '6f1b0c2e-0000-4000-8000-00000000f001'.replace(/f/g, '7');

/** The five activities a Weaner stage fills in, as the form now sends them. */
const body = {
  batch_id: BATCH,
  stage_id: STAGE,
  data_entry_level: 'SHED',
  effective_from: '2026-09-30',
  effective_to: '2026-11-11',
  animal_count: 17,
  scheduler_status: 'DRAFT',
  lines: [
    {
      line_type: 'CONSUMPTION', activity_name: 'Weaner Feed — Weaner Grower Mash (18% CP)', occurrence: 'DAILY',
      start_day: 1, end_day: 42, day_of_week: null, custom_days: null, standard_qty: 0.8, std_value: null,
      lower_alert_limit: null, upper_alert_limit: null, estimated_cost: null, is_mandatory: true,
      allow_qty_edit: true, lot_required: false, creates_inventory: true, output_lot_auto: true,
      auto_triggers_stage: false, item_id: FEED_ITEM, qty_basis: 'PER_HEAD',
    },
    {
      line_type: 'DESCRIPTIVE', activity_name: 'KPI: Average Daily Gain', occurrence: 'DAILY',
      start_day: 1, end_day: 42, day_of_week: null, custom_days: null, standard_qty: null, std_value: 600,
      lower_alert_limit: 570, upper_alert_limit: 630, estimated_cost: null, is_mandatory: false,
      allow_qty_edit: true, lot_required: false, creates_inventory: true, output_lot_auto: true,
      auto_triggers_stage: false, kpi_metric: 'ADG', kpi_uom: 'GRAM', alert_severity: 'WARNING', capture_per: 'AVERAGE',
    },
    {
      line_type: 'DESCRIPTIVE', activity_name: 'KPI: Mortality Count', occurrence: 'DAILY',
      start_day: 1, end_day: 42, day_of_week: null, custom_days: null, standard_qty: null, std_value: 0,
      lower_alert_limit: null, upper_alert_limit: null, estimated_cost: null, is_mandatory: true,
      allow_qty_edit: true, lot_required: false, creates_inventory: true, output_lot_auto: true,
      auto_triggers_stage: false, kpi_metric: 'MORTALITY_COUNT', kpi_uom: 'HEAD', alert_severity: 'WARNING', capture_per: 'TOTAL',
    },
    {
      line_type: 'DESCRIPTIVE', activity_name: 'Weaner Body Weight Check', occurrence: 'WEEKLY',
      start_day: 1, end_day: 42, day_of_week: 1, custom_days: null, standard_qty: null, std_value: 20,
      lower_alert_limit: null, upper_alert_limit: null, estimated_cost: null, is_mandatory: false,
      allow_qty_edit: true, lot_required: false, creates_inventory: true, output_lot_auto: true,
      auto_triggers_stage: false, kpi_metric: 'BODY_WEIGHT', kpi_uom: 'KG', alert_severity: 'WARNING', capture_per: 'AVERAGE',
    },
    {
      line_type: 'CONSUMPTION', activity_name: 'Medication: Ivermectin 1% — Mange', occurrence: 'DAILY',
      start_day: 1, end_day: 42, day_of_week: null, custom_days: null, standard_qty: 0, std_value: null,
      lower_alert_limit: null, upper_alert_limit: null, estimated_cost: null, is_mandatory: false,
      allow_qty_edit: true, lot_required: true, creates_inventory: true, output_lot_auto: true,
      auto_triggers_stage: false, item_id: FEED_ITEM, qty_basis: 'PER_HEAD',
      extension_config: { as_needed: true, treatments: [{ problem: 'Mange', dose: '1 ml / 33 kg' }] },
    },
  ],
};

describe('creating a scheduler with the activities filled in from the stage', () => {
  it('is accepted: a feed line, three KPI data-entry lines and an as-needed medication line', async () => {
    expect(await messagesFor(body)).toEqual([]);
  });

  it('a stage-filled line sends back the breed lifecycle row it came from', async () => {
    expect(await messagesFor({ ...body, lines: [{ ...body.lines[1], lifecycle_ref_id: '6f1b0c2e-0000-4000-8000-0000000000aa' }] })).toEqual([]);
  });

  it('a CUSTOM line sends its day numbers as a list', async () => {
    expect(await messagesFor({ ...body, lines: [{ ...body.lines[0], occurrence: 'CUSTOM', custom_days: [3, 10] }] })).toEqual([]);
  });

  it("the form's own boxes are not fields the API accepts — the server numbers the lines itself", async () => {
    expect(await messagesFor({ ...body, lines: [{ ...body.lines[1], line_seq: 2, resource_name: '' }] }))
      .toEqual(expect.arrayContaining([
        'Lines 1: Line Seq is not a field this form accepts.',
        'Lines 1: Resource Name is not a field this form accepts.',
      ]));
  });

  it('an id the user never picked must be left out, not sent as ""', async () => {
    expect(await messagesFor({ ...body, lines: [{ ...body.lines[1], item_id: '', resource_id: '' }] }))
      .toEqual(expect.arrayContaining(['Lines 1: Select an Item.', 'Lines 1: Select a Resource.']));
  });
});
