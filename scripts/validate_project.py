#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED = [
    "package.json",
    "run.sh",
    "docker-compose.yml",
    "apps/frontend/package.json",
    "apps/frontend/src/App.jsx",
    "apps/frontend/src/App.css",
    "apps/backend/package.json",
    "apps/backend/src/server.js",
    "apps/backend/src/generator.js",
    "apps/backend/src/orchestratorAgent.js",
    "apps/backend/src/runtimeRestart.js",
    "apps/generated-site/package.json",
    "apps/generated-site/src/App.jsx",
    "apps/generated-site/src/generated/generatedPage.jsx",
    "apps/generated-site/src/generated/catalogData.js",
    "docs/architecture.md",
]

JSON_FILES = [
    "package.json",
    "apps/frontend/package.json",
    "apps/backend/package.json",
    "apps/generated-site/package.json",
]


def main() -> int:
    missing = [path for path in REQUIRED if not (ROOT / path).exists()]
    json_errors = []
    for path in JSON_FILES:
        try:
            json.loads((ROOT / path).read_text())
        except Exception as exc:
            json_errors.append({"path": path, "error": str(exc)})
    result = {
        "status": "success" if not missing and not json_errors else "failed",
        "missing": missing,
        "json_errors": json_errors,
        "checked": len(REQUIRED),
    }
    out = ROOT / "observability" / "validation" / "latest-validation.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
