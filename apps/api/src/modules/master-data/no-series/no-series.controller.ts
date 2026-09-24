import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { CreateNoSeriesDto, UpdateNoSeriesDto } from './dto/no-series.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { RequireCodePreviewPermission } from '../../../common/decorators/require-code-preview-permission.decorator';

// A thin alias over NumberSeriesService's id-keyed methods, kept at its own
// /no-series routes so item-template, inventory-setup and the frontend's
// existing /no-series/* calls never had to change when no_series_master was
// merged into no_series (docs/decisions.md, 2026-09-23).
@ApiTags('No. Series')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('no-series')
export class NoSeriesController {
  constructor(private readonly numberSeriesService: NumberSeriesService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'ITEM', 'create')
  @ApiOperation({ summary: 'Create a new No. Series' })
  async create(@Body() dto: CreateNoSeriesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = req.headers?.['x-active-company-id'] || req.user?.companyId;
    const result = await this.numberSeriesService.createNoSeriesRow(dto, tenantId, companyId);
    return {
      success: true,
      message: 'No. Series created successfully.',
      data: result,
    };
  }

  @Get('preview-by-master')
  @RequireCodePreviewPermission()
  @ApiOperation({ summary: 'Preview the next number for a specific master type (e.g. SUPPLIER, CUSTOMER)' })
  async previewByMaster(
    @Query('masterType') masterType: string,
    @Query('companyId') queryCompanyId: string,
    @Query('type') type: string,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = queryCompanyId || req.headers?.['x-active-company-id'] || req.user?.companyId;
    const result = await this.numberSeriesService.previewByMaster(masterType, tenantId, companyId, type);
    return {
      success: true,
      message: 'Preview retrieved successfully.',
      data: result,
    };
  }

  @Get('by-master')
  @RequirePermission('SYSTEM', 'NUMBER_SERIES', 'view')
  @ApiOperation({ summary: 'List all No. Series grouped by master/document type — used by Inventory Setup' })
  async byMaster(
    @Query('companyId') queryCompanyId: string,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = queryCompanyId || req.headers?.['x-active-company-id'] || req.user?.companyId;
    const result = await this.numberSeriesService.byMaster(tenantId, companyId);
    return {
      success: true,
      message: 'No. Series by master retrieved successfully.',
      data: result,
    };
  }

  @Put(':id/set-default')
  @RequirePermission('MASTER_DATA', 'ITEM', 'edit')
  @ApiOperation({ summary: 'Set a No. Series as the default for its master type' })
  @ApiParam({ name: 'id', description: 'No. Series UUID' })
  async setDefault(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = req.headers?.['x-active-company-id'] || req.user?.companyId;
    const result = await this.numberSeriesService.setDefaultSeries(id, tenantId, companyId);
    return {
      success: true,
      message: 'Default No. Series updated.',
      data: result,
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'ITEM', 'view')
  @ApiOperation({ summary: 'List all No. Series' })
  async findAll(
    @Query() query: any,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = req.headers?.['x-active-company-id'] || req.user?.companyId;
    const documentType = query?.document_type || query?.filter?.document_type;
    const search = query?.search;
    const result = await this.numberSeriesService.findAllModern(documentType, tenantId, companyId, search, query?.filter, query);
    return {
      success: true,
      message: 'No. Series retrieved successfully.',
      data: Array.isArray(result) ? result : result.data,
      total: Array.isArray(result) ? result.length : result.total,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'view')
  @ApiOperation({ summary: 'Get No. Series by ID' })
  @ApiParam({ name: 'id', description: 'No. Series UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.numberSeriesService.findOneById(id);
    return {
      success: true,
      message: 'No. Series retrieved successfully.',
      data: result,
    };
  }

  @Get(':id/next-number')
  @RequirePermission('MASTER_DATA', 'ITEM', 'create')
  @ApiOperation({ summary: 'Internal utility: Atomically generate and reserve next number from No. Series' })
  @ApiParam({ name: 'id', description: 'No. Series UUID' })
  async getNextNumber(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = req.headers?.['x-active-company-id'] || req.user?.companyId;
    const result = await this.numberSeriesService.generateNextNumberById(id, tenantId, companyId);
    return {
      success: true,
      message: 'Next number generated successfully.',
      data: result,
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'edit')
  @ApiOperation({ summary: 'Update No. Series' })
  @ApiParam({ name: 'id', description: 'No. Series UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateNoSeriesDto) {
    const result = await this.numberSeriesService.updateNoSeriesRow(id, dto);
    return {
      success: true,
      message: 'No. Series updated successfully.',
      data: result,
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'delete')
  @ApiOperation({ summary: 'Deactivate No. Series' })
  @ApiParam({ name: 'id', description: 'No. Series UUID' })
  async delete(@Param('id') id: string) {
    const result = await this.numberSeriesService.softDeleteById(id);
    return {
      success: true,
      message: 'No. Series deactivated successfully.',
      data: result,
    };
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'ITEM', 'edit')
  @ApiOperation({ summary: 'Restore a deactivated No. Series' })
  @ApiParam({ name: 'id', description: 'No. Series UUID' })
  async restore(@Param('id') id: string) {
    const result = await this.numberSeriesService.restoreById(id);
    return {
      success: true,
      message: 'No. Series restored successfully.',
      data: result,
    };
  }
}
