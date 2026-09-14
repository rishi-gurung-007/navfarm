import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateUserDto, UpdateUserDto, QueryUserDto } from './dto/user.dto';

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
  @ApiOperation({ summary: 'List all users with optional filters' })
  async findAll(@Query() query: QueryUserDto) {
    return this.userService.findAll(query);
  }

  @Get('company/:companyId')
  @RequirePermission('RBAC', 'USER', 'view')
  @ApiOperation({ summary: 'List all users belonging to a specific company' })
  @ApiParam({ name: 'companyId', description: 'Company UUID' })
  async findByCompany(@Param('companyId') companyId: string) {
    return this.userService.findByCompany(companyId);
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
  @ApiOperation({ summary: 'Update user profile details' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  async update(@Param('id') id: string, @Body() body: UpdateUserDto, @Request() req: any) {
    return this.userService.update(id, body, req.user);
  }

  @Delete(':id')
  @RequirePermission('RBAC', 'USER', 'delete')
  @ApiOperation({ summary: 'Soft-delete / deactivate a user account' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.userService.remove(id, req.user);
  }
}
