import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateGeneticLevelBandDto, QueryGeneticLevelBandDto, UpdateGeneticLevelBandDto } from './genetic-level-band.dto';
import { GeneticLevelBandService } from './genetic-level-band.service';

// A company master: the genetic levels of a breeding line are not a farm's records.
@ApiTags('Genetic Level Band') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('genetic-level-band')
export class GeneticLevelBandController {
  constructor(private readonly bands: GeneticLevelBandService) {}

  @Get() @RequirePermission('MASTER_DATA', 'GENETIC_LEVEL_BAND', 'view')
  async list(@Query() query: QueryGeneticLevelBandDto, @Req() req: any) {
    const page = await this.bands.findAll(query, req.user.tenantId);
    return { data: page.data, total: page.total, limit: page.limit, offset: page.offset };
  }

  @Get(':id') @RequirePermission('MASTER_DATA', 'GENETIC_LEVEL_BAND', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.bands.findOne(id, req.user.tenantId) }; }

  @Post() @RequirePermission('MASTER_DATA', 'GENETIC_LEVEL_BAND', 'create')
  async create(@Body() dto: CreateGeneticLevelBandDto, @Req() req: any) { return { data: await this.bands.create(dto, req.user.tenantId, req.user) }; }

  @Put(':id') @RequirePermission('MASTER_DATA', 'GENETIC_LEVEL_BAND', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateGeneticLevelBandDto, @Req() req: any) { return { data: await this.bands.update(id, dto, req.user.tenantId, req.user) }; }

  @Delete(':id') @RequirePermission('MASTER_DATA', 'GENETIC_LEVEL_BAND', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.bands.setActive(id, false, req.user.tenantId, req.user) }; }

  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'GENETIC_LEVEL_BAND', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.bands.setActive(id, true, req.user.tenantId, req.user) }; }
}
