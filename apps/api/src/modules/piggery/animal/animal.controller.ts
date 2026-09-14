import { Controller, Get, Post, Put, Patch, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AnimalService } from './animal.service';
import { BulkTransitionAnimalStageDto, CreateAnimalDto, UpdateAnimalDto, DisposeAnimalDto, QueryAnimalDto, TransitionAnimalStageDto } from './dto/animal.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Animal Register')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('animal')
export class AnimalController {
  constructor(private readonly animalService: AnimalService) {}

  @Post()
  @RequirePermission('PIGGERY', 'ANIMAL', 'create')
  @ApiOperation({ summary: 'Register a new animal — animal_code is auto-generated (ANIMAL_PIGGERY series)' })
  async create(@Body() dto: CreateAnimalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.animalService.create(dto, tenantId, req.user);
    return { success: true, message: 'Animal registered successfully.', data: result };
  }

  @Get()
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'List animals matching filters (disposed animals excluded unless includeDisposed=true)' })
  async findAll(@Query() query: QueryAnimalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.animalService.findAll(query, tenantId);
    return { success: true, message: 'Animals retrieved successfully.', data: result };
  }

  @Get('lookup/tag')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'Fast lookup by RFID tag, ear tag, or animal code for scanner wand integration' })
  async lookupByTag(@Query('tag') tag: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.animalService.lookupByTag(tag || '', tenantId);
    return { success: true, message: 'Animal resolved from tag.', data: result };
  }

  @Get(':id')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'Fetch a single animal' })
  @ApiParam({ name: 'id', description: 'Animal UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.animalService.findOne(id);
    return { success: true, message: 'Animal retrieved.', data: result };
  }

  @Put(':id')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Update an animal record' })
  @ApiParam({ name: 'id', description: 'Animal UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateAnimalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.animalService.update(id, dto, tenantId, req.user);
    return { success: true, message: 'Animal updated successfully.', data: result };
  }

  // Declared before ':id/transition-stage' is irrelevant here — the two differ
  // in segment count — but keep it adjacent so the pair stays together.
  @Post('bulk-transition-stage')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Move several animals to a stage at once — the tail-enders a batch-level stage move left behind' })
  async bulkTransitionStage(@Body() dto: BulkTransitionAnimalStageDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.animalService.bulkTransitionStage(dto, tenantId, req.user);
    const message = result.failed.length
      ? `${result.moved} animal(s) moved, ${result.failed.length} could not be moved.`
      : `${result.moved} animal(s) moved.`;
    return { success: true, message, data: result };
  }

  @Post(':id/transition-stage')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Transition an animal to a new production lifecycle stage and pen/location' })
  @ApiParam({ name: 'id', description: 'Animal UUID' })
  async transitionStage(@Param('id') id: string, @Body() dto: TransitionAnimalStageDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.animalService.transitionStage(id, dto, tenantId, req.user);
    return { success: true, message: 'Animal stage transition recorded.', data: result };
  }

  @Patch(':id/dispose')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Dispose an animal (sold/slaughtered/died/transferred) — never physically deleted' })
  @ApiParam({ name: 'id', description: 'Animal UUID' })
  async dispose(@Param('id') id: string, @Body() dto: DisposeAnimalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.animalService.dispose(id, dto, tenantId, req.user);
    return { success: true, message: 'Animal disposal recorded.', data: result };
  }

  @Get(':id/breeding')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: "An animal's matings (from either side) and its farrowings" })
  @ApiParam({ name: 'id', description: 'Animal UUID' })
  async getBreedingHistory(@Param('id') id: string) {
    const result = await this.animalService.getBreedingHistory(id);
    return { success: true, message: 'Breeding history retrieved.', data: result };
  }

  @Get(':id/bio-asset-ledger')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'Get IAS 41 bio-asset ledger history for an animal' })
  @ApiParam({ name: 'id', description: 'Animal UUID' })
  async getBioAssetLedger(@Param('id') id: string) {
    const result = await this.animalService.getBioAssetLedger(id);
    return { success: true, message: 'Bio-asset ledger entries retrieved.', data: result };
  }
}


