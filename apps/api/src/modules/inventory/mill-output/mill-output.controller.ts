import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { CreateMillOutputDto, QueryMillOutputDto } from './dto/mill-output.dto';
import { MillOutputService } from './mill-output.service';

@ApiTags('Mill Production Output')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('mill-output')
export class MillOutputController {
  constructor(private readonly service: MillOutputService) {}

  @Get('assignments')
  @RequirePermission('INVENTORY', 'MILL_OUTPUT', 'view')
  @ApiOperation({
    summary:
      'BIN diet assignments of a production date — the BINs and feeds the mill may produce into',
  })
  async assignments(@Query() query: QueryMillOutputDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.service.listAssignments(tenantId, query);
    return {
      success: true,
      message: 'BIN assignments retrieved successfully.',
      data,
    };
  }

  @Get()
  @RequirePermission('INVENTORY', 'MILL_OUTPUT', 'view')
  @ApiOperation({ summary: 'Mill production outputs, newest first' })
  async list(@Query() query: QueryMillOutputDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.service.list(tenantId, query);
    return {
      success: true,
      message: 'Mill production outputs retrieved successfully.',
      data,
    };
  }

  @Post()
  @RequirePermission('INVENTORY', 'MILL_OUTPUT', 'create')
  @ApiOperation({
    summary:
      'Post feed the mill produced into a BIN: stock at standard cost, journal by the MILL_OUTPUT mapping',
  })
  async create(@Body() dto: CreateMillOutputDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.service.create(dto, tenantId, req.user);
    return {
      success: true,
      message: `Mill output ${data?.output_no ?? ''} posted.`,
      data,
    };
  }
}
