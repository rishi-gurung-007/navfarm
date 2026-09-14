import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../../core/database/schema';
import { resolveJwtSecret } from '../../../../config/jwt.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly cls: ClsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(config),
    });
  }

  async validate(payload: any) {
    if (payload.type === 'refresh') {
      throw new UnauthorizedException('A refresh token cannot be used to access this resource.');
    }

    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) {
      throw new UnauthorizedException('Tenant database connection context not established.');
    }

    const [user] = await db
      .select()
      .from(schema.userMaster)
      // A soft-deleted user keeps its row; without this an access token issued
      // before the deletion stays usable until it expires.
      .where(and(eq(schema.userMaster.user_id, payload.sub), isNull(schema.userMaster.deleted_at)))
      .limit(1);

    if (!user || !user.is_active) {
      throw new UnauthorizedException('User is not authorized or active.');
    }

    return {
      userId: user.user_id,
      email: user.email,
      // Carried so screens that record "who did this" (approvals, transfers,
      // audit) can show a person's name instead of falling back to their email.
      fullName: user.full_name,
      tenantId: user.tenant_id,
      companyId: user.company_id,
      farmId: user.farm_id ?? null,
      userType: user.user_type,
    };
  }
}
