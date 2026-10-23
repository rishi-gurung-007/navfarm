import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { BioCostingProfileService } from './bio-costing-profile.service';
import { BioCostingResidualService } from './bio-costing-residual.service';
import { CreateResidualSettingDto, SetAnimalResidualDto } from './bio-costing-residual.dto';
import {
  AssignBioCostingDto, CreateBioCostingProfileDto, CreateBioCostingRateDto, NewBioCostingProfileVersionDto,
  QueryBioCostingProfileDto, ResolveBioCostingProfileDto, UpdateBioCostingProfileDto,
} from './bio-costing-profile.dto';

/**
 * Central bio-asset costing profiles. Company-level finance setup, so it is exempt from farm scoping like the GL mappings it sits
 * beside, and uses their permission (MASTER_DATA / GL_MAPPING): whoever may maintain the GL mappings may maintain these.
 */
@ApiTags('Bio-Asset Costing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bio-costing')
export class BioCostingProfileController {
  constructor(private readonly profiles: BioCostingProfileService, private readonly residuals: BioCostingResidualService) {}

  private tenant = (req: any): string => req.user?.tenantId || req['tenantId'];
  private company = (req: any, explicit?: string): string => explicit || req.headers['x-active-company-id'] || req.user?.companyId;

  @Get('profiles')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'view')
  @ApiOperation({ summary: 'Costing profiles of the active company' })
  async list(@Query() q: QueryBioCostingProfileDto, @Req() req: any) {
    return { success: true, data: await this.profiles.findAll(q, this.tenant(req), this.company(req)) };
  }

  @Get('profiles/resolve')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'view')
  @ApiOperation({ summary: 'Which active profile an animal with these facts is costed by' })
  async resolve(@Query() q: ResolveBioCostingProfileDto, @Req() req: any) {
    return { success: true, data: await this.profiles.resolveFor(q, this.tenant(req), this.company(req, q.companyId)) };
  }

  @Get('profiles/:id')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'view')
  async one(@Param('id') id: string, @Req() req: any) {
    return { success: true, data: await this.profiles.findOne(id, this.tenant(req)) };
  }

  @Post('profiles')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  @ApiOperation({ summary: 'Create a costing profile (a draft until it is activated)' })
  async create(@Body() dto: CreateBioCostingProfileDto, @Req() req: any) {
    return { success: true, message: 'Costing profile created.', data: await this.profiles.create(dto, this.tenant(req), this.company(req, dto.company_id), req.user?.userId) };
  }

  @Put('profiles/:id')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  @ApiOperation({ summary: 'Change a profile; its terms are locked once an animal is costed by it' })
  async update(@Param('id') id: string, @Body() dto: UpdateBioCostingProfileDto, @Req() req: any) {
    return { success: true, message: 'Costing profile updated.', data: await this.profiles.update(id, dto, this.tenant(req), req.user?.userId) };
  }

  @Post('profiles/:id/activate')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  async activate(@Param('id') id: string, @Req() req: any) {
    return { success: true, message: 'Costing profile activated.', data: await this.profiles.activate(id, this.tenant(req), req.user?.userId) };
  }

  @Post('profiles/:id/deactivate')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  async deactivate(@Param('id') id: string, @Req() req: any) {
    return { success: true, message: 'Costing profile deactivated.', data: await this.profiles.deactivate(id, this.tenant(req), req.user?.userId) };
  }

  @Post('profiles/:id/new-version')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  @ApiOperation({ summary: 'New terms from a new effective date; the old profile is superseded and keeps the animals it already costs' })
  async newVersion(@Param('id') id: string, @Body() dto: NewBioCostingProfileVersionDto, @Req() req: any) {
    return { success: true, message: 'New version created.', data: await this.profiles.newVersion(id, dto, this.tenant(req), req.user?.userId) };
  }

  @Post('profiles/:id/rates')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  @ApiOperation({ summary: 'Add a dated fair-value rate (expected weight and price per kg); rates are never locked' })
  async addRate(@Param('id') id: string, @Body() dto: CreateBioCostingRateDto, @Req() req: any) {
    return { success: true, message: 'Rate added.', data: await this.profiles.addRate(id, dto, this.tenant(req), req.user?.userId) };
  }

  @Get('residual-settings')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'view')
  @ApiOperation({ summary: 'The company\'s residual value settings (per sex, from a date), each with the figure it works out to' })
  async residualSettings(@Req() req: any) {
    return { success: true, data: await this.residuals.list(this.tenant(req), this.company(req)) };
  }

  @Post('residual-settings')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  @ApiOperation({ summary: 'Set the company\'s residual value for a sex from a date; a change is a new row with a later date' })
  async addResidualSetting(@Body() dto: CreateResidualSettingDto, @Req() req: any) {
    return { success: true, message: 'Residual value setting saved.', data: await this.residuals.add(dto, this.tenant(req), this.company(req), req.user?.userId) };
  }

  @Get('animals/:animalId/residual')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'The residual an animal is written down to today and where it comes from (her own, or the company setting)' })
  async animalResidual(@Param('animalId') animalId: string, @Req() req: any) {
    return { success: true, data: await this.residuals.forAnimal(animalId, this.tenant(req)) };
  }

  @Put('animals/:animalId/residual')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Give an animal her own residual (or clear it), with a reason; applies from the next unposted month' })
  async setAnimalResidual(@Param('animalId') animalId: string, @Body() dto: SetAnimalResidualDto, @Req() req: any) {
    return { success: true, message: 'Animal residual saved.', data: await this.residuals.setForAnimal(animalId, dto, this.tenant(req), req.user?.userId) };
  }

  @Post('assign-animals')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  @ApiOperation({ summary: 'Assign the matching profile to animals that have none (dry_run reports without writing)' })
  async assign(@Body() dto: AssignBioCostingDto, @Req() req: any) {
    return { success: true, data: await this.profiles.assignAnimals(dto, this.tenant(req), this.company(req)) };
  }
}
