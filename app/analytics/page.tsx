"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { parseWsPayload } from "@/lib/telemetry";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8765";
const MAX_RSSI_POINTS = 200;
const PATH_LOSS_N = 3.0;

function rssiToMeters(rssi: number): number {
  return Math.pow(10, (-40 - rssi) / (10 * PATH_LOSS_N));
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type RssiPoint = {
  ts: number;
  timeLabel: string;
  rssi: number;
  distM: number;
  sender: string;
  alertType: string;
};

const NAV = [
  { label: "OVERVIEW", href: "/overview", icon: "▧" },
  { label: "RADAR_LINK", href: "/radar", icon: "◎" },
  { label: "SOS_ALERT", href: "/sos", icon: "⚠" },
  { label: "ANALYTICS", href: "/analytics", icon: "◈" },
] as const;

export default function AnalyticsPage() {
  const pathname = usePathname();
  const [now, setNow] = useState(new Date());
  const [wsConnected, setWsConnected] = useState(false);
  const [serialPort, setSerialPort] = useState<string | null>(null);
  const [rssiSeries, setRssiSeries] = useState<RssiPoint[]>([]);
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [totalPackets, setTotalPackets] = useState(0);
  const [rateTimestamps, setRateTimestamps] = useState<number[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        if (!cancelled) setWsConnected(true);
      };

      ws.onmessage = (ev) => {
        try {
          const data: unknown = JSON.parse(String(ev.data));
          const parsed = parseWsPayload(data);
          if (!parsed || cancelled) return;
          if (parsed.type === "status") {
            setSerialPort(parsed.serialPort);
            return;
          }
          const pkt = parsed.packet;
          const at = pkt.alertType.toUpperCase();
          setTypeCounts((prev) => ({ ...prev, [at]: (prev[at] ?? 0) + 1 }));
          setTotalPackets((n) => n + 1);
          const t0 = Date.now();
          setRateTimestamps((prev) => [...prev.filter((x) => t0 - x < 60_000), t0]);

          if (pkt.rssi !== null) {
            const ts = t0;
            seq.current += 1;
            const rssi = pkt.rssi;
            const distM = Math.min(rssiToMeters(rssi), 1000);
            setRssiSeries((prev) => {
              const next: RssiPoint[] = [
                ...prev,
                {
                  ts,
                  timeLabel: formatClock(ts),
                  rssi,
                  distM: Math.round(distM),
                  sender: pkt.sender,
                  alertType: at,
                },
              ];
              return next.slice(-MAX_RSSI_POINTS);
            });
          }
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        if (!cancelled) setWsConnected(false);
      };

      ws.onclose = () => {
        if (!cancelled) {
          setWsConnected(false);
          setSerialPort(null);
        }
      };
    };

    connect();
    return () => {
      cancelled = true;
      ws?.close();
    };
  }, []);

  const ppm = useMemo(() => rateTimestamps.length, [rateTimestamps]);

  const rssiStats = useMemo(() => {
    if (rssiSeries.length === 0) return { min: null as number | null, max: null as number | null, last: null as number | null };
    const vals = rssiSeries.map((p) => p.rssi);
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      last: rssiSeries[rssiSeries.length - 1]?.rssi ?? null,
    };
  }, [rssiSeries]);

  const barData = useMemo(
    () =>
      Object.entries(typeCounts)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
    [typeCounts],
  );

  const chartData = useMemo(
    () =>
      rssiSeries.map((p) => ({
        ...p,
        distM: p.distM,
      })),
    [rssiSeries],
  );

  return (
    <div className="min-h-screen bg-[#0c1222] text-slate-200 font-mono selection:bg-sky-500/40">
      <div className="pointer-events-none fixed inset-0 z-50 opacity-[0.035]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0)_50%,rgba(0,0,0,0.2)_50%)] bg-[length:100%_3px]" />
      </div>

      <div className="flex h-screen overflow-hidden p-2 sm:p-4 gap-4">
        <aside className="w-64 shrink-0 flex flex-col border border-slate-600/40 bg-slate-950/60 backdrop-blur-md rounded-xl p-6">
          <div className="mb-8 text-center border-b border-slate-600/40 pb-6">
            <h1 className="text-2xl font-black tracking-tighter text-sky-400" style={{ textShadow: "0 0 14px rgba(56,189,248,0.35)" }}>
              RESQ<span className="opacity-50">.SYS</span>
            </h1>
            <p className="text-[10px] mt-1 text-slate-500 font-bold uppercase tracking-widest">Live analytics</p>
          </div>

          <nav className="space-y-3 flex-1">
            {NAV.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-4 py-2 text-sm border rounded-lg transition-all ${
                  pathname === link.href
                    ? "bg-sky-600 text-white border-sky-400 shadow-[0_0_16px_rgba(56,189,248,0.35)]"
                    : "border-transparent hover:border-slate-600 hover:bg-slate-900/80"
                }`}
              >
                <span className="text-lg">{link.icon}</span>
                <span className="font-black tracking-widest">{link.label}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-auto bg-slate-900/80 p-4 border border-slate-700/60 rounded-lg text-[10px] font-bold">
            <div className="flex justify-between mb-1">
              <span className="text-slate-500">COM_LINK</span>
              <span className={wsConnected ? "text-emerald-400" : "text-red-500"}>{wsConnected ? "LIVE" : "OFFLINE"}</span>
            </div>
            {serialPort && (
              <div className="flex justify-between opacity-70">
                <span>SERIAL</span>
                <span>{serialPort}</span>
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto custom-scrollbar space-y-5 pr-1">
          <header className="flex flex-wrap justify-between gap-4 border-b border-slate-700/50 pb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-slate-500">Real-time metrics</p>
              <h2 className="text-3xl font-black tracking-tight text-sky-300 mt-1">NETWORK_ANALYTICS</h2>
            </div>
            <div className="text-right text-[10px] text-slate-500">
              <div>{now.toLocaleTimeString()}</div>
              <div className="mt-1 text-slate-600">WS · {WS_URL}</div>
            </div>
          </header>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Last RSSI", val: rssiStats.last !== null ? `${rssiStats.last} dBm` : "—", sub: "last RX w/ RSSI" },
              { label: "Range (session)", val: rssiStats.min !== null ? `${rssiStats.min} … ${rssiStats.max}` : "—", sub: "dBm min / max" },
              { label: "RX rate", val: `${ppm}/min`, sub: "rolling 60s window" },
              { label: "Packets (session)", val: String(totalPackets), sub: "all types" },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-slate-700/60 bg-slate-900/50 px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">{c.label}</p>
                <p className="text-xl font-black text-sky-200 mt-1 tabular-nums">{c.val}</p>
                <p className="text-[9px] text-slate-600 mt-0.5">{c.sub}</p>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Signal strength (RSSI)</h3>
            <p className="text-[10px] text-slate-600 mb-3">Live line — stronger signal is closer to 0 dBm. Brush below to zoom the time window.</p>
            <div className="h-[300px] w-full min-h-[280px]">
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[11px] text-slate-600">
                  {wsConnected ? "Waiting for packets with RSSI…" : "Connect server.py to stream data."}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.6} />
                    <XAxis dataKey="timeLabel" tick={{ fill: "#64748b", fontSize: 10 }} minTickGap={24} />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fill: "#64748b", fontSize: 10 }}
                      width={44}
                      label={{ value: "dBm", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: "11px" }}
                      labelStyle={{ color: "#94a3b8" }}
                      formatter={(value) => {
                        const v = typeof value === "number" ? value : Number(value);
                        return [`${Number.isFinite(v) ? v : value} dBm`, "RSSI"];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Line type="monotone" dataKey="rssi" name="RSSI" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Brush dataKey="timeLabel" height={28} stroke="#475569" fill="#1e293b" travellerWidth={8} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Estimated range (path loss model)</h3>
              <p className="text-[10px] text-slate-600 mb-3">Same RSSI series, distance capped at 1000 m (indicative).</p>
              <div className="h-[260px] w-full">
                {chartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[11px] text-slate-600">No distance data yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="distGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                      <XAxis dataKey="timeLabel" tick={{ fill: "#64748b", fontSize: 10 }} minTickGap={20} />
                      <YAxis
                        tick={{ fill: "#64748b", fontSize: 10 }}
                        width={44}
                        label={{ value: "m", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: "11px" }}
                        formatter={(v) => [`${v ?? "—"} m`, "Est. distance"]}
                      />
                      <Area type="monotone" dataKey="distM" name="Distance (m)" stroke="#22d3ee" fill="url(#distGrad)" strokeWidth={1.5} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Packet mix (session)</h3>
              <p className="text-[10px] text-slate-600 mb-3">Counts by alert type for this browser session.</p>
              <div className="h-[260px] w-full">
                {barData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[11px] text-slate-600">No packets yet</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "#64748b", fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" width={72} tick={{ fill: "#94a3b8", fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "8px", fontSize: "11px" }}
                        formatter={(v) => [v ?? "—", "Count"]}
                      />
                      <Bar dataKey="value" name="Packets" fill="#6366f1" radius={[0, 4, 4, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.5);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(71, 85, 105, 0.6);
        }
      `}</style>
    </div>
  );
}
