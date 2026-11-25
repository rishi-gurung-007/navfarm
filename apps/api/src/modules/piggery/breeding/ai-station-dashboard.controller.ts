import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { AiStationDashboardService } from './ai-station-dashboard.service';
import { AiStationDashboardQueryDto } from './dto/ai-station-dashboard.dto';

@ApiTags('Piggery Breeding & Reproduction')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('piggery/ai-station')
export class AiStationDashboardController {
  constructor(private readonly service: AiStationDashboardService) {}

  @Get('dashboard')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'AI Station dashboard: tiles, Requested / Received / Used / Destroyed by request, farm and lot, and the lots' })
  async dashboard(@Query() query: AiStationDashboardQueryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'AI Station dashboard.', data: await this.service.dashboard(query, tenantId) };
  }
}
