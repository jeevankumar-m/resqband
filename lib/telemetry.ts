/**
 * Canonical shape from Python (server.py / api_server.py) WebSocket & REST:
 * { alertType, sender, msgNumber, rssi, message, timestamp }
 * Plus WebSocket handshake: { event: "connected", serialPort, timestamp }
 */

export type TelemetryPacket = {
  alertType: string;
  sender: string;
  msgNumber: number | null;
  rssi: number | null;
  message: string;
  timestamp: string;
  /** From hub firmware: rx = Received:[…] RSSI, tx = Ping/SOS/PONG sent */
  direction?: "rx" | "tx";
};

export function isSos(p: TelemetryPacket): boolean {
  return p.alertType.trim().toUpperCase() === "SOS";
}

export function isPing(p: TelemetryPacket): boolean {
  return p.alertType.trim().toUpperCase() === "PING";
}

export function isPong(p: TelemetryPacket): boolean {
  return p.alertType.trim().toUpperCase() === "PONG";
}

function parseMsgNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = parseInt(raw.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseRssi(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Maps one backend JSON object to a TelemetryPacket. Rejects status frames and invalid rows.
 */
export function normalizeTelemetryPacket(raw: unknown): TelemetryPacket | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (o.event === "connected") return null;

  const sender = String(o.sender ?? "").trim();
  if (!sender) return null;

  const at = o.alertType;
  if (at === undefined || at === null) return null;
  const alertType = String(at).trim();
  if (!alertType) return null;

  const dir = o.direction;
  const direction =
    dir === "rx" || dir === "tx" ? dir : undefined;

  return {
    alertType: alertType.toUpperCase(),
    sender,
    msgNumber: parseMsgNumber(o.msgNumber),
    rssi: parseRssi(o.rssi),
    message: String(o.message ?? ""),
    timestamp: typeof o.timestamp === "string" ? o.timestamp : new Date().toISOString(),
    ...(direction ? { direction } : {}),
  };
}

export type WsParsed =
  | { type: "status"; serialPort: string }
  | { type: "packet"; packet: TelemetryPacket };

/** WebSocket messages from server.py — status line or telemetry packet JSON. */
export function parseWsPayload(raw: unknown): WsParsed | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.event === "connected" && typeof o.serialPort === "string") {
    return { type: "status", serialPort: o.serialPort };
  }
  const packet = normalizeTelemetryPacket(raw);
  if (!packet) return null;
  return { type: "packet", packet };
}
