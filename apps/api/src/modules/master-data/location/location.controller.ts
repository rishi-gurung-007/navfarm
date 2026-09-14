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
import { LocationService } from './location.service';
import { CreateLocationDto, UpdateLocationDto, QueryLocationDto } from './dto/location.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Location Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('location')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'LOCATION', 'create')
  @ApiOperation({ summary: 'Register a new Location' })
  async create(@Body() dto: CreateLocationDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.locationService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Location registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'LOCATION', 'view')
  @ApiOperation({ summary: 'List all Locations matching filters' })
  async findAll(@Query() query: QueryLocationDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.locationService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Locations retrieved successfully.',
      // `data` stays the array it has always been, so every existing caller
      // keeps working; total/limit/offset are new siblings the list screen uses
      // to page through the whole table rather than a fetched window of it.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get('occupancy')
  @RequirePermission('MASTER_DATA', 'LOCATION', 'view')
  @ApiOperation({ summary: 'Facility & Pen live occupancy, animal headcount and biosecurity tracking' })
  async getOccupancy(@Query('companyId') companyId: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.locationService.getLocationOccupancy(tenantId, companyId);
    return {
      success: true,
      message: 'Facility occupancy retrieved successfully.',
      data: result
    };
  }

  @Get(':id')

  @RequirePermission('MASTER_DATA', 'LOCATION', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Location by UUID' })
  @ApiParam({ name: 'id', description: 'Location UUID' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.locationService.findOne(id, tenantId);
    return {
      success: true,
      message: 'Location details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'LOCATION', 'edit')
  @ApiOperation({ summary: 'Update details of an existing Location' })
  @ApiParam({ name: 'id', description: 'Location UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateLocationDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.locationService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Location updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'LOCATION', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a Location profile' })
  @ApiParam({ name: 'id', description: 'Location UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.locationService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'LOCATION', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Location profile' })
  @ApiParam({ name: 'id', description: 'Location UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.locationService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Location restored successfully.',
      data: result
    };
  }
}
