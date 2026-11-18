import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Type, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MasterListQueryDto } from '../../common/master-list-query';
import { LogisticsMasterService } from './logistics-master.service';
import { LOGISTICS_MASTERS, type LogisticsMaster } from './logistics-masters';

export class LogisticsListQueryDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsString() isActive?: string;
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsUUID() routeId?: string;
  @IsOptional() @IsString() search?: string;
}

/**
 * One controller per Logistics master, all from the same shape: list, read, create, edit, deactivate, restore under
 * /logistics/<path>, each guarded by module LOGISTICS and the master's own resource. Company masters, not a farm's.
 * Request bodies are checked by the master's own rules (logistics.rules.ts), which name every problem in plain words.
 */
function logisticsController(m: LogisticsMaster): Type<unknown> {
  @ApiTags('Logistics') @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Controller(`logistics/${m.path}`)
  class LogisticsMasterController {
    constructor(readonly masters: LogisticsMasterService) {}
    @Get() @RequirePermission(m.permission.moduleCode, m.permission.resource, 'view')
    async list(@Query() query: LogisticsListQueryDto, @Req() req: any) {
      const page = await this.masters.findAll(m, query as never, req.user.tenantId);
      return { data: page.data, total: page.total, limit: page.limit, offset: page.offset };
    }
    @Get(':id') @RequirePermission(m.permission.moduleCode, m.permission.resource, 'view')
    async get(@Param('id') id: string, @Req() req: any) { return { data: await this.masters.findOne(m, id, req.user.tenantId) }; }
    @Post() @RequirePermission(m.permission.moduleCode, m.permission.resource, 'create')
    async create(@Body() body: Record<string, unknown>, @Req() req: any) { return { data: await this.masters.create(m, body, req.user.tenantId, req.user) }; }
    @Put(':id') @RequirePermission(m.permission.moduleCode, m.permission.resource, 'edit')
    async update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: any) { return { data: await this.masters.update(m, id, body, req.user.tenantId, req.user) }; }
    @Delete(':id') @RequirePermission(m.permission.moduleCode, m.permission.resource, 'delete')
    async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.masters.setActive(m, id, false, req.user.tenantId, req.user) }; }
    @Patch(':id/restore') @RequirePermission(m.permission.moduleCode, m.permission.resource, 'edit')
    async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.masters.setActive(m, id, true, req.user.tenantId, req.user) }; }
  }
  Object.defineProperty(LogisticsMasterController, 'name', { value: `Logistics${m.permission.resource}${m.path.replace(/(^|-)(\w)/g, (_s, _d, c: string) => c.toUpperCase())}Controller` });
  return LogisticsMasterController;
}

export const LOGISTICS_CONTROLLERS = LOGISTICS_MASTERS.map(logisticsController);
