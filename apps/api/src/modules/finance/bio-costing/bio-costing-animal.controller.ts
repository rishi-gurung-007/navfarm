import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { BioCostingResidualService } from './bio-costing-residual.service';
import { BioCostingStartService } from './bio-costing-start.service';
import { AssignBioCostingDto } from './bio-costing-assign.dto';

/** What costing says about one animal: her residual (her item's), and giving animals the date their costing starts. */
@ApiTags('Bio-Asset Costing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bio-costing')
export class BioCostingAnimalController {
  constructor(private readonly residuals: BioCostingResidualService, private readonly starts: BioCostingStartService) {}

  private tenant = (req: any): string => req.user?.tenantId || req['tenantId'];
  private company = (req: any): string => req.headers['x-active-company-id'] || req.user?.companyId;

  @Get('animals/:animalId/residual')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'The residual an animal is written down to (her item\'s) and her latest month\'s charge' })
  async animalResidual(@Param('animalId') animalId: string, @Req() req: any) {
    return { success: true, data: await this.residuals.forAnimal(animalId, this.tenant(req)) };
  }

  @Post('assign-animals')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  @ApiOperation({ summary: 'Give animals the date their costing starts, from their item (dry_run reports without writing)' })
  async assign(@Body() dto: AssignBioCostingDto, @Req() req: any) {
    return { success: true, data: await this.starts.assignAnimals(dto, this.tenant(req), this.company(req)) };
  }
}
