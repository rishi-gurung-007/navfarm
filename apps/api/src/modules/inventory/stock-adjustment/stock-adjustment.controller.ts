import { Controller, Get, Post, Put, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { StockAdjustmentService } from './stock-adjustment.service';
import { CreateStockAdjustmentDto, UpdateStockAdjustmentDto, QueryStockAdjustmentDto } from './dto/stock-adjustment.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Stock Adjustment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('stock-adjustment')
export class StockAdjustmentController {
  constructor(private readonly stockAdjustmentService: StockAdjustmentService) {}

  @Post()
  @RequirePermission('INVENTORY', 'STOCK_ADJUSTMENT', 'create')
  @ApiOperation({ summary: 'Create a draft Stock Adjustment with lines' })
  async create(@Body() dto: CreateStockAdjustmentDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockAdjustmentService.create(dto, tenantId, req.user);
    return { success: true, message: 'Stock Adjustment draft created successfully.', data: result };
  }

  @Get()
  @RequirePermission('INVENTORY', 'STOCK_ADJUSTMENT', 'view')
  @ApiOperation({ summary: 'List Stock Adjustments matching filters' })
  async findAll(@Query() query: QueryStockAdjustmentDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockAdjustmentService.findAll(query, tenantId);
    return { success: true, message: 'Stock Adjustments retrieved successfully.', data: result };
  }

  @Get(':id')
  @RequirePermission('INVENTORY', 'STOCK_ADJUSTMENT', 'view')
  @ApiOperation({ summary: 'Fetch a single Stock Adjustment with its lines' })
  @ApiParam({ name: 'id', description: 'Stock Adjustment UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.stockAdjustmentService.findOne(id);
    return { success: true, message: 'Stock Adjustment details retrieved.', data: result };
  }

  @Put(':id')
  @RequirePermission('INVENTORY', 'STOCK_ADJUSTMENT', 'edit')
  @ApiOperation({ summary: 'Update a DRAFT Stock Adjustment (header and/or lines)' })
  @ApiParam({ name: 'id', description: 'Stock Adjustment UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateStockAdjustmentDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockAdjustmentService.update(id, dto, tenantId, req.user);
    return { success: true, message: 'Stock Adjustment updated successfully.', data: result };
  }

  @Delete(':id')
  @RequirePermission('INVENTORY', 'STOCK_ADJUSTMENT', 'delete')
  @ApiOperation({ summary: 'Cancel a DRAFT Stock Adjustment' })
  @ApiParam({ name: 'id', description: 'Stock Adjustment UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.stockAdjustmentService.remove(id, tenantId, req.user);
  }

  @Post(':id/post')
  @RequirePermission('INVENTORY', 'STOCK_ADJUSTMENT', 'edit')
  @ApiOperation({ summary: 'Post a DRAFT Stock Adjustment — writes Inventory Ledger entries and locks it' })
  @ApiParam({ name: 'id', description: 'Stock Adjustment UUID' })
  async post(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockAdjustmentService.post(id, tenantId, req.user);
    return { success: true, message: 'Stock Adjustment posted successfully.', data: result };
  }
}
