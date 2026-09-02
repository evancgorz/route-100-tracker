export const dynamic = 'force-dynamic';

type Point = { id: string; latitude: number; longitude: number };

// Coordinates are used only as weather sample points. The UI never displays
// street addresses, keeping the commute card useful without exposing them.
const POINTS: Point[] = [
  { id: 'home', latitude: 35.7742658, longitude: -78.6992608 },
  { id: 'meredith', latitude: 35.7986587, longitude: -78.6888239 },
  { id: 'rtc', latitude: 35.8746891, longitude: -78.8363877 },
  { id: 'work', latitude: 35.8742106, longitude: -78.8456083 },
];

const HOURLY = [
  'temperature_2m', 'apparent_temperature', 'precipitation_probability',
  'precipitation', 'rain', 'showers', 'wind_speed_10m', 'wind_gusts_10m', 'weather_code',
].join(',');

function number(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function weatherLabel(code: number | null): string {
  if (code === null) return 'Forecast unavailable';
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Hazy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  return 'Storm risk';
}

async function forecast(point: Point): Promise<any> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(point.latitude));
  url.searchParams.set('longitude', String(point.longitude));
  url.searchParams.set('hourly', HOURLY);
  url.searchParams.set('forecast_days', '2');
  url.searchParams.set('timezone', 'America/New_York');
  url.searchParams.set('timeformat', 'unixtime');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
  return response.json();
}

function nearestIndex(times: number[], target: number): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < times.length; index += 1) {
    const nextDistance = Math.abs(times[index] - target);
    if (nextDistance < distance) { best = index; distance = nextDistance; }
  }
  return best;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const labels = (url.searchParams.get('labels') || '').split(',').filter(Boolean);
  const times = (url.searchParams.get('times') || '').split(',').map(Number).filter(Number.isFinite);
  if (!labels.length || labels.length !== times.length || labels.length > 8) {
    return Response.json({ error: 'Provide matching labels and times.' }, { status: 400 });
  }

  try {
    const forecasts = await Promise.all(POINTS.map(async (point) => ({ point, data: await forecast(point) })));
    const samples: Record<string, any> = {};
    for (let position = 0; position < labels.length; position += 1) {
      const target = times[position];
      const values = forecasts.map(({ data }) => {
        const hourly = data.hourly;
        const index = nearestIndex(hourly.time, target);
        return {
          temperature: Number(hourly.temperature_2m[index]),
          apparentTemperature: Number(hourly.apparent_temperature[index]),
          precipitationProbability: Number(hourly.precipitation_probability[index]),
          precipitation: Number(hourly.precipitation[index]),
          rain: Number(hourly.rain[index]),
          showers: Number(hourly.showers[index]),
          wind: Number(hourly.wind_speed_10m[index]),
          gust: Number(hourly.wind_gusts_10m[index]),
          code: Number(hourly.weather_code[index]),
        };
      });
      const maxCode = Math.max(...values.map((value) => value.code));
      samples[labels[position]] = {
        at: target,
        temperature: Math.round(values.reduce((sum, value) => sum + value.temperature, 0) / values.length),
        apparentTemperature: Math.round(values.reduce((sum, value) => sum + value.apparentTemperature, 0) / values.length),
        precipitationProbability: Math.max(...values.map((value) => value.precipitationProbability)),
        precipitation: Math.max(...values.map((value) => value.precipitation)),
        rain: Math.max(...values.map((value) => value.rain)),
        showers: Math.max(...values.map((value) => value.showers)),
        wind: Math.round(Math.max(...values.map((value) => value.wind))),
        gust: Math.round(Math.max(...values.map((value) => value.gust))),
        code: maxCode,
        label: weatherLabel(maxCode),
        dry: Math.max(...values.map((value) => value.rain + value.showers)) < 0.01,
      };
    }
    return Response.json({ fetchedAt: Math.floor(Date.now() / 1000), samples }, { headers: { 'cache-control': 'public, max-age=600' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Weather unavailable' }, { status: 503 });
  }
}
