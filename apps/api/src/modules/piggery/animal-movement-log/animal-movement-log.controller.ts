import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { AnimalMovementLogService } from './animal-movement-log.service';

// One endpoint, two tabs (HISTORY and LOCATION TRACEABILITY) — both read this
// same list and present/filter it differently client-side, so they can never
// disagree about the same move.
@ApiTags('Animal Movement Log')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('animal')
export class AnimalMovementLogController {
  constructor(private readonly movementLog: AnimalMovementLogService) {}

  @Get(':id/movement-log')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  async list(@Param('id') id: string, @Req() req: any) {
    return {
      success: true,
      data: await this.movementLog.findForAnimal(id, req.user.tenantId),
    };
  }
}
