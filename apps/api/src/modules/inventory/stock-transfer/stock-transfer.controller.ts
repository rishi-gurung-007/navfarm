import { Controller, Get, Post, Put, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { StockTransferService } from './stock-transfer.service';
import {
  CreateStockTransferDto, UpdateStockTransferDto, QueryStockTransferDto,
  PostShipmentDto, PostReceiptDto, PostDirectTransferDto,
  ReceiveStockTransferDto, ShipStockTransferDto,
} from './dto/stock-transfer.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Transfer Order')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('stock-transfer')
export class StockTransferController {
  constructor(private readonly stockTransferService: StockTransferService) { }

  @Post()
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'create')
  @ApiOperation({ summary: 'Create a draft Transfer Order with lines' })
  async create(@Body() dto: CreateStockTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.create(dto, tenantId, req.user);
    return { success: true, message: 'Transfer Order draft created successfully.', data: result };
  }

  @Get()
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'view')
  @ApiOperation({ summary: 'List Transfer Orders matching filters' })
  async findAll(@Query() query: QueryStockTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.findAll(query, tenantId);
    return { success: true, message: 'Transfer Orders retrieved successfully.', data: result };
  }

  @Get('pending-receipts')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'view')
  @ApiOperation({ summary: 'List inbound Transfer Orders currently in transit awaiting receipt at destination' })
  async getPendingReceipts(@Query() query: QueryStockTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.getPendingReceipts(query, tenantId);
    return { success: true, message: 'Pending transfer order receipts retrieved.', data: result };
  }

  @Get('receipts')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'view')
  @ApiOperation({ summary: 'List all posted Transfer Order receipts (GRN History) from ledger' })
  async getReceiptHistory(@Query() query: QueryStockTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.getReceiptHistory(query, tenantId);
    return { success: true, message: 'Stock transfer receipt history retrieved.', data: result };
  }

  @Get(':id')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'view')
  @ApiOperation({ summary: 'Fetch a single Transfer Order with its lines' })
  @ApiParam({ name: 'id', description: 'Transfer Order UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.stockTransferService.findOne(id);
    return { success: true, message: 'Transfer Order details retrieved.', data: result };
  }

  @Put(':id')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Update a DRAFT Transfer Order (header and/or lines)' })
  @ApiParam({ name: 'id', description: 'Transfer Order UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateStockTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    // A requisition's transfer is changed only through its requisition (Phase 1 close).
    await this.stockTransferService.assertNotRequisitionTransfer(id, tenantId);
    const result = await this.stockTransferService.update(id, dto, tenantId, req.user);
    return { success: true, message: 'Transfer Order updated successfully.', data: result };
  }

  @Delete(':id')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'delete')
  @ApiOperation({ summary: 'Cancel a DRAFT Transfer Order' })
  @ApiParam({ name: 'id', description: 'Transfer Order UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    // A requisition's transfer is changed only through its requisition (Phase 1 close).
    await this.stockTransferService.assertNotRequisitionTransfer(id, tenantId);
    return this.stockTransferService.remove(id, tenantId, req.user);
  }

  @Post(':id/ship')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Step 1: Ship a DRAFT Transfer Order — writes TRANSFER_SHIPMENT entry and sets status to IN_TRANSIT' })
  @ApiParam({ name: 'id', description: 'Transfer Order UUID' })
  async ship(
    @Param('id') id: string,
    @Body() dto: ShipStockTransferDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.ship(id, dto, tenantId, req.user);
    return { success: true, message: 'Transfer Order shipped successfully. Stock is now in transit.', data: result };
  }

  @Post(':id/receive')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Step 2: Receive an IN_TRANSIT Transfer Order — writes TRANSFER_RECEIPT entry and sets status to RECEIVED' })
  @ApiParam({ name: 'id', description: 'Transfer Order UUID' })
  async receive(@Param('id') id: string, @Body() dto: ReceiveStockTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.receive(id, dto, tenantId, req.user);
    return { success: true, message: 'Transfer Order received successfully into destination location.', data: result };
  }

  @Post(':id/post')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Direct Transfer: shipment and receipt in one transaction' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async post(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    // A requisition's transfer is posted from the requisition (P1 follow-up I1).
    await this.stockTransferService.assertNotRequisitionTransfer(id, tenantId);
    const result = await this.stockTransferService.post(id, tenantId, req.user);
    return { success: true, message: 'Transfer Order posted successfully.', data: result };
  }

  @Post(':id/close')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Short-close a partially fulfilled Transfer Order (cancels remaining un-shipped balance)' })
  @ApiParam({ name: 'id', description: 'Transfer Order UUID' })
  async close(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.stockTransferService.close(id, tenantId, req.user, body);
    return { success: true, message: 'Transfer Order closed successfully.', data: result };
  }

  @Post(':id/shipment')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Post a partial shipment event (Task 10); lot/serial identity rides the order line' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async shipment(@Param('id') id: string, @Body() dto: PostShipmentDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    // A requisition's transfer is posted from the requisition (P1 follow-up I1).
    await this.stockTransferService.assertNotRequisitionTransfer(id, tenantId);
    const result = await this.stockTransferService.postShipment(id, dto, tenantId, req.user);
    return { success: true, message: 'Shipment posted.', data: result };
  }

  @Post(':id/receipt')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Post a partial receipt event against a shipment; over-receipt is refused' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async receipt(@Param('id') id: string, @Body() dto: PostReceiptDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    // A requisition's transfer is posted from the requisition (P1 follow-up I1).
    await this.stockTransferService.assertNotRequisitionTransfer(id, tenantId);
    const result = await this.stockTransferService.postReceipt(id, dto, tenantId, req.user);
    return { success: true, message: 'Receipt posted.', data: result };
  }

  @Post(':id/direct-transfer')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Direct Transfer: a selected shipment and its matching receipt together in one transaction' })
  @ApiParam({ name: 'id', description: 'Stock Transfer UUID' })
  async directTransfer(@Param('id') id: string, @Body() dto: PostDirectTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    // A requisition's transfer is posted from the requisition (P1 follow-up I1).
    await this.stockTransferService.assertNotRequisitionTransfer(id, tenantId);
    const result = await this.stockTransferService.postDirectTransfer(id, dto, tenantId, req.user);
    return { success: true, message: 'Direct Transfer posted.', data: result };
  }
}
