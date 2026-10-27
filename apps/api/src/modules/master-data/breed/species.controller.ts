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
import { BreedService } from './breed.service';
import { CreateSpeciesDto, UpdateSpeciesDto, QuerySpeciesDto } from './dto/breed.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Species Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('species')
export class SpeciesController {
  constructor(private readonly breedService: BreedService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'SPECIES', 'create')
  @ApiOperation({ summary: 'Register a new biological Species' })
  async create(@Body() dto: CreateSpeciesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.createSpecies(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Species registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'SPECIES', 'view')
  @ApiOperation({ summary: 'List all Species matching filters' })
  async findAll(@Query() query: QuerySpeciesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.findAllSpecies(query, tenantId);
    return {
      success: true,
      message: 'Species retrieved successfully.',
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'SPECIES', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Species by UUID' })
  @ApiParam({ name: 'id', description: 'Species UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.breedService.findOneSpecies(id);
    return {
      success: true,
      message: 'Species details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'SPECIES', 'edit')
  @ApiOperation({ summary: 'Update details of an existing Species' })
  @ApiParam({ name: 'id', description: 'Species UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateSpeciesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.updateSpecies(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Species updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'SPECIES', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a Species profile' })
  @ApiParam({ name: 'id', description: 'Species UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.removeSpecies(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'SPECIES', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Species profile' })
  @ApiParam({ name: 'id', description: 'Species UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.restoreSpecies(id, tenantId, req.user);
    return {
      success: true,
      message: 'Species restored successfully.',
      data: result
    };
  }
}
