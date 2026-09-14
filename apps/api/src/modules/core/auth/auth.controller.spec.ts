import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';

describe('AuthController authorization', () => {
  it('guards GET /auth/users exactly like GET /user', () => {
    const handler = AuthController.prototype.listUsers;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler)).toEqual({ moduleCode: 'RBAC', resource: 'USER', action: 'view' });
  });

  it('leaves register-admin unguarded so an empty tenant can bootstrap its first user', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.registerAdmin)).toBeUndefined();
  });
});
