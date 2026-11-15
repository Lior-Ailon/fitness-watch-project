"""Heart-rate bridge: reads a Bluetooth LE watch/strap through Windows and serves the latest
bpm to the dashboard at http://127.0.0.1:5174/hr  (local only).

Run:   python tools/hr_bridge.py            (finds the first device named H1*)
       python tools/hr_bridge.py "Polar"    (any other name prefix)
Needs: pip install --user bleak
"""
import asyncio
import json
import sys
import time

from bleak import BleakClient, BleakScanner

PREFIX = (sys.argv[1] if len(sys.argv) > 1 else "H1").lower()
HR_CHAR = "00002a37-0000-1000-8000-00805f9b34fb"
PORT = 5174
state = {"bpm": 0, "t": 0.0, "connected": False, "name": ""}


def on_hr(_, data):
    flags = data[0]
    bpm = int.from_bytes(data[1:3], "little") if flags & 1 else data[1]
    if bpm > 0:
        state["bpm"] = bpm
        state["t"] = time.time()


async def ble_loop():
    while True:
        try:
            print("searching for a device named " + PREFIX.upper() + "...", flush=True)
            dev = await BleakScanner.find_device_by_filter(
                lambda d, adv: (d.name or "").lower().startswith(PREFIX), timeout=15)
            if not dev:
                continue
            gone = asyncio.Event()
            async with BleakClient(dev, timeout=20, disconnected_callback=lambda c: gone.set()) as client:
                state.update(connected=True, name=dev.name or "")
                print("connected: " + (dev.name or dev.address), flush=True)
                await client.start_notify(HR_CHAR, on_hr)
                await gone.wait()
        except Exception as e:  # keep trying: the watch may sleep or go out of range
            print("ble error:", e, flush=True)
        state["connected"] = False
        print("disconnected, retrying...", flush=True)
        await asyncio.sleep(2)


async def handle(reader, writer):
    try:
        await reader.readuntil(b"\r\n\r\n")
    except Exception:
        writer.close()
        return
    body = json.dumps({**state, "age": round(time.time() - state["t"], 1) if state["t"] else None}).encode()
    writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n"
                 b"Cache-Control: no-store\r\nContent-Length: " + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body)
    try:
        await writer.drain()
    finally:
        writer.close()


async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    print("bridge ready: http://127.0.0.1:%d/hr" % PORT, flush=True)
    async with server:
        await asyncio.gather(ble_loop(), server.serve_forever())


asyncio.run(main())
