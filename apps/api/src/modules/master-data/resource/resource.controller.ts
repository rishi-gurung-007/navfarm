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
import { ResourceService } from './resource.service';
import { 
  CreateResourceDto, 
  UpdateResourceDto, 
  QueryResourceDto,
  CreateMaintenanceLogDto,
  UpdateMaintenanceLogDto
} from './dto/resource.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Resource Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('resource')
export class ResourceController {
  constructor(private readonly resourceService: ResourceService) {}

  // --- Resource Endpoints ---

  @Post()
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'create')
  @ApiOperation({ summary: 'Register a new Resource (Labor/Equipment/Vehicle)' })
  async create(@Body() dto: CreateResourceDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.resourceService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Resource registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'view')
  @ApiOperation({ summary: 'List all Resources matching filters' })
  async findAll(@Query() query: QueryResourceDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.resourceService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Resources retrieved successfully.',
            // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Resource by UUID' })
  @ApiParam({ name: 'id', description: 'Resource UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.resourceService.findOne(id);
    return {
      success: true,
      message: 'Resource details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'edit')
  @ApiOperation({ summary: 'Update details of an existing Resource' })
  @ApiParam({ name: 'id', description: 'Resource UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateResourceDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.resourceService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Resource updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a Resource profile' })
  @ApiParam({ name: 'id', description: 'Resource UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.resourceService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Resource profile' })
  @ApiParam({ name: 'id', description: 'Resource UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.resourceService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Resource restored successfully.',
      data: result
    };
  }

  // --- Maintenance Log Endpoints ---

  @Post(':id/maintenance')
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'edit')
  @ApiOperation({ summary: 'Log a maintenance service event for a Resource' })
  @ApiParam({ name: 'id', description: 'Resource UUID' })
  async createMaintenanceLog(
    @Param('id') id: string,
    @Body() dto: CreateMaintenanceLogDto,
    @Req() req: any
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.resourceService.createMaintenanceLog(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Maintenance log created successfully.',
      data: result
    };
  }

  @Get(':id/maintenance')
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'view')
  @ApiOperation({ summary: 'List all maintenance logs for a given Resource' })
  @ApiParam({ name: 'id', description: 'Resource UUID' })
  async findAllMaintenanceLogs(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.resourceService.findAllMaintenanceLogs(id, tenantId);
    return {
      success: true,
      message: 'Maintenance logs retrieved.',
      data: result
    };
  }

  @Get('maintenance/:logId')
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'view')
  @ApiOperation({ summary: 'Fetch a single maintenance log details' })
  @ApiParam({ name: 'logId', description: 'Maintenance Log UUID' })
  async findOneMaintenanceLog(@Param('logId') logId: string) {
    const result = await this.resourceService.findOneMaintenanceLog(logId);
    return {
      success: true,
      message: 'Maintenance log details retrieved.',
      data: result
    };
  }

  @Put('maintenance/:logId')
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'edit')
  @ApiOperation({ summary: 'Update a maintenance log entry' })
  @ApiParam({ name: 'logId', description: 'Maintenance Log UUID' })
  async updateMaintenanceLog(
    @Param('logId') logId: string,
    @Body() dto: UpdateMaintenanceLogDto,
    @Req() req: any
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.resourceService.updateMaintenanceLog(logId, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Maintenance log updated successfully.',
      data: result
    };
  }

  @Delete('maintenance/:logId')
  @RequirePermission('MASTER_DATA', 'RESOURCE', 'edit')
  @ApiOperation({ summary: 'Remove (soft-delete) a maintenance log entry' })
  @ApiParam({ name: 'logId', description: 'Maintenance Log UUID' })
  async removeMaintenanceLog(@Param('logId') logId: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.resourceService.removeMaintenanceLog(logId, tenantId, req.user);
    return result;
  }
}
