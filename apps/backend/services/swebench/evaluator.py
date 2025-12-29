"""
Docker-Based SWE-bench Evaluation Orchestrator
===============================================

Integrates with the official SWE-bench evaluation harness to run Docker-based
test evaluation on autoclaude predictions.

This module provides functions to:
- Execute SWE-bench evaluation using the official harness
- Manage Docker container cleanup
- Monitor evaluation progress and resource usage
- Parse evaluation results

Usage:
    from apps.backend.services.swebench.evaluator import execute_evaluation

    # Run evaluation on predictions
    result = execute_evaluation(
        predictions_path="predictions.jsonl",
        run_id="run-001",
        max_workers=4,
    )

    # Check results
    print(f"Resolve rate: {result['resolve_rate']}%")

Note:
    This module requires the SWE-bench package to be installed:
    git clone https://github.com/princeton-nlp/SWE-bench.git
    pip install -e ./SWE-bench
"""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional, Union

from .health import (
    check_docker_available,
    check_disk_space,
    get_recommended_max_workers,
    MINIMUM_DISK_SPACE_GB,
)
from .models import (
    BenchmarkVariant,
    VARIANT_DATASET_NAMES,
)

logger = logging.getLogger(__name__)


# Constants
DEFAULT_LOG_DIR = "logs/run_evaluation"
DEFAULT_CACHE_LEVEL = "env"  # Cache at environment level for faster re-runs
VALID_CACHE_LEVELS = ["none", "base", "env", "instance"]


class EvaluationError(Exception):
    """Raised when evaluation fails."""

    pass


class EvaluationNotAvailableError(EvaluationError):
    """Raised when SWE-bench evaluation harness is not available."""

    pass


class InfrastructureError(EvaluationError):
    """Raised when infrastructure requirements are not met."""

    pass


def _check_swebench_available() -> bool:
    """
    Check if SWE-bench evaluation harness is installed.

    Returns:
        True if swebench.harness.run_evaluation is available.
    """
    try:
        from swebench.harness.run_evaluation import run_evaluation  # noqa: F401

        return True
    except ImportError:
        return False


def _validate_predictions_path(predictions_path: Union[str, Path]) -> Path:
    """
    Validate that predictions path exists and is readable.

    Args:
        predictions_path: Path to predictions JSONL file.

    Returns:
        Validated Path object.

    Raises:
        EvaluationError: If predictions file is invalid.
    """
    path = Path(predictions_path)

    if not path.exists():
        raise EvaluationError(f"Predictions file not found: {path}")

    if not path.is_file():
        raise EvaluationError(f"Predictions path is not a file: {path}")

    if path.suffix not in [".jsonl", ".json"]:
        logger.warning(
            f"Predictions file has unexpected extension: {path.suffix}. "
            "Expected .jsonl or .json"
        )

    return path


def _validate_max_workers(max_workers: Optional[int]) -> int:
    """
    Validate and cap max_workers to safe value.

    Args:
        max_workers: Requested number of workers. If None, uses recommended value.

    Returns:
        Safe max_workers value (capped at 75% of CPU cores).
    """
    recommended = get_recommended_max_workers()

    if max_workers is None:
        logger.info(f"Using recommended max_workers: {recommended}")
        return recommended

    if max_workers < 1:
        logger.warning(f"max_workers must be at least 1, got {max_workers}. Using 1.")
        return 1

    if max_workers > recommended:
        logger.warning(
            f"max_workers ({max_workers}) exceeds recommended ({recommended}). "
            f"Capping to {recommended} to prevent system overload."
        )
        return recommended

    return max_workers


def _validate_cache_level(cache_level: str) -> str:
    """
    Validate cache level setting.

    Args:
        cache_level: Requested cache level.

    Returns:
        Validated cache level.

    Raises:
        EvaluationError: If cache level is invalid.
    """
    if cache_level not in VALID_CACHE_LEVELS:
        raise EvaluationError(
            f"Invalid cache_level: '{cache_level}'. "
            f"Valid options: {VALID_CACHE_LEVELS}"
        )
    return cache_level


def _ensure_log_directory(log_dir: Union[str, Path], run_id: str) -> Path:
    """
    Ensure log directory exists for evaluation run.

    Args:
        log_dir: Base log directory.
        run_id: Unique run identifier.

    Returns:
        Path to the run-specific log directory.
    """
    run_log_dir = Path(log_dir) / run_id
    run_log_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"Evaluation logs will be written to: {run_log_dir}")
    return run_log_dir


def check_evaluation_prerequisites(
    predictions_path: Optional[Union[str, Path]] = None,
) -> tuple[bool, list[str]]:
    """
    Check all prerequisites for running evaluation.

    Verifies:
    - SWE-bench harness is installed
    - Docker is available and running
    - Sufficient disk space is available
    - Predictions file exists (if provided)

    Args:
        predictions_path: Optional path to predictions file to validate.

    Returns:
        Tuple of (all_passed, list of error messages).

    Example:
        >>> passed, errors = check_evaluation_prerequisites("predictions.jsonl")
        >>> if not passed:
        ...     print("Cannot run evaluation:")
        ...     for error in errors:
        ...         print(f"  - {error}")
    """
    errors: list[str] = []

    # Check SWE-bench installation
    if not _check_swebench_available():
        errors.append(
            "SWE-bench harness not installed. "
            "Install with: git clone https://github.com/princeton-nlp/SWE-bench.git && "
            "pip install -e ./SWE-bench"
        )

    # Check Docker availability
    docker_result = check_docker_available()
    if not docker_result.passed:
        errors.append(docker_result.message)

    # Check disk space
    disk_result = check_disk_space()
    if not disk_result.passed:
        errors.append(disk_result.message)

    # Check predictions file if provided
    if predictions_path is not None:
        try:
            _validate_predictions_path(predictions_path)
        except EvaluationError as e:
            errors.append(str(e))

    return len(errors) == 0, errors


def execute_evaluation(
    predictions_path: Union[str, Path],
    run_id: str,
    dataset_name: Optional[str] = None,
    variant: Optional[BenchmarkVariant] = None,
    split: str = "test",
    max_workers: Optional[int] = None,
    cache_level: str = DEFAULT_CACHE_LEVEL,
    timeout: int = 1800,
    log_dir: Union[str, Path] = DEFAULT_LOG_DIR,
    namespace: Optional[str] = None,
    force_rebuild: bool = False,
    cleanup_containers: bool = True,
    progress_callback: Optional[Callable[[dict[str, Any]], None]] = None,
) -> dict[str, Any]:
    """
    Execute SWE-bench evaluation using the official evaluation harness.

    This function runs the SWE-bench evaluation harness on the provided predictions
    file, executing tests in Docker containers and collecting results.

    Args:
        predictions_path: Path to JSONL predictions file.
        run_id: Unique identifier for this evaluation run.
        dataset_name: Full HuggingFace dataset name. If None, uses variant.
        variant: BenchmarkVariant to evaluate. Used to derive dataset_name if not provided.
        split: Dataset split to evaluate ('test' or 'dev').
        max_workers: Maximum parallel workers. Capped at 75% of CPU cores.
        cache_level: Docker image caching level ('none', 'base', 'env', 'instance').
        timeout: Per-instance timeout in seconds (default: 1800 = 30 minutes).
        log_dir: Base directory for evaluation logs.
        namespace: Docker namespace for images. Set to '' for ARM compatibility.
        force_rebuild: Force rebuild of Docker images.
        cleanup_containers: Clean up Docker containers after evaluation.
        progress_callback: Optional callback for progress updates.

    Returns:
        Dictionary containing evaluation results:
        {
            "run_id": str,
            "predictions_path": str,
            "dataset_name": str,
            "log_dir": str,
            "total_instances": int,
            "resolved_instances": int,
            "resolve_rate": float,
            "started_at": str,
            "completed_at": str,
            "duration_seconds": float,
            "status": str,  # "success" or "failed"
            "error": str,  # Only present if status is "failed"
        }

    Raises:
        EvaluationNotAvailableError: If SWE-bench harness is not installed.
        InfrastructureError: If Docker or disk space requirements not met.
        EvaluationError: If evaluation fails for other reasons.

    Example:
        >>> result = execute_evaluation(
        ...     predictions_path="predictions.jsonl",
        ...     run_id="run-001",
        ...     variant=BenchmarkVariant.LITE,
        ...     max_workers=4,
        ... )
        >>> print(f"Resolve rate: {result['resolve_rate']}%")
    """
    started_at = datetime.now()
    result: dict[str, Any] = {
        "run_id": run_id,
        "predictions_path": str(predictions_path),
        "started_at": started_at.isoformat(),
        "status": "pending",
    }

    logger.info(f"Starting evaluation run: {run_id}")

    try:
        # Check prerequisites
        passed, errors = check_evaluation_prerequisites(predictions_path)
        if not passed:
            # Determine error type
            if not _check_swebench_available():
                raise EvaluationNotAvailableError(errors[0])
            else:
                raise InfrastructureError("; ".join(errors))

        # Import SWE-bench harness (already verified available)
        from swebench.harness.run_evaluation import run_evaluation

        # Validate inputs
        validated_path = _validate_predictions_path(predictions_path)
        validated_workers = _validate_max_workers(max_workers)
        validated_cache = _validate_cache_level(cache_level)

        # Determine dataset name
        if dataset_name is None:
            if variant is None:
                variant = BenchmarkVariant.LITE
                logger.warning(
                    f"No dataset_name or variant specified. "
                    f"Defaulting to {variant.value}"
                )
            dataset_name = VARIANT_DATASET_NAMES[variant]

        result["dataset_name"] = dataset_name

        # Setup log directory
        run_log_dir = _ensure_log_directory(log_dir, run_id)
        result["log_dir"] = str(run_log_dir)

        logger.info(f"Evaluation configuration:")
        logger.info(f"  Predictions: {validated_path}")
        logger.info(f"  Dataset: {dataset_name}")
        logger.info(f"  Split: {split}")
        logger.info(f"  Max workers: {validated_workers}")
        logger.info(f"  Cache level: {validated_cache}")
        logger.info(f"  Timeout: {timeout}s")

        # Report progress if callback provided
        if progress_callback:
            progress_callback({
                "phase": "starting",
                "run_id": run_id,
                "dataset_name": dataset_name,
                "max_workers": validated_workers,
            })

        # Build evaluation kwargs
        eval_kwargs: dict[str, Any] = {
            "predictions_path": str(validated_path),
            "run_id": run_id,
            "dataset_name": dataset_name,
            "split": split,
            "max_workers": validated_workers,
            "cache_level": validated_cache,
            "timeout": timeout,
        }

        # Add optional parameters
        if namespace is not None:
            eval_kwargs["namespace"] = namespace
            logger.info(f"  Namespace: '{namespace}'")

        if force_rebuild:
            eval_kwargs["force_rebuild"] = True
            logger.info("  Force rebuild: enabled")

        # Execute evaluation
        logger.info("Starting SWE-bench evaluation harness...")
        if progress_callback:
            progress_callback({
                "phase": "evaluating",
                "run_id": run_id,
            })

        run_evaluation(**eval_kwargs)

        # Evaluation completed - parse results
        completed_at = datetime.now()
        duration = (completed_at - started_at).total_seconds()

        result.update({
            "completed_at": completed_at.isoformat(),
            "duration_seconds": duration,
            "status": "success",
        })

        # Try to parse report if available
        report_path = run_log_dir / "report.json"
        if report_path.exists():
            try:
                import json

                with open(report_path, "r") as f:
                    report = json.load(f)

                result["total_instances"] = report.get("total_instances", 0)
                result["resolved_instances"] = report.get("resolved_instances", 0)

                total = result["total_instances"]
                if total > 0:
                    result["resolve_rate"] = round(
                        (result["resolved_instances"] / total) * 100, 2
                    )
                else:
                    result["resolve_rate"] = 0.0

                logger.info(
                    f"Evaluation complete: {result['resolved_instances']}/{total} "
                    f"resolved ({result['resolve_rate']}%)"
                )
            except Exception as e:
                logger.warning(f"Could not parse evaluation report: {e}")
        else:
            logger.info(f"Evaluation complete. Check logs at: {run_log_dir}")

        # Report progress
        if progress_callback:
            progress_callback({
                "phase": "completed",
                "run_id": run_id,
                "result": result,
            })

        # Cleanup containers if requested
        if cleanup_containers:
            _cleanup_evaluation_containers(run_id)

        return result

    except EvaluationNotAvailableError:
        raise
    except InfrastructureError:
        raise
    except EvaluationError:
        raise
    except Exception as e:
        completed_at = datetime.now()
        duration = (completed_at - started_at).total_seconds()

        error_msg = f"Evaluation failed: {e}"
        logger.error(error_msg)

        result.update({
            "completed_at": completed_at.isoformat(),
            "duration_seconds": duration,
            "status": "failed",
            "error": str(e),
        })

        if progress_callback:
            progress_callback({
                "phase": "failed",
                "run_id": run_id,
                "error": str(e),
            })

        raise EvaluationError(error_msg) from e


def execute_gold_evaluation(
    variant: BenchmarkVariant = BenchmarkVariant.LITE,
    run_id: Optional[str] = None,
    max_workers: Optional[int] = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Run evaluation with gold (ground truth) patches for infrastructure validation.

    This function runs evaluation using the gold patches from the SWE-bench dataset,
    which should achieve a high resolve rate (>80%). Use this to validate that the
    evaluation infrastructure is working correctly before running with actual predictions.

    Args:
        variant: BenchmarkVariant to evaluate (default: LITE for faster testing).
        run_id: Unique run identifier. Auto-generated if not provided.
        max_workers: Maximum parallel workers.
        **kwargs: Additional arguments passed to execute_evaluation.

    Returns:
        Evaluation result dictionary (same as execute_evaluation).

    Example:
        >>> # Validate infrastructure with gold patches
        >>> result = execute_gold_evaluation(variant=BenchmarkVariant.LITE)
        >>> if result["resolve_rate"] >= 80:
        ...     print("Infrastructure validation passed!")
    """
    if run_id is None:
        run_id = f"gold-{variant.value}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    logger.info(f"Running gold evaluation for infrastructure validation: {run_id}")

    return execute_evaluation(
        predictions_path="gold",  # Special value for gold patches
        run_id=run_id,
        variant=variant,
        max_workers=max_workers,
        **kwargs,
    )


def _cleanup_evaluation_containers(run_id: str) -> None:
    """
    Clean up Docker containers created during evaluation.

    Args:
        run_id: The run ID to clean up containers for.
    """
    try:
        import docker

        client = docker.from_env()

        # Find and remove containers with run_id in name
        containers = client.containers.list(
            all=True,
            filters={"name": f"swe-eval-{run_id}"},
        )

        removed = 0
        for container in containers:
            try:
                container.remove(force=True)
                removed += 1
            except Exception as e:
                logger.warning(
                    f"Failed to remove container {container.name}: {e}"
                )

        if removed > 0:
            logger.info(f"Cleaned up {removed} evaluation container(s)")

    except Exception as e:
        logger.warning(f"Container cleanup failed: {e}")


def cleanup_docker_resources(
    prune_containers: bool = True,
    prune_images: bool = False,
    prune_volumes: bool = False,
) -> dict[str, Any]:
    """
    Clean up Docker resources to free disk space.

    This function can remove unused containers, images, and volumes.
    Use with caution as this will affect ALL Docker resources, not just SWE-bench.

    Args:
        prune_containers: Remove stopped containers (default: True).
        prune_images: Remove dangling images (default: False).
        prune_volumes: Remove unused volumes (default: False).

    Returns:
        Dictionary with cleanup statistics.

    Example:
        >>> # Clean up containers and dangling images
        >>> stats = cleanup_docker_resources(prune_images=True)
        >>> print(f"Freed {stats['space_reclaimed_mb']}MB")
    """
    try:
        import docker

        client = docker.from_env()
        stats: dict[str, Any] = {
            "containers_removed": 0,
            "images_removed": 0,
            "volumes_removed": 0,
            "space_reclaimed_bytes": 0,
        }

        if prune_containers:
            result = client.containers.prune()
            stats["containers_removed"] = len(result.get("ContainersDeleted", []) or [])
            stats["space_reclaimed_bytes"] += result.get("SpaceReclaimed", 0)
            logger.info(f"Pruned {stats['containers_removed']} containers")

        if prune_images:
            result = client.images.prune()
            stats["images_removed"] = len(result.get("ImagesDeleted", []) or [])
            stats["space_reclaimed_bytes"] += result.get("SpaceReclaimed", 0)
            logger.info(f"Pruned {stats['images_removed']} images")

        if prune_volumes:
            result = client.volumes.prune()
            stats["volumes_removed"] = len(result.get("VolumesDeleted", []) or [])
            stats["space_reclaimed_bytes"] += result.get("SpaceReclaimed", 0)
            logger.info(f"Pruned {stats['volumes_removed']} volumes")

        # Convert bytes to MB
        stats["space_reclaimed_mb"] = round(
            stats["space_reclaimed_bytes"] / (1024 * 1024), 2
        )

        logger.info(f"Total space reclaimed: {stats['space_reclaimed_mb']}MB")

        return stats

    except Exception as e:
        logger.error(f"Docker cleanup failed: {e}")
        raise EvaluationError(f"Docker cleanup failed: {e}") from e


def get_evaluation_status(
    run_id: str,
    log_dir: Union[str, Path] = DEFAULT_LOG_DIR,
) -> dict[str, Any]:
    """
    Get the status of an evaluation run.

    Args:
        run_id: The run ID to check.
        log_dir: Base log directory.

    Returns:
        Dictionary with status information.

    Example:
        >>> status = get_evaluation_status("run-001")
        >>> print(f"Status: {status['status']}")
    """
    run_log_dir = Path(log_dir) / run_id

    if not run_log_dir.exists():
        return {
            "run_id": run_id,
            "status": "not_found",
            "message": f"No logs found for run: {run_id}",
        }

    status: dict[str, Any] = {
        "run_id": run_id,
        "log_dir": str(run_log_dir),
        "status": "unknown",
    }

    # Check for report.json
    report_path = run_log_dir / "report.json"
    if report_path.exists():
        try:
            import json

            with open(report_path, "r") as f:
                report = json.load(f)

            status["status"] = "completed"
            status["report"] = report
            status["total_instances"] = report.get("total_instances", 0)
            status["resolved_instances"] = report.get("resolved_instances", 0)

            total = status["total_instances"]
            if total > 0:
                status["resolve_rate"] = round(
                    (status["resolved_instances"] / total) * 100, 2
                )
        except Exception as e:
            status["status"] = "completed"
            status["parse_error"] = str(e)
    else:
        # Check if evaluation is in progress
        status["status"] = "in_progress"

    # List log files
    log_files = list(run_log_dir.glob("*.log"))
    status["log_files"] = [str(f.name) for f in log_files]

    return status
