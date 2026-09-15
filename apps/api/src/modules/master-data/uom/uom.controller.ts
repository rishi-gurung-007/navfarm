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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';
import { UomService } from './uom.service';
import {
  CreateUomDto,
  UpdateUomDto,
  QueryUomDto,
  CreateUomConversionDto,
  UpdateUomConversionDto,
  QueryUomConversionDto,
} from './dto/uom.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('UOM (Unit of Measure) Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('uom')
export class UomController {
  constructor(private readonly uomService: UomService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'UOM', 'create')
  @ApiOperation({ summary: 'Create a new Unit of Measure (UOM)' })
  async create(@Body() dto: CreateUomDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.uomService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Unit of Measure created successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'UOM', 'view')
  @ApiOperation({ summary: 'List all Units of Measure (UOMs) matching filters' })
  async findAll(@Query() query: QueryUomDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.uomService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Units of Measure retrieved successfully.',
      data: result
    };
  }

  @Get('conversion')
  @RequirePermission('MASTER_DATA', 'UOM', 'view')
  @ApiOperation({ summary: 'List all UOM Conversion factors' })
  async findAllConversions(
    @Query() query: QueryUomConversionDto,
    @Req() req: any
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.uomService.findAllConversions(query, tenantId);
    return {
      success: true,
      message: 'UOM conversion factors retrieved successfully.',
      // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on (same envelope as Item).
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get('convert')
  @RequirePermission('MASTER_DATA', 'UOM', 'view')
  @ApiOperation({ summary: 'Live calculate UOM conversion quantity and factor' })
  async convertQuantity(
    @Query('from') fromUom: string,
    @Query('to') toUom: string,
    @Query('quantity') quantity: number,
    @Query('itemId') itemId: string,
    @Query('companyId') companyId: string,
    @Req() req: any
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.uomService.convertQuantity(
      fromUom || '',
      toUom || '',
      quantity != null ? Number(quantity) : 1,
      itemId,
      companyId,
      tenantId
    );
    return {
      success: true,
      message: 'UOM conversion calculated.',
      data: result,
    };
  }

  @Get(':id')

  @RequirePermission('MASTER_DATA', 'UOM', 'view')
  @ApiOperation({ summary: 'Fetch details of a single UOM by UUID' })
  @ApiParam({ name: 'id', description: 'UOM UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.uomService.findOne(id);
    return {
      success: true,
      message: 'Unit of Measure details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'UOM', 'edit')
  @ApiOperation({ summary: 'Update details of an existing UOM' })
  @ApiParam({ name: 'id', description: 'UOM UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateUomDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.uomService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Unit of Measure updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'UOM', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a UOM profile' })
  @ApiParam({ name: 'id', description: 'UOM UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.uomService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'UOM', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted UOM profile' })
  @ApiParam({ name: 'id', description: 'UOM UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.uomService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Unit of Measure restored successfully.',
      data: result
    };
  }

  // UOM Conversion Endpoints

  @Post('conversion')
  @RequirePermission('MASTER_DATA', 'UOM', 'create')
  @ApiOperation({ summary: 'Add a new UOM Conversion factor mapping' })
  async createConversion(@Body() dto: CreateUomConversionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.uomService.createConversion(dto, tenantId, req.user);
    return {
      success: true,
      message: 'UOM conversion mapping registered successfully.',
      data: result
    };
  }

  @Get('conversion/:id')
  @RequirePermission('MASTER_DATA', 'UOM', 'view')
  @ApiOperation({ summary: 'Fetch details of a single UOM conversion factor by UUID' })
  @ApiParam({ name: 'id', description: 'Conversion factor UUID' })
  async findOneConversion(@Param('id') id: string) {
    const result = await this.uomService.findOneConversion(id);
    return {
      success: true,
      message: 'UOM conversion mapping details retrieved.',
      data: result
    };
  }

  @Put('conversion/:id')
  @RequirePermission('MASTER_DATA', 'UOM', 'edit')
  @ApiOperation({ summary: 'Update an existing UOM conversion factor' })
  @ApiParam({ name: 'id', description: 'Conversion factor UUID' })
  async updateConversion(@Param('id') id: string, @Body() dto: UpdateUomConversionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.uomService.updateConversion(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'UOM conversion mapping updated.',
      data: result
    };
  }

  @Delete('conversion/:id')
  @RequirePermission('MASTER_DATA', 'UOM', 'delete')
  @ApiOperation({ summary: 'Soft-delete a UOM conversion factor' })
  @ApiParam({ name: 'id', description: 'Conversion factor UUID' })
  async removeConversion(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.uomService.removeConversion(id, tenantId, req.user);
    return result;
  }
}
