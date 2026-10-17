"""Re-run the specialty classification on these2/data/theses.json without re-reading the faculty sites.

Use it after archive/fmpm/theses-fmpm-specialites.csv changed (new cover pages, manual checks):
  python pipeline/scripts/reclassify.py
  python pipeline/scripts/build_charts.py --json these2/data/theses.json --out these2/stats
Same output format as update_theses.py; lastFetched is kept (the sources were not re-read).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from specialites import classify_all  # noqa: E402

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "these2/data/theses.json"
doc = json.loads(path.read_text("utf-8"))
before = json.dumps(doc["data"], ensure_ascii=False, sort_keys=True)
sources = classify_all(doc["data"])
if json.dumps(doc["data"], ensure_ascii=False, sort_keys=True) == before:
    print(f"no change: {path}")
else:
    path.write_text(json.dumps(doc, ensure_ascii=False), "utf-8")
    print(f"wrote {path}: {len(doc['data'])} theses · {dict(sources)}")
