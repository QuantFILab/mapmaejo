from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
WORKBOOK_PATH = next(ROOT.glob("*.xlsx"))
DATA_DIR = ROOT / "data"
JSON_OUTPUT_PATH = DATA_DIR / "locations.json"
JS_OUTPUT_PATH = DATA_DIR / "locations.js"

PROVINCE_COORDS = {
    "กรุงเทพมหานคร": {"lat": 13.7563, "lng": 100.5018},
    "กำแพงเพชร": {"lat": 16.4828, "lng": 99.5227},
    "กาญจนบุรี": {"lat": 14.0228, "lng": 99.5328},
    "ฉะเชิงเทรา": {"lat": 13.6904, "lng": 101.0779},
    "ชัยนาท": {"lat": 15.1852, "lng": 100.1251},
    "เชียงใหม่": {"lat": 18.7883, "lng": 98.9853},
    "นครปฐม": {"lat": 13.8199, "lng": 100.0622},
    "นครราชสีมา": {"lat": 14.9799, "lng": 102.0977},
    "นครศรีธรรมราช": {"lat": 8.4304, "lng": 99.9631},
    "ประจวบคีรีขันธ์": {"lat": 11.8124, "lng": 99.7973},
    "ปราจีนบุรี": {"lat": 14.0509, "lng": 101.3701},
    "พะเยา": {"lat": 19.1663, "lng": 99.9018},
    "พิษณุโลก": {"lat": 16.8211, "lng": 100.2659},
    "เพชรบูรณ์": {"lat": 16.4180, "lng": 101.1606},
    "ราชบุรี": {"lat": 13.5360, "lng": 99.8171},
    "ลำปาง": {"lat": 18.2855, "lng": 99.5128},
    "ลำพูน": {"lat": 18.5790, "lng": 99.0087},
    "สระบุรี": {"lat": 14.5289, "lng": 100.9101},
    "สระแก้ว": {"lat": 13.8240, "lng": 102.0646},
    "อุบลราชธานี": {"lat": 15.2448, "lng": 104.8472},
}


def normalize_text(value: object) -> str:
    if pd.isna(value):
        return ""
    text = str(value).replace("\u200b", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def normalize_student_id(value: object) -> str:
    if pd.isna(value) or value == "":
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return normalize_text(value)


def clip_address_noise(address: str) -> str:
    cleaned = normalize_text(address)
    if not cleaned:
        return ""

    five_digit_zip = re.search(r"^(.+?\d{5})(?:\s|$)", cleaned)
    if five_digit_zip:
        return five_digit_zip.group(1).strip()

    for marker in (" โทร", " คุณ", " เรียน "):
        idx = cleaned.find(marker)
        if idx > 0:
            return cleaned[:idx].strip(" ,")

    return cleaned


def extract_province(address: str) -> str:
    cleaned = clip_address_noise(address)
    if not cleaned:
        return ""

    province_match = re.search(r"จ\.\s*([^\d,]+)", cleaned)
    if province_match:
        province = normalize_text(province_match.group(1)).split()[0]
        if province in PROVINCE_COORDS:
            return province

    for province in sorted(PROVINCE_COORDS, key=len, reverse=True):
        if province in cleaned:
            return province

    return ""


def pick_most_common(series: pd.Series) -> str:
    values = [normalize_text(value) for value in series if normalize_text(value)]
    if not values:
        return ""
    return Counter(values).most_common(1)[0][0]


def row_to_student(row: pd.Series, columns: list[str]) -> dict[str, object]:
    major_col, order_col, student_id_col, name_col, establishment_col = (
        columns[0],
        columns[1],
        columns[2],
        columns[3],
        columns[7],
    )
    return {
        "major": normalize_text(row[major_col]),
        "order": normalize_text(row[order_col]),
        "studentId": normalize_student_id(row[student_id_col]),
        "name": normalize_text(row[name_col]),
        "establishment": normalize_text(row[establishment_col]),
    }


def build_payload() -> dict[str, object]:
    df = pd.read_excel(WORKBOOK_PATH, sheet_name=0)
    columns = list(df.columns)

    establishment_col = columns[7]
    address_col = columns[8]
    postal_col = columns[12]

    for column in columns:
        df[column] = df[column].map(normalize_text)

    nonblank_address_by_establishment = (
        df[df[address_col] != ""].groupby(establishment_col)[address_col].agg(pick_most_common)
    )
    postal_address_by_establishment = (
        df[df[postal_col] != ""].groupby(establishment_col)[postal_col].agg(pick_most_common)
    )

    filled_addresses: list[str] = []
    address_sources: list[str] = []

    for _, row in df.iterrows():
        direct_address = clip_address_noise(row[address_col])
        establishment = row[establishment_col]
        postal_address = clip_address_noise(row[postal_col])

        if direct_address:
            filled_addresses.append(direct_address)
            address_sources.append("address")
        elif establishment and establishment in nonblank_address_by_establishment:
            filled_addresses.append(clip_address_noise(nonblank_address_by_establishment[establishment]))
            address_sources.append("same_establishment")
        elif postal_address:
            filled_addresses.append(postal_address)
            address_sources.append("postal")
        elif establishment and establishment in postal_address_by_establishment:
            filled_addresses.append(clip_address_noise(postal_address_by_establishment[establishment]))
            address_sources.append("same_establishment_postal")
        else:
            filled_addresses.append("")
            address_sources.append("missing")

    df["filledAddress"] = filled_addresses
    df["addressSource"] = address_sources
    df["province"] = df["filledAddress"].map(extract_province)

    mapped_locations: dict[str, dict[str, object]] = {}
    province_counters: Counter[str] = Counter()
    missing_by_establishment: Counter[str] = Counter()
    missing_records: list[dict[str, str]] = []
    province_location_indexes: defaultdict[str, int] = defaultdict(int)

    for _, row in df.iterrows():
        student = row_to_student(row, columns)
        address = row["filledAddress"]
        province = row["province"]
        coords = PROVINCE_COORDS.get(province)
        establishment = student["establishment"] or "Unknown placement"

        if address and coords:
            location_key = address
            if location_key not in mapped_locations:
                province_location_indexes[province] += 1
                mapped_locations[location_key] = {
                    "id": f"location-{len(mapped_locations) + 1}",
                    "title": establishment,
                    "address": address,
                    "province": province,
                    "coords": coords,
                    "provinceIndex": province_location_indexes[province],
                    "precision": "province_approx",
                    "addressSource": row["addressSource"],
                    "students": [],
                    "establishments": [],
                    "majors": [],
                }

            entry = mapped_locations[location_key]
            entry["students"].append(student)
            if student["establishment"]:
                entry["establishments"].append(student["establishment"])
            if student["major"]:
                entry["majors"].append(student["major"])
            province_counters[province] += 1
        else:
            key = establishment or "Unknown placement"
            missing_by_establishment[key] += 1
            missing_records.append(
                {
                    "name": student["name"],
                    "major": student["major"],
                    "establishment": establishment,
                }
            )

    locations = []
    for location in mapped_locations.values():
        establishment_counts = Counter(location["establishments"])
        major_counts = Counter(location["majors"])
        location["title"] = establishment_counts.most_common(1)[0][0] if establishment_counts else location["title"]
        location["studentCount"] = len(location["students"])
        location["establishmentCount"] = len(establishment_counts)
        location["establishments"] = [name for name, _ in establishment_counts.most_common()]
        location["majors"] = [name for name, _ in major_counts.most_common()]
        location["students"] = sorted(
            location["students"],
            key=lambda student: (
                student["major"],
                student["name"],
                student["studentId"],
            ),
        )
        locations.append(location)

    locations.sort(key=lambda location: (-location["studentCount"], location["province"], location["title"]))

    top_provinces = [
        {"province": province, "studentCount": count}
        for province, count in province_counters.most_common()
    ]

    top_missing_establishments = [
        {"establishment": establishment, "studentCount": count}
        for establishment, count in missing_by_establishment.most_common(8)
    ]

    return {
        "meta": {
            "title": "Animal Science and Technology",
            "sourceFile": WORKBOOK_PATH.name,
            "sheetName": str(pd.ExcelFile(WORKBOOK_PATH).sheet_names[0]),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "totalRecords": int(len(df)),
            "mappedRecords": int(sum(location["studentCount"] for location in locations)),
            "unmappedRecords": int(len(missing_records)),
            "mappedLocations": int(len(locations)),
            "mappedProvinces": int(len({location["province"] for location in locations})),
        },
        "stats": {
            "topProvinces": top_provinces,
            "topMissingEstablishments": top_missing_establishments,
        },
        "locations": locations,
        "unmappedRecords": missing_records[:24],
    }


def main() -> None:
    payload = build_payload()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    JSON_OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    JS_OUTPUT_PATH.write_text(
        "window.MAP_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {JSON_OUTPUT_PATH}")
    print(f"Wrote {JS_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
