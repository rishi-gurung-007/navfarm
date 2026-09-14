import { Controller, Get, Post, Put, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { StockTransferService } from './stock-transfer.service';
import { CreateStockTransferDto, UpdateStockTransferDto, QueryStockTransferDto } from './dto/stock-transfer.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Stock Transfer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('stock-transfer')
export class StockTransferController {
  constructor(private readonly stockTransferService: StockTransferService) {}

  @Post()
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'create')
  @ApiOperation({ summary: 'Create a draft Stock Transfer with lines' })
  async create(@Body() dto: CreateStockTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.create(dto, tenantId, req.user);
    return { success: true, message: 'Stock Transfer draft created successfully.', data: result };
  }

  @Get()
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'view')
  @ApiOperation({ summary: 'List Stock Transfers matching filters' })
  async findAll(@Query() query: QueryStockTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.findAll(query, tenantId);
    return { success: true, message: 'Stock Transfers retrieved successfully.', data: result };
  }

  @Get(':id')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'view')
  @ApiOperation({ summary: 'Fetch a single Stock Transfer with its lines' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.stockTransferService.findOne(id);
    return { success: true, message: 'Stock Transfer details retrieved.', data: result };
  }

  @Put(':id')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Update a DRAFT Stock Transfer (header and/or lines)' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateStockTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.update(id, dto, tenantId, req.user);
    return { success: true, message: 'Stock Transfer updated successfully.', data: result };
  }

  @Delete(':id')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'delete')
  @ApiOperation({ summary: 'Cancel a DRAFT Stock Transfer' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.stockTransferService.remove(id, tenantId, req.user);
  }

  @Post(':id/post')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Post a DRAFT Stock Transfer — writes shipment + receipt Inventory Ledger entries and locks it' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async post(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.post(id, tenantId, req.user);
    return { success: true, message: 'Stock Transfer posted successfully.', data: result };
  }
}
