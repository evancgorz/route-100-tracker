'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Direction = 'outbound' | 'return';
type Arrival = {
  tripId: string;
  predictedTime: number;
  delaySeconds: number | null;
  vehicleId: string | null;
  hasVehicle: boolean;
};
type LiveData = { fetchedAt: number; feedTimestamp: number; directions: Record<Direction, Arrival[]> };
type WeatherSample = { temperature: number; apparentTemperature: number; precipitationProbability: number; rain: number; showers: number; wind: number; gust: number; label: string; dry: boolean };
type WeatherData = { samples: Record<string, WeatherSample> };
type Plan = { bus: Arrival; busTime: number; leave: number; station?: number; rtc: number; work?: number; meredith?: number; home?: number };

const BUS_MINUTES = 24;
const BUFFER_MINUTES = 5;
const HOME_MEREDITH_MINUTES = 15;
const RTC_WORK_MINUTES = 5;
const UPCOMING_BUFFER_SECONDS = 60;
const BROWSE_HISTORY_SECONDS = 3 * 60 * 60;

function clock(timestamp?: number) {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(timestamp * 1000);
}

function minutesAway(timestamp?: number) {
  if (!timestamp) return null;
  return Math.max(0, Math.round((timestamp * 1000 - Date.now()) / 60000));
}

function addMinutes(timestamp: number, minutes: number) { return timestamp + minutes * 60; }
function rangeLabel(start: number, end: number) { return clock(start) + '–' + clock(end); }
function effectiveTime(arrival: Arrival) { return arrival.predictedTime; }

function browseTrips(arrivals: Arrival[] | undefined) {
  const cutoff = Math.floor(Date.now() / 1000) - BROWSE_HISTORY_SECONDS;
  return (arrivals ?? []).filter((arrival) => effectiveTime(arrival) > cutoff);
}

function nextTripIndex(arrivals: Arrival[]) {
  const cutoff = Math.floor(Date.now() / 1000) + UPCOMING_BUFFER_SECONDS;
  const index = arrivals.findIndex((arrival) => effectiveTime(arrival) > cutoff);
  return index === -1 ? Math.max(0, arrivals.length - 1) : index;
}

function weatherWindow(samples: WeatherSample[], minTemperature: number, maxTemperature: number) {
  if (!samples.length) return { status: 'Weather loading', className: 'weather-pending', detail: 'Checking the route forecast' };
  const minTemp = Math.min(...samples.map((sample) => sample.apparentTemperature));
  const maxTemp = Math.max(...samples.map((sample) => sample.apparentTemperature));
  const rain = samples.some((sample) => !sample.dry);
  const temperatureOk = minTemp >= minTemperature && maxTemp <= maxTemperature;
  const precipitationProbability = Math.max(...samples.map((sample) => sample.precipitationProbability));
  if (rain || !temperatureOk) return { status: 'Drive recommended', className: 'weather-drive', detail: Math.round(minTemp) + '–' + Math.round(maxTemp) + '° feels like · ' + (rain ? 'rain on the route' : 'outside your temperature range') };
  if (precipitationProbability >= 20) return { status: 'Bike–Bus–Bike, watch forecast', className: 'weather-watch', detail: Math.round(minTemp) + '–' + Math.round(maxTemp) + '° feels like · ' + precipitationProbability + '% rain risk' };
  return { status: 'Bike–Bus–Bike looks good', className: 'weather-good', detail: Math.round(minTemp) + '–' + Math.round(maxTemp) + '° feels like · dry route' };
}

function Leg({ mode, title, times, detail }: { mode: 'bike' | 'bus'; title: string; times: string; detail: string }) {
  return <div className={'leg-row ' + mode}><span className="leg-icon">{mode === 'bike' ? '↗' : '100'}</span><div className="leg-copy"><strong>{title}</strong><span>{detail}</span></div><div className="leg-time">{times}</div></div>;
}

function TripPager({ index, count, onPrevious, onNext }: { index: number; count: number; onPrevious: () => void; onNext: () => void }) {
  return <div className="trip-pager">
    <span>{count > 1 ? 'Trip ' + (index + 1) + ' of ' + count + ' · swipe to browse' : count === 1 ? 'Next departure' : 'No recent or upcoming trip in feed'}</span>
    {count > 1 && <div className="trip-controls">
      <button type="button" onClick={onPrevious} disabled={index === 0} aria-label="Show previous trip">←</button>
      <button type="button" onClick={onNext} disabled={index === count - 1} aria-label="Show next trip">→</button>
    </div>}
  </div>;
}

function planForMorning(bus: Arrival | undefined): Plan | null {
  if (!bus) return null;
  const busTime = effectiveTime(bus);
  const leave = addMinutes(busTime, -(HOME_MEREDITH_MINUTES + BUFFER_MINUTES));
  const station = addMinutes(busTime, -BUFFER_MINUTES);
  const rtc = addMinutes(busTime, BUS_MINUTES);
  return { bus, busTime, leave, station, rtc, work: addMinutes(rtc, RTC_WORK_MINUTES) };
}

function planForAfternoon(bus: Arrival | undefined): Plan | null {
  if (!bus) return null;
  const busTime = effectiveTime(bus);
  const leave = addMinutes(busTime, -(RTC_WORK_MINUTES + BUFFER_MINUTES));
  const rtc = addMinutes(busTime, -BUFFER_MINUTES);
  const meredith = addMinutes(busTime, BUS_MINUTES);
  return { bus, busTime, leave, rtc, meredith, home: addMinutes(meredith, HOME_MEREDITH_MINUTES) };
}

export default function Home() {
  const [data, setData] = useState<LiveData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outboundTripId, setOutboundTripId] = useState<string | null>(null);
  const [returnTripId, setReturnTripId] = useState<string | null>(null);
  const weatherKeyRef = useRef('');
  const morningTouchStart = useRef(0);
  const afternoonTouchStart = useRef(0);

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

  const outboundTrips = useMemo(() => browseTrips(data?.directions.outbound), [data]);
  const returnTrips = useMemo(() => browseTrips(data?.directions.return), [data]);

  const outboundIndex = Math.max(0, outboundTripId ? outboundTrips.findIndex((trip) => trip.tripId === outboundTripId) : nextTripIndex(outboundTrips));
  const returnIndex = Math.max(0, returnTripId ? returnTrips.findIndex((trip) => trip.tripId === returnTripId) : nextTripIndex(returnTrips));

  useEffect(() => {
    setOutboundTripId((current) => current && outboundTrips.some((trip) => trip.tripId === current) ? current : outboundTrips[nextTripIndex(outboundTrips)]?.tripId ?? null);
    setReturnTripId((current) => current && returnTrips.some((trip) => trip.tripId === current) ? current : returnTrips[nextTripIndex(returnTrips)]?.tripId ?? null);
  }, [outboundTrips, returnTrips]);

  const plans = useMemo(() => ({
    morning: planForMorning(outboundTrips[outboundIndex]),
    afternoon: planForAfternoon(returnTrips[returnIndex]),
  }), [outboundIndex, outboundTrips, returnIndex, returnTrips]);

  useEffect(() => {
    const values: Array<[string, number]> = [];
    if (plans.morning) {
      values.push(
        ['morningHomeStart', plans.morning.leave],
        ['morningHomeEnd', plans.morning.station ?? plans.morning.leave],
        ['morningRtcStart', plans.morning.rtc],
        ['morningRtcEnd', plans.morning.work ?? plans.morning.rtc],
      );
    }
    if (plans.afternoon) {
      values.push(
        ['afternoonWorkStart', plans.afternoon.leave],
        ['afternoonWorkEnd', plans.afternoon.rtc],
        ['afternoonMeredithStart', plans.afternoon.meredith ?? plans.afternoon.rtc],
        ['afternoonMeredithEnd', plans.afternoon.home ?? plans.afternoon.rtc],
      );
    }
    if (!values.length) return undefined;
    const key = values.map(([, value]) => Math.floor(value / 900)).join(',');
    if (weatherKeyRef.current === key) return undefined;
    weatherKeyRef.current = key;
    const query = new URLSearchParams({ labels: values.map(([label]) => label).join(','), times: values.map(([, value]) => String(value)).join(',') });
    fetch('/api/weather?' + query.toString()).then(async (response) => {
      if (!response.ok) throw new Error('Weather unavailable');
      setWeather(await response.json());
    }).catch(() => setWeather(null));
    return undefined;
  }, [plans]);

  const morningWeather = weatherWindow([
    weather?.samples.morningHomeStart,
    weather?.samples.morningHomeEnd,
    weather?.samples.morningRtcStart,
    weather?.samples.morningRtcEnd,
  ].filter(Boolean) as WeatherSample[], 45, 75);
  const afternoonWeather = weatherWindow([
    weather?.samples.afternoonWorkStart,
    weather?.samples.afternoonWorkEnd,
    weather?.samples.afternoonMeredithStart,
    weather?.samples.afternoonMeredithEnd,
  ].filter(Boolean) as WeatherSample[], 45, 90);
  const feedAge = data ? Math.max(0, Math.round(Date.now() / 1000 - data.feedTimestamp)) : null;
  const setOutboundAt = (index: number) => {
    const trip = outboundTrips[Math.max(0, Math.min(index, outboundTrips.length - 1))];
    if (trip) setOutboundTripId(trip.tripId);
  };
  const setReturnAt = (index: number) => {
    const trip = returnTrips[Math.max(0, Math.min(index, returnTrips.length - 1))];
    if (trip) setReturnTripId(trip.tripId);
  };

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">↗</div>
      <div><p className="brand">Commute, connected</p><p className="brand-subtitle">Bike · Bus · Bike</p></div>
      <div className={'status-pill ' + (error ? 'offline' : data ? 'online' : '')}><span /> {error ? 'Check feed' : data ? 'Live' : 'Connecting'}</div>
    </header>

    <section className="intro"><p className="eyebrow">Next departures</p><h1>Leave on time.<br /><em>Arrive ready.</em></h1><p className="intro-copy">The card starts at the next usable bus. Swipe left for later trips or right to revisit recent ones.</p></section>
    {error && <div className="alert">{error}. Drive is the safe fallback until live bus data returns.</div>}

    <section
      className="commute-card morning-card"
      onTouchStart={(event) => { morningTouchStart.current = event.changedTouches[0]?.clientX ?? 0; }}
      onTouchEnd={(event) => {
        const delta = (event.changedTouches[0]?.clientX ?? 0) - morningTouchStart.current;
        if (delta < -45) setOutboundAt(outboundIndex + 1);
        if (delta > 45) setOutboundAt(outboundIndex - 1);
      }}
    >
      <div className="card-top"><div><span className="eyebrow">Morning commute</span><h2>To work</h2></div><span className="mode-badge">BIKE · BUS · BIKE</span></div>
      <TripPager index={outboundIndex} count={outboundTrips.length} onPrevious={() => setOutboundAt(outboundIndex - 1)} onNext={() => setOutboundAt(outboundIndex + 1)} />
      <div className="big-time"><span>Leave by</span><strong>{plans.morning ? clock(plans.morning.leave) : '—'}</strong><span className="arrival-target">Arrive by <b>{plans.morning?.work ? clock(plans.morning.work) : '—'}</b></span></div>
      <div className="legs">
        <Leg mode="bike" title="Bike to Meredith" times={plans.morning ? rangeLabel(plans.morning.leave, plans.morning.station ?? plans.morning.leave) : '—'} detail="15 min · 5 min bus buffer" />
        <Leg mode="bus" title={plans.morning ? 'Route 100 · ' + (minutesAway(plans.morning.busTime) ?? '—') + ' min' : 'Route 100'} times={plans.morning ? rangeLabel(plans.morning.busTime, plans.morning.rtc) : '—'} detail={plans.morning ? 'Meredith → RTC · Live feed' : 'Waiting for an upcoming prediction'} />
        <Leg mode="bike" title="Bike to work" times={plans.morning ? rangeLabel(plans.morning.rtc, plans.morning.work ?? plans.morning.rtc) : '—'} detail="5 min · RTC → destination" />
      </div>
      <div className={'weather-row ' + morningWeather.className}><span className="weather-symbol">☼</span><div className="weather-copy"><strong>{morningWeather.status}</strong><small>{morningWeather.detail}</small></div><span className="weather-window">AM</span></div>
    </section>

    <section
      className="commute-card afternoon-card"
      onTouchStart={(event) => { afternoonTouchStart.current = event.changedTouches[0]?.clientX ?? 0; }}
      onTouchEnd={(event) => {
        const delta = (event.changedTouches[0]?.clientX ?? 0) - afternoonTouchStart.current;
        if (delta < -45) setReturnAt(returnIndex + 1);
        if (delta > 45) setReturnAt(returnIndex - 1);
      }}
    >
      <div className="card-top"><div><span className="eyebrow">Commute home</span><h2>Back home</h2></div><span className="mode-badge">BIKE · BUS · BIKE</span></div>
      <TripPager index={returnIndex} count={returnTrips.length} onPrevious={() => setReturnAt(returnIndex - 1)} onNext={() => setReturnAt(returnIndex + 1)} />
      <div className="big-time"><span>Leave work by</span><strong>{plans.afternoon ? clock(plans.afternoon.leave) : '—'}</strong><span className="arrival-target">Arrive home by <b>{plans.afternoon?.home ? clock(plans.afternoon.home) : '—'}</b></span></div>
      <div className="legs">
        <Leg mode="bike" title="Bike to RTC" times={plans.afternoon ? rangeLabel(plans.afternoon.leave, plans.afternoon.rtc) : '—'} detail="5 min · 5 min bus buffer" />
        <Leg mode="bus" title={plans.afternoon ? 'Route 100 · ' + (minutesAway(plans.afternoon.busTime) ?? '—') + ' min' : 'Route 100'} times={plans.afternoon ? rangeLabel(plans.afternoon.busTime, plans.afternoon.meredith ?? plans.afternoon.busTime) : '—'} detail={plans.afternoon ? 'RTC → Meredith · Live feed' : 'Waiting for an upcoming prediction'} />
        <Leg mode="bike" title="Bike home" times={plans.afternoon ? rangeLabel(plans.afternoon.meredith ?? plans.afternoon.rtc, plans.afternoon.home ?? plans.afternoon.rtc) : '—'} detail="15 min · Meredith → home" />
      </div>
      <div className={'weather-row ' + afternoonWeather.className}><span className="weather-symbol">☼</span><div className="weather-copy"><strong>{afternoonWeather.status}</strong><small>{afternoonWeather.detail}</small></div><span className="weather-window">PM</span></div>
    </section>

    <footer><span>Route 100 live feed</span><span>{feedAge === null ? 'Waiting for update' : 'Updated ' + feedAge + 's ago'}</span></footer>
  </main>;
}
