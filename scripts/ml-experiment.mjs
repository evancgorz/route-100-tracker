import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROUTE_ID = '3629';
const TARGETS = new Map([
  [1, { stopId: '12228', label: 'Meredith → RTC arrival' }],
  [0, { stopId: '1733', label: 'RTC → Meredith departure' }],
]);
const MIN_SAMPLES_PER_TRIP = 3;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoDirectory = resolve(scriptDirectory, '..');
const workDirectory = resolve(repoDirectory, 'work');
const databasePath = process.env.ROUTE100_DB_PATH || resolve(workDirectory, 'route100-history.sqlite');
const jsonPath = resolve(workDirectory, 'ml-experiment-latest.json');
const markdownPath = resolve(workDirectory, 'ml-experiment-latest.md');
mkdirSync(workDirectory, { recursive: true });

function parseCsv(path) {
  const [header, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const columns = header.split(',');
  return lines.filter(Boolean).map((line) => {
    const values = line.split(',');
    return Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  });
}

function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function minutesFromClock(clock) {
  const [hours, minutes, seconds = 0] = clock.split(':').map(Number);
  return hours * 60 + minutes + seconds / 60;
}

function localDate(epochSeconds) {
  const date = new Date(Number(epochSeconds) * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localMinute(epochSeconds) {
  const date = new Date(Number(epochSeconds) * 1000);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function formatClock(minutes) {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function isInCollectionWindow(row) {
  const minute = localMinute(row.observed_at);
  return row.direction_id === 1
    ? minute >= 405 && minute < 466
    : minute >= 900 && minute < 961;
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column] || 1e-12;
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map((row) => row[size]);
}

function features(record) {
  return [1, record.scheduledMin / 1440, record.firstOffsetMin / 60, record.firstVehicle ? 1 : 0];
}

function fitRidge(records, lambda = 0.01) {
  const dimension = features(records[0]).length;
  const xtx = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  const xty = Array(dimension).fill(0);
  for (const record of records) {
    const x = features(record);
    for (let row = 0; row < dimension; row += 1) {
      xty[row] += x[row] * record.targetOffsetMin;
      for (let column = 0; column < dimension; column += 1) xtx[row][column] += x[row] * x[column];
    }
  }
  for (let index = 1; index < dimension; index += 1) xtx[index][index] += lambda;
  return solveLinearSystem(xtx, xty);
}

function predictOffset(coefficients, record) {
  const x = features(record);
  return x.reduce((sum, value, index) => sum + value * coefficients[index], 0);
}

function metrics(rows, predictionKey, lowerKey = null, upperKey = null) {
  const errors = rows.map((row) => row[predictionKey] - row.targetOffsetMin);
  const absolute = errors.map(Math.abs);
  const result = {
    n: rows.length,
    maeMin: quantile(absolute, 0.5) === null ? null : absolute.reduce((a, b) => a + b, 0) / absolute.length,
    rmseMin: Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length),
    biasMin: errors.reduce((a, b) => a + b, 0) / errors.length,
    medianAbsoluteErrorMin: quantile(absolute, 0.5),
    p90AbsoluteErrorMin: quantile(absolute, 0.9),
    within2MinPct: absolute.filter((value) => value <= 2).length / absolute.length,
    within5MinPct: absolute.filter((value) => value <= 5).length / absolute.length,
    within10MinPct: absolute.filter((value) => value <= 10).length / absolute.length,
  };
  if (lowerKey && upperKey) {
    result.interval80CoveragePct = rows.filter((row) => row.targetOffsetMin >= row[lowerKey] && row.targetOffsetMin <= row[upperKey]).length / rows.length;
  }
  return result;
}

function formatMetric(value) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)} min`;
}

const trips = parseCsv(resolve(repoDirectory, 'work', 'gtfs', 'current', 'trips.txt')).filter((row) => row.route_id === ROUTE_ID);
const tripMap = new Map(trips.map((row) => [row.trip_id, row]));
const scheduleMap = new Map();
for (const row of parseCsv(resolve(repoDirectory, 'work', 'gtfs', 'current', 'stop_times.txt'))) {
  if (!tripMap.has(row.trip_id) || !TARGETS.has(Number(tripMap.get(row.trip_id).direction_id))) continue;
  if (row.stop_id === TARGETS.get(Number(tripMap.get(row.trip_id).direction_id)).stopId) {
    scheduleMap.set(`${row.trip_id}|${row.stop_id}`, row.arrival_time);
  }
}

const database = new DatabaseSync(databasePath, { readOnly: true });
const observations = database.prepare(`SELECT observed_at, trip_id, direction_id, stop_id, predicted_time, vehicle_id
  FROM observations ORDER BY observed_at`).all().filter(isInCollectionWindow);
const runs = database.prepare('SELECT collected_at, error FROM collector_runs ORDER BY collected_at').all();
database.close();

const runCounts = new Map();
for (const run of runs) {
  if (run.error) continue;
  const date = localDate(run.collected_at);
  const minute = localMinute(run.collected_at);
  const direction = minute >= 405 && minute < 466 ? 1 : minute >= 900 && minute < 961 ? 0 : null;
  if (direction !== null) runCounts.set(`${date}|${direction}`, (runCounts.get(`${date}|${direction}`) || 0) + 1);
}

const grouped = new Map();
for (const observation of observations) {
  const schedule = scheduleMap.get(`${observation.trip_id}|${observation.stop_id}`);
  if (!schedule) continue;
  const key = `${localDate(observation.observed_at)}|${observation.trip_id}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push({ ...observation, schedule });
}

const records = [];
for (const [key, rows] of grouped) {
  rows.sort((a, b) => a.observed_at - b.observed_at);
  if (rows.length < MIN_SAMPLES_PER_TRIP) continue;
  const direction = Number(rows[0].direction_id);
  const day = key.slice(0, 10);
  if ((runCounts.get(`${day}|${direction}`) || 0) < 30) continue;
  const scheduledMin = minutesFromClock(rows[0].schedule);
  const tail = rows.slice(-3).map((row) => Number(row.predicted_time)).sort((a, b) => a - b);
  const terminalEpoch = tail[Math.floor(tail.length / 2)];
  const first = rows[0];
  records.push({
    day,
    direction,
    tripId: first.trip_id,
    scheduled: first.schedule,
    scheduledMin,
    firstPrediction: formatClock(localMinute(first.predicted_time)),
    firstOffsetMin: localMinute(first.predicted_time) - scheduledMin,
    firstVehicle: Boolean(first.vehicle_id),
    targetOffsetMin: localMinute(terminalEpoch) - scheduledMin,
    samples: rows.length,
    vehiclePct: rows.filter((row) => row.vehicle_id).length / rows.length,
  });
}

const directionResults = [];
for (const direction of [1, 0]) {
  const directionRecords = records.filter((record) => record.direction === direction).sort((a, b) => a.day.localeCompare(b.day) || a.scheduledMin - b.scheduledMin);
  const days = [...new Set(directionRecords.map((record) => record.day))].sort();
  if (days.length < 2) continue;
  const testDay = days.at(-1);
  const train = directionRecords.filter((record) => record.day < testDay);
  const test = directionRecords.filter((record) => record.day === testDay);
  if (train.length < 5 || !test.length) continue;
  const coefficients = fitRidge(train);
  const trainResiduals = train.map((record) => record.targetOffsetMin - predictOffset(coefficients, record));
  const residualP10 = quantile(trainResiduals, 0.1);
  const residualP90 = quantile(trainResiduals, 0.9);
  for (const record of test) {
    record.schedulePredictionMin = 0;
    record.firstPredictionOffsetMin = record.firstOffsetMin;
    record.modelPredictionMin = predictOffset(coefficients, record);
    record.modelLowerMin = record.modelPredictionMin + residualP10;
    record.modelUpperMin = record.modelPredictionMin + residualP90;
  }
  const methods = {
    schedule: metrics(test, 'schedulePredictionMin'),
    firstLivePrediction: metrics(test, 'firstPredictionOffsetMin'),
    ridgeModel: metrics(test, 'modelPredictionMin', 'modelLowerMin', 'modelUpperMin'),
  };
  directionResults.push({
    direction,
    label: TARGETS.get(direction).label,
    trainDays: days.slice(0, -1),
    testDay,
    trainN: train.length,
    testN: test.length,
    trainingResidualP10Min: residualP10,
    trainingResidualP90Min: residualP90,
    methods,
    predictions: test.map((record) => ({
      scheduled: formatClock(record.scheduledMin),
      estimate: formatClock(record.scheduledMin + record.modelPredictionMin),
      interval80: `${formatClock(record.scheduledMin + record.modelLowerMin)}–${formatClock(record.scheduledMin + record.modelUpperMin)}`,
      terminalEstimate: formatClock(record.scheduledMin + record.targetOffsetMin),
      samples: record.samples,
      vehiclePct: record.vehiclePct,
    })),
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  databasePath,
  method: {
    target: 'Terminal prediction = median of each trip\'s final three live predicted times',
    split: 'Time-ordered holdout: latest complete collection day per direction is test; earlier days are train',
    model: 'Ridge regression predicting terminal offset from schedule time, first live offset, and vehicle availability',
    interval: 'Empirical 80% prediction interval from training residuals (10th–90th percentiles)',
    minimumTripSamples: MIN_SAMPLES_PER_TRIP,
  },
  data: { records: records.length, directions: directionResults.map((result) => ({ direction: result.direction, trainN: result.trainN, testN: result.testN, trainDays: result.trainDays, testDay: result.testDay })) },
  results: directionResults,
};
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const lines = [
  '# Route 100 ML experiment',
  '',
  `Generated: ${report.generatedAt}`, 
  '',
  'This is a first-pass nowcast experiment. The target is the terminal live prediction for each trip, not a verified stop-passage time. The latest complete day is held out; no test-day rows are used to fit the model.',
  '',
  '| Direction | Train days | Test day | Train trips | Test trips |',
  '|---|---|---|---:|---:|',
];
for (const result of directionResults) lines.push(`| ${result.label} | ${result.trainDays.join(', ')} | ${result.testDay} | ${result.trainN} | ${result.testN} |`);
for (const result of directionResults) {
  lines.push('', `## ${result.label}`, '', '| Method | MAE | RMSE | Bias | P90 abs. error | Within 5 min | 80% interval coverage |', '|---|---:|---:|---:|---:|---:|---:|');
  for (const [name, metric] of Object.entries(result.methods)) lines.push(`| ${name} | ${formatMetric(metric.maeMin)} | ${formatMetric(metric.rmseMin)} | ${formatMetric(metric.biasMin)} | ${formatMetric(metric.p90AbsoluteErrorMin)} | ${(metric.within5MinPct * 100).toFixed(0)}% | ${metric.interval80CoveragePct === undefined ? '—' : `${(metric.interval80CoveragePct * 100).toFixed(0)}%`} |`);
  lines.push('', '| Scheduled | Model estimate | 80% interval | Terminal prediction proxy | Samples | Vehicle coverage |', '|---|---|---|---|---:|---:|');
  for (const row of result.predictions) lines.push(`| ${row.scheduled} | ${row.estimate} | ${row.interval80} | ${row.terminalEstimate} | ${row.samples} | ${(row.vehiclePct * 100).toFixed(0)}% |`);
}
lines.push('', '## Interpretation', '', '- Use MAE and P90 absolute error as the primary regular metrics; bias shows systematic early/late behavior.', '- The 80% interval is a calibration check, not a formal confidence interval.', '- Sparse histories and fixed schedule predictions can make an interval look artificially narrow; the report retains sample and vehicle coverage so those cases are visible.');
writeFileSync(markdownPath, `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ jsonPath, markdownPath, data: report.data, results: directionResults.map((result) => ({ label: result.label, testDay: result.testDay, methods: result.methods })) }, null, 2));
