import { Controller, Get, Post, Put, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { GoodsReceiptService } from './goods-receipt.service';
import { CreateGoodsReceiptDto, UpdateGoodsReceiptDto, QueryGoodsReceiptDto } from './dto/goods-receipt.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('GRN')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('goods-receipt')
export class GoodsReceiptController {
  constructor(private readonly goodsReceiptService: GoodsReceiptService) {}

  @Post()
  @RequirePermission('INVENTORY', 'GOODS_RECEIPT', 'create')
  @ApiOperation({ summary: 'Create a draft GRN with lines' })
  async create(@Body() dto: CreateGoodsReceiptDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.goodsReceiptService.create(dto, tenantId, req.user);
    return { success: true, message: 'GRN draft created successfully.', data: result };
  }

  @Get()
  @RequirePermission('INVENTORY', 'GOODS_RECEIPT', 'view')
  @ApiOperation({ summary: 'List GRNs matching filters' })
  async findAll(@Query() query: QueryGoodsReceiptDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.goodsReceiptService.findAll(query, tenantId);
    return { success: true, message: 'GRNs retrieved successfully.', data: result };
  }

  @Get(':id')
  @RequirePermission('INVENTORY', 'GOODS_RECEIPT', 'view')
  @ApiOperation({ summary: 'Fetch a single GRN with its lines' })
  @ApiParam({ name: 'id', description: 'GRN UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.goodsReceiptService.findOne(id);
    return { success: true, message: 'GRN details retrieved.', data: result };
  }

  @Put(':id')
  @RequirePermission('INVENTORY', 'GOODS_RECEIPT', 'edit')
  @ApiOperation({ summary: 'Update a DRAFT GRN (header and/or lines)' })
  @ApiParam({ name: 'id', description: 'GRN UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateGoodsReceiptDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.goodsReceiptService.update(id, dto, tenantId, req.user);
    return { success: true, message: 'GRN updated successfully.', data: result };
  }

  @Delete(':id')
  @RequirePermission('INVENTORY', 'GOODS_RECEIPT', 'delete')
  @ApiOperation({ summary: 'Cancel a DRAFT GRN' })
  @ApiParam({ name: 'id', description: 'GRN UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.goodsReceiptService.remove(id, tenantId, req.user);
  }

  @Post(':id/post')
  @RequirePermission('INVENTORY', 'GOODS_RECEIPT', 'edit')
  @ApiOperation({ summary: 'Post a DRAFT GRN — writes Inventory Ledger entries and locks it' })
  @ApiParam({ name: 'id', description: 'GRN UUID' })
  async post(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.goodsReceiptService.post(id, tenantId, req.user);
    return { success: true, message: 'GRN posted successfully.', data: result };
  }
}
