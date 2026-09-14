import { Controller, Get, Post, Patch, Delete, Body, Param, HttpStatus, UseGuards, Request, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiProperty, ApiBearerAuth } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { SignupTenantDto } from './dto/signup-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../../common/guards/system-admin.guard';

class TenantResponse {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  tenant_id: string;

  @ApiProperty({ example: 'gvf' })
  tenant_code: string;

  @ApiProperty({ example: 'Green Valley Farms' })
  tenant_name: string;

  @ApiProperty({ example: 'SME' })
  tenant_type: string;

  @ApiProperty({ example: 'PLAN_PRO' })
  plan_id: string;

  @ApiProperty({ example: '2026-06-29' })
  plan_start_date: string;

  @ApiProperty({ example: '2027-06-29' })
  plan_end_date: string;

  @ApiProperty({ example: 'billing@greenvalley.com' })
  billing_email: string;

  @ApiProperty({ example: true })
  is_active: boolean;
}

@ApiTags('Tenant')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post('signup')
  @ApiOperation({ summary: 'Register a new tenant workspace and its initial administrator' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Tenant registered successfully.', type: TenantResponse })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Tenant subdomain code already registered.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input payload.' })
  async signup(@Body() dto: SignupTenantDto) {
    return this.tenantService.signup(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({ summary: 'Platform Admin: List all registered Tenant accounts (SaaS administration)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of all tenants retrieved.', type: [TenantResponse] })
  async findAll() {
    return this.tenantService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Fetch Tenant details by UUID ID (Scoping restriction applies)' })
  @ApiParam({ name: 'id', description: 'Tenant UUID identifier' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Tenant details retrieved.', type: TenantResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Tenant not found.' })
  async findOne(@Param('id') id: string, @Request() req) {
    // tenantId on req.user comes from the user's own user_master row (JwtStrategy),
    // so a non-platform user cannot point this at someone else's tenant.
    const user = req.user;
    if (user?.userType !== 'SYSTEM_ADMIN' && (!user?.tenantId || user.tenantId !== id)) {
      throw new ForbiddenException('Access denied. You can only access details for your own tenant.');
    }
    return this.tenantService.findOne(id);
  }

  @Get('code/:code')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Fetch Tenant details by Subdomain Code (Scoping restriction applies)' })
  @ApiParam({ name: 'code', description: 'Tenant short code' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Tenant details retrieved.', type: TenantResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Tenant not found.' })
  async findByCode(@Param('code') code: string, @Request() req) {
    const user = req.user;
    if (user?.userType === 'SYSTEM_ADMIN') {
      return this.tenantService.findByCode(code);
    }
    // Unknown and foreign codes answer the same 403; a 404 for one and a 403
    // for the other let any logged-in user probe which tenant codes exist.
    const tenantDetails = await this.tenantService.findByCode(code).catch((err) => {
      if (err instanceof NotFoundException) return null;
      throw err;
    });
    if (!tenantDetails || !user?.tenantId || user.tenantId !== tenantDetails.tenant_id) {
      throw new ForbiddenException('Access denied. You can only access details for your own tenant.');
    }
    return tenantDetails;
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({ summary: 'Platform Admin: Update Tenant details or active status' })
  @ApiParam({ name: 'id', description: 'Tenant UUID identifier' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Tenant updated successfully.', type: TenantResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Tenant not found.' })
  async update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantService.update(id, dto);
  }

  @Post(':id/change-plan')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({ summary: 'Platform Admin: Upgrade or Downgrade Tenant pricing plan and adjust limits' })
  @ApiParam({ name: 'id', description: 'Tenant UUID identifier' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Tenant subscription plan changed successfully.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Tenant or plan not found.' })
  async changePlan(@Param('id') id: string, @Body() dto: ChangePlanDto) {
    return this.tenantService.changePlan(id, dto);
  }

  @Get(':id/companies')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({ summary: 'Platform Admin: Fetch all companies registered under a specific Tenant database' })
  @ApiParam({ name: 'id', description: 'Tenant UUID identifier' })
  async getTenantCompanies(@Param('id') id: string) {
    return this.tenantService.getTenantCompanies(id);
  }

  @Get(':id/users')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({ summary: 'Platform Admin: Fetch all user accounts registered under a specific Tenant database' })
  @ApiParam({ name: 'id', description: 'Tenant UUID identifier' })
  async getTenantUsers(@Param('id') id: string) {
    return this.tenantService.getTenantUsers(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiOperation({ summary: 'Platform Admin: Delete a Tenant and drop its database' })
  @ApiParam({ name: 'id', description: 'Tenant UUID identifier' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Tenant and its database deleted successfully.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Tenant not found.' })
  async remove(@Param('id') id: string) {
    return this.tenantService.remove(id);
  }
}
