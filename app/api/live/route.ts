import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { env } from 'cloudflare:workers';
import mlModel from '../../data/ml-model.json';
import route100Schedule from '../../data/route100-schedule.json';

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
type ScheduleEntry = { direction: number; stopId: string; clock: string; scheduledMin: number };
type ModelDirection = { direction: number; coefficients: number[]; residualP10Min: number; residualP90Min: number };

const scheduleByTrip = route100Schedule as Record<string, ScheduleEntry>;
const modelByDirection = new Map<number, ModelDirection>(
  (mlModel.directions as ModelDirection[]).map((direction) => [direction.direction, direction]),
);
const localClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function seconds(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function localMinute(epochSeconds: number): number {
  const parts = Object.fromEntries(localClock.formatToParts(epochSeconds * 1000).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
}

function learnedPrediction(item: { tripId: string; predictedTime: number; hasVehicle: boolean }, direction: number, observedAt: number) {
  const schedule = scheduleByTrip[item.tripId];
  const model = modelByDirection.get(direction);
  if (!schedule || !model || schedule.direction !== direction || model.coefficients.length < 4) return null;
  const firstOffsetMin = localMinute(item.predictedTime) - schedule.scheduledMin;
  const features = [1, schedule.scheduledMin / 1440, firstOffsetMin / 60, item.hasVehicle ? 1 : 0];
  const offsetMin = model.coefficients.reduce((sum, coefficient, index) => sum + coefficient * features[index], 0);
  const scheduledEpoch = observedAt + (schedule.scheduledMin - localMinute(observedAt)) * 60;
  const mlPredictedTime = Math.round(scheduledEpoch + offsetMin * 60);
  const mlLowerTime = Math.round(mlPredictedTime + model.residualP10Min * 60);
  const mlUpperTime = Math.round(mlPredictedTime + model.residualP90Min * 60);
  // The morning live feed currently beats Ridge in validation; keep it primary
  // while using the learned range. The afternoon Ridge model is primary.
  const predictionSource = direction === 1 ? 'live' : 'learned';
  return {
    scheduleTime: Math.round(scheduledEpoch),
    firstOffsetMin,
    mlPredictedTime,
    mlLowerTime,
    mlUpperTime,
    primaryPredictedTime: predictionSource === 'learned' ? mlPredictedTime : item.predictedTime,
    predictionSource,
    modelVersion: mlModel.version,
    modelGeneratedAt: mlModel.generatedAt,
  };
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
      const learned = learnedPrediction(item, target.directionId, observedAt);
      result[key].push({ ...item, ...(learned || {
        primaryPredictedTime: predictedTime,
        predictionSource: 'live',
        modelVersion: null,
        modelGeneratedAt: null,
      }) });
      rows.push({ ...item, observedAt, feedTimestamp, directionId: target.directionId, stopId: target.stopId });
    }

    result.outbound.sort((a, b) => a.primaryPredictedTime - b.primaryPredictedTime);
    result.return.sort((a, b) => a.primaryPredictedTime - b.primaryPredictedTime);
    await saveObservations(rows.slice(0, 12));

    return Response.json({ fetchedAt: observedAt, feedTimestamp, model: { version: mlModel.version, generatedAt: mlModel.generatedAt }, directions: result }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to load arrivals' }, { status: 503 });
  }
}
