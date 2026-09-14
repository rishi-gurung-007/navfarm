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
import { ItemCategoryService } from './item-category.service';
import { CreateItemCategoryDto, UpdateItemCategoryDto, QueryItemCategoryDto } from './dto/item-category.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Item Category Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('item-category')
export class ItemCategoryController {
  constructor(private readonly itemCategoryService: ItemCategoryService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'ITEM_CATEGORY', 'create')
  @ApiOperation({ summary: 'Register a new Item Category' })
  async create(@Body() dto: CreateItemCategoryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemCategoryService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Item category registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'ITEM_CATEGORY', 'view')
  @ApiOperation({ summary: 'List all Item Categories matching filters' })
  async findAll(@Query() query: QueryItemCategoryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemCategoryService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Item categories retrieved successfully.',
            // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'ITEM_CATEGORY', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Item Category by UUID' })
  @ApiParam({ name: 'id', description: 'Item Category UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.itemCategoryService.findOne(id);
    return {
      success: true,
      message: 'Item category details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'ITEM_CATEGORY', 'edit')
  @ApiOperation({ summary: 'Update details of an existing Item Category' })
  @ApiParam({ name: 'id', description: 'Item Category UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateItemCategoryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemCategoryService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Item category updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'ITEM_CATEGORY', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) an Item Category' })
  @ApiParam({ name: 'id', description: 'Item Category UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemCategoryService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'ITEM_CATEGORY', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Item Category' })
  @ApiParam({ name: 'id', description: 'Item Category UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemCategoryService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Item category restored successfully.',
      data: result
    };
  }
}
