import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('work/route100-history.sqlite', { readOnly: true });
const one = (sql) => db.prepare(sql).get();
const all = (sql) => db.prepare(sql).all();

const result = {
  summary: one(`SELECT COUNT(*) observations,
    COUNT(DISTINCT observed_at) sample_minutes,
    COUNT(DISTINCT trip_id) unique_trips,
    MIN(observed_at) first_at,
    MAX(observed_at) last_at
    FROM observations`),
  runs: one(`SELECT COUNT(*) runs,
    SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) errors,
    MIN(collected_at) first_run,
    MAX(collected_at) last_run,
    SUM(rows_saved) rows_saved
    FROM collector_runs`),
  byDateDirection: all(`SELECT date(observed_at,'unixepoch','localtime') day,
    direction_id,
    COUNT(*) observations,
    COUNT(DISTINCT observed_at) samples,
    COUNT(DISTINCT trip_id) trips
    FROM observations
    GROUP BY day,direction_id
    ORDER BY day,direction_id`),
  windowCoverage: all(`SELECT CASE
      WHEN direction_id=1 AND time(observed_at,'unixepoch','localtime') BETWEEN '06:45:00' AND '07:45:59' THEN 'AM Meredith to RTC'
      WHEN direction_id=0 AND time(observed_at,'unixepoch','localtime') BETWEEN '15:00:00' AND '16:00:59' THEN 'PM RTC to Meredith'
      ELSE 'outside target'
    END window,
    COUNT(*) observations,
    COUNT(DISTINCT observed_at) samples,
    COUNT(DISTINCT trip_id) trips,
    MIN(observed_at) first_at,
    MAX(observed_at) last_at
    FROM observations
    GROUP BY window
    ORDER BY window`),
  recentRuns: all(`SELECT collected_at, rows_saved, error
    FROM collector_runs ORDER BY collected_at DESC LIMIT 12`),
  delayByDirection: all(`SELECT direction_id,
    COUNT(delay_seconds) with_delay,
    ROUND(AVG(delay_seconds),1) avg_delay_seconds,
    MIN(delay_seconds) min_delay_seconds,
    MAX(delay_seconds) max_delay_seconds
    FROM observations GROUP BY direction_id ORDER BY direction_id`),
  predictionMovement: all(`WITH bounds AS (
      SELECT trip_id,direction_id,MIN(observed_at) first_obs,MAX(observed_at) last_obs
      FROM observations GROUP BY trip_id,direction_id HAVING COUNT(DISTINCT observed_at)>1
    ), values_at_bounds AS (
      SELECT b.trip_id,b.direction_id,
        (SELECT predicted_time FROM observations o WHERE o.trip_id=b.trip_id AND o.observed_at=b.first_obs ORDER BY id LIMIT 1) first_prediction,
        (SELECT predicted_time FROM observations o WHERE o.trip_id=b.trip_id AND o.observed_at=b.last_obs ORDER BY id DESC LIMIT 1) last_prediction
      FROM bounds b
    )
    SELECT direction_id,COUNT(*) tracked_trips,
      ROUND(AVG(ABS(last_prediction-first_prediction)),1) avg_abs_change_seconds,
      MAX(ABS(last_prediction-first_prediction)) max_abs_change_seconds
    FROM values_at_bounds GROUP BY direction_id ORDER BY direction_id`),
  targetWindowStats: all(`SELECT
    CASE WHEN direction_id=1 THEN 'AM Meredith to RTC' ELSE 'PM RTC to Meredith' END window,
    COUNT(*) observations,
    COUNT(DISTINCT observed_at) samples,
    COUNT(DISTINCT trip_id) trips,
    COUNT(vehicle_id) with_vehicle,
    COUNT(DISTINCT vehicle_id) vehicles,
    ROUND(AVG(delay_seconds),1) avg_delay_seconds,
    MIN(delay_seconds) min_delay_seconds,
    MAX(delay_seconds) max_delay_seconds,
    MIN(observed_at) first_at,
    MAX(observed_at) last_at
    FROM observations
    WHERE (direction_id=1 AND time(observed_at,'unixepoch','localtime') BETWEEN '06:45:00' AND '07:45:59')
       OR (direction_id=0 AND time(observed_at,'unixepoch','localtime') BETWEEN '15:00:00' AND '16:00:59')
    GROUP BY direction_id ORDER BY direction_id DESC`),
  pmTripChanges: all(`WITH pm AS (
      SELECT * FROM observations
      WHERE direction_id=0 AND time(observed_at,'unixepoch','localtime') BETWEEN '15:00:00' AND '16:00:59'
    ), bounds AS (
      SELECT trip_id,MIN(observed_at) first_obs,MAX(observed_at) last_obs
      FROM pm GROUP BY trip_id HAVING COUNT(DISTINCT observed_at)>1
    )
    SELECT b.trip_id,
      (SELECT predicted_time FROM pm o WHERE o.trip_id=b.trip_id AND o.observed_at=b.first_obs ORDER BY id LIMIT 1) first_prediction,
      (SELECT predicted_time FROM pm o WHERE o.trip_id=b.trip_id AND o.observed_at=b.last_obs ORDER BY id DESC LIMIT 1) last_prediction,
      b.first_obs,b.last_obs
    FROM bounds b`),
  pmDeparturesInHour: one(`SELECT
    COUNT(*) observations,
    COUNT(DISTINCT observed_at) samples,
    COUNT(DISTINCT trip_id) trips,
    COUNT(vehicle_id) with_vehicle,
    ROUND(AVG(delay_seconds),1) avg_delay_seconds,
    MAX(delay_seconds) max_delay_seconds
    FROM observations
    WHERE direction_id=0
      AND time(observed_at,'unixepoch','localtime') BETWEEN '15:00:00' AND '16:00:59'
      AND time(predicted_time,'unixepoch','localtime') BETWEEN '15:00:00' AND '16:00:59'`),
  pmDepartureTrips: all(`SELECT trip_id,
    COUNT(*) observations,
    MIN(predicted_time) earliest_prediction,
    MAX(predicted_time) latest_prediction,
    MIN(delay_seconds) min_delay_seconds,
    MAX(delay_seconds) max_delay_seconds,
    MAX(vehicle_id) vehicle_id
    FROM observations
    WHERE direction_id=0
      AND time(observed_at,'unixepoch','localtime') BETWEEN '15:00:00' AND '16:00:59'
      AND time(predicted_time,'unixepoch','localtime') BETWEEN '15:00:00' AND '16:00:59'
    GROUP BY trip_id ORDER BY earliest_prediction`),
};

console.log(JSON.stringify(result));
db.close();
