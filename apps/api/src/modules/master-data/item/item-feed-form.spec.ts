import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateItemDto, UpdateItemDto } from './dto/item.dto';
import { ItemService } from './item.service';

const base = { item_name: 'Grower', item_type: 'FEED', uom_primary: 'KG' };

describe('Item feed_form DTO', () => {
  it.each([['BULK'], ['BAGGED'], [null], [undefined]])('accepts %s', async (v) => {
    expect(await validate(plainToInstance(CreateItemDto, { ...base, feed_form: v }))).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateItemDto, { feed_form: v }))).toHaveLength(0);
  });
  it('rejects anything else', async () => {
    const errors = await validate(plainToInstance(CreateItemDto, { ...base, feed_form: 'LOOSE' }));
    expect(errors.map((e) => e.property)).toContain('feed_form');
    expect(await validate(plainToInstance(UpdateItemDto, { feed_form: 'bulk' }))).not.toHaveLength(0);
  });
});

describe('ItemService.assertFeedForm', () => {
  const assertFeedForm = (type: string, form?: string | null) => (ItemService.prototype as any).assertFeedForm.call({}, type, form);
  it('accepts a feed form on a feed item, whatever the tenant calls the type', () => {
    expect(() => assertFeedForm('FEED', 'BULK')).not.toThrow();
    expect(() => assertFeedForm('FEED-001', 'BAGGED')).not.toThrow();
  });
  it('allows clearing or omitting it on any type', () => {
    expect(() => assertFeedForm('MEDICINE', null)).not.toThrow();
    expect(() => assertFeedForm('MEDICINE', undefined)).not.toThrow();
  });
  it('rejects it on a non-feed item with a clear 400', () => {
    expect(() => assertFeedForm('MEDICINE', 'BULK')).toThrow(BadRequestException);
    expect(() => assertFeedForm('MEDICINE', 'BULK')).toThrow(/feed items only/);
  });
});
