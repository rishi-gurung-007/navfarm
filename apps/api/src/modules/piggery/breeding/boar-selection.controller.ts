import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { BoarSelectionService } from './boar-selection.service';
import { BoarSelectionQueryDto, ImportBoarTsiDto, RecordBoarTsiDto } from './boar-selection.dto';

@ApiTags('Piggery Boar Selection')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('piggery/boar-selection')
export class BoarSelectionController {
  constructor(private readonly selection: BoarSelectionService) {}

  @Get('lines')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'The breeding lines (breeds) that have live boars, with how many' })
  async lines(@Req() req: any, @Query('company_id') companyId?: string) {
    return { data: await this.selection.lines(req.user.tenantId, companyId) };
  }

  @Get()
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: "A line's boars with TSI, genetic level, last collection, ranks and overall grading, as its setup configures them" })
  async get(@Query() query: BoarSelectionQueryDto, @Req() req: any) {
    return { data: await this.selection.selection(query.breed_id, req.user.tenantId, query.as_of?.slice(0, 10), query.company_id) };
  }

  @Post('tsi')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: "Record a boar's TSI (and the genetic rank published with it) as of a date" })
  async recordTsi(@Body() dto: RecordBoarTsiDto, @Req() req: any) {
    return { data: await this.selection.recordTsi(dto, req.user.tenantId, req.user) };
  }

  @Post('tsi/import')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Record the TSI of many boars by animal code, all or nothing' })
  async importTsi(@Body() dto: ImportBoarTsiDto, @Req() req: any) {
    return { data: await this.selection.importTsi(dto, req.user.tenantId, req.user) };
  }
}
