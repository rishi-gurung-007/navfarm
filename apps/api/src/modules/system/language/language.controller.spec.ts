import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LanguageController } from './language.controller';
import { AddTranslationDto } from './dto/language.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../../common/guards/system-admin.guard';

describe('LanguageController translation writes', () => {
  const proto = LanguageController.prototype as any;

  // POST translation was the one write on this controller with no guard at all.
  it.each(['addTranslation', 'createLanguage', 'updateLanguage', 'deleteLanguage'])('%s is platform-admin only', (name) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, proto[name])).toEqual([JwtAuthGuard, SystemAdminGuard]);
  });

  const valid = { langId: '10000000-1000-1000-1000-100000000001', moduleCode: 'PIGGERY', key: 'BUTTON_SUBMIT', value: 'Submit' };
  const errorsFor = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(AddTranslationDto, body))).map((e) => e.property).sort();

  it('accepts a complete translation, including a seeded non-RFC-4122 language id', async () => {
    expect(await errorsFor(valid)).toEqual([]);
  });

  it('rejects an empty body field by field instead of writing a blank row', async () => {
    expect(await errorsFor({})).toEqual(['key', 'langId', 'moduleCode', 'value']);
  });

  it('rejects blanks, non-strings and values longer than their columns', async () => {
    expect(await errorsFor({ ...valid, value: '' })).toEqual(['value']);
    expect(await errorsFor({ ...valid, langId: 42 })).toEqual(['langId']);
    expect(await errorsFor({ ...valid, moduleCode: 'M'.repeat(51) })).toEqual(['moduleCode']);
    expect(await errorsFor({ ...valid, key: 'K'.repeat(201) })).toEqual(['key']);
  });
});
