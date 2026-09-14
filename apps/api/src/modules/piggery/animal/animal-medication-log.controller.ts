import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AnimalMedicationLogService } from './animal-medication-log.service';
import { RecordMedicationDto } from './dto/animal-medication-log.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Animal Register')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('animal')
export class AnimalMedicationLogController {
  constructor(private readonly medicationLogService: AnimalMedicationLogService) {}

  @Post(':id/medications')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Log a medicine/vaccine administration for an animal — feeds the slaughter withdrawal-period check' })
  @ApiParam({ name: 'id', description: 'Animal UUID' })
  async create(@Param('id') id: string, @Body() dto: RecordMedicationDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.medicationLogService.create(id, dto, tenantId, req.user);
    return { success: true, message: 'Medication administration logged.', data: result };
  }

  @Get(':id/medications')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'Fetch the medication administration history for an animal' })
  @ApiParam({ name: 'id', description: 'Animal UUID' })
  async findByAnimal(@Param('id') id: string) {
    const result = await this.medicationLogService.findByAnimal(id);
    return { success: true, message: 'Medication log retrieved.', data: result };
  }
}
