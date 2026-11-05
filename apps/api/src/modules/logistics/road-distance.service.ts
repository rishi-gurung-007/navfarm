import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../core/database/schema';
import {
  coordinate, DEFAULT_OSRM_BASE_URL, isPoint, osrmDistanceKm, osrmUrl, roundKm, straightLineKm,
  type DistanceResult, type Point,
} from './road-distance';

/** The point a stop's distance is measured from, and what to call it on screen. */
export interface PreviousPoint extends Point {
  label: string;
}

/** A point already on a route, drawn on the stop's map so the next one can be placed against it. */
export interface RouteMark extends Point {
  label: string;
  kind: 'START' | 'END' | 'STOP';
  /** STOP marks only: which stop it is, so the form can leave the one being edited off the map. */
  stopId?: string;
  stopSeq?: number;
}

const OSRM_TIMEOUT_MS = 6000;

/**
 * Works out a route stop's distance from the stop before it (Rishi, 5 Nov). The point before stop 1 is the route's
 * From Zone; for any later stop it is the nearest lower stop number on the same route that has a point of its own.
 */
@Injectable()
export class RoadDistanceService {
  private readonly logger = new Logger(RoadDistanceService.name);

  constructor(private readonly cls: ClsService) {}

  private get db() {
    return this.cls.get<MySql2Database<typeof schema>>('tenantDb');
  }

  private static point(row: { latitude?: unknown; longitude?: unknown } | undefined, label: string): PreviousPoint | null {
    if (!row) return null;
    const latitude = coordinate(row.latitude);
    const longitude = coordinate(row.longitude);
    if (latitude === null || longitude === null) return null;
    const candidate = { latitude, longitude };
    return isPoint(candidate) ? { ...candidate, label } : null;
  }

  async previousPoint(routeId: string, stopSeq: number, tenantId: string): Promise<PreviousPoint | null> {
    const stops = schema.logisticsRouteStop;
    if (stopSeq > 1) {
      const [earlier] = await this.db
        .select({ stop_seq: stops.stop_seq, stop_name: stops.stop_name, latitude: stops.latitude, longitude: stops.longitude })
        .from(stops)
        .where(and(eq(stops.tenant_id, tenantId), eq(stops.route_id, routeId), lt(stops.stop_seq, stopSeq), isNull(stops.deleted_at)))
        .orderBy(desc(stops.stop_seq))
        .limit(1);
      const previous = RoadDistanceService.point(earlier, earlier?.stop_name || `Stop ${earlier?.stop_seq ?? ''}`.trim());
      if (previous) return previous;
    }

    // Stop 1, or an earlier stop with no point of its own: measure from where the route starts.
    const routes = schema.logisticsRoute;
    const zones = schema.logisticsDeliveryZone;
    const [start] = await this.db
      .select({ zone_name: zones.zone_name, latitude: zones.latitude, longitude: zones.longitude })
      .from(routes)
      .innerJoin(zones, eq(zones.zone_id, routes.from_zone_id))
      .where(and(eq(routes.tenant_id, tenantId), eq(routes.route_id, routeId), isNull(routes.deleted_at)))
      .limit(1);
    return RoadDistanceService.point(start, start?.zone_name ? `${start.zone_name} (route start)` : 'Route start');
  }

  /**
   * Every point already on a route: where it starts, where it ends, and each stop in between that has a point
   * (Rishi, 5 Nov). The Stops form draws these so the next stop can be placed by eye against the ones already
   * there, rather than against an empty map.
   */
  async routeMarks(routeId: string, tenantId: string): Promise<RouteMark[]> {
    const routes = schema.logisticsRoute;
    const zones = schema.logisticsDeliveryZone;
    const stops = schema.logisticsRouteStop;
    const marks: RouteMark[] = [];

    const [route] = await this.db
      .select({
        from_name: zones.zone_name,
        from_lat: zones.latitude,
        from_lng: zones.longitude,
        to_zone_id: routes.to_zone_id,
      })
      .from(routes)
      .leftJoin(zones, eq(zones.zone_id, routes.from_zone_id))
      .where(and(eq(routes.tenant_id, tenantId), eq(routes.route_id, routeId), isNull(routes.deleted_at)))
      .limit(1);
    if (!route) return marks;

    const start = RoadDistanceService.point(
      { latitude: route.from_lat, longitude: route.from_lng },
      route.from_name ? `${route.from_name} (start)` : 'Route start',
    );
    if (start) marks.push({ ...start, kind: 'START' });

    const [destination] = await this.db
      .select({ zone_name: zones.zone_name, latitude: zones.latitude, longitude: zones.longitude })
      .from(zones)
      .where(and(eq(zones.tenant_id, tenantId), eq(zones.zone_id, route.to_zone_id)))
      .limit(1);
    const end = RoadDistanceService.point(
      destination,
      destination?.zone_name ? `${destination.zone_name} (destination)` : 'Route destination',
    );
    if (end) marks.push({ ...end, kind: 'END' });

    const existing = await this.db
      .select({
        stop_id: stops.stop_id,
        stop_seq: stops.stop_seq,
        stop_name: stops.stop_name,
        latitude: stops.latitude,
        longitude: stops.longitude,
      })
      .from(stops)
      .where(and(eq(stops.tenant_id, tenantId), eq(stops.route_id, routeId), isNull(stops.deleted_at)))
      .orderBy(stops.stop_seq);
    for (const stop of existing) {
      const point = RoadDistanceService.point(stop, `${stop.stop_seq}. ${stop.stop_name || 'Stop'}`);
      if (point) marks.push({ ...point, kind: 'STOP', stopId: stop.stop_id, stopSeq: stop.stop_seq });
    }
    return marks;
  }

  /**
   * Road distance between two points, falling back to the straight line when the routing service cannot be reached
   * or does not route them. A farm must never be held up by a public map server, so a failure is logged, not thrown.
   */
  async between(from: Point, to: Point): Promise<DistanceResult> {
    const baseUrl = process.env.OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL;
    try {
      const response = await fetch(osrmUrl(baseUrl, from, to), {
        signal: AbortSignal.timeout(OSRM_TIMEOUT_MS),
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const km = osrmDistanceKm(await response.json().catch(() => null));
        if (km !== null) return { km: roundKm(km), source: 'ROAD' };
      }
      this.logger.warn(`Routing service ${baseUrl} did not route the stop; using the straight line.`);
    } catch (error) {
      this.logger.warn(`Routing service ${baseUrl} unreachable (${(error as Error).message}); using the straight line.`);
    }
    return { km: roundKm(straightLineKm(from, to)), source: 'STRAIGHT_LINE' };
  }
}
