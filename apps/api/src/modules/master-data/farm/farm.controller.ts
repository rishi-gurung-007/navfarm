import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { FarmService } from './farm.service';
import { QueryFarmDto } from './dto/farm.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

/**
 * Read-only. Farms are rows of `location_master`, so they are created,
 * renamed and retired through /location — the single write path for the whole
 * location tree. These endpoints remain because existing screens bind to the
 * farm_* field names; they project the location rows back into that shape.
 */
@ApiTags('Farm Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('farm')
export class FarmController {
  constructor(private readonly farmService: FarmService) {}

  @Get()
  @RequirePermission('MASTER_DATA', 'FARM', 'view')
  @ApiOperation({ summary: 'List all Farms matching filters' })
  async findAll(@Query() query: QueryFarmDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.farmService.findAll(query, tenantId);
    return { success: true, message: 'Farms retrieved successfully.', data: result };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'FARM', 'view')
  @ApiOperation({ summary: 'Get a single Farm by ID' })
  @ApiParam({ name: 'id', description: 'Farm UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.farmService.findOne(id);
    return { success: true, message: 'Farm retrieved successfully.', data: result };
  }
}
