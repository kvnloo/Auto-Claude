#!/usr/bin/env python
"""
Validate data formats for SWE-bench integration.

This script validates:
- JSONL predictions file
- Checkpoint JSON files
- Metrics report JSON

Usage:
    python tests/swebench/integration/validate_data_formats.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def validate_jsonl(jsonl_path: Path) -> bool:
    """Validate that a JSONL file has valid JSON on each line."""
    if not jsonl_path.exists():
        print(f"SKIP: {jsonl_path} does not exist")
        return True

    print(f"Validating: {jsonl_path}")
    with open(jsonl_path) as f:
        lines = f.readlines()

    if not lines:
        print(f"  WARN: File is empty")
        return True

    for i, line in enumerate(lines, start=1):
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
            # Check required fields
            required = ["instance_id", "model_patch", "model_name_or_path"]
            for field in required:
                if field not in data:
                    print(f"  ERROR: Line {i}: Missing required field '{field}'")
                    return False
        except json.JSONDecodeError as e:
            print(f"  ERROR: Line {i}: Invalid JSON - {e}")
            return False

    print(f"  OK: {len(lines)} lines validated")
    return True


def validate_json_file(json_path: Path, required_fields: list[str]) -> bool:
    """Validate that a JSON file is valid and has required fields."""
    if not json_path.exists():
        print(f"SKIP: {json_path} does not exist")
        return True

    print(f"Validating: {json_path}")
    try:
        with open(json_path) as f:
            data = json.load(f)

        for field in required_fields:
            if field not in data:
                print(f"  ERROR: Missing required field '{field}'")
                return False

        print(f"  OK: All required fields present")
        return True
    except json.JSONDecodeError as e:
        print(f"  ERROR: Invalid JSON - {e}")
        return False


def main() -> int:
    """Run all validations."""
    base_dir = Path(".auto-claude/swebench")

    if not base_dir.exists():
        print(f"SWE-bench data directory not found: {base_dir}")
        print("No data to validate. OK.")
        return 0

    success = True

    # Validate predictions.jsonl
    jsonl_files = list(base_dir.glob("*.jsonl"))
    for jsonl_file in jsonl_files:
        if not validate_jsonl(jsonl_file):
            success = False

    # Validate report.json files
    report_required = ["resolution_rate", "aggregated_stats"]
    report_files = list(base_dir.glob("*report.json"))
    for report_file in report_files:
        if not validate_json_file(report_file, report_required):
            success = False

    # Validate checkpoint files
    checkpoint_dir = base_dir / "checkpoints"
    if checkpoint_dir.exists():
        checkpoint_required = ["run_id", "dataset_name", "instance_states"]
        for checkpoint_file in checkpoint_dir.glob("*.json"):
            if not validate_json_file(checkpoint_file, checkpoint_required):
                success = False

    if success:
        print("\nOK")
        return 0
    else:
        print("\nFAILED: Some validations failed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
