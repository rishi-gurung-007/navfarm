import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateGiltClassRuleDto, QueryGiltClassRuleDto, UpdateGiltClassRuleDto } from './gilt-class-rule.dto';
import { GiltClassRuleService } from './gilt-class-rule.service';

// A company master: the class a gilt takes from her parentage is not a farm's record.
@ApiTags('Gilt Class Rule') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('gilt-class-rule')
export class GiltClassRuleController {
  constructor(private readonly rules: GiltClassRuleService) {}

  @Get() @RequirePermission('MASTER_DATA', 'GILT_CLASS_RULE', 'view')
  async list(@Query() query: QueryGiltClassRuleDto, @Req() req: any) {
    const page = await this.rules.findAll(query, req.user.tenantId);
    return { data: page.data, total: page.total, limit: page.limit, offset: page.offset };
  }

  @Get(':id') @RequirePermission('MASTER_DATA', 'GILT_CLASS_RULE', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.rules.findOne(id, req.user.tenantId) }; }

  @Post() @RequirePermission('MASTER_DATA', 'GILT_CLASS_RULE', 'create')
  async create(@Body() dto: CreateGiltClassRuleDto, @Req() req: any) { return { data: await this.rules.create(dto, req.user.tenantId, req.user) }; }

  @Put(':id') @RequirePermission('MASTER_DATA', 'GILT_CLASS_RULE', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateGiltClassRuleDto, @Req() req: any) { return { data: await this.rules.update(id, dto, req.user.tenantId, req.user) }; }

  @Delete(':id') @RequirePermission('MASTER_DATA', 'GILT_CLASS_RULE', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.rules.setActive(id, false, req.user.tenantId, req.user) }; }

  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'GILT_CLASS_RULE', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.rules.setActive(id, true, req.user.tenantId, req.user) }; }
}
