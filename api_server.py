"""
ResqBand FastAPI backend — serial LoRa ingest + REST + SSE for the Next.js UI.

Reads the same UART format as server.py, keeps a rolling history, and pushes
new packets to connected overview clients via Server-Sent Events.

Do not run server.py at the same time — only one process can open the serial port.

Usage:
    pip install -r requirements.txt
    python api_server.py

Env:
    RESQ_SERIAL_PORT   default COM3
    RESQ_SERIAL_BAUD   default 115200
    RESQ_API_HOST      default 0.0.0.0
    RESQ_API_PORT      default 8000
"""

from __future__ import annotations

import asyncio
import json
import os
import queue
import threading
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import serial
import uvicorn

from serial_codec import parse_serial_line
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SERIAL_PORT = os.environ.get("RESQ_SERIAL_PORT", "COM3")
BAUD_RATE = int(os.environ.get("RESQ_SERIAL_BAUD", "115200"))
API_HOST = os.environ.get("RESQ_API_HOST", "0.0.0.0")
API_PORT = int(os.environ.get("RESQ_API_PORT", "8000"))

MAX_PACKETS = 500
packet_history: deque[dict] = deque(maxlen=MAX_PACKETS)
line_queue: queue.Queue[str] = queue.Queue()
sse_queues: list[asyncio.Queue[dict]] = []

# ---------------------------------------------------------------------------
# Serial reader (background thread)
# ---------------------------------------------------------------------------


def serial_reader(port: str, baud: int, loop: asyncio.AbstractEventLoop) -> None:
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
# Packet parser (same as server.py)
# ---------------------------------------------------------------------------


def parse_buffer(lines: list[str]) -> dict | None:
    packet: dict = {}
    alert_parts: list[str] = []

    for line in lines:
        line = line.strip()

        if line.upper().startswith("PACKET"):
            _, _, value = line.partition(":")
            fields = value.strip().split(":")
            if len(fields) >= 3:
                packet["alertType"] = fields[0].strip()
                packet["sender"] = fields[1].strip()
                msg_tag = fields[2].strip()
                if "#" in msg_tag:
                    try:
                        packet["msgNumber"] = int(msg_tag.split("#", 1)[1])
                    except ValueError:
                        packet["msgNumber"] = None

        elif line.upper().startswith("RSSI"):
            _, _, value = line.partition(":")
            rssi_str = value.strip().replace("dBm", "").replace("DBM", "").strip()
            try:
                packet["rssi"] = int(rssi_str)
            except ValueError:
                packet["rssi"] = None

        elif line and not line.startswith("="):
            alert_parts.append(line)

    if not packet:
        return None

    packet["message"] = " ".join(alert_parts) if alert_parts else ""
    packet["timestamp"] = datetime.now(timezone.utc).isoformat()
    return packet


async def push_packet(packet: dict) -> None:
    packet_history.append(packet)
    for q in sse_queues:
        try:
            q.put_nowait(packet)
        except Exception:
            pass
    print(f"[api] packet: {packet}")


async def consume_lines() -> None:
    buffer: list[str] = []

    while True:
        drained = False
        while not line_queue.empty():
            line = line_queue.get_nowait()
            print(f"[serial] {line}")

            quick = parse_serial_line(line)
            if quick:
                await push_packet(quick)
                drained = True
                continue

            if line.upper().startswith("PACKET") and buffer:
                packet = parse_buffer(buffer)
                if packet:
                    await push_packet(packet)
                buffer = []

            buffer.append(line)
            drained = True

        if not drained:
            await asyncio.sleep(0.05)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    t = threading.Thread(
        target=serial_reader,
        args=(SERIAL_PORT, BAUD_RATE, loop),
        daemon=True,
    )
    t.start()
    task = asyncio.create_task(consume_lines())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="ResqBand API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "serialPort": SERIAL_PORT, "packetsBuffered": len(packet_history)}


@app.get("/api/packets")
async def get_packets() -> dict:
    return {"packets": list(packet_history), "serialPort": SERIAL_PORT}


@app.get("/api/stream")
async def stream_packets() -> StreamingResponse:
    async def event_gen():
        q: asyncio.Queue[dict] = asyncio.Queue()
        sse_queues.append(q)
        try:
            snap = {"event": "snapshot", "packets": list(packet_history), "serialPort": SERIAL_PORT}
            yield f"data: {json.dumps(snap)}\n\n"
            while True:
                pkt = await q.get()
                yield f"data: {json.dumps({'event': 'packet', 'packet': pkt})}\n\n"
        finally:
            try:
                sse_queues.remove(q)
            except ValueError:
                pass

    return StreamingResponse(event_gen(), media_type="text/event-stream")


if __name__ == "__main__":
    print(f"[api] http://{API_HOST}:{API_PORT}  (serial {SERIAL_PORT})")
    uvicorn.run(app, host=API_HOST, port=API_PORT, reload=False)
