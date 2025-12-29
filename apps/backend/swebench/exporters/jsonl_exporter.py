"""
JSONL Predictions Exporter
==========================

Exports evaluation predictions in JSONL format compatible with SWE-bench evaluation harness.

The SWE-bench evaluation harness expects predictions in JSONL format where each line
contains a JSON object with these required fields:
    - instance_id: string (format: owner__repo-issue_number)
    - model_patch: string (git diff format patch)
    - model_name_or_path: string (model identifier)

Usage:
    from swebench.exporters.jsonl_exporter import export_predictions
    from swebench.models import InstanceResult

    results = [
        InstanceResult(instance_id="django__django-12345", status="success", model_patch="..."),
        InstanceResult(instance_id="flask__flask-567", status="success", model_patch="..."),
    ]

    export_predictions(results, Path("predictions.jsonl"))
"""

from __future__ import annotations

import json
import logging
import tempfile
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Generator

from swebench.models import InstanceResult, SWEBenchPrediction

if TYPE_CHECKING:
    pass


logger = logging.getLogger(__name__)


# Default model name for autoclaude predictions
DEFAULT_MODEL_NAME = "autoclaude"


class JSONLExportError(Exception):
    """Raised when JSONL export fails."""

    pass


def _result_to_prediction(
    result: InstanceResult,
    model_name_or_path: str = DEFAULT_MODEL_NAME,
) -> SWEBenchPrediction:
    """Convert an InstanceResult to a SWEBenchPrediction.

    Args:
        result: The InstanceResult to convert
        model_name_or_path: Name of the model

    Returns:
        SWEBenchPrediction for JSONL export
    """
    return SWEBenchPrediction(
        instance_id=result.instance_id,
        model_patch=result.model_patch or "",
        model_name_or_path=model_name_or_path,
    )


def _prediction_to_jsonl_line(prediction: SWEBenchPrediction) -> str:
    """Convert a prediction to a JSONL line (without newline).

    Args:
        prediction: The prediction to serialize

    Returns:
        JSON string representation
    """
    return prediction.model_dump_json()


def export_predictions(
    results: list[InstanceResult],
    output_path: Path,
    *,
    model_name_or_path: str = DEFAULT_MODEL_NAME,
    include_failed: bool = True,
    include_empty_patches: bool = True,
    overwrite: bool = False,
    append: bool = False,
) -> dict:
    """Export evaluation results as JSONL predictions file.

    This is the main export function for SWE-bench predictions. It converts
    InstanceResult objects to the JSONL format expected by the SWE-bench
    evaluation harness.

    Args:
        results: List of InstanceResult objects from evaluation
        output_path: Path to output JSONL file
        model_name_or_path: Model identifier (default: "autoclaude")
        include_failed: Include failed/error results with empty patches (default: True)
        include_empty_patches: Include predictions with empty patches (default: True)
        overwrite: Overwrite existing file (default: False)
        append: Append to existing file (default: False)

    Returns:
        Dictionary with export statistics:
            - output_path: Path to the created file
            - total_exported: Number of predictions exported
            - with_patches: Number of predictions with non-empty patches
            - without_patches: Number of predictions with empty patches
            - skipped: Number of results skipped (filtered out)
            - exported_at: ISO timestamp of export

    Raises:
        JSONLExportError: If export fails
        FileExistsError: If file exists and neither overwrite nor append is True
        ValueError: If both overwrite and append are True

    Example:
        >>> results = [
        ...     InstanceResult(instance_id="django__django-12345", status="success",
        ...                    model_patch="--- a/file.py\\n+++ b/file.py\\n..."),
        ... ]
        >>> stats = export_predictions(results, Path("predictions.jsonl"), overwrite=True)
        >>> print(f"Exported {stats['total_exported']} predictions")
    """
    if overwrite and append:
        raise ValueError("Cannot specify both overwrite=True and append=True")

    output_path = Path(output_path)

    # Check if file exists
    if output_path.exists() and not overwrite and not append:
        raise FileExistsError(
            f"Output file already exists: {output_path}. "
            "Use overwrite=True to replace or append=True to add to it."
        )

    # Create parent directory if needed
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Filter and convert results
    predictions_to_export: list[SWEBenchPrediction] = []
    skipped = 0

    for result in results:
        # Filter by status
        if not include_failed and result.status in ("failed", "error", "skipped"):
            skipped += 1
            continue

        # Convert to prediction
        prediction = _result_to_prediction(result, model_name_or_path)

        # Filter by patch content
        if not include_empty_patches and not prediction.model_patch.strip():
            skipped += 1
            continue

        predictions_to_export.append(prediction)

    # Export using atomic write pattern for safety
    try:
        if append:
            # Append mode - just add to existing file
            with open(output_path, "a") as f:
                for prediction in predictions_to_export:
                    f.write(_prediction_to_jsonl_line(prediction))
                    f.write("\n")
        else:
            # Write mode - use temp file + rename for atomicity
            temp_fd = None
            temp_path = None
            try:
                temp_fd, temp_path_str = tempfile.mkstemp(
                    dir=output_path.parent,
                    prefix=".predictions_",
                    suffix=".jsonl.tmp",
                )
                temp_path = Path(temp_path_str)

                with open(temp_fd, "w") as f:
                    for prediction in predictions_to_export:
                        f.write(_prediction_to_jsonl_line(prediction))
                        f.write("\n")

                # Atomic rename
                temp_path.rename(output_path)
                temp_path = None  # Successfully moved

            finally:
                # Clean up temp file if rename failed
                if temp_path and temp_path.exists():
                    temp_path.unlink()

    except Exception as e:
        raise JSONLExportError(f"Failed to export predictions: {e}") from e

    # Calculate statistics
    with_patches = sum(1 for p in predictions_to_export if p.model_patch.strip())
    without_patches = len(predictions_to_export) - with_patches

    stats = {
        "output_path": str(output_path),
        "total_exported": len(predictions_to_export),
        "with_patches": with_patches,
        "without_patches": without_patches,
        "skipped": skipped,
        "model_name": model_name_or_path,
        "exported_at": datetime.now().isoformat(),
    }

    logger.info(
        f"Exported {stats['total_exported']} predictions to {output_path} "
        f"({with_patches} with patches, {without_patches} empty)"
    )

    return stats


def export_predictions_streaming(
    results_generator: Generator[InstanceResult, None, None],
    output_path: Path,
    *,
    model_name_or_path: str = DEFAULT_MODEL_NAME,
    include_failed: bool = True,
    include_empty_patches: bool = True,
    overwrite: bool = False,
) -> dict:
    """Export predictions from a generator in streaming fashion.

    This function is optimized for memory efficiency when processing large
    numbers of results. Results are written immediately as they are generated,
    without buffering the entire list in memory.

    Args:
        results_generator: Generator yielding InstanceResult objects
        output_path: Path to output JSONL file
        model_name_or_path: Model identifier (default: "autoclaude")
        include_failed: Include failed/error results with empty patches
        include_empty_patches: Include predictions with empty patches
        overwrite: Overwrite existing file (default: False)

    Returns:
        Dictionary with export statistics

    Raises:
        JSONLExportError: If export fails
        FileExistsError: If file exists and overwrite is False

    Example:
        >>> def generate_results():
        ...     for i in range(1000):
        ...         yield InstanceResult(instance_id=f"test__repo-{i}", status="success")
        >>> stats = export_predictions_streaming(generate_results(), Path("predictions.jsonl"))
    """
    output_path = Path(output_path)

    if output_path.exists() and not overwrite:
        raise FileExistsError(
            f"Output file already exists: {output_path}. "
            "Use overwrite=True to replace."
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    total_exported = 0
    with_patches = 0
    without_patches = 0
    skipped = 0

    try:
        # Use temp file for atomic write
        temp_fd = None
        temp_path = None
        try:
            temp_fd, temp_path_str = tempfile.mkstemp(
                dir=output_path.parent,
                prefix=".predictions_",
                suffix=".jsonl.tmp",
            )
            temp_path = Path(temp_path_str)

            with open(temp_fd, "w") as f:
                for result in results_generator:
                    # Filter by status
                    if not include_failed and result.status in (
                        "failed", "error", "skipped"
                    ):
                        skipped += 1
                        continue

                    prediction = _result_to_prediction(result, model_name_or_path)

                    # Filter by patch content
                    if not include_empty_patches and not prediction.model_patch.strip():
                        skipped += 1
                        continue

                    f.write(_prediction_to_jsonl_line(prediction))
                    f.write("\n")

                    total_exported += 1
                    if prediction.model_patch.strip():
                        with_patches += 1
                    else:
                        without_patches += 1

            # Atomic rename
            temp_path.rename(output_path)
            temp_path = None

        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink()

    except Exception as e:
        raise JSONLExportError(f"Failed to export predictions: {e}") from e

    stats = {
        "output_path": str(output_path),
        "total_exported": total_exported,
        "with_patches": with_patches,
        "without_patches": without_patches,
        "skipped": skipped,
        "model_name": model_name_or_path,
        "exported_at": datetime.now().isoformat(),
    }

    logger.info(
        f"Exported {total_exported} predictions (streaming) to {output_path} "
        f"({with_patches} with patches, {without_patches} empty)"
    )

    return stats


def load_predictions(jsonl_path: Path) -> list[SWEBenchPrediction]:
    """Load predictions from a JSONL file.

    Args:
        jsonl_path: Path to the JSONL file

    Returns:
        List of SWEBenchPrediction objects

    Raises:
        FileNotFoundError: If file doesn't exist
        JSONLExportError: If file contains invalid data
    """
    jsonl_path = Path(jsonl_path)

    if not jsonl_path.exists():
        raise FileNotFoundError(f"Predictions file not found: {jsonl_path}")

    predictions = []

    with open(jsonl_path) as f:
        for line_num, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)
                prediction = SWEBenchPrediction.model_validate(data)
                predictions.append(prediction)
            except json.JSONDecodeError as e:
                raise JSONLExportError(
                    f"Invalid JSON on line {line_num}: {e}"
                ) from e
            except Exception as e:
                raise JSONLExportError(
                    f"Invalid prediction on line {line_num}: {e}"
                ) from e

    return predictions


def validate_predictions_file(
    jsonl_path: Path,
    *,
    require_patches: bool = False,
    require_instance_id_format: bool = True,
) -> tuple[bool, list[str]]:
    """Validate a predictions JSONL file.

    Checks that:
    - Each line is valid JSON
    - Required fields are present: instance_id, model_patch, model_name_or_path
    - All fields are strings
    - Optionally: instance_id uses double underscore format
    - Optionally: model_patch is non-empty

    Args:
        jsonl_path: Path to the JSONL file
        require_patches: Require non-empty model_patch (default: False)
        require_instance_id_format: Require owner__repo-issue format (default: True)

    Returns:
        Tuple of (is_valid, list_of_errors)
    """
    jsonl_path = Path(jsonl_path)
    errors: list[str] = []

    if not jsonl_path.exists():
        return False, [f"File not found: {jsonl_path}"]

    line_count = 0

    with open(jsonl_path) as f:
        for line_num, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue

            line_count += 1

            try:
                data = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"Line {line_num}: Invalid JSON - {e}")
                continue

            # Check required fields
            required_fields = ["instance_id", "model_patch", "model_name_or_path"]
            for field in required_fields:
                if field not in data:
                    errors.append(f"Line {line_num}: Missing '{field}' field")
                elif not isinstance(data[field], str):
                    errors.append(f"Line {line_num}: '{field}' must be a string")

            # Check instance_id format
            if (
                require_instance_id_format
                and "instance_id" in data
                and isinstance(data["instance_id"], str)
            ):
                if "__" not in data["instance_id"]:
                    errors.append(
                        f"Line {line_num}: 'instance_id' should use double underscore "
                        f"format (owner__repo-issue), got: {data['instance_id']}"
                    )

            # Check for non-empty patches
            if require_patches:
                if "model_patch" in data and not data["model_patch"].strip():
                    errors.append(f"Line {line_num}: 'model_patch' is empty")

    if line_count == 0:
        errors.append("File is empty (no valid prediction lines)")

    return len(errors) == 0, errors


def get_predictions_summary(jsonl_path: Path) -> dict:
    """Get a summary of a predictions file.

    Args:
        jsonl_path: Path to the JSONL file

    Returns:
        Dictionary with summary statistics:
            - total_predictions: Total number of predictions
            - with_patches: Number with non-empty patches
            - without_patches: Number with empty patches
            - unique_repos: Set of unique repositories
            - model_names: Set of model names used
            - file_size_bytes: Size of the file
    """
    jsonl_path = Path(jsonl_path)

    if not jsonl_path.exists():
        raise FileNotFoundError(f"Predictions file not found: {jsonl_path}")

    total = 0
    with_patches = 0
    repos: set[str] = set()
    models: set[str] = set()

    with open(jsonl_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)
                total += 1

                if data.get("model_patch", "").strip():
                    with_patches += 1

                # Extract repo from instance_id
                instance_id = data.get("instance_id", "")
                if "__" in instance_id:
                    parts = instance_id.rsplit("-", 1)
                    if parts:
                        repo = parts[0].replace("__", "/")
                        repos.add(repo)

                models.add(data.get("model_name_or_path", "unknown"))

            except json.JSONDecodeError:
                continue

    return {
        "total_predictions": total,
        "with_patches": with_patches,
        "without_patches": total - with_patches,
        "unique_repos": sorted(repos),
        "model_names": sorted(models),
        "file_size_bytes": jsonl_path.stat().st_size,
    }
