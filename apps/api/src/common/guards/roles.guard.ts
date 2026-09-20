import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { enforceMasterRequest } from '../master-data-scope';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../core/database/schema';
import { REQUIRE_PERMISSION_KEY, RequiredPermission } from '../decorators/require-permission.decorator';
import { grantsAny, isAdminUserType, loadUserPermissions } from '../permissions';
import { CODE_PREVIEW_PERMISSION_KEY, codePreviewPermissions } from '../decorators/require-code-preview-permission.decorator';
import { FARM_SCOPED_KEY, FARM_SCOPE_KEY, resolveFarmScope } from '../farm-scope';

@Injectable()
export class RolesGuard implements CanActivate {
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
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User session context missing.');
    }

    // Scope enforcement runs for every request this guard sees, independent of
    // @RequirePermission — the client-supplied active-company/area headers are
    // otherwise never validated against what the user is actually assigned to.
    await this.enforceScope(request, user);
    const controller = context.getClass();
    const controllerPath = controller ? Reflect.getMetadata(PATH_METADATA, controller) as string | undefined : undefined;
    if (typeof controllerPath === 'string') await enforceMasterRequest(this.cls, request, controllerPath);

    // Farm scope depends on the operational area validated by enforceScope
    // above, so it must resolve after that call, never before it.
    const farmScoped = this.reflector.getAllAndOverride<boolean>(FARM_SCOPED_KEY, [context.getHandler(), context.getClass()]);
    if (farmScoped) {
      const scope = await resolveFarmScope(this.db, {
        user,
        headers: request.headers,
        activeArea: this.cls.get('activeOperationalArea'),
        activeCompanyId: request.headers['x-active-company-id'] as string | undefined,
        tenantId: request.tenantId || user.tenantId,
      });
      this.cls.set(FARM_SCOPE_KEY, scope);
    }

    const requiredPermission = this.reflector.getAllAndOverride<RequiredPermission>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isAdminUserType(user.userType)) {
      return true;
    }

    const previewPermission = this.reflector.getAllAndOverride<boolean>(CODE_PREVIEW_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    const masterParam = request.query?.master || request.query?.masterType;
    const requiredPermissions = previewPermission ? codePreviewPermissions(masterParam) : requiredPermission ? [requiredPermission] : [];

    if (!requiredPermissions.length) {
      return true;
    }

    const userPermissions = await loadUserPermissions(this.db, user.userId);
    const hasMatch = grantsAny(userPermissions, requiredPermissions);

    if (!hasMatch) {
      throw new ForbiddenException('Insufficient permissions to execute this request.');
    }

    return true;
  }

  /**
   * Validates the x-active-company-id / x-active-operational-area-id headers
   * against what the user is actually assigned to. Client-supplied headers
   * are otherwise trusted at face value by every downstream handler.
   */
  private async enforceScope(request: any, user: any): Promise<void> {
    const activeCompanyId = request.headers['x-active-company-id'] as string | undefined;
    if (activeCompanyId && user.userType !== 'SYSTEM_ADMIN') {
      if (user.userType === 'TENANT_ADMIN') {
        const [company] = await this.db
          .select({ tenant_id: schema.companyMaster.tenant_id })
          .from(schema.companyMaster)
          .where(eq(schema.companyMaster.company_id, activeCompanyId))
          .limit(1);
        if (!company || company.tenant_id !== user.tenantId) {
          throw new ForbiddenException('Not authorized for this company.');
        }
      } else if (activeCompanyId !== user.companyId) {
        const [assignment] = await this.db
          .select({ id: schema.userCompanyAssignments.assign_id })
          .from(schema.userCompanyAssignments)
          .where(
            and(
              eq(schema.userCompanyAssignments.user_id, user.userId),
              eq(schema.userCompanyAssignments.company_id, activeCompanyId),
              eq(schema.userCompanyAssignments.is_active, true),
            ),
          )
          .limit(1);
        if (!assignment) {
          throw new ForbiddenException('Not authorized for this company.');
        }
      }
    }

    const activeAreaId = request.headers['x-active-operational-area-id'] as string | undefined;
    if (activeAreaId && !['SYSTEM_ADMIN', 'TENANT_ADMIN', 'COMPANY_ADMIN'].includes(user.userType)) {
      const [assignment] = await this.db
        .select({ id: schema.userOperationalAreaAssignment.assignment_id })
        .from(schema.userOperationalAreaAssignment)
        .where(
          and(
            eq(schema.userOperationalAreaAssignment.user_id, user.userId),
            eq(schema.userOperationalAreaAssignment.area_id, activeAreaId),
          ),
        )
        .limit(1);
      if (!assignment) {
        throw new ForbiddenException('Not authorized for this operational area.');
      }
    }

    if (activeAreaId) {
      // An assignment alone does not prove that an area belongs to the active
      // company. Resolve and validate it before exposing context to services.
      const [area] = await this.db.select({
        area_id: schema.operationalAreaMaster.area_id,
        company_id: schema.operationalAreaMaster.company_id,
        nob_id: schema.operationalAreaMaster.nob_id,
        lob_id: schema.operationalAreaMaster.lob_id,
      }).from(schema.operationalAreaMaster).where(and(
        eq(schema.operationalAreaMaster.area_id, activeAreaId),
        eq(schema.operationalAreaMaster.tenant_id, request.tenantId || user.tenantId),
        eq(schema.operationalAreaMaster.is_active, true),
        isNull(schema.operationalAreaMaster.deleted_at),
      )).limit(1);
      if (!area || !activeCompanyId || area.company_id !== activeCompanyId) {
        throw new ForbiddenException('Operational area does not belong to the active company.');
      }
      this.cls.set('activeOperationalArea', area);
    }
  }
}
