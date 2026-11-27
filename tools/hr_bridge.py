"""Heart-rate bridge: reads several Bluetooth LE watches/straps at once through Windows and serves
their latest bpm to the dashboard (local only, http://127.0.0.1:5174).

Run:   python tools/hr_bridge.py                 (connects every device whose name starts with H1)
       python tools/hr_bridge.py "Polar"         (another name prefix)
       python tools/hr_bridge.py "H1,Polar,Coros"  (several prefixes, separated by commas)
Needs: pip install --user bleak

Endpoints:
  /devices   every device the bridge found: id, name, connected, bpm, age (seconds since the last bpm)
  /hr        the first device only, in the old single-watch shape
"""
import asyncio
import json
import sys
import time

from bleak import BleakClient, BleakScanner

ARG = sys.argv[1] if len(sys.argv) > 1 else "H1"
PREFIXES = [p.strip().lower() for p in ARG.split(",") if p.strip()] or ["h1"]
HR_CHAR = "00002a37-0000-1000-8000-00805f9b34fb"
PORT = 5174

devices = {}   # address -> {"id", "name", "bpm", "t", "connected"}
tasks = {}     # address -> the task that keeps that device connected


def matches(name):
    name = (name or "").lower()
    return any(name.startswith(p) for p in PREFIXES)


def on_hr(st, data):
    flags = data[0]
    bpm = int.from_bytes(data[1:3], "little") if flags & 1 else data[1]
    if bpm > 0:
        st["bpm"] = bpm
        st["t"] = time.time()


async def keep_connected(addr, dev):
    """One device: connect, listen, and come back after a drop (the watch may sleep or go out of range)."""
    st = devices[addr]
    while True:
        try:
            gone = asyncio.Event()
            async with BleakClient(dev, timeout=20, disconnected_callback=lambda c: gone.set()) as client:
                st["connected"] = True
                print("connected: %s (%s)" % (st["name"] or addr, addr), flush=True)
                await client.start_notify(HR_CHAR, lambda _, data: on_hr(st, data))
                await gone.wait()
        except Exception as e:
            print("ble error (%s): %s" % (st["name"] or addr, e), flush=True)
        st["connected"] = False
        print("disconnected: %s, retrying..." % (st["name"] or addr), flush=True)
        await asyncio.sleep(2)


async def scan_loop():
    """Keeps looking, so a watch switched on later is picked up without restarting the bridge."""
    print("searching for devices named " + ", ".join(p.upper() for p in PREFIXES) + "...", flush=True)
    while True:
        try:
            found = await BleakScanner.discover(timeout=6, return_adv=True)
            for addr, (dev, adv) in found.items():
                name = dev.name or adv.local_name or ""
                if matches(name) and addr not in tasks:
                    devices[addr] = {"id": addr, "name": name, "bpm": 0, "t": 0.0, "connected": False}
                    tasks[addr] = asyncio.create_task(keep_connected(addr, dev))
                    print("found: %s (%s)" % (name, addr), flush=True)
        except Exception as e:
            print("scan error:", e, flush=True)
        await asyncio.sleep(1)


def public(st):
    return {
        "id": st["id"], "name": st["name"], "connected": st["connected"], "bpm": st["bpm"],
        "age": round(time.time() - st["t"], 1) if st["t"] else None,
    }


def render(path):
    """The JSON for a request path."""
    if path.split("?")[0].rstrip("/") == "/devices":
        return {"devices": [public(st) for st in devices.values()]}
    first = next(iter(devices.values()), None)
    if first is None:
        return {"bpm": 0, "t": 0.0, "connected": False, "name": "", "age": None}
    return {**first, **public(first)}


async def handle(reader, writer):
    try:
        head = await reader.readuntil(b"\r\n\r\n")
        path = head.split(b" ", 2)[1].decode("ascii", "replace")
    except Exception:
        writer.close()
        return
    body = json.dumps(render(path)).encode()
    writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n"
                 b"Cache-Control: no-store\r\nContent-Length: " + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body)
    try:
        await writer.drain()
    finally:
        writer.close()


async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    print("bridge ready: http://127.0.0.1:%d/devices" % PORT, flush=True)
    async with server:
        await asyncio.gather(scan_loop(), server.serve_forever())


if __name__ == "__main__":
    asyncio.run(main())
