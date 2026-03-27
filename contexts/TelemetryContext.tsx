"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseWsPayload, type TelemetryPacket } from "@/lib/telemetry";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8765";
const MAX_PACKETS = 500;

/** Server packet plus client receive time (for charts / rate windows). */
export type TelemetryPacketIn = TelemetryPacket & { clientReceivedAt: number };

type TelemetryContextValue = {
  packets: TelemetryPacketIn[];
  wsConnected: boolean;
  serialPort: string | null;
};

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [packets, setPackets] = useState<TelemetryPacketIn[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [serialPort, setSerialPort] = useState<string | null>(null);

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
          const receivedAt = Date.now();
          setPackets((prev) =>
            [{ ...pkt, clientReceivedAt: receivedAt }, ...prev].slice(0, MAX_PACKETS),
          );
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

  const value = useMemo(
    () => ({ packets, wsConnected, serialPort }),
    [packets, wsConnected, serialPort],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): TelemetryContextValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) {
    throw new Error("useTelemetry must be used within TelemetryProvider");
  }
  return ctx;
}
