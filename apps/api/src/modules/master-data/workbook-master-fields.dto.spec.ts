import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItemDto, UpdateItemDto } from './item/dto/item.dto';
import { CreateBreedLifecycleStageDto, UpdateBreedLifecycleStageDto } from './breed/dto/breed.dto';
import { CreateLocationDto, UpdateLocationDto } from './location/dto/location.dto';

// Same options the global ValidationPipe uses.
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;
const check = (cls: any, plain: Record<string, unknown>) => validate(plainToInstance(cls, plain), PIPE);
const props = (errors: { property: string }[]) => errors.map((e) => e.property);

const ITEM_BASE = { item_name: 'Starter', item_type: 'RAW_MATERIAL' };
const STAGE_BASE = { breed_id: '11111111-1111-4111-8111-111111111111', stage_id: '22222222-2222-4222-8222-222222222222', calc_unit: 'DAY', period_from: 0, period_to: 10 };
const LOC_BASE = { location_name: 'Farm', location_type: 'FARM' };

describe('Item Diet No. (TDD Master Setup §2)', () => {
  it.each([CreateItemDto, UpdateItemDto])('%p rejects diet_no 15 with the workbook message', async (cls) => {
    const errors = await check(cls, { ...(cls === CreateItemDto ? ITEM_BASE : {}), diet_no: 15 });
    const e = errors.find((x) => x.property === 'diet_no');
    expect(e).toBeDefined();
    expect(Object.values(e!.constraints!)).toContain('Diet No. must be between 1 and 14.');
  });
  it.each([CreateItemDto, UpdateItemDto])('%p rejects diet_no 0 and 1.5', async (cls) => {
    for (const v of [0, 1.5]) {
      const errors = await check(cls, { ...(cls === CreateItemDto ? ITEM_BASE : {}), diet_no: v });
      expect(props(errors)).toContain('diet_no');
    }
  });
  it.each([CreateItemDto, UpdateItemDto])('%p accepts diet_no 4 and none', async (cls) => {
    const base = cls === CreateItemDto ? ITEM_BASE : {};
    expect(props(await check(cls, { ...base, diet_no: 4 }))).not.toContain('diet_no');
    expect(props(await check(cls, { ...base }))).not.toContain('diet_no');
  });
});

describe('Lifecycle feed form (TDD Master Setup row 37)', () => {
  it.each([CreateBreedLifecycleStageDto, UpdateBreedLifecycleStageDto])('%p rejects LOOSE', async (cls) => {
    const errors = await check(cls, { ...(cls === CreateBreedLifecycleStageDto ? STAGE_BASE : {}), feed_form: 'LOOSE' });
    expect(props(errors)).toContain('feed_form');
  });
  it.each([CreateBreedLifecycleStageDto, UpdateBreedLifecycleStageDto])('%p accepts BULK and BAGGED', async (cls) => {
    const base = cls === CreateBreedLifecycleStageDto ? STAGE_BASE : {};
    for (const v of ['BULK', 'BAGGED']) {
      expect(props(await check(cls, { ...base, feed_form: v }))).not.toContain('feed_form');
    }
  });
});

describe('Location no longer accepts feed-era farm logistics fields', () => {
  const REMOVED = {
    feed_refill_buffer_days: 2, feed_lead_time_days: 2, feed_bulk_multiple_kg: 3000,
    feed_bag_size_kg: 50, feed_truck_target_kg: 30000, feed_production_weekday: 0,
  };
  for (const cls of [CreateLocationDto, UpdateLocationDto]) {
    for (const [key, value] of Object.entries(REMOVED)) {
      it(`${cls.name} rejects ${key}`, async () => {
        const errors = await check(cls, { ...(cls === CreateLocationDto ? LOC_BASE : {}), [key]: value });
        expect(props(errors)).toContain(key);
      });
    }
  }
});
