"""
Metrics Report Exporter
=======================

Exports evaluation metrics in JSON format compatible with SWE-bench reporting standards.

The metrics report includes:
    - resolution_rate: Percentage of successfully resolved instances
    - instance_results: Per-instance results with status, timing, and errors
    - aggregated stats: Total/completed/successful/failed instance counts

Usage:
    from swebench.exporters.metrics_exporter import generate_metrics_report
    from swebench.models import InstanceResult

    results = [
        InstanceResult(instance_id="django__django-12345", status="success", model_patch="..."),
        InstanceResult(instance_id="flask__flask-567", status="failed", error_message="..."),
    ]

    report = generate_metrics_report(results, Path("report.json"))
"""

from __future__ import annotations

import json
import logging
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from swebench.models import EvaluationMetrics, InstanceResult

logger = logging.getLogger(__name__)


class MetricsExportError(Exception):
    """Raised when metrics export fails."""

    pass


# =============================================================================
# Report Data Structures
# =============================================================================


def _calculate_aggregated_metrics(results: list[InstanceResult]) -> EvaluationMetrics:
    """Calculate aggregated metrics from a list of instance results.

    Args:
        results: List of InstanceResult objects

    Returns:
        EvaluationMetrics with calculated statistics
    """
    total = len(results)
    completed = sum(
        1 for r in results if r.status in ("success", "failed", "error", "skipped")
    )
    successful = sum(1 for r in results if r.status == "success")
    failed = sum(1 for r in results if r.status == "failed")
    error = sum(1 for r in results if r.status == "error")
    skipped = sum(1 for r in results if r.status == "skipped")

    total_time = sum(r.execution_time_seconds or 0.0 for r in results)

    return EvaluationMetrics(
        total_instances=total,
        completed_instances=completed,
        successful_instances=successful,
        failed_instances=failed,
        error_instances=error,
        skipped_instances=skipped,
        total_execution_time_seconds=total_time,
    )


def _result_to_dict(result: InstanceResult) -> dict[str, Any]:
    """Convert an InstanceResult to a dictionary for JSON serialization.

    Args:
        result: The InstanceResult to convert

    Returns:
        Dictionary representation suitable for JSON
    """
    return {
        "instance_id": result.instance_id,
        "status": result.status,
        "model_patch": result.model_patch,
        "error_message": result.error_message,
        "execution_time_seconds": result.execution_time_seconds,
        "tests_passed": result.tests_passed,
        "tests_total": result.tests_total,
        "regression_tests_passed": result.regression_tests_passed,
        "regression_tests_total": result.regression_tests_total,
    }


def _calculate_per_repo_stats(results: list[InstanceResult]) -> dict[str, dict]:
    """Calculate per-repository statistics.

    Args:
        results: List of InstanceResult objects

    Returns:
        Dictionary mapping repo name to stats
    """
    repo_results: dict[str, list[InstanceResult]] = defaultdict(list)

    for result in results:
        # Extract repo from instance_id (format: owner__repo-issue)
        instance_id = result.instance_id
        if "__" in instance_id:
            parts = instance_id.rsplit("-", 1)
            if parts:
                repo = parts[0].replace("__", "/")
                repo_results[repo].append(result)

    per_repo_stats = {}
    for repo, repo_result_list in repo_results.items():
        total = len(repo_result_list)
        successful = sum(1 for r in repo_result_list if r.status == "success")
        failed = sum(1 for r in repo_result_list if r.status == "failed")
        error = sum(1 for r in repo_result_list if r.status == "error")
        resolution_rate = successful / total if total > 0 else 0.0

        per_repo_stats[repo] = {
            "total_instances": total,
            "successful_instances": successful,
            "failed_instances": failed,
            "error_instances": error,
            "resolution_rate": resolution_rate,
        }

    return per_repo_stats


def _calculate_timing_stats(results: list[InstanceResult]) -> dict[str, float]:
    """Calculate timing statistics from results.

    Args:
        results: List of InstanceResult objects

    Returns:
        Dictionary with timing statistics
    """
    times = [
        r.execution_time_seconds for r in results if r.execution_time_seconds is not None
    ]

    if not times:
        return {
            "total_time_seconds": 0.0,
            "average_time_seconds": 0.0,
            "min_time_seconds": 0.0,
            "max_time_seconds": 0.0,
            "median_time_seconds": 0.0,
        }

    sorted_times = sorted(times)
    n = len(sorted_times)
    median = (
        sorted_times[n // 2]
        if n % 2 == 1
        else (sorted_times[n // 2 - 1] + sorted_times[n // 2]) / 2
    )

    return {
        "total_time_seconds": sum(times),
        "average_time_seconds": sum(times) / len(times),
        "min_time_seconds": min(times),
        "max_time_seconds": max(times),
        "median_time_seconds": median,
    }


# =============================================================================
# Main Export Functions
# =============================================================================


def generate_metrics_report(
    results: list[InstanceResult],
    output_path: Path | None = None,
    *,
    run_id: str | None = None,
    dataset_name: str | None = None,
    model_name: str = "autoclaude",
    include_instance_results: bool = True,
    include_per_repo_stats: bool = True,
    include_timing_stats: bool = True,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Generate a comprehensive metrics report for SWE-bench evaluation.

    This function creates a JSON report with resolution rate, instance-level
    results, and aggregated statistics compatible with SWE-bench reporting.

    Args:
        results: List of InstanceResult objects from evaluation
        output_path: Optional path to save the JSON report (if None, report is not saved)
        run_id: Optional evaluation run identifier
        dataset_name: Name of the dataset evaluated (e.g., "princeton-nlp/SWE-bench_Lite")
        model_name: Name of the model used (default: "autoclaude")
        include_instance_results: Include per-instance results in report (default: True)
        include_per_repo_stats: Include per-repository statistics (default: True)
        include_timing_stats: Include timing statistics (default: True)
        overwrite: Overwrite existing report file (default: False)

    Returns:
        Dictionary containing the full metrics report:
            - run_id: Evaluation run identifier
            - dataset_name: Name of the evaluated dataset
            - model_name: Name of the model
            - resolution_rate: Overall success rate (0.0-1.0)
            - aggregated_stats: Counts of total/completed/successful/failed instances
            - instance_results: Per-instance results (if include_instance_results=True)
            - per_repo_stats: Per-repository statistics (if include_per_repo_stats=True)
            - timing_stats: Execution time statistics (if include_timing_stats=True)
            - timestamps: Start time, end time, and duration

    Raises:
        MetricsExportError: If export fails
        FileExistsError: If file exists and overwrite is False

    Example:
        >>> results = [
        ...     InstanceResult(instance_id="django__django-12345", status="success",
        ...                    model_patch="...", execution_time_seconds=120.5),
        ...     InstanceResult(instance_id="flask__flask-567", status="failed",
        ...                    error_message="Timeout"),
        ... ]
        >>> report = generate_metrics_report(results, Path("report.json"), overwrite=True)
        >>> print(f"Resolution rate: {report['resolution_rate']:.2%}")
    """
    # Calculate aggregated metrics
    metrics = _calculate_aggregated_metrics(results)

    # Build report
    report: dict[str, Any] = {
        "run_id": run_id,
        "dataset_name": dataset_name,
        "model_name": model_name,
        "resolution_rate": metrics.resolution_rate,
        "aggregated_stats": {
            "total_instances": metrics.total_instances,
            "completed_instances": metrics.completed_instances,
            "successful_instances": metrics.successful_instances,
            "failed_instances": metrics.failed_instances,
            "error_instances": metrics.error_instances,
            "skipped_instances": metrics.skipped_instances,
            "resolution_rate": metrics.resolution_rate,
        },
    }

    # Add instance-level results
    if include_instance_results:
        report["instance_results"] = [_result_to_dict(r) for r in results]

    # Add per-repository statistics
    if include_per_repo_stats:
        report["per_repo_stats"] = _calculate_per_repo_stats(results)

    # Add timing statistics
    if include_timing_stats:
        report["timing_stats"] = _calculate_timing_stats(results)

    # Add timestamps
    now = datetime.now(timezone.utc)
    report["timestamps"] = {
        "generated_at": now.isoformat(),
        "total_execution_time_seconds": metrics.total_execution_time_seconds,
        "average_execution_time_seconds": metrics.average_execution_time_seconds,
    }

    # Save to file if path provided
    if output_path is not None:
        _save_report(report, output_path, overwrite=overwrite)

    logger.info(
        f"Generated metrics report: {metrics.successful_instances}/{metrics.total_instances} "
        f"resolved ({metrics.resolution_rate:.2%})"
    )

    return report


def _save_report(report: dict[str, Any], output_path: Path, *, overwrite: bool) -> None:
    """Save a metrics report to a JSON file with atomic write.

    Args:
        report: The report dictionary to save
        output_path: Path to save the JSON file
        overwrite: Whether to overwrite existing file

    Raises:
        FileExistsError: If file exists and overwrite is False
        MetricsExportError: If save fails
    """
    output_path = Path(output_path)

    if output_path.exists() and not overwrite:
        raise FileExistsError(
            f"Report file already exists: {output_path}. "
            "Use overwrite=True to replace."
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        # Use atomic write pattern
        temp_fd = None
        temp_path = None
        try:
            temp_fd, temp_path_str = tempfile.mkstemp(
                dir=output_path.parent,
                prefix=".report_",
                suffix=".json.tmp",
            )
            temp_path = Path(temp_path_str)

            with open(temp_fd, "w") as f:
                json.dump(report, f, indent=2, default=str)

            # Atomic rename
            temp_path.rename(output_path)
            temp_path = None

        finally:
            if temp_path and temp_path.exists():
                temp_path.unlink()

    except Exception as e:
        raise MetricsExportError(f"Failed to save metrics report: {e}") from e

    logger.info(f"Saved metrics report to {output_path}")


def load_metrics_report(report_path: Path) -> dict[str, Any]:
    """Load a metrics report from a JSON file.

    Args:
        report_path: Path to the JSON report file

    Returns:
        Dictionary containing the metrics report

    Raises:
        FileNotFoundError: If file doesn't exist
        MetricsExportError: If file contains invalid data
    """
    report_path = Path(report_path)

    if not report_path.exists():
        raise FileNotFoundError(f"Report file not found: {report_path}")

    try:
        with open(report_path) as f:
            report = json.load(f)
    except json.JSONDecodeError as e:
        raise MetricsExportError(f"Invalid JSON in report file: {e}") from e

    return report


def validate_metrics_report(report: dict[str, Any]) -> tuple[bool, list[str]]:
    """Validate a metrics report has all required fields.

    Checks that:
    - resolution_rate is present and valid (0.0-1.0)
    - aggregated_stats contains required fields
    - instance_results (if present) is a list with valid entries
    - timestamps is present

    Args:
        report: The metrics report dictionary to validate

    Returns:
        Tuple of (is_valid, list_of_errors)
    """
    errors: list[str] = []

    # Check resolution_rate
    if "resolution_rate" not in report:
        errors.append("Missing 'resolution_rate' field")
    elif not isinstance(report["resolution_rate"], (int, float)):
        errors.append("'resolution_rate' must be a number")
    elif not (0.0 <= report["resolution_rate"] <= 1.0):
        errors.append(f"'resolution_rate' must be between 0.0 and 1.0, got {report['resolution_rate']}")

    # Check aggregated_stats
    if "aggregated_stats" not in report:
        errors.append("Missing 'aggregated_stats' field")
    else:
        stats = report["aggregated_stats"]
        required_stat_fields = [
            "total_instances",
            "completed_instances",
            "successful_instances",
            "failed_instances",
        ]
        for field in required_stat_fields:
            if field not in stats:
                errors.append(f"Missing 'aggregated_stats.{field}' field")
            elif not isinstance(stats[field], int):
                errors.append(f"'aggregated_stats.{field}' must be an integer")

    # Check instance_results if present
    if "instance_results" in report:
        if not isinstance(report["instance_results"], list):
            errors.append("'instance_results' must be a list")
        else:
            for i, result in enumerate(report["instance_results"]):
                if not isinstance(result, dict):
                    errors.append(f"'instance_results[{i}]' must be a dictionary")
                    continue
                if "instance_id" not in result:
                    errors.append(f"'instance_results[{i}]' missing 'instance_id'")
                if "status" not in result:
                    errors.append(f"'instance_results[{i}]' missing 'status'")

    # Check timestamps
    if "timestamps" not in report:
        errors.append("Missing 'timestamps' field")
    elif "generated_at" not in report.get("timestamps", {}):
        errors.append("Missing 'timestamps.generated_at' field")

    return len(errors) == 0, errors


def get_summary_from_report(report: dict[str, Any]) -> str:
    """Generate a human-readable summary from a metrics report.

    Args:
        report: The metrics report dictionary

    Returns:
        Multi-line string summary
    """
    lines = [
        "=" * 60,
        "SWE-bench Evaluation Report",
        "=" * 60,
    ]

    if report.get("run_id"):
        lines.append(f"Run ID: {report['run_id']}")
    if report.get("dataset_name"):
        lines.append(f"Dataset: {report['dataset_name']}")
    if report.get("model_name"):
        lines.append(f"Model: {report['model_name']}")

    lines.append("")
    lines.append("-" * 60)
    lines.append("Resolution Rate")
    lines.append("-" * 60)

    resolution_rate = report.get("resolution_rate", 0.0)
    lines.append(f"  Overall: {resolution_rate:.2%}")

    # Aggregated stats
    stats = report.get("aggregated_stats", {})
    if stats:
        lines.append("")
        lines.append("-" * 60)
        lines.append("Instance Summary")
        lines.append("-" * 60)
        lines.append(f"  Total: {stats.get('total_instances', 0)}")
        lines.append(f"  Completed: {stats.get('completed_instances', 0)}")
        lines.append(f"  Successful: {stats.get('successful_instances', 0)}")
        lines.append(f"  Failed: {stats.get('failed_instances', 0)}")
        lines.append(f"  Errors: {stats.get('error_instances', 0)}")
        lines.append(f"  Skipped: {stats.get('skipped_instances', 0)}")

    # Timing stats
    timing = report.get("timing_stats", {})
    if timing:
        lines.append("")
        lines.append("-" * 60)
        lines.append("Timing")
        lines.append("-" * 60)
        total_time = timing.get("total_time_seconds", 0)
        avg_time = timing.get("average_time_seconds", 0)
        lines.append(f"  Total Time: {total_time:.1f}s ({total_time/60:.1f}m)")
        lines.append(f"  Average Time: {avg_time:.1f}s per instance")
        if timing.get("min_time_seconds") is not None:
            lines.append(f"  Min Time: {timing['min_time_seconds']:.1f}s")
        if timing.get("max_time_seconds") is not None:
            lines.append(f"  Max Time: {timing['max_time_seconds']:.1f}s")

    # Per-repo stats
    per_repo = report.get("per_repo_stats", {})
    if per_repo:
        lines.append("")
        lines.append("-" * 60)
        lines.append("Per-Repository Results")
        lines.append("-" * 60)
        for repo, repo_stats in sorted(per_repo.items()):
            rate = repo_stats.get("resolution_rate", 0.0)
            total = repo_stats.get("total_instances", 0)
            success = repo_stats.get("successful_instances", 0)
            lines.append(f"  {repo}: {success}/{total} ({rate:.2%})")

    # Timestamp
    timestamps = report.get("timestamps", {})
    if timestamps.get("generated_at"):
        lines.append("")
        lines.append("-" * 60)
        lines.append(f"Generated: {timestamps['generated_at']}")

    lines.append("=" * 60)

    return "\n".join(lines)


def compare_reports(
    report_a: dict[str, Any],
    report_b: dict[str, Any],
    *,
    label_a: str = "Report A",
    label_b: str = "Report B",
) -> dict[str, Any]:
    """Compare two metrics reports and show differences.

    Args:
        report_a: First metrics report
        report_b: Second metrics report
        label_a: Label for first report
        label_b: Label for second report

    Returns:
        Dictionary with comparison results
    """
    stats_a = report_a.get("aggregated_stats", {})
    stats_b = report_b.get("aggregated_stats", {})

    rate_a = report_a.get("resolution_rate", 0.0)
    rate_b = report_b.get("resolution_rate", 0.0)

    comparison = {
        "labels": [label_a, label_b],
        "resolution_rate": {
            label_a: rate_a,
            label_b: rate_b,
            "difference": rate_b - rate_a,
            "improvement_percent": ((rate_b - rate_a) / rate_a * 100) if rate_a > 0 else 0.0,
        },
        "total_instances": {
            label_a: stats_a.get("total_instances", 0),
            label_b: stats_b.get("total_instances", 0),
        },
        "successful_instances": {
            label_a: stats_a.get("successful_instances", 0),
            label_b: stats_b.get("successful_instances", 0),
            "difference": stats_b.get("successful_instances", 0) - stats_a.get("successful_instances", 0),
        },
    }

    # Per-repo comparison
    per_repo_a = report_a.get("per_repo_stats", {})
    per_repo_b = report_b.get("per_repo_stats", {})
    all_repos = set(per_repo_a.keys()) | set(per_repo_b.keys())

    per_repo_comparison = {}
    for repo in sorted(all_repos):
        rate_repo_a = per_repo_a.get(repo, {}).get("resolution_rate", 0.0)
        rate_repo_b = per_repo_b.get(repo, {}).get("resolution_rate", 0.0)
        per_repo_comparison[repo] = {
            label_a: rate_repo_a,
            label_b: rate_repo_b,
            "difference": rate_repo_b - rate_repo_a,
        }

    comparison["per_repo_comparison"] = per_repo_comparison

    return comparison
