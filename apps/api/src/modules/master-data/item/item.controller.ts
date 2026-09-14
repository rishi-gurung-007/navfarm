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
import { ItemService } from './item.service';
import { CreateItemDto, UpdateItemDto, QueryItemDto } from './dto/item.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Item Master')
@ApiBearerAuth()
// Item Master (BBP-1 §1.5) places this catalog in Business Central. That integration is not built,
// so the catalog stays writable here and the frontend notice states the blueprint's
// position. Re-add a write guard when the BC sync endpoint lands.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('item')
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'ITEM', 'create')
  @ApiOperation({ summary: 'Register a new Item with attributes' })
  async create(@Body() dto: CreateItemDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Item registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'ITEM', 'view')
  @ApiOperation({ summary: 'List all Items matching filters' })
  async findAll(@Query() query: QueryItemDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Items retrieved successfully.',
      // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Item by UUID including mapped attributes' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.itemService.findOne(id, true);
    return {
      success: true,
      message: 'Item details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'edit')
  @ApiOperation({ summary: 'Update details and attributes of an existing Item' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateItemDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Item updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) an Item profile' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'ITEM', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Item profile' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Item restored successfully.',
      data: result
    };
  }
}
