import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { formatValidationErrors, humanizeFieldName, humanizeFieldNamesInText } from './validation-messages';

class LineDto {
  @IsUUID() item_id!: string;
  @Min(1) quantity!: number;
}

class SampleDto {
  @IsString() @IsNotEmpty() location_type!: string;
  @IsUUID() @IsOptional() parent_location_id?: string;
  @IsUUID() farm_id!: string;
  @IsString() @MaxLength(5) location_name!: string;
  @IsInt() @Min(1) @Max(10) seq_length!: number;
  @IsIn(['SHED', 'PEN']) kind!: string;
  @ArrayNotEmpty() animal_ids!: string[];
  @ValidateNested({ each: true }) @Type(() => LineDto) lines!: LineDto[];
}

const pipe = new ValidationPipe({
  whitelist: true, transform: true, forbidNonWhitelisted: true,
  exceptionFactory: (errors) => new BadRequestException({ statusCode: 400, message: formatValidationErrors(errors), error: 'Bad Request' }),
});

async function messagesFor(body: unknown): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype: SampleDto });
  } catch (err) {
    return (err as BadRequestException).getResponse()['message'];
  }
  return [];
}

describe('humanizeFieldName', () => {
  it.each([
    ['parent_location_id', 'Parent Location'],
    ['parentLocationId', 'Parent Location'],
    ['location_type', 'Location Type'],
    ['uom', 'UOM'],
    ['rfid_tag', 'RFID Tag'],
    ['nob_id', 'Nature of Business'],
    ['animal_ids', 'Animals'],
  ])('%s -> %s', (raw, label) => expect(humanizeFieldName(raw)).toBe(label));
});

describe('validation messages', () => {
  it('names the field the way the screen does and says what to do', async () => {
    const messages = await messagesFor({ parent_location_id: 'nope', location_name: 'far too long', seq_length: 99, kind: 'BARN', animal_ids: [], lines: [{ quantity: 0 }] });
    expect(messages).toEqual(expect.arrayContaining([
      'Location Type is required.',
      'Select a valid Parent Location.',
      'Select a Farm.',
      'Location Name can have at most 5 characters.',
      'Seq Length must be 10 or less.',
      'Kind must be one of: SHED, PEN.',
      'Animals needs at least one entry.',
      'Lines 1: Select an Item.',
      'Lines 1: Quantity must be 1 or more.',
    ]));
  });

  it('never shows a column name or a rule number', async () => {
    const messages = (await messagesFor({ parent_location_id: 'nope' })).join(' ');
    expect(messages).not.toMatch(/_id|should not be empty|must be a UUID|property .* should not exist/);
  });

  it('says "is required" once for a missing value instead of listing every rule it breaks', async () => {
    const messages = await messagesFor({ location_type: 'FARM', farm_id: '11111111-1111-4111-8111-111111111111', location_name: 'x', kind: 'PEN', animal_ids: ['a'], lines: [] });
    expect(messages).toEqual(['Seq Length is required.']);
  });

  it('explains an unrecognised field instead of quoting the validator', async () => {
    const messages = await messagesFor({ location_type: 'FARM', farm_id: '11111111-1111-4111-8111-111111111111', location_name: 'x', seq_length: 1, kind: 'PEN', animal_ids: ['a'], lines: [], surprise_field: 1 });
    expect(messages).toEqual(['Surprise Field is not a field this form accepts.']);
  });
});

describe('humanizeFieldNamesInText', () => {
  it('swaps request field names for labels and leaves codes alone', () => {
    expect(humanizeFieldNamesInText('boar_animal_id must be set for NATURAL_MATING.')).toBe('Boar Animal must be set for NATURAL_MATING.');
    expect(humanizeFieldNamesInText("Item 'ITM_0001' not found; set is_qr_enabled first.")).toBe("Item 'ITM_0001' not found; set Is QR Enabled first.");
    expect(humanizeFieldNamesInText('Everything is fine.')).toBe('Everything is fine.');
  });
});
