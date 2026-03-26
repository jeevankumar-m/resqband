"""
Parse UART lines from ResqBand Hub / Ranger firmware for server.py / api_server.py.

Hub RX (incoming LoRa):
  Received: [PING:RANGER-01:MSG#5] RSSI: -49 dBm

Hub / Ranger TX:
  Ping sent → PING:HUB-01:MSG#5 | TX: OK
  SOS sent → SOS:HUB-01:MSG#6 | TX: OK
  PONG sent | TX: OK

Legacy multi-line blocks still use parse_buffer() in server.py.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

# Incoming RX with RSSI (flexible spacing)
RECEIVED = re.compile(
    r"^Received:\s*\[([^\]]+)\]\s*RSSI:\s*(-?\d+)\s*dBm",
    re.IGNORECASE,
)

# TX confirmations (optional Unicode → or ASCII -> after "sent")
TX_PING_SOS = re.compile(
    r"^(?:Ping|SOS)\s+sent\s*(?:→|->)?\s*(.+?)\s*\|\s*TX:\s*(\w+)",
    re.IGNORECASE,
)

PONG_SENT = re.compile(r"^PONG\s+sent\s*\|\s*TX:\s*(\w+)", re.IGNORECASE)


def _split_lora_payload(inner: str) -> dict | None:
    """TYPE:SENDER or TYPE:SENDER:MSG#N"""
    parts = [p.strip() for p in inner.split(":")]
    if len(parts) < 2:
        return None
    alert_type = parts[0].upper()
    sender = parts[1]
    msg_num: int | None = None
    if len(parts) >= 3:
        tag = parts[2].strip()
        if "#" in tag:
            try:
                msg_num = int(tag.split("#", 1)[1])
            except ValueError:
                msg_num = None
    return {"alertType": alert_type, "sender": sender, "msgNumber": msg_num}


def parse_serial_line(line: str) -> dict | None:
    """
    If the line matches a known firmware pattern, return a telemetry dict for the Web UI.
    Otherwise return None (caller may use legacy PACKET/ block parsing).
    """
    line = line.strip()
    if not line:
        return None

    ts = datetime.now(timezone.utc).isoformat()

    m = RECEIVED.match(line)
    if m:
        inner = m.group(1).strip()
        try:
            rssi = int(m.group(2))
        except ValueError:
            rssi = None
        base = _split_lora_payload(inner)
        if not base:
            return None
        return {
            **base,
            "rssi": rssi,
            "message": "",
            "timestamp": ts,
            "direction": "rx",
        }

    m = TX_PING_SOS.match(line)
    if m:
        inner = m.group(1).strip()
        tx_ok = m.group(2).upper() == "OK"
        base = _split_lora_payload(inner)
        if not base:
            return None
        return {
            **base,
            "rssi": None,
            "message": "TX OK" if tx_ok else "TX FAIL",
            "timestamp": ts,
            "direction": "tx",
        }

    m = PONG_SENT.match(line)
    if m:
        tx_ok = m.group(1).upper() == "OK"
        return {
            "alertType": "PONG",
            "sender": "HUB-01",
            "msgNumber": None,
            "rssi": None,
            "message": "TX OK" if tx_ok else "TX FAIL",
            "timestamp": ts,
            "direction": "tx",
        }

    return None
