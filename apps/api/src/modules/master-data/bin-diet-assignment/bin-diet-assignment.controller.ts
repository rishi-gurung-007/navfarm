import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { BinDietAssignmentService } from './bin-diet-assignment.service';
import { CreateBinDietAssignmentDto, QueryBinDietAssignmentDto, UpdateBinDietAssignmentDto } from './dto/bin-diet-assignment.dto';

@ApiTags('BIN Diet Assignment Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bin-diet-assignment')
export class BinDietAssignmentController {
  constructor(private readonly assignments: BinDietAssignmentService) {}

  @Get()
  @RequirePermission('MASTER_DATA', 'BIN_DIET_ASSIGNMENT', 'view')
  async list(@Query() query: QueryBinDietAssignmentDto, @Req() req: any) {
    return { data: await this.assignments.findAll(query, req.user.tenantId) };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'BIN_DIET_ASSIGNMENT', 'view')
  async get(@Param('id') id: string, @Req() req: any) {
    return { data: await this.assignments.findOne(id, req.user.tenantId) };
  }

  @Post()
  @RequirePermission('MASTER_DATA', 'BIN_DIET_ASSIGNMENT', 'create')
  async create(@Body() dto: CreateBinDietAssignmentDto, @Req() req: any) {
    return { data: await this.assignments.create(dto, req.user.tenantId, req.user) };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'BIN_DIET_ASSIGNMENT', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateBinDietAssignmentDto, @Req() req: any) {
    return { data: await this.assignments.update(id, dto, req.user.tenantId, req.user) };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'BIN_DIET_ASSIGNMENT', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) {
    return { data: await this.assignments.deactivate(id, req.user.tenantId, req.user) };
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'BIN_DIET_ASSIGNMENT', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) {
    return { data: await this.assignments.restore(id, req.user.tenantId, req.user) };
  }
}
