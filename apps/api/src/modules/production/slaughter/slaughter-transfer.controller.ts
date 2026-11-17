import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { CreateSlaughterTransferDto, QuerySlaughterTransferDto, SlaughterKillSheetDto, SlaughterPodDto } from './slaughter-transfer.dto';
import { SlaughterTransferService } from './slaughter-transfer.service';

@ApiTags('Slaughter Transfer Order') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('slaughter-transfer-order')
export class SlaughterTransferController {
  constructor(private readonly service: SlaughterTransferService) {}

  private tenant(req: any) { return req.user?.tenantId || req['tenantId']; }

  @Get() @RequirePermission('PRODUCTION', 'SLAUGHTER_TRANSFER', 'view')
  async list(@Query() q: QuerySlaughterTransferDto, @Req() req: any) { return { data: await this.service.findAll(q, this.tenant(req)) }; }

  @Get('eligible-lots') @RequirePermission('PRODUCTION', 'SLAUGHTER_TRANSFER', 'view')
  @ApiOperation({ summary: 'The lots a farm can send to slaughter on a date: head, carrying value, and any medicine withdrawal still active' })
  async eligible(@Query('farm_id') farmId: string, @Query('as_of') asOf: string, @Req() req: any) {
    return { data: await this.service.eligibleLots(farmId, (asOf || new Date().toISOString()).slice(0, 10), this.tenant(req)) };
  }

  @Get(':id') @RequirePermission('PRODUCTION', 'SLAUGHTER_TRANSFER', 'view')
  async one(@Param('id') id: string, @Req() req: any) { return { data: await this.service.findOne(id, this.tenant(req)) }; }

  @Post() @RequirePermission('PRODUCTION', 'SLAUGHTER_TRANSFER', 'create')
  @ApiOperation({ summary: 'A slaughter Transfer Order as a draft: one supplying farm, one line per batch per source house' })
  async create(@Body() dto: CreateSlaughterTransferDto, @Req() req: any) { return { data: await this.service.create(dto, this.tenant(req), req.user) }; }

  @Post(':id/confirm') @RequirePermission('PRODUCTION', 'SLAUGHTER_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Dispatch: withdrawal check, then the head leave their lots for Inventory in Transit' })
  async confirm(@Param('id') id: string, @Req() req: any) { return { data: await this.service.confirm(id, this.tenant(req), req.user) }; }

  @Post(':id/pod') @RequirePermission('PRODUCTION', 'SLAUGHTER_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Proof of delivery: each line\'s DOA, written off from In Transit' })
  async pod(@Param('id') id: string, @Body() dto: SlaughterPodDto, @Req() req: any) { return { data: await this.service.pod(id, dto, this.tenant(req), req.user) }; }

  @Post(':id/kill-sheet') @RequirePermission('PRODUCTION', 'SLAUGHTER_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Kill sheet and invoice: delivered x average carcass weight x price per kg' })
  async killSheet(@Param('id') id: string, @Body() dto: SlaughterKillSheetDto, @Req() req: any) { return { data: await this.service.killSheet(id, dto, this.tenant(req), req.user) }; }

  @Post(':id/close') @RequirePermission('PRODUCTION', 'SLAUGHTER_TRANSFER', 'edit')
  async close(@Param('id') id: string, @Req() req: any) { return { data: await this.service.close(id, this.tenant(req), req.user) }; }

  @Post(':id/cancel') @RequirePermission('PRODUCTION', 'SLAUGHTER_TRANSFER', 'edit')
  async cancel(@Param('id') id: string, @Req() req: any) { return { data: await this.service.cancel(id, this.tenant(req), req.user) }; }
}
