"""
SWE-bench Results Adapter
=========================

Transforms autoclaude evaluation results into SWE-bench prediction format.

This adapter takes autoclaude's InstanceResult (or similar output data) and
converts it into the JSONL format expected by the SWE-bench evaluation harness.

Output Format (JSONL - one JSON object per line):
    {"instance_id": "owner__repo-123", "model_patch": "diff content...", "model_name_or_path": "autoclaude"}

Usage:
    from swebench.adapters.results_adapter import convert_to_swebench_prediction
    from swebench.models import InstanceResult

    result = InstanceResult(
        instance_id="django__django-12345",
        status="success",
        model_patch="--- a/file.py\\n+++ b/file.py\\n...",
    )
    prediction = convert_to_swebench_prediction(result)
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from swebench.models import InstanceResult, SWEBenchPrediction

if TYPE_CHECKING:
    pass


# Default model name for autoclaude predictions
DEFAULT_MODEL_NAME = "autoclaude"


def convert_to_swebench_prediction(
    result: InstanceResult,
    *,
    model_name_or_path: str = DEFAULT_MODEL_NAME,
) -> SWEBenchPrediction:
    """Convert an autoclaude InstanceResult to SWE-bench prediction format.

    This function transforms the autoclaude evaluation result into the format
    expected by the SWE-bench evaluation harness. Each prediction contains
    the instance_id, the generated patch, and the model identifier.

    Args:
        result: The InstanceResult from autoclaude evaluation
        model_name_or_path: Name of the model (default: "autoclaude")

    Returns:
        SWEBenchPrediction ready for JSONL export

    Example:
        >>> result = InstanceResult(
        ...     instance_id="django__django-12345",
        ...     status="success",
        ...     model_patch="--- a/file.py\\n+++ b/file.py\\n@@ -1,1 +1,2 @@\\n...",
        ... )
        >>> prediction = convert_to_swebench_prediction(result)
        >>> prediction.instance_id
        'django__django-12345'
        >>> prediction.model_name_or_path
        'autoclaude'
    """
    # Extract the patch, defaulting to empty string if not available
    model_patch = result.model_patch or ""

    return SWEBenchPrediction(
        instance_id=result.instance_id,
        model_patch=model_patch,
        model_name_or_path=model_name_or_path,
    )


def convert_results_batch(
    results: list[InstanceResult],
    *,
    model_name_or_path: str = DEFAULT_MODEL_NAME,
    include_failed: bool = True,
) -> list[SWEBenchPrediction]:
    """Convert a batch of autoclaude results to SWE-bench predictions.

    Processes multiple results at once, optionally filtering out failed
    or error results.

    Args:
        results: List of InstanceResult objects from autoclaude evaluation
        model_name_or_path: Name of the model (default: "autoclaude")
        include_failed: Whether to include failed/error results with empty patches
                       (default: True, as SWE-bench harness expects all instances)

    Returns:
        List of SWEBenchPrediction objects ready for JSONL export
    """
    predictions = []

    for result in results:
        # Skip failed/error results if requested
        if not include_failed and result.status in ("failed", "error", "skipped"):
            continue

        prediction = convert_to_swebench_prediction(
            result, model_name_or_path=model_name_or_path
        )
        predictions.append(prediction)

    return predictions


def prediction_to_jsonl_line(prediction: SWEBenchPrediction) -> str:
    """Convert a single prediction to a JSONL line.

    Args:
        prediction: The SWEBenchPrediction to serialize

    Returns:
        JSON string (without trailing newline)
    """
    return prediction.model_dump_json()


def export_predictions_to_jsonl(
    predictions: list[SWEBenchPrediction],
    output_path: Path,
    *,
    overwrite: bool = False,
    append: bool = False,
) -> Path:
    """Export predictions to a JSONL file.

    Each prediction is written as a single JSON object per line, in the format
    expected by the SWE-bench evaluation harness.

    Args:
        predictions: List of SWEBenchPrediction objects
        output_path: Path to the output JSONL file
        overwrite: Whether to overwrite existing file (default: False)
        append: Whether to append to existing file (default: False)

    Returns:
        Path to the created/updated JSONL file

    Raises:
        FileExistsError: If file exists and neither overwrite nor append is True
        ValueError: If both overwrite and append are True
    """
    if overwrite and append:
        raise ValueError("Cannot specify both overwrite=True and append=True")

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if output_path.exists() and not overwrite and not append:
        raise FileExistsError(
            f"Output file already exists: {output_path}. "
            "Use overwrite=True to replace or append=True to add to it."
        )

    mode = "a" if append else "w"

    with open(output_path, mode) as f:
        for prediction in predictions:
            f.write(prediction_to_jsonl_line(prediction))
            f.write("\n")

    return output_path


def load_predictions_from_jsonl(jsonl_path: Path) -> list[SWEBenchPrediction]:
    """Load predictions from a JSONL file.

    Args:
        jsonl_path: Path to the JSONL file containing predictions

    Returns:
        List of SWEBenchPrediction objects

    Raises:
        FileNotFoundError: If the file doesn't exist
        ValueError: If a line contains invalid JSON or missing required fields
    """
    jsonl_path = Path(jsonl_path)

    if not jsonl_path.exists():
        raise FileNotFoundError(f"Predictions file not found: {jsonl_path}")

    predictions = []

    with open(jsonl_path) as f:
        for line_num, line in enumerate(f, start=1):
            line = line.strip()
            if not line:  # Skip empty lines
                continue

            try:
                data = json.loads(line)
                prediction = SWEBenchPrediction.model_validate(data)
                predictions.append(prediction)
            except json.JSONDecodeError as e:
                raise ValueError(
                    f"Invalid JSON on line {line_num}: {e}"
                ) from e
            except Exception as e:
                raise ValueError(
                    f"Invalid prediction data on line {line_num}: {e}"
                ) from e

    return predictions


def validate_jsonl_file(jsonl_path: Path) -> tuple[bool, list[str]]:
    """Validate a predictions JSONL file.

    Checks that each line is valid JSON with required fields:
    - instance_id (string)
    - model_patch (string)
    - model_name_or_path (string)

    Args:
        jsonl_path: Path to the JSONL file to validate

    Returns:
        Tuple of (is_valid, list_of_error_messages)
        If is_valid is True, error list will be empty
    """
    jsonl_path = Path(jsonl_path)
    errors: list[str] = []

    if not jsonl_path.exists():
        return False, [f"File not found: {jsonl_path}"]

    with open(jsonl_path) as f:
        for line_num, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"Line {line_num}: Invalid JSON - {e}")
                continue

            # Check required fields
            if "instance_id" not in data:
                errors.append(f"Line {line_num}: Missing 'instance_id' field")
            elif not isinstance(data["instance_id"], str):
                errors.append(f"Line {line_num}: 'instance_id' must be a string")

            if "model_patch" not in data:
                errors.append(f"Line {line_num}: Missing 'model_patch' field")
            elif not isinstance(data["model_patch"], str):
                errors.append(f"Line {line_num}: 'model_patch' must be a string")

            if "model_name_or_path" not in data:
                errors.append(f"Line {line_num}: Missing 'model_name_or_path' field")
            elif not isinstance(data["model_name_or_path"], str):
                errors.append(f"Line {line_num}: 'model_name_or_path' must be a string")

            # Validate instance_id format (double underscore separator)
            if "instance_id" in data and isinstance(data["instance_id"], str):
                if "__" not in data["instance_id"]:
                    errors.append(
                        f"Line {line_num}: 'instance_id' should use double underscore "
                        f"format (owner__repo-issue), got: {data['instance_id']}"
                    )

    return len(errors) == 0, errors


def create_prediction_summary(
    predictions: list[SWEBenchPrediction],
) -> dict:
    """Create a summary of predictions for logging/reporting.

    Args:
        predictions: List of predictions to summarize

    Returns:
        Dictionary with summary statistics
    """
    total = len(predictions)
    with_patch = sum(1 for p in predictions if p.model_patch.strip())
    empty_patch = total - with_patch

    # Extract unique model names
    model_names = set(p.model_name_or_path for p in predictions)

    return {
        "total_predictions": total,
        "predictions_with_patch": with_patch,
        "predictions_empty_patch": empty_patch,
        "model_names": list(model_names),
        "generated_at": datetime.now().isoformat(),
    }
