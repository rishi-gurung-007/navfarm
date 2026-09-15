import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { BreedingService } from './breeding.service';
import {
  CreateMatingDto,
  UpdatePregCheckDto,
  CreateFarrowingDto,
  UpdateWeaningDto,
  CreateSemenCollectionDto,
} from './dto/breeding.dto';

@ApiTags('Piggery Breeding & Reproduction')
@ApiBearerAuth()
// Breeding events write parity, piglet counts and status onto animal_register,
// so they are gated by the animal permission rather than a separate resource
// the roles screen does not have.
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('piggery/breeding')
export class BreedingController {
  constructor(private readonly breedingService: BreedingService) {}

  // ==========================================
  // MATING & INSEMINATION
  // ==========================================

  @Post('mating')
  @RequirePermission('PIGGERY', 'ANIMAL', 'create')
  @ApiOperation({ summary: "Record sow mating or AI insemination event with auto-scheduled farrowing date (sow's breed gestation_days, else 116)" })
  async recordMating(@Body() dto: CreateMatingDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return await this.breedingService.recordMating(dto, tenantId, req.user);
  }

  @Patch('mating/:id/preg-check')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Record pregnancy confirmation ultrasound check result' })
  async recordPregnancyCheck(
    @Param('id') id: string,
    @Body() dto: UpdatePregCheckDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return await this.breedingService.recordPregnancyCheck(id, dto, tenantId, req.user);
  }

  @Get('mating')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'List sow mating records with upcoming farrowing countdowns' })
  async getMatingRecords(@Req() req: any, @Query('company_id') companyId?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return await this.breedingService.getMatingRecords(tenantId, companyId);
  }

  // ==========================================
  // FARROWING & LITTERS
  // ==========================================

  @Post('farrowing')
  @RequirePermission('PIGGERY', 'ANIMAL', 'create')
  @ApiOperation({ summary: 'Record sow farrowing event, live birth counts, and increment parity' })
  async recordFarrowing(@Body() dto: CreateFarrowingDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return await this.breedingService.recordFarrowing(dto, tenantId, req.user);
  }

  @Patch('farrowing/:id/weaning')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Record litter weaning outcome, survival rate, and return sow to active' })
  async recordWeaning(
    @Param('id') id: string,
    @Body() dto: UpdateWeaningDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return await this.breedingService.recordWeaning(id, dto, tenantId, req.user);
  }

  @Get('farrowing')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'List farrowing records with litter weights and survival rates' })
  async getFarrowingRecords(@Req() req: any, @Query('company_id') companyId?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return await this.breedingService.getFarrowingRecords(tenantId, companyId);
  }

  // ==========================================
  // BOAR SEMEN AI STATION
  // ==========================================

  @Post('semen-collection')
  @RequirePermission('PIGGERY', 'ANIMAL', 'create')
  @ApiOperation({ summary: 'Record boar semen collection and compute unit cost per dose' })
  async recordSemenCollection(@Body() dto: CreateSemenCollectionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return await this.breedingService.recordSemenCollection(dto, tenantId, req.user);
  }

  @Get('semen-collection')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'List boar semen collections and doses inventory' })
  async getSemenBatches(@Req() req: any, @Query('company_id') companyId?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return await this.breedingService.getSemenBatches(tenantId, companyId);
  }
}
