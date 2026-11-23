#!/usr/bin/env python3
"""Dashboard server with periodic refresh from the Mami Lezza Google Sheet.

Run:  python3 server.py       → http://localhost:3000
Env:  PORT=8080 REFRESH_SECONDS=300 python3 server.py
"""

from __future__ import annotations

import datetime as dt
import json
import os
import threading
import time
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import build_data

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
PORT = int(os.environ.get("PORT", "3000"))
REFRESH_SECONDS = int(os.environ.get("REFRESH_SECONDS", "300"))


def build_area_summary(payload: dict) -> dict:
    """Aggregate the sales records into compact omzet-per-area data."""
    areas = payload["areas"]
    months = payload["months"]
    products = payload["products"]

    totals = [[0, 0, 0] for _ in areas]                       # value, qty, rows
    by_month: dict[tuple[int, int], list[int]] = {}            # area, month
    by_brand: dict[tuple[int, str], list[int]] = {}
    by_product: dict[tuple[int, int], list[int]] = {}
    by_mami: dict[tuple[int, int], list[int]] = {}

    for date_i, area_i, product_i, mami_i, qty, value in payload["sales"]:
        month_key = payload["dates"][date_i]["monthKey"]
        month_i = payload["monthIndex"][month_key]
        brand = products[product_i]["brand"]

        for acc in (totals[area_i],
                    by_month.setdefault((area_i, month_i), [0, 0, 0]),
                    by_brand.setdefault((area_i, brand), [0, 0, 0]),
                    by_product.setdefault((area_i, product_i), [0, 0, 0]),
                    by_mami.setdefault((area_i, mami_i), [0, 0, 0])):
            acc[0] += value
            acc[1] += qty
            acc[2] += 1

    pack = lambda d: [[k[0], k[1], v[0], v[1], v[2]] for k, v in sorted(d.items())]
    return {
        "meta": payload["meta"],
        "areas": areas,
        "months": months,
        "totals": totals,
        "byMonth": pack(by_month),
        "byBrand": [[a, b, v[0], v[1], v[2]] for (a, b), v in sorted(by_brand.items())],
        "byProduct": pack(by_product),
        "byMami": pack(by_mami),
        "productNames": [p["name"] for p in products],
        "productBrands": [p["brand"] for p in products],
        "productColors": [p["color"] for p in products],
        "mamiNames": payload["mamis"],
        # Raw compact rows let the browser combine Area + Bulan + Brand filters.
        "sales": payload["sales"],
        "dateMonths": [payload["monthIndex"][d["monthKey"]] for d in payload["dates"]],
    }


class Store:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.summary: dict | None = None
        self.last_attempt = 0.0
        self.last_success = 0.0
        self.status = "loading"
        self.error = ""

    def refresh(self, force: bool = False) -> None:
        with self.lock:
            now = time.time()
            if not force and self.summary is not None and now - self.last_attempt < REFRESH_SECONDS:
                return
            self.last_attempt = now
            try:
                text = build_data.fetch_csv()
                payload = build_data.build_payload(text)
                try:
                    build_data.write_data_file(payload)
                except Exception as file_exc:
                    print(f"[{dt.datetime.now():%H:%M:%S}] Gagal menulis data.js: {file_exc}", flush=True)
                summary = build_area_summary(payload)
                summary["server"] = {
                    "refreshedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
                    "refreshSeconds": REFRESH_SECONDS,
                    "nextRefreshAt": time.time() + REFRESH_SECONDS,
                    "status": "ok",
                    "error": "",
                }
                self.summary = summary
                self.last_success = now
                self.status = "ok"
                self.error = ""
                stamp = dt.datetime.now().strftime("%H:%M:%S")
                print(f"[{stamp}] Data diperbarui: {payload['meta']['salesRows']:,} baris penjualan", flush=True)
            except Exception as exc:  # keep last good data on screen
                self.status = "error" if self.summary is None else "stale"
                self.error = str(exc)
                if self.summary is not None:
                    self.summary["server"] = {
                        "refreshedAt": self.summary["server"]["refreshedAt"],
                        "refreshSeconds": REFRESH_SECONDS,
                        "nextRefreshAt": time.time() + 30,
                        "status": "stale",
                        "error": self.error,
                    }
                print(f"[{dt.datetime.now():%H:%M:%S}] Gagal update sheet: {exc}", flush=True)

    def current(self) -> dict:
        with self.lock:
            if self.summary is None:
                return {"server": {"status": self.status, "error": self.error,
                                   "refreshSeconds": REFRESH_SECONDS,
                                   "nextRefreshAt": time.time() + 10}}
            return self.summary


store = Store()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/api/omzet-area", "/api/refresh"):
            if parsed.path == "/api/refresh":
                store.refresh(force=True)
            else:
                query = urllib.parse.parse_qs(parsed.query)
                if query.get("force", ["0"])[0] == "1":
                    store.refresh(force=True)
            body = json.dumps(store.current(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt: str, *args) -> None:
        # Quieter logs: only non-200 responses are interesting.
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


def refresher() -> None:
    while True:
        store.refresh()
        time.sleep(5)


if __name__ == "__main__":
    print(f"Mami Lezza Dashboard → http://localhost:{PORT}", flush=True)
    print(f"Auto-update tiap {REFRESH_SECONDS} detik (browser mengecek tiap 30 detik)", flush=True)
    store.refresh(force=True)
    threading.Thread(target=refresher, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
