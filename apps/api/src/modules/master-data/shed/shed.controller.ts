import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ShedService } from './shed.service';
import { QueryShedDto } from './dto/shed.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { FarmScoped } from '../../../common/farm-scope';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

/**
 * Read-only. Sheds are rows of `location_master`, so they are created,
 * renamed and retired through /location — the single write path for the whole
 * location tree. These endpoints remain because existing screens bind to the
 * shed_* field names; they project the location rows back into that shape.
 */
@ApiTags('Shed Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('shed')
export class ShedController {
  constructor(private readonly shedService: ShedService) {}

  @Get()
  @RequirePermission('MASTER_DATA', 'SHED', 'view')
  @ApiOperation({ summary: 'List all Sheds matching filters' })
  async findAll(@Query() query: QueryShedDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.shedService.findAll(query, tenantId);
    return { success: true, message: 'Sheds retrieved successfully.', data: result };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'SHED', 'view')
  @ApiOperation({ summary: 'Get a single Shed by ID' })
  @ApiParam({ name: 'id', description: 'Shed UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.shedService.findOne(id);
    return { success: true, message: 'Shed retrieved successfully.', data: result };
  }
}
