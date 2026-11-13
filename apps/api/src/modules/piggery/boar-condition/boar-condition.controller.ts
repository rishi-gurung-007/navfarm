import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { BoarConditionService } from './boar-condition.service';
import { AssessBoarConditionDto, BoarConditionListQueryDto } from './boar-condition.dto';

@ApiTags('Piggery Boar Body Condition')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('piggery/boar-condition')
export class BoarConditionController {
  constructor(private readonly condition: BoarConditionService) {}

  @Get()
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'Every live boar with his latest body condition score, his feed level and whether his next assessment is due' })
  async list(@Query() query: BoarConditionListQueryDto, @Req() req: any) {
    return { data: await this.condition.list(query, req.user.tenantId) };
  }

  @Get('boars/:boarId/scale')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: "The scale a boar is scored on, whether his feed level may be changed, and where he stands" })
  async scale(@Param('boarId') boarId: string, @Req() req: any) {
    return { data: await this.condition.scaleOf(boarId, req.user.tenantId) };
  }

  @Get('boars/:boarId/history')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  async history(@Param('boarId') boarId: string, @Req() req: any) {
    return { data: await this.condition.history(boarId, req.user.tenantId) };
  }

  @Post()
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: "Record a boar's body condition score; the scale sets his feed level, the action and the health flag" })
  async assess(@Body() dto: AssessBoarConditionDto, @Req() req: any) {
    return { data: await this.condition.assess(dto, req.user.tenantId, req.user) };
  }
}
