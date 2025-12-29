"""
Autoclaude Results to SWE-bench JSONL Exporter
===============================================

Exports autoclaude execution results to SWE-bench-compliant JSONL predictions format.

This module provides functions to convert autoclaude execution results into the
JSONL format required by the SWE-bench evaluation harness.

Output Schema:
    {"instance_id": str, "model_name_or_path": "autoclaude", "model_patch": str}

Usage:
    from apps.backend.services.swebench.exporter import export_predictions

    # Export benchmark results to JSONL file
    export_predictions(benchmark_result, "predictions.jsonl")

    # Export a single instance result
    prediction = create_prediction_entry(instance_result)
"""

import json
from pathlib import Path
from typing import IO, Optional, Union

from .models import (
    BenchmarkResult,
    ExecutionStatus,
    InstanceResult,
    PredictionEntry,
)


class ExportError(Exception):
    """Raised when export to JSONL fails."""

    pass


def create_prediction_entry(
    instance_result: InstanceResult,
    model_name: str = "autoclaude",
    default_patch: str = "",
) -> PredictionEntry:
    """
    Create a PredictionEntry from an InstanceResult.

    Args:
        instance_result: The result from autoclaude execution.
        model_name: Model identifier for the prediction (default: 'autoclaude').
        default_patch: Default patch to use if result has no patch (default: empty string).

    Returns:
        PredictionEntry ready for JSONL serialization.

    Raises:
        ExportError: If the instance result cannot be converted.

    Example:
        >>> result = InstanceResult(
        ...     instance_id="django__django-12345",
        ...     status=ExecutionStatus.COMPLETED,
        ...     model_patch="diff --git a/file.py..."
        ... )
        >>> entry = create_prediction_entry(result)
        >>> entry.model_name_or_path
        'autoclaude'
    """
    if not instance_result.instance_id:
        raise ExportError("instance_result must have a valid instance_id")

    # Use model_patch from result, or default if not available
    patch = instance_result.model_patch if instance_result.model_patch else default_patch

    return PredictionEntry(
        instance_id=instance_result.instance_id,
        model_name_or_path=model_name,
        model_patch=patch,
    )


def export_prediction_to_dict(prediction: PredictionEntry) -> dict:
    """
    Convert a PredictionEntry to a dictionary for JSON serialization.

    Args:
        prediction: The prediction entry to convert.

    Returns:
        Dictionary with instance_id, model_name_or_path, and model_patch.
    """
    return {
        "instance_id": prediction.instance_id,
        "model_name_or_path": prediction.model_name_or_path,
        "model_patch": prediction.model_patch,
    }


def export_predictions(
    results: Union[BenchmarkResult, list[InstanceResult]],
    output_path: Union[str, Path],
    model_name: str = "autoclaude",
    include_failed: bool = True,
    include_empty_patches: bool = True,
    default_patch: str = "",
) -> int:
    """
    Export autoclaude results to SWE-bench JSONL predictions file.

    Each line in the output file is a JSON object with the schema:
    {"instance_id": str, "model_name_or_path": str, "model_patch": str}

    Args:
        results: BenchmarkResult or list of InstanceResult to export.
        output_path: Path to the output JSONL file.
        model_name: Model identifier for predictions (default: 'autoclaude').
        include_failed: Include results with FAILED status (default: True).
        include_empty_patches: Include results with empty patches (default: True).
        default_patch: Default patch for results without model_patch (default: empty).

    Returns:
        Number of predictions exported.

    Raises:
        ExportError: If export fails.

    Example:
        >>> results = BenchmarkResult(
        ...     run_id="run-001",
        ...     variant=BenchmarkVariant.LITE,
        ...     total_instances=10,
        ...     instance_results=[...]
        ... )
        >>> count = export_predictions(results, "predictions.jsonl")
        >>> print(f"Exported {count} predictions")
    """
    try:
        output_path = Path(output_path)

        # Ensure parent directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Extract instance results
        if isinstance(results, BenchmarkResult):
            instance_results = results.instance_results
        else:
            instance_results = results

        # Filter and convert to predictions
        predictions = _filter_and_convert_results(
            instance_results=instance_results,
            model_name=model_name,
            include_failed=include_failed,
            include_empty_patches=include_empty_patches,
            default_patch=default_patch,
        )

        # Write to file
        with open(output_path, "w", encoding="utf-8") as f:
            _write_predictions_to_file(f, predictions)

        return len(predictions)

    except ExportError:
        raise
    except Exception as e:
        raise ExportError(f"Failed to export predictions to '{output_path}': {e}") from e


def export_predictions_to_string(
    results: Union[BenchmarkResult, list[InstanceResult]],
    model_name: str = "autoclaude",
    include_failed: bool = True,
    include_empty_patches: bool = True,
    default_patch: str = "",
) -> str:
    """
    Export autoclaude results to JSONL string format.

    Args:
        results: BenchmarkResult or list of InstanceResult to export.
        model_name: Model identifier for predictions (default: 'autoclaude').
        include_failed: Include results with FAILED status (default: True).
        include_empty_patches: Include results with empty patches (default: True).
        default_patch: Default patch for results without model_patch (default: empty).

    Returns:
        JSONL string with one prediction per line.

    Example:
        >>> jsonl_content = export_predictions_to_string(results)
        >>> print(jsonl_content)
        {"instance_id": "django__django-12345", "model_name_or_path": "autoclaude", "model_patch": "..."}
    """
    # Extract instance results
    if isinstance(results, BenchmarkResult):
        instance_results = results.instance_results
    else:
        instance_results = results

    # Filter and convert to predictions
    predictions = _filter_and_convert_results(
        instance_results=instance_results,
        model_name=model_name,
        include_failed=include_failed,
        include_empty_patches=include_empty_patches,
        default_patch=default_patch,
    )

    # Build JSONL string
    lines = []
    for prediction in predictions:
        pred_dict = export_prediction_to_dict(prediction)
        lines.append(json.dumps(pred_dict, ensure_ascii=False))

    return "\n".join(lines)


def append_prediction(
    output_path: Union[str, Path],
    instance_result: InstanceResult,
    model_name: str = "autoclaude",
    default_patch: str = "",
) -> None:
    """
    Append a single prediction to an existing JSONL file.

    Useful for streaming results as they are generated.

    Args:
        output_path: Path to the output JSONL file.
        instance_result: The result to append.
        model_name: Model identifier for the prediction.
        default_patch: Default patch if result has no patch.

    Raises:
        ExportError: If append fails.

    Example:
        >>> for result in execute_benchmark():
        ...     append_prediction("predictions.jsonl", result)
    """
    try:
        output_path = Path(output_path)

        # Ensure parent directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Create prediction entry
        prediction = create_prediction_entry(
            instance_result=instance_result,
            model_name=model_name,
            default_patch=default_patch,
        )

        # Append to file
        with open(output_path, "a", encoding="utf-8") as f:
            pred_dict = export_prediction_to_dict(prediction)
            f.write(json.dumps(pred_dict, ensure_ascii=False) + "\n")

    except ExportError:
        raise
    except Exception as e:
        raise ExportError(
            f"Failed to append prediction for '{instance_result.instance_id}': {e}"
        ) from e


def validate_predictions_file(
    file_path: Union[str, Path],
) -> tuple[bool, list[str]]:
    """
    Validate a predictions JSONL file for SWE-bench compatibility.

    Checks that each line is valid JSON with required fields:
    - instance_id (non-empty string)
    - model_name_or_path (non-empty string)
    - model_patch (string, can be empty)

    Args:
        file_path: Path to the JSONL file to validate.

    Returns:
        Tuple of (is_valid, list of error messages).

    Example:
        >>> is_valid, errors = validate_predictions_file("predictions.jsonl")
        >>> if not is_valid:
        ...     print(f"Validation failed: {errors}")
    """
    file_path = Path(file_path)
    errors: list[str] = []

    if not file_path.exists():
        return False, [f"File not found: {file_path}"]

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue

                line_errors = _validate_prediction_line(line, line_num)
                errors.extend(line_errors)

    except Exception as e:
        errors.append(f"Failed to read file: {e}")

    return len(errors) == 0, errors


def count_predictions(file_path: Union[str, Path]) -> int:
    """
    Count the number of predictions in a JSONL file.

    Args:
        file_path: Path to the JSONL file.

    Returns:
        Number of predictions in the file.

    Raises:
        ExportError: If file cannot be read.
    """
    try:
        file_path = Path(file_path)
        count = 0

        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    count += 1

        return count

    except Exception as e:
        raise ExportError(f"Failed to count predictions in '{file_path}': {e}") from e


def _filter_and_convert_results(
    instance_results: list[InstanceResult],
    model_name: str,
    include_failed: bool,
    include_empty_patches: bool,
    default_patch: str,
) -> list[PredictionEntry]:
    """
    Filter and convert instance results to prediction entries.

    Args:
        instance_results: List of results to process.
        model_name: Model identifier for predictions.
        include_failed: Include results with FAILED status.
        include_empty_patches: Include results with empty patches.
        default_patch: Default patch for results without model_patch.

    Returns:
        List of PredictionEntry objects.
    """
    predictions: list[PredictionEntry] = []

    for result in instance_results:
        # Skip PENDING status (not yet executed)
        if result.status == ExecutionStatus.PENDING:
            continue

        # Skip FAILED if not including failed results
        if not include_failed and result.status == ExecutionStatus.FAILED:
            continue

        # Check if result has a patch
        has_patch = result.model_patch is not None and result.model_patch.strip() != ""

        # Skip empty patches if not including them
        if not include_empty_patches and not has_patch:
            continue

        # Create prediction entry
        prediction = create_prediction_entry(
            instance_result=result,
            model_name=model_name,
            default_patch=default_patch,
        )
        predictions.append(prediction)

    return predictions


def _write_predictions_to_file(
    file: IO[str],
    predictions: list[PredictionEntry],
) -> None:
    """
    Write predictions to file in JSONL format.

    Args:
        file: File object to write to.
        predictions: List of predictions to write.
    """
    for prediction in predictions:
        pred_dict = export_prediction_to_dict(prediction)
        file.write(json.dumps(pred_dict, ensure_ascii=False) + "\n")


def _validate_prediction_line(line: str, line_num: int) -> list[str]:
    """
    Validate a single line from a predictions JSONL file.

    Args:
        line: The JSON line to validate.
        line_num: Line number for error messages.

    Returns:
        List of error messages (empty if valid).
    """
    errors: list[str] = []

    try:
        data = json.loads(line)
    except json.JSONDecodeError as e:
        return [f"Line {line_num}: Invalid JSON - {e}"]

    if not isinstance(data, dict):
        return [f"Line {line_num}: Expected JSON object, got {type(data).__name__}"]

    # Check required fields
    required_fields = ["instance_id", "model_name_or_path", "model_patch"]
    for field in required_fields:
        if field not in data:
            errors.append(f"Line {line_num}: Missing required field '{field}'")

    # Validate field types and values
    if "instance_id" in data:
        if not isinstance(data["instance_id"], str):
            errors.append(f"Line {line_num}: 'instance_id' must be a string")
        elif not data["instance_id"]:
            errors.append(f"Line {line_num}: 'instance_id' cannot be empty")

    if "model_name_or_path" in data:
        if not isinstance(data["model_name_or_path"], str):
            errors.append(f"Line {line_num}: 'model_name_or_path' must be a string")
        elif not data["model_name_or_path"]:
            errors.append(f"Line {line_num}: 'model_name_or_path' cannot be empty")

    if "model_patch" in data:
        if not isinstance(data["model_patch"], str):
            errors.append(f"Line {line_num}: 'model_patch' must be a string")

    return errors
