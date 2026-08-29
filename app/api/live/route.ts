import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

const TRIP_UPDATES_URL = 'https://gotriangle.tripsparkhost.com/gtfs/Realtime/GTFS_TripUpdates.pb';
const VEHICLE_POSITIONS_URL = 'https://gotriangle.tripsparkhost.com/gtfs/Realtime/GTFS_VehiclePositions.pb';
const ROUTE_ID = '3629';

const targets = {
  outbound: { directionId: 1, stopId: '12228', event: 'arrival' as const },
  return: { directionId: 0, stopId: '1733', event: 'departure' as const },
};

type DirectionKey = keyof typeof targets;
type FeedEntity = any;

function seconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function latestDelayBefore(updates: any[], sequence: number): number | null {
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index];
    if (Number(update.stopSequence ?? 0) > sequence) continue;
    const delay = update.arrival?.delay ?? update.departure?.delay;
    if (delay !== null && delay !== undefined) return Number(delay);
  }
  return null;
}

async function ensureSchema() {
  if (!env.DB) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observed_at INTEGER NOT NULL,
      feed_timestamp INTEGER NOT NULL,
      trip_id TEXT NOT NULL,
      route_id TEXT NOT NULL,
      direction_id INTEGER NOT NULL,
      stop_id TEXT NOT NULL,
      predicted_time INTEGER NOT NULL,
      delay_seconds INTEGER,
      vehicle_id TEXT,
      vehicle_lat REAL,
      vehicle_lon REAL
    )`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_unique_sample
      ON observations(observed_at, trip_id, stop_id, predicted_time)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_observations_direction_time
      ON observations(direction_id, observed_at)`),
    env.DB.prepare('PRAGMA optimize'),
  ]);
}

async function saveObservations(rows: any[]) {
  if (!env.DB || rows.length === 0) return;
  await ensureSchema();
  await env.DB.batch(rows.map((row) => env.DB.prepare(`INSERT OR IGNORE INTO observations
    (observed_at, feed_timestamp, trip_id, route_id, direction_id, stop_id, predicted_time, delay_seconds, vehicle_id, vehicle_lat, vehicle_lon)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.observedAt, row.feedTimestamp, row.tripId, ROUTE_ID, row.directionId, row.stopId, row.predictedTime, row.delaySeconds, row.vehicleId, row.latitude, row.longitude)));
}

export async function GET() {
  try {
    const [tripResponse, vehicleResponse] = await Promise.all([
      fetch(TRIP_UPDATES_URL, { headers: { accept: 'application/x-protobuf' }, cache: 'no-store' }),
      fetch(VEHICLE_POSITIONS_URL, { headers: { accept: 'application/x-protobuf' }, cache: 'no-store' }),
    ]);
    if (!tripResponse.ok) throw new Error(`GoTriangle trip feed is unavailable (${tripResponse.status})`);

    const tripBytes = await tripResponse.arrayBuffer();
    const vehicleBytes = vehicleResponse.ok ? await vehicleResponse.arrayBuffer() : null;
    const tripFeed: any = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(tripBytes));
    const vehicleFeed: any = vehicleBytes
      ? GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(vehicleBytes))
      : { entity: [] };
    const feedTimestamp = seconds(tripFeed.header.timestamp) ?? Math.floor(Date.now() / 1000);
    const observedAt = Math.floor(Date.now() / 1000);

    const vehicles = new Map<string, any>();
    for (const entity of vehicleFeed.entity as FeedEntity[]) {
      const position = entity.vehicle;
      if (position?.trip?.routeId !== ROUTE_ID || !position.trip.tripId) continue;
      vehicles.set(position.trip.tripId, position);
    }

    const result: Record<DirectionKey, any[]> = { outbound: [], return: [] };
    const rows: any[] = [];
    for (const entity of tripFeed.entity as FeedEntity[]) {
      const update = entity.tripUpdate;
      if (!update || update.trip?.routeId !== ROUTE_ID) continue;
      const key = (Object.keys(targets) as DirectionKey[]).find((candidate) => targets[candidate].directionId === update.trip.directionId);
      if (!key) continue;
      const target = targets[key];
      const stopUpdate = update.stopTimeUpdate?.find((item: any) => item.stopId === target.stopId);
      if (!stopUpdate) continue;
      const event = stopUpdate[target.event] ?? stopUpdate.arrival ?? stopUpdate.departure;
      const predictedTime = seconds(event?.time);
      if (!predictedTime || predictedTime < observedAt - 180 || predictedTime > observedAt + 6 * 3600) continue;
      const vehicle = vehicles.get(update.trip.tripId);
      const delaySeconds = event?.delay ?? latestDelayBefore(update.stopTimeUpdate, Number(stopUpdate.stopSequence ?? 0));
      const item = {
        tripId: update.trip.tripId,
        predictedTime,
        delaySeconds: delaySeconds === null || delaySeconds === undefined ? null : Number(delaySeconds),
        vehicleId: vehicle?.vehicle?.label ?? vehicle?.vehicle?.id ?? update.vehicle?.label ?? null,
        latitude: vehicle?.position?.latitude ?? null,
        longitude: vehicle?.position?.longitude ?? null,
        hasVehicle: Boolean(vehicle),
      };
      result[key].push(item);
      rows.push({ ...item, observedAt, feedTimestamp, directionId: target.directionId, stopId: target.stopId });
    }

    result.outbound.sort((a, b) => a.predictedTime - b.predictedTime);
    result.return.sort((a, b) => a.predictedTime - b.predictedTime);
    await saveObservations(rows.slice(0, 12));

    return Response.json({ fetchedAt: observedAt, feedTimestamp, directions: result }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load arrivals' }, { status: 503 });
  }
}
