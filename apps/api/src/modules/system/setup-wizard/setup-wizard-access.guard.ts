import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { isAdminUserType } from '../../../common/permissions';

/**
 * Who may use a setup-wizard route.
 *
 * - `admin`   — System, Tenant or Company Admin only.
 * - `target`  — which company the route acts on:
 *     `none`    no company (logo upload just stores a file);
 *     `company` `:companyId` param or body `company_id`, required;
 *     `profile` step 1, which updates `company_id` when given and otherwise
 *               creates a company (or claims the tenant placeholder) in
 *               body `tenant_id`.
 */
export interface WizardAccessRule {
  admin: boolean;
  target: 'none' | 'company' | 'profile';
}

export const WIZARD_ACCESS_KEY = 'setup_wizard_access';
export const WizardAccess = (rule: WizardAccessRule) => SetMetadata(WIZARD_ACCESS_KEY, rule);

export interface WizardRequester {
  userId: string;
  userType: string;
  tenantId?: string | null;
  companyId?: string | null;
}

/**
 * The access decision on its own, so it can be tested without a database.
 * `company` is the target row (null when it does not exist); `assigned` is
 * whether the requester holds an active user_company_assignments row for it.
 */
export function canAccessCompany(
  user: WizardRequester,
  companyId: string,
  company: { tenant_id: string } | null,
  assigned: boolean,
): boolean {
  if (user.userType === 'SYSTEM_ADMIN') return true;
  // Everyone else stays inside their own tenant, and cannot act on a company
  // that does not exist — step 1 would otherwise create one under that id's tenant.
  if (!company || company.tenant_id !== user.tenantId) return false;
  if (user.userType === 'TENANT_ADMIN') return true;
  return companyId === user.companyId || assigned;
}

/**
 * Step 1 without a company_id creates a company, or claims the tenant's
 * placeholder, inside body tenant_id. That is tenant administration, so a
 * Company Admin cannot do it, and a Tenant Admin only in their own tenant.
 */
export function canCreateCompany(user: WizardRequester, tenantId: unknown): boolean {
  if (user.userType === 'SYSTEM_ADMIN') return true;
  return user.userType === 'TENANT_ADMIN' && typeof tenantId === 'string' && tenantId === user.tenantId;
}

/** Guards run before the ValidationPipe, so only a plain string counts as an id. */
const idOf = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

@Injectable()
export class SetupWizardAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<WizardAccessRule>(WIZARD_ACCESS_KEY, [context.getHandler(), context.getClass()]);
    // Routes without a rule are authentication-only reference data (NOB/LOB lists).
    if (!rule) return true;

    const request = context.switchToHttp().getRequest();
    // Always the JWT-validated user, never a body field.
    const user = request.user as WizardRequester | undefined;
    if (!user) {
      throw new ForbiddenException('User session context missing.');
    }

    if (rule.admin && !isAdminUserType(user.userType)) {
      throw new ForbiddenException('Only a System, Tenant or Company Admin can change company setup.');
    }

    if (rule.target === 'none') return true;

    const companyId = idOf(request.params?.companyId) ?? idOf(request.body?.company_id);

    if (rule.target === 'profile') {
      // The service falls through to creating a company in body tenant_id
      // when company_id is unknown, so the tenant must match either way.
      if (user.userType !== 'SYSTEM_ADMIN' && request.body?.tenant_id !== user.tenantId) {
        throw new ForbiddenException('Not authorized for this tenant.');
      }
      if (!companyId) {
        if (!canCreateCompany(user, request.body?.tenant_id)) {
          throw new ForbiddenException('Only a Tenant Admin can register a new company.');
        }
        return true;
      }
    }

    if (!companyId) {
      throw new BadRequestException('company_id is required.');
    }

    if (!(await this.companyAccess(user, companyId))) {
      throw new ForbiddenException('Not authorized for this company.');
    }
    return true;
  }

  private async companyAccess(user: WizardRequester, companyId: string): Promise<boolean> {
    if (user.userType === 'SYSTEM_ADMIN') return true;

    const [company] = await this.db
      .select({ tenant_id: schema.companyMaster.tenant_id })
      .from(schema.companyMaster)
      .where(eq(schema.companyMaster.company_id, companyId))
      .limit(1);

    let assigned = false;
    if (company && user.userType !== 'TENANT_ADMIN' && companyId !== user.companyId) {
      const [assignment] = await this.db
        .select({ id: schema.userCompanyAssignments.assign_id })
        .from(schema.userCompanyAssignments)
        .where(
          and(
            eq(schema.userCompanyAssignments.user_id, user.userId),
            eq(schema.userCompanyAssignments.company_id, companyId),
            eq(schema.userCompanyAssignments.is_active, true),
          ),
        )
        .limit(1);
      assigned = !!assignment;
    }

    return canAccessCompany(user, companyId, company ?? null, assigned);
  }
}
