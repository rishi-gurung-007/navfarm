import { Controller, Get, Post, Put, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { StockTransferService } from './stock-transfer.service';
import { CreateStockTransferDto, UpdateStockTransferDto, QueryStockTransferDto, PostShipmentDto, PostReceiptDto, PostDirectTransferDto } from './dto/stock-transfer.dto';
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
  @ApiOperation({ summary: 'Direct Transfer (compatibility): one shipment plus its matching receipt in one transaction' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async post(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.post(id, tenantId, req.user);
    return { success: true, message: 'Stock Transfer posted successfully.', data: result };
  }

  @Post(':id/shipment')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Post a partial shipment event (Task 10); lot/serial identity rides the order line' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async shipment(@Param('id') id: string, @Body() dto: PostShipmentDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.postShipment(id, dto, tenantId, req.user);
    return { success: true, message: 'Shipment posted.', data: result };
  }

  @Post(':id/receipt')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Post a partial receipt event against a shipment; over-receipt is refused' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async receipt(@Param('id') id: string, @Body() dto: PostReceiptDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.postReceipt(id, dto, tenantId, req.user);
    return { success: true, message: 'Receipt posted.', data: result };
  }

  @Post(':id/direct-transfer')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Direct Transfer: a selected shipment and its matching receipt together in one transaction' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async directTransfer(@Param('id') id: string, @Body() dto: PostDirectTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.postDirectTransfer(id, dto, tenantId, req.user);
    return { success: true, message: 'Direct Transfer posted.', data: result };
  }
}
