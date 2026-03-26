"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { isPing, isPong, isSos, parseWsPayload, type TelemetryPacket } from "@/lib/telemetry";

/** Same WebSocket as radar / `server.py` (default ws://localhost:8765). */
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8765";

function packetKey(p: TelemetryPacket, i: number): string {
  return `${p.timestamp}|${p.sender}|${p.msgNumber ?? i}|${p.direction ?? ""}|${p.alertType}|${i}`;
}

function badgeClasses(p: TelemetryPacket): string {
  if (isSos(p)) return "border-red-500 text-red-500 shadow-[0_0_10px_#ef4444]";
  if (isPong(p)) return "border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.35)]";
  if (isPing(p)) return "border-emerald-400 text-emerald-300";
  return "border-emerald-500 text-emerald-500";
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

/** Visual Signal segments (Military LED style) */
function SignalSegments({ rssi }: { rssi: number | null }) {
  const levels = rssi === null ? 0 : rssi > -70 ? 5 : rssi > -85 ? 3 : rssi > -100 ? 2 : 1;
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((v) => (
        <div
          key={v}
          className={`h-3 w-2 border ${
            v <= levels ? "bg-emerald-500 border-emerald-400 shadow-[0_0_8px_#10b981]" : "bg-transparent border-emerald-900/30"
          }`}
        />
      ))}
    </div>
  );
}

/** Pixel Brackets for that "Mission HUD" feel */
const PixelBrackets = () => (
  <>
    <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-emerald-500/50" />
    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-emerald-500/50" />
    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-emerald-500/50" />
    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-emerald-500/50" />
  </>
);

const MAX_ROWS = 200;

export default function OverviewPage() {
  const pathname = usePathname();
  const [now, setNow] = useState(new Date());
  const [wsConnected, setWsConnected] = useState(false);
  const [serialPort, setSerialPort] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<TelemetryPacket[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
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
          setAlerts((prev) => [parsed.packet, ...prev].slice(0, MAX_ROWS));
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

  const sosCount = alerts.filter(isSos).length;
  const rssiWithValues = alerts.map((a) => a.rssi).filter((r): r is number => typeof r === "number");
  const rssiAvg =
    rssiWithValues.length > 0
      ? Math.round(rssiWithValues.reduce((a, b) => a + b, 0) / rssiWithValues.length)
      : null;

  return (
    <div className="min-h-screen bg-[#050a05] text-emerald-500 font-mono selection:bg-emerald-500 selection:text-black">
      {/* ── CRT Overlay Effects ── */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden opacity-[0.03]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
      </div>
      
      <div className="flex h-screen overflow-hidden p-2 sm:p-4 gap-4">
        
        {/* ── Sidebar ── */}
        <aside className="w-64 flex flex-col border border-emerald-500/30 bg-emerald-950/10 backdrop-blur-md rounded-lg p-6 relative">
          <div className="mb-10 text-center border-b border-emerald-500/30 pb-6">
            <h1 className="text-2xl font-black tracking-tighter glow-text">
              RESQ<span className="opacity-50">.SYS</span>
            </h1>
            <p className="text-[10px] mt-1 text-emerald-700 font-bold uppercase tracking-widest">Tactical Mesh OS v4.0</p>
          </div>

          <nav className="space-y-4 flex-1">
            {[
              { label: "OVERVIEW", href: "/overview", icon: "▧" },
              { label: "RADAR_LINK", href: "/radar", icon: "◎" },
              { label: "SOS_ALERT", href: "/sos", icon: "⚠" },
            ].map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={`flex items-center gap-3 px-4 py-2 text-sm border transition-all ${
                  pathname === link.href 
                    ? "bg-emerald-500 text-black border-emerald-400 shadow-[0_0_15px_#10b981]" 
                    : "border-transparent hover:border-emerald-500/50 hover:bg-emerald-500/5"
                }`}
              >
                <span className="text-lg">{link.icon}</span>
                <span className="font-black tracking-widest">{link.label}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-auto bg-emerald-950/20 p-4 border border-emerald-500/20">
            <div className="flex justify-between items-center text-[10px] mb-2 font-black">
              <span>COM_LINK</span>
              <span className={wsConnected ? "text-emerald-400 animate-pulse" : "text-red-500"}>
                {wsConnected ? "LIVE" : "OFFLINE"}
              </span>
            </div>
            {serialPort && (
              <div className="flex justify-between items-center text-[10px] mb-2 font-black opacity-70">
                <span>SERIAL</span>
                <span>{serialPort}</span>
              </div>
            )}
            <div className="h-1 bg-emerald-900/50 overflow-hidden">
               <div className="h-full bg-emerald-500 w-[70%] animate-[shimmer_2s_infinite]" />
            </div>
          </div>
        </aside>

        {/* ── Main Terminal ── */}
        <main className="flex-1 overflow-y-auto custom-scrollbar space-y-6">
          <header className="flex justify-between items-end border-b border-emerald-500/20 pb-4">
            <div>
              <div className="flex items-center gap-2 text-emerald-700 text-[10px] font-black uppercase tracking-[0.3em]">
                <span className="inline-block w-2 h-2 bg-emerald-500 animate-ping" />
                Live Telemetry Output
              </div>
              <h2 className="text-4xl font-black tracking-tighter text-emerald-400 glow-text">COMMAND_CENTRE</h2>
            </div>
            <div className="text-right text-[10px] font-bold leading-tight">
              <div>LOC: 42.3601° N, 71.0589° W</div>
              <div className="text-emerald-700 mt-1">{now.toLocaleTimeString()} // ID: 0xFF-42</div>
            </div>
          </header>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: "SOS_INBOUND", val: sosCount, sub: "PRIORITY ALPHA", status: "ALERT", alert: sosCount > 0 },
              {
                label: "RSSI_AVG",
                val: rssiAvg !== null ? String(rssiAvg) : "—",
                sub: "SIGNAL_DBM",
                status: rssiAvg !== null ? "LIVE" : "N/A",
              },
            ].map((s, i) => (
              <div key={i} className={`relative p-6 border border-emerald-500/30 bg-emerald-950/5 group hover:bg-emerald-500/5 transition-all ${s.alert ? 'border-red-500/50' : ''}`}>
                <PixelBrackets />
                <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-1">{s.label}</p>
                <div className="flex items-baseline gap-2">
                  <h3 className={`text-5xl font-black ${s.alert ? "text-red-500 animate-[pulse_0.5s_infinite]" : "text-emerald-400"}`}>
                    {s.val}
                  </h3>
                  <span className="text-[10px] font-bold opacity-50">[{s.status}]</span>
                </div>
                <p className="text-[10px] mt-2 font-bold opacity-30 tracking-tighter">CHECKSUM: VALID</p>
              </div>
            ))}
          </div>

          {/* Data Feed */}
          <div className="border border-emerald-500/30 bg-emerald-950/5 relative">
            <PixelBrackets />
            <div className="p-4 border-b border-emerald-500/30 flex justify-between items-center bg-emerald-500/5">
              <h3 className="text-xs font-black uppercase tracking-widest">Inbound_Packet_Stream</h3>
              <div className="flex gap-4 text-[10px] font-black opacity-50">
                <span>FREQ: 433.00</span>
                <span>BW: 125K</span>
              </div>
            </div>

            <div className="divide-y divide-emerald-500/20 max-h-[500px] overflow-y-auto">
              {alerts.length === 0 && (
                <div className="p-6 text-[10px] font-bold text-emerald-700/50 uppercase tracking-widest">
                  {wsConnected
                    ? "Listening — no packets yet."
                    : `No WebSocket at ${WS_URL} — run: python server.py`}
                </div>
              )}
              {alerts.map((p, i) => (
                <div
                  key={packetKey(p, i)}
                  className={`p-4 flex flex-wrap sm:flex-nowrap items-center gap-6 hover:bg-emerald-500/10 transition-colors ${
                    isSos(p) ? "bg-red-500/10" : ""
                  }`}
                >
                  <div className={`px-2 py-1 border text-[10px] font-black ${badgeClasses(p)}`}>{p.alertType}</div>

                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                      <span className="font-black text-emerald-200 uppercase tracking-tighter italic underline decoration-emerald-500/30">
                        {p.sender}
                      </span>
                      {p.direction && (
                        <span
                          className={`text-[9px] font-black px-1.5 py-0.5 border ${
                            p.direction === "rx"
                              ? "border-emerald-600 text-emerald-400 bg-emerald-950/50"
                              : "border-amber-600/80 text-amber-400/90 bg-amber-950/20"
                          }`}
                        >
                          {p.direction === "rx" ? "RX" : "TX"}
                        </span>
                      )}
                      <span className="text-[10px] font-bold text-emerald-800">
                        MSG_REF: {p.msgNumber ?? "—"}
                      </span>
                    </div>
                    <div className="text-xs text-emerald-600 mt-1 font-bold">
                      {">"} {p.message || "NO_STRING_DATA // BEACON_ONLY"}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <SignalSegments rssi={p.rssi} />
                    <span className="text-[10px] font-black text-emerald-700">
                      {p.rssi !== null ? `${p.rssi} DBM` : "— DBM"} // CH_01
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      <style jsx global>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        .glow-text {
          text-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(16, 185, 129, 0.05);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(16, 185, 129, 0.3);
        }
      `}</style>
    </div>
  );
}