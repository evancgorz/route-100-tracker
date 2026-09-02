'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Direction = 'outbound' | 'return';
type Arrival = { tripId: string; predictedTime: number; delaySeconds: number | null; vehicleId: string | null; hasVehicle: boolean };
type LiveData = { fetchedAt: number; feedTimestamp: number; directions: Record<Direction, Arrival[]> };
type WeatherSample = { temperature: number; apparentTemperature: number; precipitationProbability: number; rain: number; showers: number; wind: number; gust: number; label: string; dry: boolean };
type WeatherData = { samples: Record<string, WeatherSample> };

const BUS_MINUTES = 24;
const BUFFER_MINUTES = 8;
const HOME_MEREDITH_MINUTES = 14;
const RTC_WORK_MINUTES = 5;

function clock(timestamp?: number) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(timestamp * 1000);
}

function minutesAway(timestamp?: number) {
  if (!timestamp) return null;
  return Math.max(0, Math.round((timestamp * 1000 - Date.now()) / 60000));
}

function addMinutes(timestamp: number, minutes: number) { return timestamp + minutes * 60; }
function rangeLabel(start: number, end: number) { return `${clock(start)}–${clock(end)}`; }

function weatherWindow(samples: WeatherSample[], minTemperature: number, maxTemperature: number) {
  if (!samples.length) return { status: 'Weather loading', className: 'weather-pending', detail: 'Checking the route forecast' };
  const minTemp = Math.min(...samples.map((sample) => sample.apparentTemperature));
  const maxTemp = Math.max(...samples.map((sample) => sample.apparentTemperature));
  const rain = samples.some((sample) => !sample.dry);
  const temperatureOk = minTemp >= minTemperature && maxTemp <= maxTemperature;
  const precipitationProbability = Math.max(...samples.map((sample) => sample.precipitationProbability));
  if (rain || !temperatureOk) return { status: 'Drive recommended', className: 'weather-drive', detail: `${Math.round(minTemp)}–${Math.round(maxTemp)}° feels like · ${rain ? 'rain on the route' : 'outside your temperature range'}` };
  if (precipitationProbability >= 20) return { status: 'Bike–Bus–Bike, watch forecast', className: 'weather-watch', detail: `${Math.round(minTemp)}–${Math.round(maxTemp)}° feels like · ${precipitationProbability}% rain risk` };
  return { status: 'Bike–Bus–Bike looks good', className: 'weather-good', detail: `${Math.round(minTemp)}–${Math.round(maxTemp)}° feels like · dry route` };
}

function Leg({ mode, title, times, detail }: { mode: 'bike' | 'bus'; title: string; times: string; detail: string }) {
  return <div className={`leg-row ${mode}`}><span className="leg-icon">{mode === 'bike' ? '↗' : '100'}</span><div className="leg-copy"><strong>{title}</strong><span>{detail}</span></div><div className="leg-time">{times}</div></div>;
}

export default function Home() {
  const [data, setData] = useState<LiveData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const weatherKeyRef = useRef('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/live', { cache: 'no-store' });
        if (!response.ok) throw new Error('Live bus feed unavailable');
        const payload = await response.json();
        if (active) { setData(payload); setError(null); }
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Live bus feed unavailable');
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const plans = useMemo(() => {
    const outbound = data?.directions.outbound[0]?.predictedTime;
    const returning = data?.directions.return[0]?.predictedTime;
    if (!outbound || !returning) return null;
    const morningLeave = addMinutes(outbound, -(HOME_MEREDITH_MINUTES + BUFFER_MINUTES));
    const morningStation = addMinutes(outbound, -BUFFER_MINUTES);
    const morningRtc = addMinutes(outbound, BUS_MINUTES);
    const morningWork = addMinutes(morningRtc, RTC_WORK_MINUTES);
    const afternoonLeave = addMinutes(returning, -(RTC_WORK_MINUTES + BUFFER_MINUTES));
    const afternoonRtc = addMinutes(returning, -BUFFER_MINUTES);
    const afternoonMeredith = addMinutes(returning, BUS_MINUTES);
    const afternoonHome = addMinutes(afternoonMeredith, HOME_MEREDITH_MINUTES);
    return {
      morning: { bus: outbound, leave: morningLeave, station: morningStation, rtc: morningRtc, work: morningWork },
      afternoon: { bus: returning, leave: afternoonLeave, rtc: afternoonRtc, meredith: afternoonMeredith, home: afternoonHome },
    };
  }, [data]);

  useEffect(() => {
    if (!plans) return undefined;
    const values = [
      ['morningHomeStart', plans.morning.leave], ['morningHomeEnd', plans.morning.station],
      ['morningRtcStart', plans.morning.rtc], ['morningRtcEnd', plans.morning.work],
      ['afternoonWorkStart', plans.afternoon.leave], ['afternoonWorkEnd', plans.afternoon.rtc],
      ['afternoonMeredithStart', plans.afternoon.meredith], ['afternoonMeredithEnd', plans.afternoon.home],
    ] as const;
    const key = values.map(([, value]) => Math.floor(value / 900)).join(',');
    if (weatherKeyRef.current === key) return undefined;
    weatherKeyRef.current = key;
    const query = new URLSearchParams({ labels: values.map(([label]) => label).join(','), times: values.map(([, value]) => String(value)).join(',') });
    fetch(`/api/weather?${query.toString()}`).then(async (response) => {
      if (!response.ok) throw new Error('Weather unavailable');
      setWeather(await response.json());
    }).catch(() => setWeather(null));
    return undefined;
  }, [plans]);

  const morningWeather = weatherWindow([weather?.samples.morningHomeStart, weather?.samples.morningHomeEnd, weather?.samples.morningRtcStart, weather?.samples.morningRtcEnd].filter(Boolean) as WeatherSample[], 45, 75);
  const afternoonWeather = weatherWindow([weather?.samples.afternoonWorkStart, weather?.samples.afternoonWorkEnd, weather?.samples.afternoonMeredithStart, weather?.samples.afternoonMeredithEnd].filter(Boolean) as WeatherSample[], 45, 90);
  const feedAge = data ? Math.max(0, Math.round(Date.now() / 1000 - data.feedTimestamp)) : null;
  const nextOutbound = data?.directions.outbound[0];
  const nextReturn = data?.directions.return[0];

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">↗</div>
      <div><p className="brand">Commute, connected</p><p className="brand-subtitle">Bike · Bus · Bike</p></div>
      <div className={`status-pill ${error ? 'offline' : data ? 'online' : ''}`}><span /> {error ? 'Check feed' : data ? 'Live' : 'Connecting'}</div>
    </header>

    <section className="intro"><p className="eyebrow">Today’s plan</p><h1>Leave on time.<br /><em>Arrive ready.</em></h1><p className="intro-copy">Your multimodal commute, timed around the next bus and the weather on both bike legs.</p></section>
    {error && <div className="alert">{error}. Drive is the safe fallback until live bus data returns.</div>}

    <section className="commute-card morning-card">
      <div className="card-top"><div><span className="eyebrow">Morning commute</span><h2>To work</h2></div><span className="mode-badge">BIKE · BUS · BIKE</span></div>
      <div className="big-time"><span>Leave by</span><strong>{plans ? clock(plans.morning.leave) : '—'}</strong><span className="arrival-target">Arrive by <b>{plans ? clock(plans.morning.work) : '—'}</b></span></div>
      <div className="legs">
        <Leg mode="bike" title="Bike to Meredith" times={plans ? rangeLabel(plans.morning.leave, plans.morning.station) : '—'} detail="14 min · 8 min bus buffer" />
        <Leg mode="bus" title={`Route 100 · ${minutesAway(nextOutbound?.predictedTime) ?? '—'} min`} times={plans ? rangeLabel(plans.morning.bus, plans.morning.rtc) : '—'} detail="Meredith → RTC" />
        <Leg mode="bike" title="Bike to work" times={plans ? rangeLabel(plans.morning.rtc, plans.morning.work) : '—'} detail="5 min · RTC → destination" />
      </div>
      <div className={`weather-row ${morningWeather.className}`}><span className="weather-symbol">☼</span><div className="weather-copy"><strong>{morningWeather.status}</strong><small>{morningWeather.detail}</small></div><span className="weather-window">AM</span></div>
    </section>

    <section className="commute-card afternoon-card">
      <div className="card-top"><div><span className="eyebrow">Commute home</span><h2>Back home</h2></div><span className="mode-badge">BIKE · BUS · BIKE</span></div>
      <div className="big-time"><span>Leave work by</span><strong>{plans ? clock(plans.afternoon.leave) : '—'}</strong><span className="arrival-target">Arrive home by <b>{plans ? clock(plans.afternoon.home) : '—'}</b></span></div>
      <div className="legs">
        <Leg mode="bike" title="Bike to RTC" times={plans ? rangeLabel(plans.afternoon.leave, plans.afternoon.rtc) : '—'} detail="5 min · 8 min bus buffer" />
        <Leg mode="bus" title={`Route 100 · ${minutesAway(nextReturn?.predictedTime) ?? '—'} min`} times={plans ? rangeLabel(plans.afternoon.bus, plans.afternoon.meredith) : '—'} detail="RTC → Meredith" />
        <Leg mode="bike" title="Bike home" times={plans ? rangeLabel(plans.afternoon.meredith, plans.afternoon.home) : '—'} detail="14 min · Meredith → home" />
      </div>
      <div className={`weather-row ${afternoonWeather.className}`}><span className="weather-symbol">☼</span><div className="weather-copy"><strong>{afternoonWeather.status}</strong><small>{afternoonWeather.detail}</small></div><span className="weather-window">PM</span></div>
    </section>

    <footer><span>Route 100 live feed</span><span>{feedAge === null ? 'Waiting for update' : `Updated ${feedAge}s ago`}</span></footer>
  </main>;
}
