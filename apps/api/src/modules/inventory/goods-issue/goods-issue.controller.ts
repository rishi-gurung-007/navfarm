import { Controller, Get, Post, Put, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { GoodsIssueService } from './goods-issue.service';
import { CreateGoodsIssueDto, UpdateGoodsIssueDto, QueryGoodsIssueDto } from './dto/goods-issue.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Goods Issue')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('goods-issue')
export class GoodsIssueController {
  constructor(private readonly goodsIssueService: GoodsIssueService) {}

  @Post()
  @RequirePermission('INVENTORY', 'GOODS_ISSUE', 'create')
  @ApiOperation({ summary: 'Create a draft Goods Issue with lines' })
  async create(@Body() dto: CreateGoodsIssueDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.goodsIssueService.create(dto, tenantId, req.user);
    return { success: true, message: 'Goods Issue draft created successfully.', data: result };
  }

  @Get()
  @RequirePermission('INVENTORY', 'GOODS_ISSUE', 'view')
  @ApiOperation({ summary: 'List Goods Issues matching filters' })
  async findAll(@Query() query: QueryGoodsIssueDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.goodsIssueService.findAll(query, tenantId);
    return { success: true, message: 'Goods Issues retrieved successfully.', data: result };
  }

  @Get(':id')
  @RequirePermission('INVENTORY', 'GOODS_ISSUE', 'view')
  @ApiOperation({ summary: 'Fetch a single Goods Issue with its lines' })
  @ApiParam({ name: 'id', description: 'Goods Issue UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.goodsIssueService.findOne(id);
    return { success: true, message: 'Goods Issue details retrieved.', data: result };
  }

  @Put(':id')
  @RequirePermission('INVENTORY', 'GOODS_ISSUE', 'edit')
  @ApiOperation({ summary: 'Update a DRAFT Goods Issue (header and/or lines)' })
  @ApiParam({ name: 'id', description: 'Goods Issue UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateGoodsIssueDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.goodsIssueService.update(id, dto, tenantId, req.user);
    return { success: true, message: 'Goods Issue updated successfully.', data: result };
  }

  @Delete(':id')
  @RequirePermission('INVENTORY', 'GOODS_ISSUE', 'delete')
  @ApiOperation({ summary: 'Cancel a DRAFT Goods Issue' })
  @ApiParam({ name: 'id', description: 'Goods Issue UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.goodsIssueService.remove(id, tenantId, req.user);
  }

  @Post(':id/post')
  @RequirePermission('INVENTORY', 'GOODS_ISSUE', 'edit')
  @ApiOperation({ summary: 'Post a DRAFT Goods Issue — writes Inventory Ledger entries via FIFO and locks it' })
  @ApiParam({ name: 'id', description: 'Goods Issue UUID' })
  async post(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.goodsIssueService.post(id, tenantId, req.user);
    return { success: true, message: 'Goods Issue posted successfully.', data: result };
  }
}
