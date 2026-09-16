import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, HttpStatus, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { RoleService } from './role.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateRoleDto, AssignRoleDto, UpdatePermissionsDto, UpdateRoleDto } from './dto/role.dto';

@ApiTags('RBAC Roles & Permissions')
@Controller('role')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post('create')
  @RequirePermission('RBAC', 'ROLE', 'create')
  @ApiOperation({ summary: 'Create a custom RBAC Role for a company' })
  async createRole(@Body() body: CreateRoleDto) {
    return this.roleService.createRole(body.companyId, body.roleCode, body.roleName, body.description);
  }

  @Post('assign')
  @RequirePermission('RBAC', 'ROLE', 'edit')
  @ApiOperation({ summary: 'Assign an RBAC Role to a User' })
  async assignRole(@Body() body: AssignRoleDto, @Request() req) {
    return this.roleService.assignRoleToUser(body.userId, body.roleId, req.user);
  }

  @Post('permissions/:roleId')
  @RequirePermission('RBAC', 'ROLE', 'edit')
  @ApiOperation({ summary: 'Update granular module access matrix rules for a Role' })
  @ApiParam({ name: 'roleId', description: 'Role UUID' })
  async updatePermissions(
    @Param('roleId') roleId: string,
    @Body() body: UpdatePermissionsDto,
    @Request() req,
  ) {
    return this.roleService.updateRolePermissions(roleId, req.user, body.permissions);
  }

  @Get('permissions/:roleId')
  @RequirePermission('RBAC', 'ROLE', 'view')
  @ApiOperation({ summary: 'Fetch active permission rules for a Role' })
  @ApiParam({ name: 'roleId', description: 'Role UUID' })
  async getPermissions(@Param('roleId') roleId: string) {
    return this.roleService.getRolePermissions(roleId);
  }

  // The Roles screen needs the holders of a role to say who a permission
  // change affects and to revoke one of them. RoleService already read them
  // for its own use; nothing exposed them.
  @Get('members/:roleId')
  @RequirePermission('RBAC', 'ROLE', 'view')
  @ApiOperation({ summary: 'List the users who currently hold a role' })
  @ApiParam({ name: 'roleId', description: 'Role UUID' })
  async getRoleMembers(@Param('roleId') roleId: string) {
    return this.roleService.getRoleMembers(roleId);
  }

  @Get('company/:companyId')
  @RequirePermission('RBAC', 'ROLE', 'view')
  @ApiOperation({ summary: 'List all custom and system roles of a company' })
  @ApiParam({ name: 'companyId', description: 'Company UUID' })
  async getCompanyRoles(@Param('companyId') companyId: string) {
    return this.roleService.getCompanyRoles(companyId);
  }

  @Put(':roleId')
  @RequirePermission('RBAC', 'ROLE', 'edit')
  @ApiOperation({ summary: 'Update role name, description, or active status' })
  @ApiParam({ name: 'roleId', description: 'Role UUID' })
  async updateRole(@Param('roleId') roleId: string, @Body() body: UpdateRoleDto) {
    return this.roleService.updateRole(roleId, body);
  }

  @Delete(':roleId')
  @RequirePermission('RBAC', 'ROLE', 'delete')
  @ApiOperation({ summary: 'Delete a custom role (system roles protected)' })
  @ApiParam({ name: 'roleId', description: 'Role UUID' })
  async deleteRole(@Param('roleId') roleId: string) {
    return this.roleService.deleteRole(roleId);
  }

  @Delete('assign/:assignId')
  @RequirePermission('RBAC', 'ROLE', 'edit')
  @ApiOperation({ summary: 'Revoke/unassign a role from a user' })
  @ApiParam({ name: 'assignId', description: 'Assignment UUID' })
  async unassignRole(@Param('assignId') assignId: string, @Request() req) {
    return this.roleService.unassignRole(assignId, req.user);
  }

  @Get('assignments/:userId')
  @RequirePermission('RBAC', 'ROLE', 'view')
  @ApiOperation({ summary: 'List all role assignments for a user' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  async getUserAssignments(@Param('userId') userId: string) {
    return this.roleService.getUserAssignments(userId);
  }
}
