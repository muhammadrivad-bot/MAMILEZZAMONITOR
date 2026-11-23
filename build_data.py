#!/usr/bin/env python3
"""Build the dashboard data file from the Mami Lezza Google Sheet.

Usage:
    python3 build_data.py

The sheet is exported as public CSV, cleaned (area / mami / product name
variants are normalised), then written to public/data.js as a compact,
dependency-free JavaScript literal that the dashboard reads at runtime.
"""

from __future__ import annotations

import collections
import csv
import datetime as dt
import decimal
import io
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

SHEET_ID = "1Z_g7Z6B_ZVQJyYvhE2kE_tBLoP0J3TsLAY9rNv813t0"
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit?usp=sharing"
CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=0"
# Tiny "did anything change?" probe: row count + total qty + total value.
# ~100 bytes instead of the full ~2.3 MB CSV, so it can be checked every second.
PROBE_URL = (f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq"
             "?tqx=out:csv&gid=0&tq=" + urllib.parse.quote("select count(A), sum(J), sum(L)"))

ROOT = Path(__file__).resolve().parent
# Supports both layouts: local dev uses public/, while a GitHub repository
# uploaded with all files at the root serves data.js straight from the root.
PUBLIC_DIR = ROOT / "public"
OUT = (PUBLIC_DIR / "data.js") if (PUBLIC_DIR / "data.js").exists() else (ROOT / "data.js")
CACHE = (PUBLIC_DIR / "sheet_snapshot.csv.gz") if (PUBLIC_DIR / "sheet_snapshot.csv.gz").exists() \
    else (ROOT / "sheet_snapshot.csv.gz")

MONTH_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
            "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


def fetch_csv(fallback: bool = True) -> str:
    """Fetch CSV from Google Sheets.

    fallback=True  → use the bundled snapshot when the sheet is unreachable
                     (used by build_data.py from the command line).
    fallback=False → raise instead, so a live server can detect the failure
                     and back off instead of pretending the data is fresh.
    """
    try:
        req = urllib.request.Request(CSV_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as res:
            raw = res.read()
        text = raw.decode("utf-8-sig")
        if "value terjual" not in text.lower():
            raise ValueError("Unexpected CSV content")
        # Keep a compressed snapshot so the dashboard data stays reproducible.
        import gzip
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_bytes(gzip.compress(raw, compresslevel=6))
        return text
    except Exception as exc:  # offline / sheet temporarily unavailable
        if fallback and CACHE.exists():
            import gzip
            print(f"Sheet fetch failed ({exc}); using bundled snapshot.")
            return gzip.decompress(CACHE.read_bytes()).decode("utf-8-sig")
        raise


def probe_sheet() -> str:
    """Return a ~100-byte signature of the sheet, or raise on network error."""
    req = urllib.request.Request(PROBE_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return res.read().decode("utf-8-sig").strip()


def parse_money(value: str) -> int:
    """Parse sheet-formatted numbers: comma = thousands, dot = decimal.

    e.g. "44,200.00" -> 44200 (NOT 4420000).
    """
    cleaned = value.strip().replace(",", "")
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", cleaned):
        return 0
    return int(decimal.Decimal(cleaned).quantize(decimal.Decimal("1"), rounding=decimal.ROUND_HALF_UP))


def canonical_area(raw: str) -> str:
    raw = raw.strip()
    match = re.match(r"^(\d+)\.\s*(.+)$", raw)
    if not match:
        return raw
    num, name = match.groups()
    name = name.strip()
    if name.lower() == "b302":
        name = "B302"
    else:
        name = " ".join(word.capitalize() for word in name.lower().split())
    return f"{int(num):02d}. {name}"


def pick_label(counter: collections.Counter[str]) -> str:
    """Most frequent spelling wins; ties resolved alphabetically."""
    return sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def brand_of(product: str) -> str:
    return "Lezza" if product.lower().startswith("lezza") else "Hanarose"


def build_payload(text: str) -> dict:
    """Turn raw sheet CSV into the compact dashboard payload."""
    rows = list(csv.DictReader(io.StringIO(text)))

    # --- normalise name variants before indexing -------------------------
    area_variants: collections.Counter[str] = collections.Counter()
    mami_variants: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    product_variants: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)

    for row in rows:
        status = row["Stock Masuk/ Penjualan"].strip()
        if status not in ("02. Penjualan", ""):
            continue
        value = parse_money(row["value terjual"])
        if value <= 0:
            continue
        area = canonical_area(row["Area"])
        mami = row["Nama Mami Lezza"].strip()
        product = row["Nama barang"].strip()
        if not area or not mami or not product:
            continue
        area_variants[area] += 1
        mami_variants[mami.lower()][mami] += 1
        product_variants[product.lower()][product] += 1

    areas = sorted(area_variants, key=lambda a: (int(a.split(".")[0]), a))
    mamis = sorted(pick_label(c) for c in mami_variants.values())
    products = sorted((pick_label(c) for c in product_variants.values()),
                      key=lambda p: (brand_of(p) != "Lezza", p.lower()))

    area_idx = {name: i for i, name in enumerate(areas)}
    mami_idx = {name: i for i, name in enumerate(mamis)}
    product_idx = {name: i for i, name in enumerate(products)}

    # --- dates and months ------------------------------------------------
    def make_date(row: dict[str, str]) -> dt.date:
        year = row["yy-jual"].strip()
        year = int(year) + 2000 if len(year) == 2 else int(year)
        return dt.date(year, int(row["mm-jual"]), int(row["dd-jual"]))

    date_keys = sorted({make_date(r).isoformat() for r in rows
                        if r["Stock Masuk/ Penjualan"].strip() in ("02. Penjualan", "")
                        and parse_money(r["value terjual"]) > 0})
    # Keep the exact tgl-jual spelling from the sheet in the date filter.
    date_labels: dict[str, str] = {}
    for row in rows:
        if row["Stock Masuk/ Penjualan"].strip() not in ("02. Penjualan", ""):
            continue
        if parse_money(row["value terjual"]) <= 0:
            continue
        date_labels.setdefault(make_date(row).isoformat(), row["tgl-jual"].strip())
    dates = []
    for key in date_keys:
        d = dt.date.fromisoformat(key)
        dates.append({
            "key": key,
            "label": date_labels.get(key, f"{d.day}-{MONTH_ID[d.month - 1]}-{d.strftime('%y')}"),
            "monthKey": f"{d.year:04d}-{d.month:02d}",
        })
    date_idx = {d["key"]: i for i, d in enumerate(dates)}

    month_keys = sorted({d["monthKey"] for d in dates})
    months = []
    for key in month_keys:
        year, month = key.split("-")
        months.append({"key": key, "label": f"{MONTH_ID[int(month) - 1]} {year}"})
    month_idx = {m["key"]: i for i, m in enumerate(months)}

    # --- compact sales records: [date, area, product, mami, qty, value] --
    sales: list[list[int]] = []
    status_counts: collections.Counter[str] = collections.Counter()
    for row in rows:
        status = row["Stock Masuk/ Penjualan"].strip()
        if status not in ("02. Penjualan", ""):
            continue
        value = parse_money(row["value terjual"])
        if value <= 0:
            continue
        area = canonical_area(row["Area"])
        mami = row["Nama Mami Lezza"].strip()
        product = row["Nama barang"].strip()
        if not area or not mami or not product:
            continue
        mami = pick_label(mami_variants[mami.lower()])
        product = pick_label(product_variants[product.lower()])
        date = make_date(row)
        qty = parse_money(row["Qty Pcs terjual"])
        sales.append([date_idx[date.isoformat()], area_idx[area],
                      product_idx[product], mami_idx[mami], qty, value])
        status_counts[status or "(tanpa status / lanjutan penjualan)"] += 1

    product_meta = []
    lezza_i = hanarose_i = 0
    lezza_palette = ["#F2654C", "#F2A03D", "#E14D74", "#B95BD3", "#D9794C", "#EF7C9C", "#F0B544",
                     "#C44B5E", "#E8873D", "#8E5AB5", "#DA6A8E", "#E7B23E"]
    hanarose_palette = ["#2E9C9C", "#3D82C4", "#5D7BD9", "#25A879", "#6B8FB5", "#1E8AAB", "#7BA05B",
                        "#4C6FA8", "#128A78", "#7C6BB8", "#3AA0C4", "#5C8D4D"]
    for product in products:
        brand = brand_of(product)
        color = (lezza_palette if brand == "Lezza" else hanarose_palette)
        product_meta.append({
            "name": product,
            "brand": brand,
            "color": color[(lezza_i if brand == "Lezza" else hanarose_i) % len(color)],
        })
        if brand == "Lezza":
            lezza_i += 1
        else:
            hanarose_i += 1

    payload = {
        "meta": {
            "generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "source": SHEET_URL,
            "sheetRows": len(rows),
            "salesRows": len(sales),
            "statusCounts": dict(status_counts),
            "dateMin": date_keys[0],
            "dateMax": date_keys[-1],
        },
        "areas": areas,
        "months": months,
        "dates": dates,
        "mamis": mamis,
        "products": product_meta,
        "monthIndex": month_idx,
        "sales": sales,
    }
    return payload


def _without_timestamp(payload: dict) -> str:
    """Canonical JSON of the payload, ignoring the run-specific generatedAt."""
    clone = dict(payload)
    meta = dict(clone.get("meta", {}))
    meta.pop("generatedAt", None)
    clone["meta"] = meta
    return json.dumps(clone, ensure_ascii=False, separators=(",", ":"))


def write_data_file(payload: dict) -> bool:
    """Write public/data.js only when the actual data changed.

    Returns True when the file was written. Skipping identical content keeps
    GitHub Actions from creating an empty commit every five minutes.
    """
    OUT.parent.mkdir(parents=True, exist_ok=True)
    new_content = ("// Generated by build_data.py — do not edit by hand.\n"
                   "window.DASH_DATA = " +
                   json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n")
    if OUT.exists():
        try:
            old = OUT.read_text(encoding="utf-8")
            old_json = old[old.index("{", old.index("DASH_DATA")):].rstrip().rstrip(";")
            if _without_timestamp(json.loads(old_json)) == _without_timestamp(payload):
                return False
        except Exception:
            pass  # unreadable / malformed → rewrite it
    OUT.write_text(new_content, encoding="utf-8")
    return True


def main() -> None:
    payload = build_payload(fetch_csv())
    write_data_file(payload)

    meta = payload["meta"]
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"  source rows: {meta['sheetRows']:,} | sales rows: {meta['salesRows']:,} | "
          f"dates: {len(payload['dates'])} | areas: {len(payload['areas'])} | "
          f"mamis: {len(payload['mamis'])} | SKU: {len(payload['products'])}")
    print(f"  periode {meta['dateMin']} s/d {meta['dateMax']} | total value: Rp {sum(r[5] for r in payload['sales']):,}")
    print(f"  status: {meta['statusCounts']}")


if __name__ == "__main__":
    main()
