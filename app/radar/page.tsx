"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTelemetry } from "@/contexts/TelemetryContext";
import { isSos, type TelemetryPacket } from "@/lib/telemetry";

const MAX_DIST_M = 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function rssiToMeters(rssi: number): number {
  return Math.pow(10, (-40 - rssi) / (10 * 3.0));
}

/** Stable bearing for a sender (no AoA from RSSI; visual only). */
function senderBearing(sender: string): number {
  let h = 5381;
  for (let i = 0; i < sender.length; i++) {
    h = ((h << 5) + h) ^ sender.charCodeAt(i);
  }
  return (15 + ((h >>> 0) % 330)) * (Math.PI / 180);
}

const PixelBrackets = () => (
  <>
    <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-emerald-500/50" />
    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-emerald-500/50" />
    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-emerald-500/50" />
    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-emerald-500/50" />
  </>
);

// ─── Components ─────────────────────────────────────────────────────────────

/** Gateway / hub at center — LoRa + ESP32 receiver; range rings are relative to this point. */
function HubMarker({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g aria-label="Gateway hub — LoRa and ESP32">
      <circle cx={cx} cy={cy} r={14} fill="#022c14" stroke="#10b981" strokeWidth={2} className="shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
      <circle cx={cx} cy={cy} r={5} fill="#10b981" opacity={0.9} />
      <path d={`M ${cx} ${cy - 18} L ${cx - 4} ${cy - 22} L ${cx + 4} ${cy - 22} Z`} fill="#34d399" opacity={0.8} />
      <text x={cx} y={cy + 28} fill="#10b981" fontSize="9" fontWeight="900" fontFamily="monospace" textAnchor="middle" className="opacity-90">
        HUB · LoRa+ESP32
      </text>
    </g>
  );
}

function RadarDisplay({ live }: { live: TelemetryPacket | null }) {
  const SIZE = 440;
  const C = SIZE / 2;
  const R = C - 50;

  const p = live;
  const hasRssi = p !== null && p.rssi !== null;
  const distM = hasRssi ? Math.min(rssiToMeters(p.rssi as number), MAX_DIST_M) : 0;
  const bearing = p ? senderBearing(p.sender) : 0;
  const blipR = hasRssi ? (distM / MAX_DIST_M) * R : 0;
  const bx = C + blipR * Math.sin(bearing);
  const by = C - blipR * Math.cos(bearing);
  const isSOS = p ? isSos(p) : false;

  return (
    <div className="relative group p-4 bg-black/40 rounded-full border border-emerald-500/10 shadow-[inset_0_0_50px_rgba(16,185,129,0.05)]">
      <style>{`
        @keyframes sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes radar-ping { 0% { r: 2; opacity: 1; } 100% { r: 25; opacity: 0; } }
      `}</style>

      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="overflow-visible">
        <circle cx={C} cy={C} r={R} fill="#050a05" stroke="#10b981" strokeWidth="1" strokeOpacity="0.2" />
        {[0.25, 0.5, 0.75].map((f) => (
          <circle key={f} cx={C} cy={C} r={R * f} fill="none" stroke="#10b981" strokeWidth="0.5" strokeOpacity="0.1" strokeDasharray="4 4" />
        ))}

        <line x1={C - R - 10} y1={C} x2={C + R + 10} y2={C} stroke="#10b981" strokeOpacity="0.1" />
        <line x1={C} y1={C - R - 10} x2={C} y2={C + R + 10} stroke="#10b981" strokeOpacity="0.1" />

        {["N", "E", "S", "W"].map((label, i) => {
          const angle = i * 90 * (Math.PI / 180);
          const tx = C + (R + 25) * Math.sin(angle);
          const ty = C - (R + 25) * Math.cos(angle);
          return (
            <text
              key={label}
              x={tx}
              y={ty}
              fill="#10b981"
              fontSize="12"
              fontWeight="900"
              textAnchor="middle"
              alignmentBaseline="middle"
              className="opacity-40 font-mono"
            >
              {label}
            </text>
          );
        })}

        {[250, 500, 750].map((dist) => (
          <text key={dist} x={C + (dist / MAX_DIST_M) * R} y={C - 6} fill="#10b981" fontSize="8" className="opacity-20 font-black">
            {dist}M
          </text>
        ))}

        <defs>
          {/* Radial fade from hub — symmetric within the wedge (no “empty” side like a bad linear grad). */}
          <radialGradient id="sweepGrad" cx={C} cy={C} r={R} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0" />
            <stop offset="45%" stopColor="#10b981" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.42" />
          </radialGradient>
          <filter id="sweepGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {(() => {
          const wedgeDeg = 52;
          const half = ((wedgeDeg / 2) * Math.PI) / 180;
          const north = -Math.PI / 2;
          const a0 = north - half;
          const a1 = north + half;
          const x0 = C + R * Math.cos(a0);
          const y0 = C + R * Math.sin(a0);
          const x1 = C + R * Math.cos(a1);
          const y1 = C + R * Math.sin(a1);
          const largeArc = 0;
          const sweepFlag = 1;
          const wedgeD = `M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${largeArc} ${sweepFlag} ${x1} ${y1} Z`;
          return (
            <g style={{ transformOrigin: `${C}px ${C}px`, animation: "sweep 4s linear infinite" }}>
              <path d={wedgeD} fill="url(#sweepGrad)" opacity={0.95} filter="url(#sweepGlow)" />
              <line x1={C} y1={C} x2={C} y2={C - R} stroke="#10b981" strokeWidth="2" className="shadow-[0_0_10px_#10b981]" />
            </g>
          );
        })()}

        <HubMarker cx={C} cy={C} />

        {p && hasRssi && (
          <g>
            {isSOS && <circle cx={bx} cy={by} r="2" fill="#ef4444" className="animate-[radar-ping_1.5s_ease-out_infinite]" />}
            <rect x={bx - 3} y={by - 3} width="6" height="6" fill={isSOS ? "#ef4444" : "#10b981"} className={isSOS ? "animate-pulse" : ""} />
            <text x={bx + 8} y={by + 4} fill={isSOS ? "#ef4444" : "#10b981"} fontSize="10" fontWeight="900" fontFamily="monospace" className="glow-text">
              {p.sender}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export default function RadarPage() {
  const pathname = usePathname();
  const [now, setNow] = useState(new Date());
  const { packets, wsConnected, serialPort } = useTelemetry();
  const liveRanger = useMemo(
    () => packets.find((p) => p.rssi !== null) ?? null,
    [packets],
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#050a05] text-emerald-500 font-mono selection:bg-emerald-500 selection:text-black">
      {/* CRT Scanline Overlay */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden opacity-[0.03] select-none">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
      </div>

      <div className="flex h-screen overflow-hidden p-4 gap-4">
        {/* ── Sidebar ── */}
        <aside className="w-64 flex flex-col border border-emerald-500/30 bg-emerald-950/10 backdrop-blur-md rounded-lg p-6 relative">
          <div className="mb-10 text-center border-b border-emerald-500/30 pb-6">
            <h1 className="text-2xl font-black tracking-tighter glow-text italic">
              RESQ<span className="opacity-50">BAND</span>
            </h1>
            <p className="text-[10px] mt-1 text-emerald-700 font-black uppercase tracking-[0.2em]">Mil-Spec Interface</p>
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
                    ? "bg-emerald-500 text-black border-emerald-400 shadow-[0_0_15px_#10b981]"
                    : "border-transparent hover:border-emerald-500/50 hover:bg-emerald-500/5"
                }`}
              >
                <span className="text-lg font-bold">{link.icon}</span>
                <span className="font-black tracking-widest">{link.label}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-auto bg-emerald-950/20 p-4 border border-emerald-500/20 text-[10px] font-bold">
            <div className="flex justify-between items-center mb-1">
              <span className="opacity-40 uppercase">System_Clock</span>
              <span>{now.toLocaleTimeString("en-GB")}</span>
            </div>
            <div className="flex justify-between items-center text-emerald-400">
              <span className="opacity-40 uppercase">Com_Link</span>
              <span className={wsConnected ? "animate-pulse" : ""}>{wsConnected ? "ACTIVE" : "OFFLINE"}</span>
            </div>
            {serialPort && (
              <div className="flex justify-between items-center mt-1 opacity-60">
                <span className="uppercase">Serial</span>
                <span>{serialPort}</span>
              </div>
            )}
          </div>
        </aside>

        {/* ── Main Radar Interface ── */}
        <main className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6">
          <header className="flex justify-between items-end border-b border-emerald-500/20 pb-4">
            <div>
              <div className="text-emerald-700 text-[10px] font-black uppercase tracking-[0.4em] mb-1">Spatial_Mesh_Visualizer</div>
              <h2 className="text-4xl font-black tracking-tighter text-emerald-400 glow-text">TACTICAL_RADAR</h2>
            </div>
            <div className="flex gap-2">
              <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-black uppercase">Range: 1.0KM</div>
              <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-black uppercase">Auto_Scan: ON</div>
            </div>
          </header>

          <div className="flex flex-col xl:flex-row gap-6 items-start">
            <div className="relative border border-emerald-500/20 bg-emerald-950/5 p-12 rounded-xl grow flex items-center justify-center min-h-[600px]">
              <PixelBrackets />
              <RadarDisplay live={liveRanger} />

              <div className="absolute top-6 left-6 text-[10px] font-bold opacity-30 leading-relaxed uppercase">
                Origin: gateway (hub)<br />
                Grid_Scale: 1:1000M<br />
                Bearing_Mode: synthetic (RSSI-only)
              </div>
            </div>

            <div className="w-full xl:w-96 space-y-4">
              <div className="relative border border-emerald-500/20 bg-emerald-950/5 p-6">
                <PixelBrackets />
                <h4 className="text-xs font-black uppercase tracking-widest text-emerald-700 mb-4 border-b border-emerald-500/20 pb-2">Target_Lock</h4>
                {!liveRanger ? (
                  <p className="text-[10px] opacity-40 italic">
                    {wsConnected ? "Awaiting ranger packet from gateway…" : "WebSocket offline — start server.py and refresh."}
                  </p>
                ) : (
                  <div
                    className={`p-3 border ${
                      isSos(liveRanger) ? "border-red-500/50 bg-red-500/5" : "border-emerald-500/20 bg-emerald-500/5"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-black text-sm">{liveRanger.sender}</span>
                      <span
                        className={`text-[10px] px-1 font-black ${
                          isSos(liveRanger) ? "bg-red-500 text-black" : "bg-emerald-500 text-black"
                        }`}
                      >
                        {liveRanger.alertType}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-bold opacity-70 uppercase">
                      <div>
                        Dist: ~{liveRanger.rssi !== null ? Math.round(rssiToMeters(liveRanger.rssi)) : "—"}m
                      </div>
                      <div>RSSI: {liveRanger.rssi ?? "—"}dBm</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="relative border border-emerald-500/20 bg-emerald-950/5 p-6 text-[10px] font-bold leading-relaxed">
                <PixelBrackets />
                <h4 className="text-xs font-black uppercase tracking-widest text-emerald-700 mb-4 border-b border-emerald-500/20 pb-2">Telemetry_Notes</h4>
                <p className="text-emerald-600/60 uppercase">
                  {">"} Center = LoRa/ESP32 gateway; range rings are from RSSI estimate.<br />
                  {">"} Only the last live ranger packet is shown.<br />
                  {">"} SOS packets render with alert styling.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>

      <style jsx global>{`
        .glow-text {
          text-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
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
