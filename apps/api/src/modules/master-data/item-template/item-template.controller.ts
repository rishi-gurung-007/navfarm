import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ItemTemplateService } from './item-template.service';
import { CreateItemTemplateDto, UpdateItemTemplateDto } from './dto/item-template.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Item Template')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller(['item-templates', 'item-template'])
export class ItemTemplateController {
  constructor(private readonly itemTemplateService: ItemTemplateService) {}

  @Get()
  @RequirePermission('MASTER_DATA', 'ITEM', 'view')
  @ApiOperation({ summary: 'List Item Templates' })
  async findAll(@Req() req: any, @Query('activeOnly') activeOnly?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = req.headers?.['x-active-company-id'] || req.user?.companyId;
    const result = activeOnly === 'true'
      ? await this.itemTemplateService.findAllActive(tenantId, companyId)
      : await this.itemTemplateService.findAll(tenantId, companyId);
    return {
      success: true,
      message: 'Item templates retrieved successfully.',
      data: result,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'view')
  @ApiOperation({ summary: 'Get Item Template by ID' })
  @ApiParam({ name: 'id', description: 'Item Template UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.itemTemplateService.findOne(id);
    return {
      success: true,
      message: 'Item template retrieved successfully.',
      data: result,
    };
  }

  @Post()
  @RequirePermission('MASTER_DATA', 'ITEM', 'create')
  @ApiOperation({ summary: 'Create a new Item Template' })
  async create(@Body() dto: CreateItemTemplateDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = req.headers?.['x-active-company-id'] || req.user?.companyId;
    const result = await this.itemTemplateService.create(dto, tenantId, companyId);
    return {
      success: true,
      message: 'Item template created successfully.',
      data: result,
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'edit')
  @ApiOperation({ summary: 'Update Item Template' })
  @ApiParam({ name: 'id', description: 'Item Template UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateItemTemplateDto) {
    const result = await this.itemTemplateService.update(id, dto);
    return {
      success: true,
      message: 'Item template updated successfully.',
      data: result,
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'delete')
  @ApiOperation({ summary: 'Delete Item Template' })
  @ApiParam({ name: 'id', description: 'Item Template UUID' })
  async delete(@Param('id') id: string) {
    const result = await this.itemTemplateService.delete(id);
    return {
      success: true,
      message: 'Item template deleted successfully.',
      data: result,
    };
  }
}
