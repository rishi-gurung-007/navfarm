import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { GiltSelectionService } from './gilt-selection.service';
import { CreateAnimalDto } from '../animal/dto/animal.dto';
import { CreateGiltSelectionDto, CreateGiltsDto, GiltPigletsQueryDto } from './dto/gilt-selection.dto';

@ApiTags('Piggery Gilt Selection')
@ApiBearerAuth()
// Selecting gilts registers animals, so it is gated by the animal permission, like the breeding events.
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('piggery/gilt-selection')
export class GiltSelectionController {
  constructor(private readonly service: GiltSelectionService) {}

  @Get('piglets')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'Get Produced Piglets: the litters whose piglets are in a batch, what is left to select from each, and the value of one head' })
  async piglets(@Query() query: GiltPigletsQueryDto, @Req() req: any) {
    return this.service.getProducedPiglets(query.batch_id, req.user?.tenantId || req['tenantId'], query.as_of);
  }

  @Get('litter/:farrowId')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'The batch a litter\'s piglets are in now (its own lot, or the batch they were weaned into), to open gilt selection from the Breeding page' })
  async litter(@Param('farrowId') farrowId: string, @Req() req: any) {
    return { batch: await this.service.batchOfLitter(farrowId, req.user?.tenantId || req['tenantId']) };
  }

  @Get()
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'List gilt selections' })
  async list(@Req() req: any) {
    return this.service.findAll(req.user?.tenantId || req['tenantId']);
  }

  @Get(':id')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'One gilt selection with its lines and the gilts it created' })
  async one(@Param('id') id: string, @Req() req: any) {
    return this.service.findOne(id, req.user?.tenantId || req['tenantId']);
  }

  @Post()
  @RequirePermission('PIGGERY', 'ANIMAL', 'create')
  @ApiOperation({ summary: 'Save a gilt selection as a draft: the header and how many gilts come from each litter' })
  async create(@Body() dto: CreateGiltSelectionDto, @Req() req: any) {
    return this.service.create(dto, req.user?.tenantId || req['tenantId'], req.user);
  }

  @Get(':id/lines/:lineId/prefill')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  @ApiOperation({ summary: 'What the full animal register form opens with for one gilt of a selection line (lineage, entry, cost per head, placement)' })
  async prefill(@Param('id') id: string, @Param('lineId') lineId: string, @Req() req: any) {
    return this.service.prefillGilt(id, lineId, req.user?.tenantId || req['tenantId']);
  }

  @Post(':id/lines/:lineId/gilt')
  @RequirePermission('PIGGERY', 'ANIMAL', 'create')
  @ApiOperation({ summary: 'Register one gilt of a selection line through the full animal register form (15 teats minimum); the batch loses one head at its value per head' })
  async registerGilt(@Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: CreateAnimalDto, @Req() req: any) {
    return this.service.registerGilt(id, lineId, dto as unknown as Record<string, any>, req.user?.tenantId || req['tenantId'], req.user);
  }

  @Post(':id/create-gilts')
  @RequirePermission('PIGGERY', 'ANIMAL', 'create')
  @ApiOperation({ summary: 'Create Gilts: take each gilt\'s RFID and teat count, reduce the batch, register every gilt (15 teats minimum) and post the selection' })
  async createGilts(@Param('id') id: string, @Body() dto: CreateGiltsDto, @Req() req: any) {
    return this.service.createGilts(id, dto, req.user?.tenantId || req['tenantId'], req.user);
  }

  @Patch(':id/cancel')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Cancel a draft selection' })
  async cancel(@Param('id') id: string, @Req() req: any) {
    return this.service.cancel(id, req.user?.tenantId || req['tenantId'], req.user);
  }
}
