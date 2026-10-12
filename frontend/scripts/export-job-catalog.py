"""Snapshot only public fictional postings for a frontend-only deployment."""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import load_career_markdown


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=ROOT.parent / "CareerLens-backend" / "app" / "modules" / "job_postings",
        help="Directory containing public numbered fictional .md postings and 00_목록.md.",
    )
    args = parser.parse_args()
    catalog = load_career_markdown(args.source)
    output = ROOT / "data" / "career-postings.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    categories = {item.get("role_category") for item in catalog["items"]} - {None}
    print(f"Exported {len(catalog['items'])} fictional postings / {len(categories)} categories.")


if __name__ == "__main__":
    main()
