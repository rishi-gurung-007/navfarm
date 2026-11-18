import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../common/farm-scope';
import { LogisticsTripService } from './logistics-trip.service';

class DispatchQueryDto {
  @IsOptional() @IsString() days?: string;
}

class TripListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
}

/**
 * Logistics trips (Phase 2) under /logistics/trip, guarded by module LOGISTICS, resource TRIP. Bodies are checked by
 * the service, which names every problem in plain words, as the Phase 1 masters do. Farm-scoped only so the guard
 * resolves the caller's company boundary: a trip is a company document that may serve several farms.
 */
@ApiTags('Logistics') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('logistics/trip')
export class LogisticsTripController {
  constructor(private readonly trips: LogisticsTripService) {}

  @Get() @RequirePermission('LOGISTICS', 'TRIP', 'view')
  list(@Query() query: TripListQueryDto, @Req() req: any) {
    return this.trips.findAll(query, req.user.tenantId);
  }

  /** Declared before ':id' so "dispatch" is not read as a trip id. */
  @Get('dispatch') @RequirePermission('LOGISTICS', 'TRIP', 'view')
  async dispatch(@Query() query: DispatchQueryDto, @Req() req: any) {
    return { data: await this.trips.dispatchBoard(query, req.user.tenantId) };
  }

  @Post('plan') @RequirePermission('LOGISTICS', 'TRIP', 'create')
  async plan(@Body() body: Record<string, any>, @Req() req: any) {
    return { data: await this.trips.plan(body as never, req.user.tenantId, req.user) };
  }

  /** Phase 3: a trip for one cross-farm livestock batch transfer (a LIVESTOCK truck, loaded in head). */
  @Post('plan-batch-transfer') @RequirePermission('LOGISTICS', 'TRIP', 'create')
  async planBatchTransfer(@Body() body: Record<string, any>, @Req() req: any) {
    return { data: await this.trips.planBatchTransfer(body as never, req.user.tenantId, req.user) };
  }

  @Get(':id') @RequirePermission('LOGISTICS', 'TRIP', 'view')
  async get(@Param('id') id: string, @Req() req: any) {
    return { data: await this.trips.findOne(id, req.user.tenantId) };
  }

  @Get(':id/find-vehicle') @RequirePermission('LOGISTICS', 'TRIP', 'view')
  async findVehicle(@Param('id') id: string, @Req() req: any) {
    return { data: await this.trips.findVehicle(id, req.user.tenantId) };
  }

  @Put(':id/assign') @RequirePermission('LOGISTICS', 'TRIP', 'edit')
  async assign(@Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return { data: await this.trips.assign(id, body as never, req.user.tenantId, req.user) };
  }

  @Post(':id/move') @RequirePermission('LOGISTICS', 'TRIP', 'edit')
  async move(@Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return { data: await this.trips.move(id, body as never, req.user.tenantId, req.user) };
  }

  @Post(':id/cancel') @RequirePermission('LOGISTICS', 'TRIP', 'edit')
  async cancel(@Param('id') id: string, @Body() body: Record<string, any>, @Req() req: any) {
    return { data: await this.trips.cancel(id, body ?? {}, req.user.tenantId, req.user) };
  }
}
