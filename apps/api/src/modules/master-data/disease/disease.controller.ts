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
import { DiseaseService } from './disease.service';
import { CreateDiseaseDto, UpdateDiseaseDto, QueryDiseaseDto } from './dto/disease.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Disease Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('disease')
export class DiseaseController {
  constructor(private readonly diseaseService: DiseaseService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'DISEASE', 'create')
  @ApiOperation({ summary: 'Register a new Disease definition' })
  async create(@Body() dto: CreateDiseaseDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.diseaseService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Disease definition registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'DISEASE', 'view')
  @ApiOperation({ summary: 'List all Disease definitions matching filters' })
  async findAll(@Query() query: QueryDiseaseDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.diseaseService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Disease definitions retrieved successfully.',
            // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'DISEASE', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Disease definition by UUID' })
  @ApiParam({ name: 'id', description: 'Disease UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.diseaseService.findOne(id);
    return {
      success: true,
      message: 'Disease details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'DISEASE', 'edit')
  @ApiOperation({ summary: 'Update details of an existing Disease definition' })
  @ApiParam({ name: 'id', description: 'Disease UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateDiseaseDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.diseaseService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Disease definition updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'DISEASE', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a Disease definition' })
  @ApiParam({ name: 'id', description: 'Disease UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.diseaseService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'DISEASE', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Disease definition' })
  @ApiParam({ name: 'id', description: 'Disease UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.diseaseService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Disease definition restored successfully.',
      data: result
    };
  }
}
