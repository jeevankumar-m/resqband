"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTelemetry } from "@/contexts/TelemetryContext";
import { isSos, type TelemetryPacket } from "@/lib/telemetry";

const WS_HINT = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8765";
const MAX_SOS = 150;

function sosKey(p: TelemetryPacket, i: number): string {
  return `${p.timestamp}|${p.sender}|${p.msgNumber ?? i}|${i}`;
}

function SignalSegments({ rssi }: { rssi: number | null }) {
  const levels = rssi === null ? 0 : rssi > -70 ? 5 : rssi > -85 ? 3 : rssi > -100 ? 2 : 1;
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((v) => (
        <div
          key={v}
          className={`h-3 w-2 border ${
            v <= levels ? "bg-red-500 border-red-400 shadow-[0_0_8px_#ef4444]" : "bg-transparent border-red-950/40"
          }`}
        />
      ))}
    </div>
  );
}

const PixelBrackets = () => (
  <>
    <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-red-500/50" />
    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-red-500/50" />
    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-red-500/50" />
    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-red-500/50" />
  </>
);

export default function SosMonitorPage() {
  const pathname = usePathname();
  const [now, setNow] = useState(new Date());
  const { packets, wsConnected, serialPort } = useTelemetry();
  const sosAlerts = useMemo(
    () => packets.filter(isSos).slice(0, MAX_SOS),
    [packets],
  );
  const [pulseKey, setPulseKey] = useState<string | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNewestSosRef = useRef<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    prevNewestSosRef.current = sosAlerts[0]
      ? `${sosAlerts[0].timestamp}|${sosAlerts[0].sender}|${sosAlerts[0].msgNumber ?? ""}`
      : null;
  }, []);

  const newestKey = sosAlerts[0]
    ? `${sosAlerts[0].timestamp}|${sosAlerts[0].sender}|${sosAlerts[0].msgNumber ?? ""}`
    : null;

  useEffect(() => {
    if (!newestKey) return;
    if (newestKey === prevNewestSosRef.current) return;
    prevNewestSosRef.current = newestKey;
    setPulseKey(newestKey);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => setPulseKey(null), 2200);
  }, [newestKey]);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    };
  }, []);

  const isPulsing = pulseKey !== null && newestKey === pulseKey;

  return (
    <div className="min-h-screen bg-[#0a0505] text-red-400 font-mono selection:bg-red-600 selection:text-white">
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden opacity-[0.04]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.05),rgba(255,0,0,0.02))] bg-[length:100%_2px,3px_100%]" />
      </div>

      <div className="flex h-screen overflow-hidden p-2 sm:p-4 gap-4">
        <aside className="w-64 flex flex-col border border-red-500/30 bg-red-950/10 backdrop-blur-md rounded-lg p-6 relative">
          <div className="mb-10 text-center border-b border-red-500/30 pb-6">
            <h1 className="text-2xl font-black tracking-tighter text-red-400" style={{ textShadow: "0 0 12px rgba(239,68,68,0.45)" }}>
              RESQ<span className="opacity-50">BAND</span>
            </h1>
            <p className="text-[10px] mt-1 text-red-800 font-bold uppercase tracking-widest">SOS Monitor</p>
          </div>

          <nav className="space-y-4 flex-1">
            {[
              { label: "OVERVIEW", href: "/overview", icon: "▧" },
              { label: "RADAR_LINK", href: "/radar", icon: "◎" },
              { label: "SOS_ALERT", href: "/sos", icon: "⚠" },
              { label: "ANALYTICS", href: "/analytics", icon: "◈" },
            ].map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={`flex items-center gap-3 px-4 py-2 text-sm border transition-all ${
                  pathname === link.href
                    ? "bg-red-600 text-white border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.5)]"
                    : "border-transparent hover:border-red-500/50 hover:bg-red-500/5"
                }`}
              >
                <span className="text-lg">{link.icon}</span>
                <span className="font-black tracking-widest">{link.label}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-auto bg-red-950/30 p-4 border border-red-500/20">
            <div className="flex justify-between items-center text-[10px] mb-2 font-black">
              <span>COM_LINK</span>
              <span className={wsConnected ? "text-red-300 animate-pulse" : "text-red-800"}>
                {wsConnected ? "LIVE" : "OFFLINE"}
              </span>
            </div>
            {serialPort && (
              <div className="flex justify-between items-center text-[10px] mb-2 font-black opacity-70">
                <span>SERIAL</span>
                <span>{serialPort}</span>
              </div>
            )}
            <div className="h-1 bg-red-950/50 overflow-hidden rounded">
              <div className="h-full bg-red-600 w-[85%] animate-pulse" />
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto custom-scrollbar space-y-6">
          <header className="flex flex-wrap justify-between items-end gap-4 border-b border-red-500/25 pb-4">
            <div>
              <div className="flex items-center gap-2 text-red-700 text-[10px] font-black uppercase tracking-[0.3em]">
                <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-ping" />
                Emergency channel only
              </div>
              <h2 className="text-4xl font-black tracking-tighter text-red-400 mt-1" style={{ textShadow: "0 0 14px rgba(239,68,68,0.35)" }}>
                SOS_MONITOR
              </h2>
            </div>
            <div className="text-right text-[10px] font-bold leading-tight text-red-700/90">
              <div>SESSION_SOS: {sosAlerts.length}</div>
              <div className="mt-1">{now.toLocaleTimeString()} UTC_LOCAL</div>
            </div>
          </header>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative p-5 border border-red-500/30 bg-red-950/20">
              <PixelBrackets />
              <p className="text-[10px] font-black text-red-700 uppercase tracking-widest mb-1">TOTAL_IN_SESSION</p>
              <p className="text-4xl font-black text-red-500">{sosAlerts.length}</p>
            </div>
            <div className="relative p-5 border border-red-500/30 bg-red-950/20">
              <PixelBrackets />
              <p className="text-[10px] font-black text-red-700 uppercase tracking-widest mb-1">LATEST_SOS</p>
              <p className="text-sm font-bold text-red-300/90 truncate">
                {sosAlerts[0]
                  ? `${sosAlerts[0].sender} · MSG#${sosAlerts[0].msgNumber ?? "—"}`
                  : "— none yet —"}
              </p>
            </div>
          </div>

          <div className="border border-red-500/30 bg-red-950/10 relative">
            <PixelBrackets />
            <div className="p-4 border-b border-red-500/25 flex justify-between items-center bg-red-500/5">
              <h3 className="text-xs font-black uppercase tracking-widest text-red-400">SOS_Event_Log</h3>
              <span className="text-[10px] font-black text-red-700">RX_ONLY // NOT_FILTERED_ELSEWHERE</span>
            </div>

            <div className="divide-y divide-red-500/15 max-h-[min(56vh,520px)] overflow-y-auto">
              {sosAlerts.length === 0 && (
                <div className="p-8 text-center text-[10px] font-bold text-red-900/60 uppercase tracking-widest">
                  {wsConnected
                    ? "Standing by — no SOS packets in this session."
                    : `No link — run server.py · ${WS_HINT}`}
                </div>
              )}
              {sosAlerts.map((p, i) => {
                const k = sosKey(p, i);
                const isNewest = i === 0 && isPulsing;
                return (
                  <div
                    key={k}
                    className={`p-4 flex flex-wrap sm:flex-nowrap items-center gap-6 transition-all duration-300 bg-red-950/20 hover:bg-red-500/10 ${
                      isNewest ? "ring-2 ring-red-500/70 shadow-[0_0_24px_rgba(239,68,68,0.25)]" : ""
                    }`}
                  >
                    <div className="px-2 py-1 border border-red-500 text-red-400 text-[10px] font-black shadow-[0_0_10px_rgba(239,68,68,0.35)]">
                      SOS
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-black text-red-200 uppercase tracking-tighter">{p.sender}</span>
                        {p.direction && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 border border-red-800 text-red-500">
                            {p.direction === "rx" ? "RX" : "TX"}
                          </span>
                        )}
                        <span className="text-[10px] font-bold text-red-800">MSG_REF: {p.msgNumber ?? "—"}</span>
                      </div>
                      <div className="text-xs text-red-500/90 mt-1 font-bold break-words">
                        {">"} {p.message || "NO_AUX_MESSAGE"}
                      </div>
                      <div className="text-[9px] text-red-900 font-mono mt-1">{p.timestamp}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <SignalSegments rssi={p.rssi} />
                      <span className="text-[10px] font-black text-red-700">
                        {p.rssi !== null ? `${p.rssi} DBM` : "— DBM"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-[9px] text-red-900/80 font-bold uppercase tracking-wider px-1">
            Overview still receives all telemetry types. This page filters SOS only.
          </p>
        </main>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(127, 29, 29, 0.15);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(239, 68, 68, 0.35);
        }
      `}</style>
    </div>
  );
}
