import { useEffect, useRef, useState } from "react";
import type { InvoiceRecord } from "@ledgerrun/contract";
import { computeStats } from "../lib";

// The heartbeat: the PRD's headline impact metric (time saved) made visible, with
// values that count up as the AI clears invoices on its own.
export default function StatsBar({ invoices }: { invoices: InvoiceRecord[] }) {
  const s = computeStats(invoices);
  const processed = useCountUp(s.processed);
  const rate = useCountUp(Math.round(s.autoRate * 100));
  const minutes = useCountUp(s.minutesSaved);

  if (s.processed === 0) return null;

  return (
    <div className="flex items-center gap-5 text-[13.5px]">
      <Stat value={`${Math.round(processed)}`} label="processed" />
      <Divider />
      <Stat value={`${Math.round(rate)}%`} label="auto-cleared" tone="text-accent-green" />
      <Divider />
      <Stat value={fmtSaved(minutes)} label="time saved" hero />
    </div>
  );
}

function Stat({ value, label, tone = "text-ink", hero = false }: { value: string; label: string; tone?: string; hero?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={(hero ? "text-[16.5px] font-semibold tabular-nums " : "text-[14.5px] font-semibold tabular-nums ") + tone}>
        {value}
      </span>
      <span className="text-[11.5px] uppercase tracking-[0.06em] text-muted-2">{label}</span>
    </div>
  );
}

const Divider = () => <span className="h-3.5 w-px bg-line" />;

function fmtSaved(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${(m / 60).toFixed(1)} hrs`;
}

function useCountUp(value: number, duration = 600): number {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(start + (value - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}
