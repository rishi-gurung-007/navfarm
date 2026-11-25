import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { SemenDisposalService } from './semen-disposal.service';
import { CreateSemenDisposalDto, QuerySemenDisposalDto } from './dto/semen-disposal.dto';

@ApiTags('Piggery Breeding & Reproduction')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('piggery/semen-disposal')
export class SemenDisposalController {
  constructor(private readonly service: SemenDisposalService) {}

  @Get()
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'Destroyed semen doses: written off from stock, or rejected by QC and scrapped' })
  async list(@Query() query: QuerySemenDisposalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Semen disposals retrieved.', data: await this.service.list(query, tenantId) };
  }

  @Get('stock/:lotId')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: "Where a semen lot's doses are now: each store holding it" })
  async stock(@Param('lotId', new ParseUUIDPipe()) lotId: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Lot stock retrieved.', data: await this.service.stock(lotId, tenantId) };
  }

  @Post(':lotId')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Destroy doses of a semen lot: written off from the store they are at, with its journal' })
  async dispose(@Param('lotId', new ParseUUIDPipe()) lotId: string, @Body() dto: CreateSemenDisposalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Doses destroyed.', data: await this.service.dispose(lotId, dto, tenantId, req.user) };
  }
}
