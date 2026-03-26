"""
ResqBand WebSocket server
Reads LoRa packets from a serial port and broadcasts parsed JSON to all
connected WebSocket clients.

Usage:
    pip install -r requirements.txt
    python server.py

Serial formats:
    New hub (single-line RX):
        Received: [PING:RANGER-01:MSG#5] RSSI: -49 dBm
    New hub (TX log):
        Ping sent → PING:HUB-01:MSG#5 | TX: OK
        PONG sent | TX: OK
    Legacy block:
        Packet  : SOS:RANGER-01:MSG#11
        RSSI    : -118 dBm
"""

import asyncio
import json
import queue
import threading
from datetime import datetime, timezone

import serial
import websockets

from serial_codec import parse_serial_line

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SERIAL_PORT = "COM3"
BAUD_RATE = 115200          # match your Arduino Serial.begin() rate
WS_HOST = "localhost"
WS_PORT = 8765

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
connected_clients: set = set()
line_queue: queue.Queue = queue.Queue()


# ---------------------------------------------------------------------------
# Serial reader (runs in a background thread)
# ---------------------------------------------------------------------------
def serial_reader(port: str, baud: int, loop: asyncio.AbstractEventLoop) -> None:
    """Blocking thread — reads lines from the serial port and forwards them
    to the async event loop via the thread-safe line_queue."""
    while True:
        try:
            print(f"[serial] Opening {port} @ {baud} baud …")
            with serial.Serial(port, baud, timeout=1) as ser:
                print(f"[serial] {port} open")
                while True:
                    raw = ser.readline()
                    if raw:
                        line = raw.decode("utf-8", errors="replace").rstrip()
                        loop.call_soon_threadsafe(line_queue.put_nowait, line)
        except serial.SerialException as exc:
            print(f"[serial] Error: {exc} — retrying in 3 s …")
            import time
            time.sleep(3)


# ---------------------------------------------------------------------------
# Packet parser
# ---------------------------------------------------------------------------
def parse_buffer(lines: list[str]) -> dict | None:
    """Turn a buffered block of lines (one full packet) into a dict."""
    packet: dict = {}
    alert_parts: list[str] = []

    for line in lines:
        line = line.strip()

        if line.upper().startswith("PACKET"):
            # "Packet  : SOS:RANGER-01:MSG#11"
            _, _, value = line.partition(":")
            fields = value.strip().split(":")
            if len(fields) >= 3:
                packet["alertType"] = fields[0].strip()
                packet["sender"] = fields[1].strip()
                msg_tag = fields[2].strip()          # e.g. MSG#11
                if "#" in msg_tag:
                    try:
                        packet["msgNumber"] = int(msg_tag.split("#", 1)[1])
                    except ValueError:
                        packet["msgNumber"] = None

        elif line.upper().startswith("RSSI"):
            # "RSSI    : -118 dBm"
            _, _, value = line.partition(":")
            rssi_str = value.strip().replace("dBm", "").replace("DBM", "").strip()
            try:
                packet["rssi"] = int(rssi_str)
            except ValueError:
                packet["rssi"] = None

        elif line and not line.startswith("="):
            # Any other non-separator text is the human-readable alert message
            alert_parts.append(line)

    if not packet:
        return None

    packet["message"] = " ".join(alert_parts) if alert_parts else ""
    packet["timestamp"] = datetime.now(timezone.utc).isoformat()
    return packet


# ---------------------------------------------------------------------------
# Async broadcaster
# ---------------------------------------------------------------------------
async def broadcast(payload: dict) -> None:
    if not connected_clients:
        return
    data = json.dumps(payload)
    # Fire-and-forget to all clients; ignore individual send errors
    results = await asyncio.gather(
        *[client.send(data) for client in connected_clients],
        return_exceptions=True,
    )
    for r in results:
        if isinstance(r, Exception):
            print(f"[ws] Send error (client gone?): {r}")


# ---------------------------------------------------------------------------
# Line consumer — drains line_queue and assembles packets
# ---------------------------------------------------------------------------
async def consume_lines() -> None:
    buffer: list[str] = []

    while True:
        # Drain all currently available lines without blocking
        drained = False
        while not line_queue.empty():
            line = line_queue.get_nowait()
            print(f"[serial] {line}")

            quick = parse_serial_line(line)
            if quick:
                print(f"[ws] Broadcasting: {quick}")
                await broadcast(quick)
                drained = True
                continue

            # A new "Packet" line marks the start of a new packet block.
            # Emit whatever we buffered so far.
            if line.upper().startswith("PACKET") and buffer:
                packet = parse_buffer(buffer)
                if packet:
                    print(f"[ws] Broadcasting: {packet}")
                    await broadcast(packet)
                buffer = []

            buffer.append(line)
            drained = True

        if not drained:
            await asyncio.sleep(0.05)   # yield to the event loop briefly


# ---------------------------------------------------------------------------
# WebSocket connection handler
# ---------------------------------------------------------------------------
async def ws_handler(websocket) -> None:
    connected_clients.add(websocket)
    addr = websocket.remote_address
    print(f"[ws] Client connected: {addr}  (total: {len(connected_clients)})")
    try:
        # Send an immediate status message so the UI knows the server is alive
        await websocket.send(json.dumps({
            "event": "connected",
            "serialPort": SERIAL_PORT,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }))
        await websocket.wait_closed()
    finally:
        connected_clients.discard(websocket)
        print(f"[ws] Client disconnected: {addr}  (total: {len(connected_clients)})")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
async def main() -> None:
    loop = asyncio.get_running_loop()

    # Start the serial reader in a daemon thread so it doesn't block shutdown
    t = threading.Thread(
        target=serial_reader,
        args=(SERIAL_PORT, BAUD_RATE, loop),
        daemon=True,
    )
    t.start()

    print(f"[ws] Server listening on ws://{WS_HOST}:{WS_PORT}")
    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        await consume_lines()   # runs forever


if __name__ == "__main__":
    asyncio.run(main())
