import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateUserDto, UpdateUserDto, QueryUserDto } from './dto/user.dto';

/** RolesGuard has validated this header against the user's assignments before any handler runs. */
const activeCompany = (req: any): string | undefined => {
  const value = req?.headers?.['x-active-company-id'];
  return typeof value === 'string' && value ? value : undefined;
};

@ApiTags('User Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @RequirePermission('RBAC', 'USER', 'create')
  @ApiOperation({ summary: 'Create a new user account under a company' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'User account created.' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Email already exists.' })
  async create(@Body() body: CreateUserDto, @Request() req: any) {
    return this.userService.create(body, req.user);
  }

  @Get()
  @RequirePermission('RBAC', 'USER', 'view')
  @ApiOperation({ summary: 'List users with company, farm, operational areas and roles' })
  async findAll(@Query() query: QueryUserDto, @Request() req: any) {
    return this.userService.findAll(query, req.user, activeCompany(req));
  }

  // Declared before ':id' so the literal segments are not read as a user id.
  @Get('assignable-farms')
  @RequirePermission('RBAC', 'USER', 'view')
  @ApiOperation({ summary: 'Top-level farms a standard user of this company may be assigned to' })
  @ApiQuery({ name: 'companyId', required: true })
  async assignableFarms(@Query('companyId') companyId: string, @Request() req: any) {
    return this.userService.assignableFarms(companyId, req.user, activeCompany(req));
  }

  @Get('assignable-areas')
  @RequirePermission('RBAC', 'USER', 'view')
  @ApiOperation({ summary: 'Operational areas the requester may assign in this company' })
  @ApiQuery({ name: 'companyId', required: true })
  async assignableAreas(@Query('companyId') companyId: string, @Request() req: any) {
    return this.userService.assignableAreas(companyId, req.user, activeCompany(req));
  }

  @Get('company/:companyId')
  @RequirePermission('RBAC', 'USER', 'view')
  @ApiOperation({ summary: 'List all users belonging to a specific company' })
  @ApiParam({ name: 'companyId', description: 'Company UUID' })
  async findByCompany(@Param('companyId') companyId: string, @Request() req: any) {
    return this.userService.findByCompany(companyId, req.user, activeCompany(req));
  }

  @Get(':id')
  @RequirePermission('RBAC', 'USER', 'view')
  @ApiOperation({ summary: 'Fetch user details with assigned roles' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  async findOne(@Param('id') id: string) {
    return this.userService.findById(id);
  }

  @Put(':id')
  @RequirePermission('RBAC', 'USER', 'edit')
  @ApiOperation({ summary: 'Update user profile, type, farm and operational areas' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  async update(@Param('id') id: string, @Body() body: UpdateUserDto, @Request() req: any) {
    return this.userService.update(id, body, req.user);
  }

  @Put(':id/deactivate')
  @RequirePermission('RBAC', 'USER', 'edit')
  @ApiOperation({ summary: 'Deactivate a user account without deleting it' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  async deactivate(@Param('id') id: string, @Request() req: any) {
    return this.userService.deactivate(id, req.user);
  }

  @Delete(':id')
  @RequirePermission('RBAC', 'USER', 'delete')
  @ApiOperation({ summary: 'Soft-delete / deactivate a user account' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.userService.remove(id, req.user);
  }
}
