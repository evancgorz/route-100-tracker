'use client';

import { useEffect, useMemo, useState } from 'react';

type Direction = 'outbound' | 'return';
type Arrival = { tripId: string; predictedTime: number; delaySeconds: number | null; vehicleId: string | null; hasVehicle: boolean };
type LiveData = { fetchedAt: number; feedTimestamp: number; directions: Record<Direction, Arrival[]> };

const directions = {
  outbound: { eyebrow: 'Morning ride', from: 'Meredith College', platform: 'Hillsborough St · Westbound · Stop 8587', to: 'Regional Transit Center', action: 'arrival' },
  return: { eyebrow: 'Ride home', from: 'Regional Transit Center', platform: 'RTC · Stop 1000', to: 'Meredith College', action: 'departure' },
} as const;

function clock(timestamp?: number) {
  if (!timestamp) return { time: '—', meridiem: '' };
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).formatToParts(timestamp * 1000);
  return { time: `${parts.find((part) => part.type === 'hour')?.value}:${parts.find((part) => part.type === 'minute')?.value}`, meridiem: parts.find((part) => part.type === 'dayPeriod')?.value ?? '' };
}

function minutesAway(timestamp?: number) {
  if (!timestamp) return null;
  return Math.max(0, Math.round((timestamp * 1000 - Date.now()) / 60000));
}

export default function Home() {
  const [direction, setDirection] = useState<Direction>('outbound');
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/live', { cache: 'no-store' });
        if (!response.ok) throw new Error('Live feed unavailable');
        const payload = await response.json();
        if (active) { setData(payload); setError(null); }
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Live feed unavailable');
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const trip = directions[direction];
  const arrivals = data?.directions[direction] ?? [];
  const next = arrivals[0];
  const displayed = clock(next?.predictedTime);
  const due = minutesAway(next?.predictedTime);
  const feedAge = data ? Math.max(0, Math.round(Date.now() / 1000 - data.feedTimestamp)) : null;
  const confidence = useMemo(() => {
    if (!next) return 'No upcoming trip found';
    if (next.hasVehicle) return `Bus ${next.vehicleId ?? 'assigned'} is reporting live`;
    return 'Agency estimate · vehicle not assigned yet';
  }, [next]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">100</div>
        <div><p className="brand">Route 100 Watch</p><p className="brand-subtitle">Meredith ↔ RTC</p></div>
        <div className={`status-pill ${error ? 'offline' : data ? 'online' : ''}`}><span /> {error ? 'Feed issue' : data ? 'Live' : 'Connecting'}</div>
      </header>

      <section className="hero">
        <div className="direction-switch" aria-label="Choose direction">
          <button className={direction === 'outbound' ? 'active' : ''} onClick={() => setDirection('outbound')}>To RTC</button>
          <button className={direction === 'return' ? 'active' : ''} onClick={() => setDirection('return')}>To Meredith</button>
        </div>

        <p className="eyebrow">{trip.eyebrow}</p>
        <h1>{trip.from}</h1>
        <p className="platform">{trip.platform}</p>

        <div className="route-line" aria-hidden="true">
          <span className="stop-dot start" /><span className="line" /><span className="bus-dot">100</span><span className="line" /><span className="stop-dot" />
        </div>

        <div className="arrival-card" aria-live="polite">
          <div className="card-heading"><p className="card-label">Next Route 100</p>{due !== null && <span className="due">{due === 0 ? 'Due' : `${due} min`}</span>}</div>
          <div className="arrival-time"><strong>{displayed.time}</strong><span>{displayed.meridiem}</span></div>
          <p className="destination">toward {trip.to}</p>
          <div className="confidence-row"><span>{confidence}</span><span className={next?.hasVehicle ? 'live-note' : 'pending'}>{next ? `Realtime ${trip.action}` : 'Checking schedule'}</span></div>
        </div>

        {arrivals.length > 1 && (
          <div className="later-row"><span>Following bus</span><strong>{clock(arrivals[1].predictedTime).time} {clock(arrivals[1].predictedTime).meridiem}</strong></div>
        )}
      </section>

      <footer><span>GoTriangle live feed</span><span>{feedAge === null ? 'Waiting for first update' : `Feed age ${feedAge}s`}</span></footer>
    </main>
  );
}
