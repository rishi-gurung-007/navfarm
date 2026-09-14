import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Delete, 
  Param, 
  Body, 
  Query, 
  Req, 
  UseGuards, 
  Patch 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CostCenterService } from './cost-center.service';
import { CreateCostCenterDto, UpdateCostCenterDto, QueryCostCenterDto } from './dto/cost-center.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Cost Center (Dimensions Master)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cost-center')
export class CostCenterController {
  constructor(private readonly costCenterService: CostCenterService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'COST_CENTER', 'create')
  @ApiOperation({ summary: 'Register a new Cost Center dimension' })
  async create(@Body() dto: CreateCostCenterDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.costCenterService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Cost Center registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'COST_CENTER', 'view')
  @ApiOperation({ summary: 'List all Cost Centers matching filters' })
  async findAll(@Query() query: QueryCostCenterDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.costCenterService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Cost Centers retrieved successfully.',
            // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'COST_CENTER', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Cost Center by UUID' })
  @ApiParam({ name: 'id', description: 'Cost Center UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.costCenterService.findOne(id);
    return {
      success: true,
      message: 'Cost Center details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'COST_CENTER', 'edit')
  @ApiOperation({ summary: 'Update details of an existing Cost Center' })
  @ApiParam({ name: 'id', description: 'Cost Center UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateCostCenterDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.costCenterService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Cost Center updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'COST_CENTER', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a Cost Center' })
  @ApiParam({ name: 'id', description: 'Cost Center UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.costCenterService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'COST_CENTER', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Cost Center' })
  @ApiParam({ name: 'id', description: 'Cost Center UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.costCenterService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Cost Center restored successfully.',
      data: result
    };
  }
}
