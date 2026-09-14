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
import { CreateBreedDto, UpdateBreedDto, QueryBreedDto } from './dto/breed.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Breed Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('breed')
export class BreedController {
  constructor(private readonly breedService: BreedService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'BREED', 'create')
  @ApiOperation({ summary: 'Register a new biological Breed' })
  async create(@Body() dto: CreateBreedDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.createBreed(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Breed registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'BREED', 'view')
  @ApiOperation({ summary: 'List all Breeds matching filters' })
  async findAll(@Query() query: QueryBreedDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.findAllBreeds(query, tenantId);
    return {
      success: true,
      message: 'Breeds retrieved successfully.',
      data: result
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'BREED', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Breed by UUID' })
  @ApiParam({ name: 'id', description: 'Breed UUID' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.findOneBreed(id, tenantId);
    return {
      success: true,
      message: 'Breed details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'BREED', 'edit')
  @ApiOperation({ summary: 'Update details of an existing Breed' })
  @ApiParam({ name: 'id', description: 'Breed UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateBreedDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.updateBreed(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Breed updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'BREED', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a Breed profile' })
  @ApiParam({ name: 'id', description: 'Breed UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.removeBreed(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'BREED', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Breed profile' })
  @ApiParam({ name: 'id', description: 'Breed UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.breedService.restoreBreed(id, tenantId, req.user);
    return {
      success: true,
      message: 'Breed restored successfully.',
      data: result
    };
  }
}
