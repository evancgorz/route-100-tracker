import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const ROUTE_ID = '3629';
const TRIP_UPDATES_URL = 'https://gotriangle.tripsparkhost.com/gtfs/Realtime/GTFS_TripUpdates.pb';
const VEHICLE_POSITIONS_URL = 'https://gotriangle.tripsparkhost.com/gtfs/Realtime/GTFS_VehiclePositions.pb';
const TARGETS = new Map([
  [1, { stopId: '12228', eventType: 'arrival' }],
  [0, { stopId: '1733', eventType: 'departure' }],
]);

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.ROUTE100_DB_PATH || resolve(scriptDirectory, '..', '..', 'work', 'route100-history.sqlite');
const logPath = process.env.ROUTE100_LOG_PATH || resolve(scriptDirectory, '..', '..', 'work', 'route100-collector.log');
mkdirSync(dirname(databasePath), { recursive: true });
mkdirSync(dirname(logPath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observed_at INTEGER NOT NULL,
    feed_timestamp INTEGER NOT NULL,
    trip_id TEXT NOT NULL,
    route_id TEXT NOT NULL,
    direction_id INTEGER NOT NULL,
    stop_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    predicted_time INTEGER NOT NULL,
    delay_seconds INTEGER,
    vehicle_id TEXT,
    vehicle_lat REAL,
    vehicle_lon REAL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_unique_sample
    ON observations(observed_at, trip_id, stop_id, predicted_time);
  CREATE INDEX IF NOT EXISTS idx_observations_direction_time
    ON observations(direction_id, observed_at);
  CREATE TABLE IF NOT EXISTS collector_runs (
    collected_at INTEGER PRIMARY KEY,
    feed_timestamp INTEGER,
    rows_saved INTEGER NOT NULL,
    error TEXT
  );
  PRAGMA optimize;
`);

const insertObservation = database.prepare(`INSERT OR IGNORE INTO observations
  (observed_at, feed_timestamp, trip_id, route_id, direction_id, stop_id, event_type, predicted_time, delay_seconds, vehicle_id, vehicle_lat, vehicle_lon)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insertRun = database.prepare(`INSERT OR REPLACE INTO collector_runs
  (collected_at, feed_timestamp, rows_saved, error) VALUES (?, ?, ?, ?)`);

function numeric(value) {
  if (value === null || value === undefined) return null;
  const result = Number(String(value));
  return Number.isFinite(result) ? result : null;
}

function latestDelayBefore(updates, sequence) {
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index];
    if (Number(update.stopSequence ?? 0) > sequence) continue;
    const delay = update.arrival?.delay ?? update.departure?.delay;
    if (delay !== null && delay !== undefined) return Number(delay);
  }
  return null;
}

async function readFeed(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/x-protobuf' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
    new Uint8Array(await response.arrayBuffer()),
  );
}

async function collect(directionFilter = null) {
  const observedAt = Math.floor(Date.now() / 1000);
  try {
    const tripFeed = await readFeed(TRIP_UPDATES_URL);
    let vehicleFeed = { entity: [] };
    try {
      vehicleFeed = await readFeed(VEHICLE_POSITIONS_URL);
    } catch {
      // Predictions remain useful when the optional vehicle feed is briefly absent.
    }

    const feedTimestamp = numeric(tripFeed.header.timestamp) ?? observedAt;
    const vehicles = new Map();
    for (const entity of vehicleFeed.entity) {
      const vehicle = entity.vehicle;
      if (vehicle?.trip?.routeId === ROUTE_ID && vehicle.trip.tripId) {
        vehicles.set(vehicle.trip.tripId, vehicle);
      }
    }

    let rowsSaved = 0;
    database.exec('BEGIN');
    try {
      for (const entity of tripFeed.entity) {
        const update = entity.tripUpdate;
        if (!update || update.trip?.routeId !== ROUTE_ID) continue;
        const directionId = Number(update.trip.directionId);
        if (directionFilter !== null && directionId !== directionFilter) continue;
        const target = TARGETS.get(directionId);
        if (!target) continue;
        const stopUpdate = update.stopTimeUpdate?.find((item) => item.stopId === target.stopId);
        if (!stopUpdate) continue;
        const event = stopUpdate[target.eventType] ?? stopUpdate.arrival ?? stopUpdate.departure;
        const predictedTime = numeric(event?.time);
        if (!predictedTime || predictedTime < observedAt - 300 || predictedTime > observedAt + 8 * 3600) continue;
        const vehicle = vehicles.get(update.trip.tripId);
        const delay = event?.delay ?? latestDelayBefore(update.stopTimeUpdate, Number(stopUpdate.stopSequence ?? 0));
        const result = insertObservation.run(
          observedAt,
          feedTimestamp,
          update.trip.tripId,
          ROUTE_ID,
          directionId,
          target.stopId,
          target.eventType,
          predictedTime,
          delay === null || delay === undefined ? null : Number(delay),
          vehicle?.vehicle?.label ?? vehicle?.vehicle?.id ?? update.vehicle?.label ?? null,
          vehicle?.position?.latitude ?? null,
          vehicle?.position?.longitude ?? null,
        );
        rowsSaved += Number(result.changes);
      }
      insertRun.run(observedAt, feedTimestamp, rowsSaved, null);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return rowsSaved;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    insertRun.run(observedAt, null, 0, message.slice(0, 500));
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
    return 0;
  }
}

function activeDirection(date = new Date()) {
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const morning = minuteOfDay >= 6 * 60 + 45 && minuteOfDay <= 7 * 60 + 45;
  const afternoon = minuteOfDay >= 15 * 60 && minuteOfDay <= 16 * 60;
  if (morning) return 1;
  if (afternoon) return 0;
  return null;
}

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

const runOnce = process.argv.includes('--once');
const startedAt = new Date();
const startingDirection = activeDirection(startedAt);
appendFileSync(logPath, `${startedAt.toISOString()} collector started${runOnce ? ' (--once)' : ''}\n`, 'utf8');

if (runOnce) {
  await collect();
} else if (startingDirection === null) {
  appendFileSync(logPath, `${new Date().toISOString()} outside collection window; exiting\n`, 'utf8');
} else {
  // Scheduled tasks launch at the start of each collection window. Keep this
  // process bounded to that window so the afternoon run never depends on the
  // morning process (or vice versa).
  while (!stopping && activeDirection() === startingDirection) {
    const cycleStartedAt = Date.now();
    await collect(startingDirection);
    const remaining = Math.max(0, 60_000 - (Date.now() - cycleStartedAt));
    if (remaining > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, remaining));
    }
  }
}

appendFileSync(logPath, `${new Date().toISOString()} collector stopped\n`, 'utf8');
database.close();
