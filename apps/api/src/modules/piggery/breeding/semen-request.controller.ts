import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { SemenRequestService } from './semen-request.service';
import { AllocateSemenLotDto, QuerySemenRequestDto } from './dto/semen-request.dto';

@ApiTags('Piggery Breeding & Reproduction')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('piggery/semen-requests')
export class SemenRequestController {
  constructor(private readonly service: SemenRequestService) {}

  @Get()
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: "Farms' semen requests (Store requisitions naming a breeding line), with their plan and lot" })
  async list(@Query() query: QuerySemenRequestDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Semen requests retrieved.', data: await this.service.list(query, tenantId) };
  }

  @Get('sources')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: "The company's farms, stores and breeding lines a farm can ask semen from" })
  async sources(@Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Semen sources retrieved.', data: await this.service.sources(tenantId) };
  }

  @Post('allocate')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: "Allocate a collected lot, clear of QC, to requests: the lot is put on each request's transfer" })
  async allocate(@Body() dto: AllocateSemenLotDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Lot allocated.', data: await this.service.allocate(dto, tenantId, req.user) };
  }
}
