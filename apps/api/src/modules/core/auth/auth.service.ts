import { Injectable, UnauthorizedException, ConflictException, BadRequestException, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, isNull } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import * as masterSchema from '../../../core/database/master-schema';
import { MASTER_CONNECTION } from '../../../core/database/database.module';
import { RegisterAdminDto } from './dto/register-admin.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { ConnectionManagerService } from '../../../core/database/connection-manager.service';
import { EncryptionService } from '../../system/encryption/encryption.service';
import { UserDirectoryService } from '../../../core/database/user-directory.service';
import * as nodemailer from 'nodemailer';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

// toMysqlTimestamp writes UTC wall-clock time and the driver hands TIMESTAMP
// columns back as that same naive string. `new Date(naive)` reads it in the
// server's local zone instead — Asia/Calcutta here — which put every lock
// 5h30m in the past, so the account lockout never engaged. Read it as UTC.
const fromMysqlTimestamp = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(hasZone ? value : `${value.replace(' ', 'T')}Z`);
};

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

// One answer for an unknown address, a wrong password and a locked account, so
// the login endpoint cannot be used to learn which accounts exist. It names the
// lockout policy so a locked-out user still has a reason to wait.
const INVALID_LOGIN_MESSAGE = `Invalid email credentials. Accounts are locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_LOGINS} failed attempts.`;

// Compared against when the email matches no account, so that path spends the
// same bcrypt work as a wrong password and response time does not reveal
// whether the address is registered. Same cost factor as real password hashes.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly cls: ClsService,
    @Inject(MASTER_CONNECTION)
    private readonly masterDb: MySql2Database<typeof masterSchema>,
    private readonly auditLogService: AuditLogService,
    private readonly connectionManager: ConnectionManagerService,
    private readonly encryptionService: EncryptionService,
    private readonly userDirectory: UserDirectoryService,
  ) { }

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * register-admin has no guard because the first user of an empty tenant
   * registers without a session, so the bearer token is checked here instead.
   * It used to be read with jwtService.decode, which does not check the
   * signature: a hand-made token claiming TENANT_ADMIN could create admins.
   * A header that is present but not a valid access token is an error, never
   * "no requester".
   */
  private verifyRegisteringToken(authHeader?: string): { sub: string } | null {
    if (!authHeader) return null;

    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : '';
    let payload: any = null;
    try {
      payload = token ? this.jwtService.verify(token) : null;
    } catch {
      payload = null;
    }

    if (!payload?.sub) {
      throw new UnauthorizedException('Access denied. Invalid session token.');
    }
    if (payload.type === 'refresh') {
      throw new UnauthorizedException('A refresh token cannot be used to access this resource.');
    }
    return payload;
  }

  async registerAdmin(dto: RegisterAdminDto, authHeader?: string) {
    const tokenPayload = this.verifyRegisteringToken(authHeader);

    // The user is written into the database of the x-tenant-id workspace, and
    // "is this the tenant's first user" is counted there. A body tenant_id
    // naming a different tenant counted zero users in the wrong database and
    // took the unauthenticated first-user path.
    const contextTenantId = this.cls.get<string>('tenantId');
    if (contextTenantId && contextTenantId !== dto.tenant_id) {
      throw new BadRequestException('tenant_id does not match the active tenant workspace.');
    }

    const activeUsers = await this.db
      .select()
      .from(schema.userMaster)
      .where(eq(schema.userMaster.tenant_id, dto.tenant_id));

    // Enforce role boundary logic before anything about the target email or
    // tenant is disclosed to the caller.
    if (activeUsers.length > 0) {
      if (!tokenPayload) {
        throw new UnauthorizedException('Authentication required to register additional users.');
      }

      // The requester's type, status and tenant come from user_master, not from
      // the token's claims: a token outlives a demotion, deactivation or deletion.
      const [requestingUser] = await this.db
        .select()
        .from(schema.userMaster)
        .where(and(eq(schema.userMaster.user_id, tokenPayload.sub), isNull(schema.userMaster.deleted_at)))
        .limit(1);

      if (!requestingUser || !requestingUser.is_active) {
        throw new UnauthorizedException('User is not authorized or active.');
      }
      if (requestingUser.tenant_id !== dto.tenant_id) {
        throw new ForbiddenException('Insufficient privileges to register user accounts in this tenant.');
      }

      const requesterType = requestingUser.user_type;
      if (requesterType === 'TENANT_ADMIN') {
        if (dto.user_type !== 'COMPANY_ADMIN' && dto.user_type !== 'OPERATIONAL_ADMIN' && dto.user_type !== 'STANDARD_USER') {
          throw new BadRequestException('Tenant Administrators can register Company Admins, Operational Admins, or Standard Users.');
        }
      } else if (requesterType === 'COMPANY_ADMIN') {
        if (dto.user_type !== 'OPERATIONAL_ADMIN' && dto.user_type !== 'STANDARD_USER') {
          throw new BadRequestException('Company Administrators can register Operational Admins and Standard Operators.');
        }
      } else if (requesterType === 'OPERATIONAL_ADMIN') {
        if (dto.user_type !== 'STANDARD_USER') {
          throw new BadRequestException('Operational Administrators can only register Standard Operators.');
        }
      } else {
        throw new ForbiddenException('Insufficient privileges to register user accounts.');
      }
    } else {
      dto.user_type = 'TENANT_ADMIN';
    }

    // 1. Check if user already exists
    const existing = await this.db
      .select()
      .from(schema.userMaster)
      .where(eq(schema.userMaster.email, dto.email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`User account with email '${dto.email}' already exists.`);
    }

    // Check plan limits in masterDb
    const [tenantMeta] = await this.masterDb
      .select()
      .from(masterSchema.tenantMaster)
      .where(eq(masterSchema.tenantMaster.tenant_id, dto.tenant_id))
      .limit(1);

    if (!tenantMeta) {
      throw new NotFoundException(`Tenant with ID '${dto.tenant_id}' not found.`);
    }

    if (activeUsers.length >= tenantMeta.max_users) {
      throw new BadRequestException(
        `User registration limit reached (${tenantMeta.max_users}). Please upgrade your SaaS plan to register more users.`
      );
    }

    // Ensure placeholder company exists in tenant database to satisfy foreign keys
    const [companyPlaceholder] = await this.db
      .select()
      .from(schema.companyMaster)
      .where(eq(schema.companyMaster.company_id, dto.company_id))
      .limit(1);

    if (!companyPlaceholder && dto.company_id === '00000000-0000-0000-0000-000000000000') {
      const [lang] = await this.db.select().from(schema.languageMaster).limit(1);
      // USD by iso_code, not by row order. The currency master is an unordered
      // ISO reference list with no system default, so `limit(1)` returned INR
      // simply because it is inserted first.
      const [curr] = await this.db.select().from(schema.currencyMaster).where(eq(schema.currencyMaster.iso_code, 'USD')).limit(1);

      await this.db.insert(schema.companyMaster).values({
        company_id: '00000000-0000-0000-0000-000000000000',
        tenant_id: dto.tenant_id,
        company_code: 'PLACEHOLDER',
        company_name: 'Placeholder Company',
        company_type: 'Pvt Ltd',
        industry_type: 'Poultry Farming',
        base_currency_id: curr?.currency_id || '20000000-2000-2000-2000-200000000002',
        default_language_id: lang?.lang_id || '10000000-1000-1000-1000-100000000001',
        default_timezone_id: 'UTC',
        country_id: 'ZWE',
        onboarding_status: 'PENDING',
        is_active: true,
      });
    }

    // 2. Hash administrative password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password_hash, salt);

    const result = await this.db.transaction(async (tx) => {
      // 3. Ensure the SUPER_ADMIN role exists for this company — but only
      // bother/use it for TENANT_ADMIN and COMPANY_ADMIN accounts. Both
      // already bypass every permission check unconditionally on their
      // userType alone (see RolesGuard.canActivate and the frontend's
      // hasPermission()), so this role is pure bootstrap scaffolding for
      // them — never actually consulted. For STANDARD_USER it's the
      // opposite: RolesGuard and hasPermission() DO look up this user's
      // assigned role's permissions, so auto-granting SUPER_ADMIN
      // (module_code/resource 'ALL', every action true) here handed every
      // newly invited staff account unrestricted access to the entire
      // company from the moment they were created, until an admin
      // remembered to go assign them something narrower via Team
      // Management. A standard user should start with zero permissions,
      // not full access that quietly gets revoked later.
      //
      // The same holds for OPERATIONAL_ADMIN, which the original
      // `!== STANDARD_USER` test missed: it is not an admin user type in
      // RolesGuard, so its role IS consulted, and SUPER_ADMIN handed every
      // invited operational admin ALL/ALL. Only the two types that bypass
      // permissions get the scaffolding role; everyone else starts with none.
      const bypassesPermissions = dto.user_type === 'TENANT_ADMIN' || dto.user_type === 'COMPANY_ADMIN';
      let superAdminRole: typeof schema.roleMaster.$inferSelect | undefined;

      if (bypassesPermissions) {
        [superAdminRole] = await tx
          .select()
          .from(schema.roleMaster)
          .where(
            and(
              eq(schema.roleMaster.company_id, dto.company_id),
              eq(schema.roleMaster.role_code, 'SUPER_ADMIN')
            )
          )
          .limit(1);

        if (!superAdminRole) {
          const roleId = crypto.randomUUID();
          await tx
            .insert(schema.roleMaster)
            .values({
              role_id: roleId,
              company_id: dto.company_id,
              role_code: 'SUPER_ADMIN',
              role_name: 'Super Administrator',
              role_description: 'Full administrative control over all company scopes',
              is_system_role: true,
            });

          [superAdminRole] = await tx
            .select()
            .from(schema.roleMaster)
            .where(eq(schema.roleMaster.role_id, roleId))
            .limit(1);

          // Seed all permissions for SUPER_ADMIN
          await tx.insert(schema.rolePermissions).values({
            role_id: superAdminRole.role_id,
            module_code: 'ALL',
            resource: 'ALL',
            can_view: true,
            can_create: true,
            can_edit: true,
            can_delete: true,
            can_approve: true,
            can_export: true,
            can_print: true,
          });
        }
      }

      // 4. Create user record
      const userId = crypto.randomUUID();
      await tx
        .insert(schema.userMaster)
        .values({
          user_id: userId,
          company_id: dto.company_id,
          tenant_id: dto.tenant_id,
          full_name: dto.full_name,
          email: dto.email.toLowerCase(),
          phone: dto.phone,
          password_hash: passwordHash,
          user_type: dto.user_type || 'TENANT_ADMIN',
          timezone_pref_id: dto.timezone_pref_id as any, // casting to matching schema type
        });

      const [user] = await tx
        .select()
        .from(schema.userMaster)
        .where(eq(schema.userMaster.user_id, userId))
        .limit(1);

      // 5. Assign SUPER_ADMIN role to user (only TENANT_ADMIN and COMPANY_ADMIN — see above)
      if (superAdminRole) {
        await tx.insert(schema.userRoleAssignment).values({
          user_id: user.user_id,
          role_id: superAdminRole.role_id,
          assigned_by: user.user_id, // Self-assigned for initial admin setup
        });
      }

      return {
        user_id: user.user_id,
        email: user.email,
        full_name: user.full_name,
        user_type: user.user_type,
      };
    });

    this.userDirectory.index(result.email, result.user_id, dto.tenant_id).catch((err) =>
      console.error('Failed to update user auth index:', err),
    );

    // Send the welcome invitation email with temporary login credentials asynchronously
    const roleName = dto.user_type === 'TENANT_ADMIN' ? 'Tenant Administrator' :
                     dto.user_type === 'COMPANY_ADMIN' ? 'Company Administrator' : 'Standard Operator / User';

    this.sendInvitationEmail(
      dto.company_id,
      dto.email.toLowerCase(),
      dto.full_name,
      dto.password_hash, // Plain text temporary password
      roleName
    ).catch(err => console.error('Failed to dispatch background user invitation email:', err));

    return result;
  }

  async login(dto: LoginDto) {
    let user: any = null;
    let targetDb: any = null;
    let resolvedTenantId: string | null = null;
    let matchedTenant: any = null;
    const email = dto.email.toLowerCase();

    // Fast path: resolve the owning tenant from the central index in one
    // query instead of connecting to every tenant database.
    const indexedTenantId = await this.userDirectory.lookupTenantId(email);
    if (indexedTenantId) {
      const [indexedTenant] = await this.masterDb
        .select()
        .from(masterSchema.tenantMaster)
        .where(eq(masterSchema.tenantMaster.tenant_id, indexedTenantId))
        .limit(1);
      if (indexedTenant) {
        try {
          const tenantDbConnection = await this.connectionManager.getTenantConnection(indexedTenant);
          const [userRecord] = await tenantDbConnection
            .select()
            .from(schema.userMaster)
            .where(and(eq(schema.userMaster.email, email), isNull(schema.userMaster.deleted_at)))
            .limit(1);
          if (userRecord) {
            user = userRecord;
            targetDb = tenantDbConnection;
            resolvedTenantId = indexedTenant.tenant_id;
            matchedTenant = indexedTenant;
          }
        } catch (err) {
          console.error(`Error loading indexed tenant database ${indexedTenant.tenant_name}:`, err);
        }
      }
    }

    // Fallback: the index was empty or stale (e.g. a user created before this
    // index existed) — scan every tenant, then self-heal the index so this
    // user resolves in one query next time.
    if (!user) {
      const tenants = await this.masterDb
        .select()
        .from(masterSchema.tenantMaster);

      for (const t of tenants) {
        try {
          const tenantDbConnection = await this.connectionManager.getTenantConnection(t);
          const [userRecord] = await tenantDbConnection
            .select()
            .from(schema.userMaster)
            .where(and(eq(schema.userMaster.email, email), isNull(schema.userMaster.deleted_at)))
            .limit(1);

          if (userRecord) {
            user = userRecord;
            targetDb = tenantDbConnection;
            resolvedTenantId = t.tenant_id;
            matchedTenant = t;
            break;
          }
        } catch (err) {
          console.error(`Error searching user in tenant database ${t.tenant_name}:`, err);
        }
      }

      if (user) {
        this.userDirectory.index(email, user.user_id, resolvedTenantId!).catch((err) =>
          console.error('Failed to self-heal user auth index:', err),
        );
      }
    }

    // Fallback to active cls context DB (e.g. master/default tenant)
    if (!user) {
      try {
        const fallbackDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
        if (fallbackDb) {
          const [fallbackUser] = await fallbackDb
            .select()
            .from(schema.userMaster)
            .where(and(eq(schema.userMaster.email, email), isNull(schema.userMaster.deleted_at)))
            .limit(1);
          if (fallbackUser) {
            user = fallbackUser;
            targetDb = fallbackDb;
            resolvedTenantId = this.cls.get<string>('tenantId') || '00000000-0000-0000-0000-000000000000';
          }
        }
      } catch (err) {
        // Ignored
      }
    }

    if (!user) {
      // Spend the bcrypt work a real account would, so an unregistered address
      // cannot be told apart from a wrong password by response time.
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException(INVALID_LOGIN_MESSAGE);
    }

    // Bind dynamically resolved tenant context to current request thread execution storage
    this.cls.set('tenantId', resolvedTenantId);
    this.cls.set('tenantDb', targetDb);

    // 2. Verify password before disclosing anything about the account. The
    // suspended, inactive and locked checks used to run first, so anyone could
    // learn an address's status without knowing its password.
    const now = Date.now();
    const lockedUntil = fromMysqlTimestamp(user.locked_until);
    const isLocked = !!lockedUntil && lockedUntil.getTime() > now;
    const isPasswordValid = await bcrypt.compare(dto.password, user.password_hash);

    // 3. Lockout policy. While a lock is active every attempt gets the
    // bad-password answer, whatever was typed: replying "locked" to the right
    // password would confirm each guess and make the lockout pointless. Attempts
    // during a lock are not counted, so nobody can keep extending it.
    if (isLocked) {
      throw new UnauthorizedException(INVALID_LOGIN_MESSAGE);
    }

    if (!isPasswordValid) {
      // A lock that has run out starts a fresh count; carrying the old count
      // over re-locked the account on the first typo after it expired.
      const failedCount = (lockedUntil ? 0 : user.failed_login_count) + 1;
      const updates: any = { failed_login_count: failedCount };

      if (failedCount >= MAX_FAILED_LOGINS) {
        updates.locked_until = toMysqlTimestamp(new Date(now + LOCKOUT_MINUTES * 60 * 1000));
      } else if (lockedUntil) {
        updates.locked_until = null;
      }

      await this.db
        .update(schema.userMaster)
        .set(updates)
        .where(eq(schema.userMaster.user_id, user.user_id));

      throw new UnauthorizedException(INVALID_LOGIN_MESSAGE);
    }

    // Only a caller who has proved the password is told why the account cannot sign in.
    if (matchedTenant && !matchedTenant.is_active) {
      throw new ForbiddenException('Your tenant workspace is suspended or inactive. Please contact system support.');
    }

    if (!user.is_active) {
      throw new ForbiddenException('Your user account is inactive or disabled. Please contact your company administrator.');
    }

    // Reset failed login count on success
    await this.db
      .update(schema.userMaster)
      .set({ failed_login_count: 0, locked_until: null, last_login_at: toMysqlTimestamp() })
      .where(eq(schema.userMaster.user_id, user.user_id));

    // 4. Handle MFA requirement
    if (user.mfa_enabled) {
      return {
        mfa_required: true,
        email: user.email,
        message: 'Multi-factor authentication required. Please verify TOTP token.',
      };
    }

    // 5. Issue JWT session tokens
    try {
      await this.auditLogService.log({
        tenantId: user.tenant_id,
        companyId: user.company_id || undefined,
        userId: user.user_id,
        action: 'LOGIN',
        entityName: 'USER',
        entityId: user.user_id,
      });
    } catch (e) {
      console.error('Failed to write audit log for user login:', e);
    }

    return await this.generateTokens(user);
  }

  async verifyMfa(dto: VerifyMfaDto) {
    const [user] = await this.db
      .select()
      .from(schema.userMaster)
      .where(and(eq(schema.userMaster.email, dto.email.toLowerCase()), isNull(schema.userMaster.deleted_at)))
      .limit(1);

    // One answer for every failure. Separate replies for an unknown or disabled
    // account and for one without MFA let this public endpoint enumerate accounts.
    if (!user || !user.is_active || !user.mfa_enabled || !user.mfa_secret || !this.verifyTOTP(user.mfa_secret, dto.code)) {
      throw new UnauthorizedException('Invalid MFA token code.');
    }

    try {
      await this.auditLogService.log({
        tenantId: user.tenant_id,
        companyId: user.company_id || undefined,
        userId: user.user_id,
        action: 'LOGIN_MFA',
        entityName: 'USER',
        entityId: user.user_id,
      });
    } catch (e) {
      console.error('Failed to write audit log for MFA login:', e);
    }

    return await this.generateTokens(user);
  }

  async generateMfaQr(userId: string, email: string) {
    // Generate a random 32-char base32 key
    const secret = this.generateBase32Secret();

    // Save temporary secret (mfa_enabled remains false until verified)
    await this.db
      .update(schema.userMaster)
      .set({ mfa_secret: secret })
      .where(eq(schema.userMaster.user_id, userId));

    const otpauthUrl = `otpauth://totp/NAVFarm:${email}?secret=${secret}&issuer=NAVFarm`;
    return {
      secret,
      otpauthUrl,
    };
  }

  async getUserPermissions(userId: string) {
    try {
      return await this.db
        .select({
          moduleCode: schema.rolePermissions.module_code,
          resource: schema.rolePermissions.resource,
          canView: schema.rolePermissions.can_view,
          canCreate: schema.rolePermissions.can_create,
          canEdit: schema.rolePermissions.can_edit,
          canDelete: schema.rolePermissions.can_delete,
          canApprove: schema.rolePermissions.can_approve,
          canExport: schema.rolePermissions.can_export,
          canPrint: schema.rolePermissions.can_print,
        })
        .from(schema.userRoleAssignment)
        .innerJoin(schema.roleMaster, eq(schema.userRoleAssignment.role_id, schema.roleMaster.role_id))
        .innerJoin(schema.rolePermissions, eq(schema.roleMaster.role_id, schema.rolePermissions.role_id))
        .where(
          and(
            eq(schema.userRoleAssignment.user_id, userId),
            eq(schema.userRoleAssignment.is_active, true),
            eq(schema.roleMaster.is_active, true)
          )
        );
    } catch (e) {
      console.error('Failed to query user permissions:', e);
      return [];
    }
  }

  private async generateTokens(user: any) {
    const permissions = await this.getUserPermissions(user.user_id);
    let companies: Array<{
      company_id: string;
      company_name: string;
      is_primary: boolean;
    }> = [];

    try {
      companies = await this.db
        .select({
          company_id: schema.companyMaster.company_id,
          company_name: schema.companyMaster.company_name,
          is_primary: schema.userCompanyAssignments.is_primary,
        })
        .from(schema.userCompanyAssignments)
        .innerJoin(
          schema.companyMaster,
          eq(schema.userCompanyAssignments.company_id, schema.companyMaster.company_id),
        )
        .where(
          and(
            eq(schema.userCompanyAssignments.user_id, user.user_id),
            eq(schema.userCompanyAssignments.is_active, true),
          ),
        );
    } catch (error) {
      console.warn(
        'Could not load user company assignments. Run the tenant migrations.',
        error instanceof Error ? error.message : error,
      );
    }

    if (
      companies.length === 0 &&
      user.company_id &&
      user.company_id !== '00000000-0000-0000-0000-000000000000'
    ) {
      const [homeCompany] = await this.db
        .select({
          company_id: schema.companyMaster.company_id,
          company_name: schema.companyMaster.company_name,
        })
        .from(schema.companyMaster)
        .where(eq(schema.companyMaster.company_id, user.company_id))
        .limit(1);
      if (homeCompany) companies = [{ ...homeCompany, is_primary: true }];
    }

    let operationalAreas: any[] = [];
    try {
      operationalAreas = await this.db
        .select({
          area_id: schema.operationalAreaMaster.area_id,
          area_code: schema.operationalAreaMaster.area_code,
          area_name: schema.operationalAreaMaster.area_name,
          company_id: schema.operationalAreaMaster.company_id,
          lob_id: schema.operationalAreaMaster.lob_id,
          nob_id: schema.operationalAreaMaster.nob_id,
          is_primary: schema.userOperationalAreaAssignment.is_primary,
        })
        .from(schema.userOperationalAreaAssignment)
        .innerJoin(
          schema.operationalAreaMaster,
          eq(schema.userOperationalAreaAssignment.area_id, schema.operationalAreaMaster.area_id)
        )
        .where(eq(schema.userOperationalAreaAssignment.user_id, user.user_id));
    } catch {
      // Table will exist once migrated
    }

    const payload = {
      email: user.email,
      sub: user.user_id,
      tenantId: user.tenant_id,
      companyId: user.company_id,
      userType: user.user_type,
      companies,
      operationalAreas,
    };

    const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
    const accessToken = this.jwtService.sign({ ...payload, type: 'access' }, { expiresIn: '15m' });
    // A per-session nonce. Without it the refresh payload is identical for a
    // given user and JWT timestamps are only second-granular, so two logins
    // within the same second produced a byte-identical token, an identical
    // SHA-256, and a duplicate-key failure on user_session.uq_session_token_hash
    // — a double-clicked "Sign in", or two devices at once, returned 500.
    const refreshToken = this.jwtService.sign(
      { ...payload, type: 'refresh', jti: crypto.randomUUID() },
      { expiresIn: REFRESH_TTL_SECONDS },
    );

    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
    await this.db.insert(schema.userSession).values({
      user_id: user.user_id,
      refresh_token_hash: refreshTokenHash,
      expires_at: toMysqlTimestamp(expiresAt),
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        userId: user.user_id,
        fullName: user.full_name,
        email: user.email,
        userType: user.user_type,
        companyId: user.company_id,
        tenantId: user.tenant_id,
        uiLanguage: user.ui_language || 'en',
        companies,
        operationalAreas,
        permissions,
      },
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid or expired refresh token.');
      }
      const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
      if (!db) {
        throw new UnauthorizedException('Tenant database connection context not established.');
      }

      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const [session] = await db
        .select()
        .from(schema.userSession)
        .where(eq(schema.userSession.refresh_token_hash, tokenHash))
        .limit(1);

      const sessionExpiresAt = fromMysqlTimestamp(session?.expires_at);
      if (!session || session.revoked_at || !sessionExpiresAt || sessionExpiresAt.getTime() < Date.now()) {
        throw new UnauthorizedException('Invalid or expired refresh token.');
      }

      const [user] = await db
        .select()
        .from(schema.userMaster)
        .where(and(eq(schema.userMaster.user_id, payload.sub), isNull(schema.userMaster.deleted_at)))
        .limit(1);

      if (!user || !user.is_active) {
        throw new UnauthorizedException('User account is inactive or not found.');
      }

      // Rotate: the presented refresh token is single-use — revoke it before
      // issuing the next pair so a stolen-then-replayed token is caught.
      await db
        .update(schema.userSession)
        .set({ revoked_at: toMysqlTimestamp() })
        .where(eq(schema.userSession.session_id, session.session_id));

      return await this.generateTokens(user);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
  }

  async logout(refreshToken: string): Promise<void> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db || !refreshToken) return;
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await db
      .update(schema.userSession)
      .set({ revoked_at: toMysqlTimestamp() })
      .where(eq(schema.userSession.refresh_token_hash, tokenHash))
      .catch((err) => console.error('Failed to revoke session on logout:', err));
  }

  private generateBase32Secret(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars[crypto.randomInt(0, chars.length)];
    }
    return result;
  }

  private verifyTOTP(secret: string, code: string): boolean {
    const key = this.base32Decode(secret);
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / 30);

    for (let i = -1; i <= 1; i++) {
      const c = counter + i;
      const buffer = Buffer.alloc(8);
      buffer.writeUInt32BE(0, 0);
      buffer.writeUInt32BE(c, 4);

      const hmac = crypto.createHmac('sha1', key);
      hmac.update(buffer);
      const digest = hmac.digest();

      const offset = digest[digest.length - 1] & 0xf;
      const binary =
        ((digest[offset] & 0x7f) << 24) |
        ((digest[offset + 1] & 0xff) << 16) |
        ((digest[offset + 2] & 0xff) << 8) |
        (digest[offset + 3] & 0xff);

      const otp = binary % 1000000;
      const otpStr = otp.toString().padStart(6, '0');

      if (otpStr === code) {
        return true;
      }
    }
    return false;
  }

  private base32Decode(base32: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = base32.toUpperCase().replace(/=+$/, '');
    const length = clean.length;
    const buffer = Buffer.alloc(Math.floor((length * 5) / 8));

    let bits = 0;
    let value = 0;
    let index = 0;

    for (let i = 0; i < length; i++) {
      const val = alphabet.indexOf(clean[i]);
      if (val === -1) throw new Error('Invalid base32 character');
      value = (value << 5) | val;
      bits += 5;
      if (bits >= 8) {
        buffer[index++] = (value >>> (bits - 8)) & 0xff;
        bits -= 8;
      }
    }
    return buffer;
  }

  async listUsers(requestingUser?: any) {
    const queryBuilder = this.db
      .select({
        user_id: schema.userMaster.user_id,
        email: schema.userMaster.email,
        full_name: schema.userMaster.full_name,
        phone: schema.userMaster.phone,
        user_type: schema.userMaster.user_type,
        is_active: schema.userMaster.is_active,
        company_id: schema.userMaster.company_id,
        created_at: schema.userMaster.created_at,
        assign_id: schema.userRoleAssignment.assign_id,
        role_id: schema.roleMaster.role_id,
        role_code: schema.roleMaster.role_code,
        role_name: schema.roleMaster.role_name,
      })
      .from(schema.userMaster)
      .leftJoin(
        schema.userRoleAssignment,
        and(
          eq(schema.userMaster.user_id, schema.userRoleAssignment.user_id),
          eq(schema.userRoleAssignment.is_active, true)
        )
      )
      .leftJoin(
        schema.roleMaster,
        eq(schema.userRoleAssignment.role_id, schema.roleMaster.role_id)
      );

    let rows: any[] = [];
    if (requestingUser) {
      if (requestingUser.userType === 'TENANT_ADMIN') {
        rows = await queryBuilder.where(
          or(
            eq(schema.userMaster.user_type, 'COMPANY_ADMIN'),
            eq(schema.userMaster.user_type, 'TENANT_ADMIN')
          )
        );
      } else if (requestingUser.userType === 'COMPANY_ADMIN') {
        rows = await queryBuilder.where(
          eq(schema.userMaster.company_id, requestingUser.companyId)
        );
      } else if (requestingUser.userType === 'SYSTEM_ADMIN') {
        rows = await queryBuilder;
      } else {
        rows = await queryBuilder.where(
          eq(schema.userMaster.company_id, requestingUser.companyId)
        );
      }
    } else {
      rows = await queryBuilder;
    }

    // Deduplicate by user_id (LEFT JOIN on userRoleAssignment can produce
    // duplicate rows when a user has multiple role assignments)
    const seen = new Map<string, any>();
    for (const row of rows) {
      if (!seen.has(row.user_id)) {
        seen.set(row.user_id, row);
      }
    }
    return Array.from(seen.values());
  }

  async getProfile(userId: string) {
    const [user] = await this.db
      .select({
        userId: schema.userMaster.user_id,
        fullName: schema.userMaster.full_name,
        email: schema.userMaster.email,
        phone: schema.userMaster.phone,
        userType: schema.userMaster.user_type,
        companyId: schema.userMaster.company_id,
        tenantId: schema.userMaster.tenant_id,
        department: schema.userMaster.department,
        designation: schema.userMaster.designation,
        profilePhotoUrl: schema.userMaster.profile_photo_url,
        langPrefId: schema.userMaster.lang_pref_id,
        uiLanguage: schema.userMaster.ui_language,
        timezonePrefId: schema.userMaster.timezone_pref_id,
        mfaEnabled: schema.userMaster.mfa_enabled,
        lastLoginAt: schema.userMaster.last_login_at,
        createdAt: schema.userMaster.created_at,
      })
      .from(schema.userMaster)
      .where(eq(schema.userMaster.user_id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundException('User profile not found.');
    }

    const permissions = await this.getUserPermissions(userId);

    return {
      ...user,
      permissions,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const [existing] = await this.db.select().from(schema.userMaster).where(eq(schema.userMaster.user_id, userId)).limit(1);
    if (!existing) {
      throw new NotFoundException('User profile not found.');
    }

    await this.db
      .update(schema.userMaster)
      .set({
        full_name: dto.full_name ?? existing.full_name,
        phone: dto.phone ?? existing.phone,
        department: dto.department ?? existing.department,
        designation: dto.designation ?? existing.designation,
        profile_photo_url: dto.profile_photo_url ?? existing.profile_photo_url,
        lang_pref_id: dto.lang_pref_id ?? existing.lang_pref_id,
        ui_language: dto.ui_language ?? existing.ui_language,
        timezone_pref_id: dto.timezone_pref_id ?? existing.timezone_pref_id,
      })
      .where(eq(schema.userMaster.user_id, userId));

    return this.getProfile(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const [user] = await this.db.select().from(schema.userMaster).where(eq(schema.userMaster.user_id, userId)).limit(1);
    if (!user) {
      throw new NotFoundException('User profile not found.');
    }
    const isValid = await bcrypt.compare(dto.current_password, user.password_hash);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    const newHash = await bcrypt.hash(dto.new_password, 10);
    await this.db.update(schema.userMaster).set({ password_hash: newHash }).where(eq(schema.userMaster.user_id, userId));
    return { success: true };
  }

  async listSessions(userId: string) {
    const rows = await this.db
      .select({
        sessionId: schema.userSession.session_id,
        issuedAt: schema.userSession.issued_at,
        expiresAt: schema.userSession.expires_at,
        revokedAt: schema.userSession.revoked_at,
      })
      .from(schema.userSession)
      .where(eq(schema.userSession.user_id, userId));
    const now = new Date();
    return rows
      .filter((s) => !s.revokedAt && (fromMysqlTimestamp(s.expiresAt)?.getTime() ?? 0) > now.getTime())
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
  }

  async revokeSession(userId: string, sessionId: string) {
    const [session] = await this.db
      .select()
      .from(schema.userSession)
      .where(and(eq(schema.userSession.session_id, sessionId), eq(schema.userSession.user_id, userId)))
      .limit(1);
    if (!session) {
      throw new NotFoundException('Session not found.');
    }
    await this.db
      .update(schema.userSession)
      .set({ revoked_at: toMysqlTimestamp() })
      .where(eq(schema.userSession.session_id, sessionId));
    return { success: true };
  }

  private static readonly NOTIFICATION_CATEGORIES = [
    'APPROVALS',
    'MORTALITY_ALERTS',
    'KPI_ALERTS',
    'INVENTORY_ALERTS',
    'SYSTEM',
  ] as const;

  async getNotificationPreferences(userId: string) {
    const rows = await this.db.select().from(schema.userNotificationPref).where(eq(schema.userNotificationPref.user_id, userId));
    const byCategory = new Map(rows.map((r) => [r.category, r]));
    return AuthService.NOTIFICATION_CATEGORIES.map((category) => {
      const existing = byCategory.get(category);
      return {
        category,
        emailEnabled: existing?.email_enabled ?? true,
        inAppEnabled: existing?.in_app_enabled ?? true,
      };
    });
  }

  async updateNotificationPreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    for (const pref of dto.preferences) {
      await this.db
        .insert(schema.userNotificationPref)
        .values({
          user_id: userId,
          category: pref.category,
          email_enabled: pref.email_enabled,
          in_app_enabled: pref.in_app_enabled,
        })
        .onDuplicateKeyUpdate({
          set: { email_enabled: pref.email_enabled, in_app_enabled: pref.in_app_enabled, updated_at: toMysqlTimestamp() },
        });
    }
    return this.getNotificationPreferences(userId);
  }

  private async sendInvitationEmail(
    companyId: string,
    recipientEmail: string,
    recipientName: string,
    temporaryPassword: string,
    roleName: string,
  ) {
    // 1. Attempt to resolve active company-level SMTP settings from tenantDb
    let smtpConfig: any = null;
    try {
      const [config] = await this.db
        .select()
        .from(schema.notificationConfig)
        .where(
          and(
            eq(schema.notificationConfig.company_id, companyId),
            eq(schema.notificationConfig.channel, 'EMAIL'),
            eq(schema.notificationConfig.is_enabled, true)
          )
        )
        .limit(1);
      
      if (config && config.smtp_host) {
        smtpConfig = config;
      }
    } catch (e) {
      console.warn('Could not query company notification settings for invitation email:', e);
    }

    // 2. Fallback to system / environment SMTP variables
    const host = smtpConfig?.smtp_host || process.env.SMTP_HOST || 'smtp.mailtrap.io';
    const port = Number(smtpConfig?.smtp_port || process.env.SMTP_PORT || 2525);
    const user = smtpConfig?.smtp_user || process.env.SMTP_USER || '';
    const password = smtpConfig?.smtp_password_enc
      ? this.encryptionService.decrypt(smtpConfig.smtp_password_enc)
      : process.env.SMTP_PASSWORD || '';
    const fromEmail = smtpConfig?.from_email || process.env.SMTP_FROM_EMAIL || 'no-reply@navfarm.com';
    const fromName = smtpConfig?.from_name || process.env.SMTP_FROM_NAME || 'NAVFarm Support';

    // 3. Resolve frontend URL (fallback to localhost:3000)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // 4. Create mail transport
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && password ? { user, pass: password } : undefined,
    });

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: recipientEmail,
      subject: 'Welcome to NAVFarm — Access Details and Credentials',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e1e8ed; border-radius: 12px;">
          <h2 style="color: #1F4E79; margin-top: 0;">Welcome to NAVFarm!</h2>
          <p>Hello <strong>${recipientName}</strong>,</p>
          <p>You have been registered and invited as a <strong>${roleName}</strong> on the NAVFarm platform.</p>
          
          <div style="background-color: #f5f8fa; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #e1e8ed;">
            <p style="margin: 0 0 10px 0; color: #1F4E79;"><strong>Your Login Credentials:</strong></p>
            <p style="margin: 5px 0;"><strong>Email Address:</strong> ${recipientEmail}</p>
            <p style="margin: 5px 0;"><strong>Temporary Password:</strong> <code style="background: #e1e8ed; padding: 2px 6px; border-radius: 4px; font-family: monospace;">${temporaryPassword}</code></p>
          </div>
          
          <div style="text-align: center; margin: 25px 0;">
            <a href="${frontendUrl}" style="background-color: #1F4E79; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              Login to NAVFarm Workspace
            </a>
            <p style="font-size: 11px; color: #888; margin-top: 8px; margin-bottom: 0;">
              Or navigate directly to: <a href="${frontendUrl}" style="color: #1F4E79;">${frontendUrl}</a>
            </p>
          </div>
          
          <p>Please log in and update your password immediately upon accessing the workspace portal.</p>
          <p style="margin-top: 30px; border-top: 1px solid #e1e8ed; padding-top: 15px; font-size: 12px; color: #5f7d95;">
            Best regards,<br>
            <strong>The NAVFarm Platform Team</strong>
          </p>
        </div>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`[SMTP] Invitation email successfully dispatched to ${recipientEmail} via host ${host}:${port}`);
    } catch (err) {
      console.error(`[SMTP Error] Failed to deliver invitation email to ${recipientEmail}:`, err);
    }
  }
}
