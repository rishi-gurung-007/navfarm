import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import {
  CreateBreedingLineSetupDto,
  EffectiveBreedingLineSetupQueryDto,
  QueryBreedingLineSetupDto,
  UpdateBreedingLineSetupDto,
} from './breeding-line-setup.dto';
import { BreedingLineSetupService } from './breeding-line-setup.service';
import { SELECTION_COLUMNS, WEEKDAY_OPTIONS } from './breeding-line.rules';

// A company master: the AI Station's line rules apply company-wide, not to one farm.
@ApiTags('Breeding Line Setup') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('breeding-line-setup')
export class BreedingLineSetupController {
  constructor(private readonly setups: BreedingLineSetupService) {}

  @Get() @RequirePermission('MASTER_DATA', 'BREEDING_LINE_SETUP', 'view')
  async list(@Query() query: QueryBreedingLineSetupDto, @Req() req: any) {
    const page = await this.setups.findAll(query, req.user.tenantId);
    return { data: page.data, total: page.total, limit: page.limit, offset: page.offset };
  }

  // The weekdays a line can be tapped on, as options for the form's picker. Declared before ':id'.
  @Get('weekday-options') @RequirePermission('MASTER_DATA', 'BREEDING_LINE_SETUP', 'view')
  weekdayOptions() { return { data: WEEKDAY_OPTIONS }; }

  // The columns the boar selection table can show, as options for the setup form's column layout. Declared before ':id'.
  @Get('selection-column-options') @RequirePermission('MASTER_DATA', 'BREEDING_LINE_SETUP', 'view')
  selectionColumnOptions() { return { data: SELECTION_COLUMNS.map((c) => ({ column_key: c.key, column_label: c.label })) }; }

  @Get('effective') @RequirePermission('MASTER_DATA', 'BREEDING_LINE_SETUP', 'view')
  async effective(@Query() query: EffectiveBreedingLineSetupQueryDto, @Req() req: any) {
    const companyId = query.companyId ?? req.user.companyId ?? null;
    return { data: await this.setups.findEffective(query.breed_id, req.user.tenantId, companyId) };
  }

  @Get(':id') @RequirePermission('MASTER_DATA', 'BREEDING_LINE_SETUP', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.setups.findOne(id, req.user.tenantId) }; }

  @Post() @RequirePermission('MASTER_DATA', 'BREEDING_LINE_SETUP', 'create')
  async create(@Body() dto: CreateBreedingLineSetupDto, @Req() req: any) { return { data: await this.setups.create(dto, req.user.tenantId, req.user) }; }

  @Put(':id') @RequirePermission('MASTER_DATA', 'BREEDING_LINE_SETUP', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateBreedingLineSetupDto, @Req() req: any) { return { data: await this.setups.update(id, dto, req.user.tenantId, req.user) }; }

  @Delete(':id') @RequirePermission('MASTER_DATA', 'BREEDING_LINE_SETUP', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.setups.setActive(id, false, req.user.tenantId, req.user) }; }

  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'BREEDING_LINE_SETUP', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.setups.setActive(id, true, req.user.tenantId, req.user) }; }
}
