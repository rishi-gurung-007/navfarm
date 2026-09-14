import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, sql } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateUserDto, UpdateUserDto, QueryUserDto } from './dto/user.dto';
import { UserDirectoryService } from '../../../core/database/user-directory.service';
import { canAssignUserType, outranks } from '../../../common/user-type-hierarchy';

/**
 * The validated JWT user (JwtStrategy re-reads user_master on every request),
 * so userType is the database value, never anything from the request body.
 */
export interface RequestingUser {
  userId: string;
  tenantId: string;
  userType: string;
}

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class UserService {
  constructor(
    private readonly cls: ClsService,
    private readonly userDirectory: UserDirectoryService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async create(dto: CreateUserDto, requester: RequestingUser) {
    // Checked before anything touches the database: user_type decides whether
    // RolesGuard consults role_permissions at all, so an unchecked value let a
    // company admin mint tenant or system admins.
    const userType = dto.user_type ?? 'STANDARD_USER';
    this.assertCanAssign(requester, userType);
    // The auth directory maps the email to this tenant id for login routing;
    // only a platform admin may name a tenant other than their own.
    if (requester.userType !== 'SYSTEM_ADMIN' && dto.tenant_id !== requester.tenantId) {
      throw new ForbiddenException('You can only create users in your own tenant.');
    }

    const existing = await this.db
      .select()
      .from(schema.userMaster)
      .where(eq(schema.userMaster.email, dto.email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`User with email '${dto.email}' already exists.`);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);

    const userId = randomUUID();
    await this.db.transaction(async (tx) => {
      await tx.insert(schema.userMaster).values({
        user_id: userId,
        company_id: dto.company_id,
        tenant_id: dto.tenant_id,
        full_name: dto.full_name,
        email: dto.email.toLowerCase(),
        phone: dto.phone || null,
        password_hash: passwordHash,
        user_type: userType,
        employee_id: dto.employee_id || null,
        department: dto.department || null,
        designation: dto.designation || null,
        timezone_pref_id: dto.timezone_pref_id || null,
      });
      await tx.insert(schema.userCompanyAssignments).values({
        user_id: userId,
        company_id: dto.company_id,
        is_primary: true,
        assigned_by: userId,
      });
    });

    this.userDirectory.index(dto.email, userId, dto.tenant_id).catch((err) =>
      console.error('Failed to update user auth index:', err),
    );

    return this.findById(userId);
  }

  async findById(id: string) {
    const [user] = await this.db
      .select()
      .from(schema.userMaster)
      .where(eq(schema.userMaster.user_id, id))
      .limit(1);

    if (!user) {
      throw new NotFoundException(`User with ID '${id}' not found.`);
    }

    const roles = await this.db
      .select({
        role_id: schema.roleMaster.role_id,
        role_code: schema.roleMaster.role_code,
        role_name: schema.roleMaster.role_name,
      })
      .from(schema.userRoleAssignment)
      .innerJoin(
        schema.roleMaster,
        eq(schema.userRoleAssignment.role_id, schema.roleMaster.role_id),
      )
      .where(
        and(
          eq(schema.userRoleAssignment.user_id, id),
          eq(schema.userRoleAssignment.is_active, true),
        ),
      );

    return { ...user, roles };
  }

  async findByEmail(email: string) {
    const [user] = await this.db
      .select()
      .from(schema.userMaster)
      .where(eq(schema.userMaster.email, email.toLowerCase()))
      .limit(1);

    return user || null;
  }

  async findAll(query: QueryUserDto) {
    const conditions: any[] = [];

    if (query.companyId) {
      conditions.push(eq(schema.userMaster.company_id, query.companyId));
    }
    if (query.userType) {
      conditions.push(eq(schema.userMaster.user_type, query.userType));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.userMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.userMaster.full_name, `%${query.search}%`),
          like(schema.userMaster.email, `%${query.search}%`),
        ),
      );
    }

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const users = await this.db
      .select({
        user_id: schema.userMaster.user_id,
        company_id: schema.userMaster.company_id,
        tenant_id: schema.userMaster.tenant_id,
        full_name: schema.userMaster.full_name,
        email: schema.userMaster.email,
        phone: schema.userMaster.phone,
        user_type: schema.userMaster.user_type,
        employee_id: schema.userMaster.employee_id,
        department: schema.userMaster.department,
        designation: schema.userMaster.designation,
        is_active: schema.userMaster.is_active,
        last_login_at: schema.userMaster.last_login_at,
        created_at: schema.userMaster.created_at,
      })
      .from(schema.userMaster)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .limit(limit)
      .offset(offset);

    // Enrich each user with their role assignments
    const enriched = await Promise.all(
      users.map(async (user) => {
        const roles = await this.db
          .select({
            role_id: schema.roleMaster.role_id,
            role_code: schema.roleMaster.role_code,
            role_name: schema.roleMaster.role_name,
          })
          .from(schema.userRoleAssignment)
          .innerJoin(
            schema.roleMaster,
            eq(schema.userRoleAssignment.role_id, schema.roleMaster.role_id),
          )
          .where(
            and(
              eq(schema.userRoleAssignment.user_id, user.user_id),
              eq(schema.userRoleAssignment.is_active, true),
            ),
          );
        return { ...user, roles };
      }),
    );

    return enriched;
  }

  async findByCompany(companyId: string) {
    return this.findAll({ companyId });
  }

  async update(id: string, dto: UpdateUserDto, requester: RequestingUser) {
    const user = await this.findById(id);
    const actingUserId = requester.userId;
    const isSelf = id === actingUserId;

    // Peers and superiors are out of reach; your own profile is not.
    if (!isSelf) this.assertOutranks(requester, user.user_type);

    // The console's edit form always echoes the current type back, so only a
    // real change is treated as an assignment.
    const typeChanged = dto.user_type !== undefined && dto.user_type !== user.user_type;
    if (typeChanged) {
      if (isSelf) {
        throw new ForbiddenException('You cannot change your own user type.');
      }
      this.assertCanAssign(requester, dto.user_type as string);
    }

    // A user can edit their own profile fields, but never flip their own
    // account inactive — that's an easy way to accidentally lock yourself
    // out with no one else able to log in and reverse it (especially for a
    // tenant's only admin). Deactivating someone always has to come from a
    // different, still-active account.
    if (isSelf && dto.is_active === false) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    const updates: any = {};
    if (dto.full_name !== undefined) updates.full_name = dto.full_name;
    if (dto.phone !== undefined) updates.phone = dto.phone;
    if (typeChanged) updates.user_type = dto.user_type;
    if (dto.employee_id !== undefined) updates.employee_id = dto.employee_id;
    if (dto.department !== undefined) updates.department = dto.department;
    if (dto.designation !== undefined) updates.designation = dto.designation;
    if (dto.timezone_pref_id !== undefined) updates.timezone_pref_id = dto.timezone_pref_id;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    if (Object.keys(updates).length > 0) {
      await this.db
        .update(schema.userMaster)
        .set(updates)
        .where(eq(schema.userMaster.user_id, id));
    }

    return this.findById(id);
  }

  async deactivate(id: string, requester: RequestingUser) {
    if (id === requester.userId) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }
    const user = await this.findById(id);
    this.assertOutranks(requester, user.user_type);

    await this.db
      .update(schema.userMaster)
      .set({
        is_active: false,
      })
      .where(eq(schema.userMaster.user_id, id));

    return this.findById(id);
  }

  async remove(id: string, requester: RequestingUser) {
    if (id === requester.userId) {
      throw new BadRequestException('You cannot deactivate your own account.');
    }

    const user = await this.findById(id);
    this.assertOutranks(requester, user.user_type);

    await this.db
      .update(schema.userMaster)
      .set({
        is_active: false,
        deleted_at: toMysqlTimestamp() as any,
      })
      .where(eq(schema.userMaster.user_id, id));

    return { deleted: true, user_id: id };
  }

  private assertCanAssign(requester: RequestingUser, targetType: string) {
    if (!canAssignUserType(requester?.userType, targetType)) {
      throw new ForbiddenException(`You are not allowed to assign the user type '${targetType}'.`);
    }
  }

  private assertOutranks(requester: RequestingUser, targetType: string) {
    if (!outranks(requester?.userType, targetType)) {
      throw new ForbiddenException('You cannot modify a user at or above your own access level.');
    }
  }
}
