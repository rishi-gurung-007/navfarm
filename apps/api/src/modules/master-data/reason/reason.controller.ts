import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateReasonDto, QueryReasonDto, UpdateReasonDto } from './reason.dto';
import { ReasonService } from './reason.service';

/** User-confirmed mapping of BBP business administration to NAVFarm roles. */
@Injectable()
export class ReasonAdministrationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !['TENANT_ADMIN', 'COMPANY_ADMIN'].includes(request.user?.userType)) {
      throw new ForbiddenException('Only a Tenant Admin or Company Admin can change Reason Master.');
    }
    return true;
  }
}

@ApiTags('Reason Master') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ReasonAdministrationGuard)
@Controller('reason')
export class ReasonController {
  constructor(private readonly reasons: ReasonService) {}
  @Get() @RequirePermission('MASTER_DATA', 'REASON', 'view')
  async list(@Query() query: QueryReasonDto, @Req() req: any) { const page = await this.reasons.findAll(query, req.user.tenantId);
    // total/limit/offset are what the list screen pages on; data stays an array.
    return { data: page.data, total: page.total, limit: page.limit, offset: page.offset }; }
  @Get(':id') @RequirePermission('MASTER_DATA', 'REASON', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.reasons.findOne(id, req.user.tenantId) }; }
  @Post() @RequirePermission('MASTER_DATA', 'REASON', 'create')
  async create(@Body() dto: CreateReasonDto, @Req() req: any) { return { data: await this.reasons.create(dto, req.user.tenantId, req.user) }; }
  @Put(':id') @RequirePermission('MASTER_DATA', 'REASON', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateReasonDto, @Req() req: any) { return { data: await this.reasons.update(id, dto, req.user.tenantId, req.user) }; }
  @Delete(':id') @RequirePermission('MASTER_DATA', 'REASON', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.reasons.setActive(id, false, req.user.tenantId, req.user) }; }
  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'REASON', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.reasons.setActive(id, true, req.user.tenantId, req.user) }; }
}
