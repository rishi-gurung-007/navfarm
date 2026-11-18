import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RoadDistanceService } from './road-distance.service';

export class RouteMarksQueryDto {
  @IsUUID() routeId!: string;
  /** The stop being edited: left off the map, since its own point is the one being placed. */
  @IsOptional() @IsUUID() excludeStopId?: string;
  @IsOptional() @IsUUID() companyId?: string;
}

export class RouteStopDistanceQueryDto {
  @IsUUID() routeId!: string;
  @Type(() => Number) @IsNumber() @Min(1) stopSeq!: number;
  @Type(() => Number) @IsLatitude() latitude!: number;
  @Type(() => Number) @IsLongitude() longitude!: number;
  @IsOptional() @IsUUID() companyId?: string;
}

/**
 * How far a route stop is from the stop before it, by road (Rishi, 5 Nov). Its own path, not a sub-route of
 * /logistics/route-stop, so it cannot be mistaken for that master's `:id` route.
 *
 * The answer says whether it came from the road network or from the straight line, so the form can tell someone
 * which they are looking at. The number it returns is a suggestion: the field stays editable.
 */
@ApiTags('Logistics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('logistics/route-distance')
export class RoadDistanceController {
  constructor(private readonly distances: RoadDistanceService) {}

  @Get('route-stop')
  @RequirePermission('LOGISTICS', 'ROUTE', 'view')
  async forRouteStop(@Query() query: RouteStopDistanceQueryDto, @Req() req: any) {
    const from = await this.distances.previousPoint(query.routeId, query.stopSeq, req.user.tenantId);
    if (!from) {
      throw new BadRequestException(
        'There is no point to measure from yet. Give the route\'s From Zone a map point, or put a point on the stop before this one.',
      );
    }
    const to = { latitude: query.latitude, longitude: query.longitude };
    const distance = await this.distances.between(from, to);
    return { data: { ...distance, from } };
  }

  /**
   * The points already on a route — its start, its destination, and the stops in between — so the Stops form can
   * draw them and the next stop can be placed against them rather than onto an empty map (Rishi, 5 Nov).
   */
  @Get('route-marks')
  @RequirePermission('LOGISTICS', 'ROUTE', 'view')
  async forRoute(@Query() query: RouteMarksQueryDto, @Req() req: any) {
    const marks = await this.distances.routeMarks(query.routeId, req.user.tenantId);
    return { data: marks.filter((m) => !query.excludeStopId || m.stopId !== query.excludeStopId) };
  }
}
