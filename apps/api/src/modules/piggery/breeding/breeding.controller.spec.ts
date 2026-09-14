import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { BreedingController } from './breeding.controller';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';

// The controller once carried only JwtAuthGuard, so any signed-in user of any
// role read and wrote breeding records and the scope headers were never checked.
describe('BreedingController authorization metadata', () => {
  const handlers = Object.getOwnPropertyNames(BreedingController.prototype).filter((name) => name !== 'constructor');
  const handler = (name: string) => (BreedingController.prototype as any)[name];

  it('mounts JwtAuthGuard and RolesGuard on the whole controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, BreedingController)).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it.each([
    ['recordMating', RequestMethod.POST, 'mating', 'create'],
    ['recordPregnancyCheck', RequestMethod.PATCH, 'mating/:id/preg-check', 'edit'],
    ['getMatingRecords', RequestMethod.GET, 'mating', 'view'],
    ['recordFarrowing', RequestMethod.POST, 'farrowing', 'create'],
    ['recordWeaning', RequestMethod.PATCH, 'farrowing/:id/weaning', 'edit'],
    ['getFarrowingRecords', RequestMethod.GET, 'farrowing', 'view'],
    ['recordSemenCollection', RequestMethod.POST, 'semen-collection', 'create'],
    ['getSemenBatches', RequestMethod.GET, 'semen-collection', 'view'],
  ])('%s requires PIGGERY/ANIMAL %s', (name, method, path, action) => {
    expect(Reflect.getMetadata(METHOD_METADATA, handler(name))).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler(name))).toBe(path);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler(name))).toEqual({ moduleCode: 'PIGGERY', resource: 'ANIMAL', action });
  });

  it('leaves no route without a permission, so a new route cannot slip in open', () => {
    const routes = handlers.filter((name) => Reflect.getMetadata(PATH_METADATA, handler(name)) !== undefined);
    expect(routes).toHaveLength(8);
    for (const name of routes) {
      expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler(name))).toMatchObject({ moduleCode: 'PIGGERY', resource: 'ANIMAL' });
    }
  });
});
