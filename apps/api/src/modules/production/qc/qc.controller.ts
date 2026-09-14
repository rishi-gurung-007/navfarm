import { Controller, Get, Post, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { QcService } from './qc.service';
import { CreateQcDto, QueryQcDto } from './dto/qc.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('QC Inspections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('qc')
export class QcController {
  constructor(private readonly qcService: QcService) {}

  @Post()
  @RequirePermission('PRODUCTION', 'QC', 'create')
  @ApiOperation({ summary: 'Record a QC inspection against a batch output — auto-determines PASS/FAIL per parameter and overall result' })
  async create(@Body() dto: CreateQcDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.qcService.create(dto, tenantId, req.user);
    return { success: true, message: 'QC inspection recorded successfully.', data: result };
  }

  @Get()
  @RequirePermission('PRODUCTION', 'QC', 'view')
  @ApiOperation({ summary: 'List QC inspections matching filters' })
  async findAll(@Query() query: QueryQcDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.qcService.findAll(query, tenantId);
    return { success: true, message: 'QC inspections retrieved successfully.', data: result };
  }

  @Get(':id')
  @RequirePermission('PRODUCTION', 'QC', 'view')
  @ApiOperation({ summary: 'Fetch a QC inspection with its parameter results' })
  @ApiParam({ name: 'id', description: 'QC UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.qcService.findOne(id);
    return { success: true, message: 'QC inspection retrieved.', data: result };
  }
}
