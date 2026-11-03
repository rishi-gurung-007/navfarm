import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { CollectionPlanService } from './collection-plan.service';
import { CreateCollectionPlanDto, QueryCollectionPlansDto, ReasonDto } from './collection-plan.dto';

@ApiTags('Piggery Semen Collection Plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('piggery/collection-plans')
export class CollectionPlanController {
  constructor(private readonly plans: CollectionPlanService) {}

  @Get()
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'Planned semen collections, with their boars' })
  async list(@Query() query: QueryCollectionPlansDto, @Req() req: any) {
    return { data: await this.plans.list(query, req.user.tenantId) };
  }

  @Get(':id')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  async get(@Param('id') id: string, @Req() req: any) {
    return { data: await this.plans.findOne(id, req.user.tenantId) };
  }

  @Post()
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: "Plan a collection: a line's boars for a day, checked against the line's setup" })
  async create(@Body() dto: CreateCollectionPlanDto, @Req() req: any) {
    return { data: await this.plans.create(dto, req.user.tenantId, req.user) };
  }

  @Post(':id/cancel')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  async cancel(@Param('id') id: string, @Body() dto: ReasonDto, @Req() req: any) {
    return { data: await this.plans.cancel(id, dto.reason, req.user.tenantId) };
  }

  @Post(':id/boars/:boarId/skip')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  async skip(@Param('id') id: string, @Param('boarId') boarId: string, @Body() dto: ReasonDto, @Req() req: any) {
    return { data: await this.plans.skipLine(id, boarId, dto.reason, req.user.tenantId) };
  }
}
