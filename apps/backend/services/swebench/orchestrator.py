"""
SWE-bench Benchmark Execution Orchestrator
===========================================

Coordinates the full SWE-bench benchmark execution pipeline:
1. Load dataset from HuggingFace
2. Convert instances to autoclaude task format
3. Execute tasks via autoclaude pipeline
4. Collect execution results
5. Export results to JSONL predictions
6. Run SWE-bench evaluation harness

The orchestrator is used by:
- Backend API: To run benchmark evaluations
- CLI: To execute benchmarks from command line
- Frontend: To track real-time progress

Usage:
    from apps.backend.services.swebench.orchestrator import BenchmarkOrchestrator

    # Create and configure orchestrator
    orchestrator = BenchmarkOrchestrator()

    # Run a benchmark
    result = orchestrator.run(
        variant="lite",
        max_instances=10,
        output_dir="./output",
    )

    # Or use context manager
    with BenchmarkOrchestrator() as orchestrator:
        result = orchestrator.run(variant="lite")
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator, Optional, Union

from .converter import convert_batch, convert_to_task, ConversionError
from .evaluator import (
    execute_evaluation,
    check_evaluation_prerequisites,
    cleanup_docker_resources,
    EvaluationError,
)
from .exporter import (
    export_predictions,
    append_prediction,
    ExportError,
)
from .health import (
    check_infrastructure,
    get_recommended_max_workers,
)
from .loader import (
    load_benchmark,
    load_benchmark_iterator,
    DatasetLoadError,
)
from .models import (
    BenchmarkResult,
    BenchmarkVariant,
    ExecutionStatus,
    InstanceResult,
    SWEBenchInstance,
    AutoclaudeTask,
    InfrastructureStatus,
)


logger = logging.getLogger(__name__)


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class OrchestratorConfig:
    """
    Configuration for benchmark execution.

    Attributes:
        variant: SWE-bench benchmark variant to run
        max_instances: Maximum instances to process (None for all)
        max_workers: Maximum parallel workers for evaluation
        output_dir: Directory for output files (predictions, logs)
        cache_level: Docker image caching level
        timeout_per_instance: Timeout per instance in seconds
        include_hints: Whether to include hints in tasks
        skip_evaluation: Skip Docker-based evaluation (export only)
        cleanup_after_run: Clean up Docker resources after run
        resume_from_checkpoint: Resume from previous checkpoint if available
    """

    variant: BenchmarkVariant = BenchmarkVariant.LITE
    max_instances: Optional[int] = None
    max_workers: Optional[int] = None
    output_dir: Union[str, Path] = "./swebench_output"
    cache_level: str = "env"
    timeout_per_instance: int = 1800
    include_hints: bool = True
    skip_evaluation: bool = False
    cleanup_after_run: bool = True
    resume_from_checkpoint: bool = True


@dataclass
class OrchestrationProgress:
    """
    Progress tracking for benchmark execution.

    Attributes:
        phase: Current execution phase
        current_instance: Currently processing instance ID
        completed_instances: Number of instances completed
        total_instances: Total instances to process
        failed_instances: Number of failed instances
        elapsed_seconds: Time elapsed since start
        estimated_remaining_seconds: Estimated remaining time
    """

    phase: str = "initializing"
    current_instance: Optional[str] = None
    completed_instances: int = 0
    total_instances: int = 0
    failed_instances: int = 0
    elapsed_seconds: float = 0.0
    estimated_remaining_seconds: Optional[float] = None

    @property
    def progress_percent(self) -> float:
        """Calculate progress percentage."""
        if self.total_instances == 0:
            return 0.0
        return round((self.completed_instances / self.total_instances) * 100, 1)


@dataclass
class OrchestrationResult:
    """
    Result of benchmark orchestration.

    Attributes:
        success: Whether orchestration completed successfully
        run_id: Unique identifier for this run
        benchmark_result: Full benchmark results with metrics
        predictions_path: Path to exported predictions file
        evaluation_result: Result from SWE-bench evaluation
        errors: List of error messages
        warnings: List of warning messages
    """

    success: bool = False
    run_id: str = ""
    benchmark_result: Optional[BenchmarkResult] = None
    predictions_path: Optional[Path] = None
    evaluation_result: Optional[dict[str, Any]] = None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class Checkpoint:
    """
    Checkpoint for resumable execution.

    Attributes:
        run_id: Run identifier
        variant: Benchmark variant
        completed_instance_ids: IDs of completed instances
        failed_instance_ids: IDs of failed instances
        results: Instance results collected so far
        created_at: When checkpoint was created
    """

    run_id: str
    variant: BenchmarkVariant
    completed_instance_ids: list[str] = field(default_factory=list)
    failed_instance_ids: list[str] = field(default_factory=list)
    results: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())


# =============================================================================
# ORCHESTRATOR ERRORS
# =============================================================================


class OrchestrationError(Exception):
    """Base exception for orchestration errors."""

    pass


class ConfigurationError(OrchestrationError):
    """Raised when configuration is invalid."""

    pass


class ExecutionInterruptedError(OrchestrationError):
    """Raised when execution is interrupted."""

    pass


# =============================================================================
# BENCHMARK ORCHESTRATOR
# =============================================================================


class BenchmarkOrchestrator:
    """
    Orchestrates SWE-bench benchmark execution.

    Coordinates the full pipeline:
    - Load dataset from HuggingFace
    - Convert instances to autoclaude task format
    - Execute tasks via autoclaude
    - Collect and export results
    - Run SWE-bench evaluation harness

    Supports:
    - Progress tracking with callbacks
    - Resumable execution from checkpoints
    - Infrastructure validation
    """

    def __init__(
        self,
        config: Optional[OrchestratorConfig] = None,
        progress_callback: Optional[Callable[[OrchestrationProgress], None]] = None,
    ) -> None:
        """
        Initialize the benchmark orchestrator.

        Args:
            config: Orchestrator configuration. Defaults to OrchestratorConfig().
            progress_callback: Optional callback for progress updates.
        """
        self.config = config or OrchestratorConfig()
        self.progress_callback = progress_callback
        self._progress = OrchestrationProgress()
        self._run_id: Optional[str] = None
        self._start_time: Optional[float] = None
        self._checkpoint: Optional[Checkpoint] = None
        self._cancelled = False

    def __enter__(self) -> "BenchmarkOrchestrator":
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """Context manager exit - cleanup on exit."""
        if self.config.cleanup_after_run and self._run_id:
            self._cleanup()

    # -------------------------------------------------------------------------
    # Public Methods
    # -------------------------------------------------------------------------

    def run(
        self,
        variant: Optional[Union[str, BenchmarkVariant]] = None,
        max_instances: Optional[int] = None,
        output_dir: Optional[Union[str, Path]] = None,
        run_id: Optional[str] = None,
        task_executor: Optional[Callable[[AutoclaudeTask], InstanceResult]] = None,
    ) -> OrchestrationResult:
        """
        Run the benchmark orchestration pipeline.

        Args:
            variant: Override config variant for this run.
            max_instances: Override config max_instances for this run.
            output_dir: Override config output_dir for this run.
            run_id: Custom run ID. Auto-generated if not provided.
            task_executor: Custom task executor function. Uses default if not provided.

        Returns:
            OrchestrationResult with complete run information.

        Raises:
            ConfigurationError: If configuration is invalid.
            OrchestrationError: If orchestration fails.

        Example:
            >>> orchestrator = BenchmarkOrchestrator()
            >>> result = orchestrator.run(variant="lite", max_instances=10)
            >>> if result.success:
            ...     print(f"Resolve rate: {result.benchmark_result.resolve_rate}%")
        """
        result = OrchestrationResult()

        try:
            # Apply overrides
            if variant is not None:
                self.config.variant = self._normalize_variant(variant)
            if max_instances is not None:
                self.config.max_instances = max_instances
            if output_dir is not None:
                self.config.output_dir = Path(output_dir)

            # Generate run ID
            self._run_id = run_id or self._generate_run_id()
            result.run_id = self._run_id

            # Initialize timing
            self._start_time = time.time()
            self._cancelled = False

            # Setup output directory
            output_path = self._setup_output_directory()

            logger.info(
                f"Starting benchmark run: {self._run_id} "
                f"(variant: {self.config.variant.value})"
            )

            # Phase 1: Validate infrastructure
            self._update_progress("validating_infrastructure")
            infra_status = self._validate_infrastructure()
            result.warnings.extend(infra_status.warnings)

            if not infra_status.all_passed:
                result.errors.extend(infra_status.errors)
                logger.error("Infrastructure validation failed")
                return result

            # Phase 2: Load dataset
            self._update_progress("loading_dataset")
            instances = self._load_dataset()

            if not instances:
                result.errors.append("No instances loaded from dataset")
                return result

            self._progress.total_instances = len(instances)
            logger.info(f"Loaded {len(instances)} instances")

            # Phase 3: Convert instances to tasks
            self._update_progress("converting_instances")
            tasks = self._convert_instances(instances)

            if not tasks:
                result.errors.append("No tasks converted from instances")
                return result

            logger.info(f"Converted {len(tasks)} tasks")

            # Phase 4: Check for checkpoint and resume if available
            checkpoint = None
            if self.config.resume_from_checkpoint:
                checkpoint = self._load_checkpoint(output_path)
                if checkpoint:
                    logger.info(
                        f"Resuming from checkpoint: "
                        f"{len(checkpoint.completed_instance_ids)} completed"
                    )

            # Phase 5: Execute tasks
            self._update_progress("executing_tasks")
            instance_results = self._execute_tasks(
                tasks=tasks,
                task_executor=task_executor,
                checkpoint=checkpoint,
                output_path=output_path,
            )

            # Phase 6: Create benchmark result
            benchmark_result = self._create_benchmark_result(
                instances=instances,
                instance_results=instance_results,
            )
            result.benchmark_result = benchmark_result

            # Phase 7: Export predictions
            self._update_progress("exporting_predictions")
            predictions_path = output_path / f"{self._run_id}_predictions.jsonl"
            self._export_predictions(
                instance_results=instance_results,
                output_path=predictions_path,
            )
            result.predictions_path = predictions_path
            logger.info(f"Exported predictions to: {predictions_path}")

            # Phase 8: Run evaluation (optional)
            if not self.config.skip_evaluation:
                self._update_progress("running_evaluation")
                try:
                    eval_result = self._run_evaluation(predictions_path)
                    result.evaluation_result = eval_result

                    # Update benchmark result with evaluation metrics
                    if eval_result.get("resolve_rate") is not None:
                        benchmark_result.resolve_rate = eval_result["resolve_rate"]

                except EvaluationError as e:
                    logger.warning(f"Evaluation failed: {e}")
                    result.warnings.append(f"Evaluation failed: {e}")

            # Phase 9: Cleanup
            if self.config.cleanup_after_run:
                self._update_progress("cleaning_up")
                self._cleanup()

            # Mark success
            result.success = True
            self._update_progress("completed")

            logger.info(
                f"Benchmark run completed: {self._run_id} "
                f"({benchmark_result.completed_instances}/{benchmark_result.total_instances} instances)"
            )

            return result

        except OrchestrationError:
            raise
        except Exception as e:
            logger.exception(f"Orchestration failed: {e}")
            result.errors.append(str(e))
            self._update_progress("failed")
            raise OrchestrationError(f"Orchestration failed: {e}") from e

    def cancel(self) -> None:
        """
        Cancel the current benchmark run.

        The run will complete the current instance and then stop,
        saving a checkpoint for resumption.
        """
        logger.info("Cancellation requested")
        self._cancelled = True

    def get_progress(self) -> OrchestrationProgress:
        """
        Get current execution progress.

        Returns:
            OrchestrationProgress with current state.
        """
        # Update elapsed time
        if self._start_time:
            self._progress.elapsed_seconds = time.time() - self._start_time

        return self._progress

    def validate_config(self) -> tuple[bool, list[str]]:
        """
        Validate the current configuration.

        Returns:
            Tuple of (is_valid, list of error messages).
        """
        errors: list[str] = []

        # Validate variant
        if not isinstance(self.config.variant, BenchmarkVariant):
            try:
                self._normalize_variant(self.config.variant)
            except ValueError as e:
                errors.append(str(e))

        # Validate max_workers
        if self.config.max_workers is not None and self.config.max_workers < 1:
            errors.append("max_workers must be at least 1")

        # Validate timeout
        if self.config.timeout_per_instance < 60:
            errors.append("timeout_per_instance must be at least 60 seconds")

        # Validate cache level
        valid_cache_levels = ["none", "base", "env", "instance"]
        if self.config.cache_level not in valid_cache_levels:
            errors.append(f"cache_level must be one of: {valid_cache_levels}")

        return len(errors) == 0, errors

    # -------------------------------------------------------------------------
    # Private Methods - Pipeline Steps
    # -------------------------------------------------------------------------

    def _validate_infrastructure(self) -> InfrastructureStatus:
        """Validate infrastructure requirements."""
        status = check_infrastructure()

        if status.all_passed:
            logger.info("Infrastructure validation passed")
        else:
            for error in status.errors:
                logger.error(f"Infrastructure error: {error}")

        for warning in status.warnings:
            logger.warning(f"Infrastructure warning: {warning}")

        return status

    def _load_dataset(self) -> list[SWEBenchInstance]:
        """Load benchmark dataset from HuggingFace."""
        try:
            instances = load_benchmark(
                variant=self.config.variant,
                max_instances=self.config.max_instances,
            )
            return instances
        except DatasetLoadError as e:
            logger.error(f"Failed to load dataset: {e}")
            raise OrchestrationError(f"Failed to load dataset: {e}") from e

    def _convert_instances(
        self,
        instances: list[SWEBenchInstance],
    ) -> list[AutoclaudeTask]:
        """Convert SWE-bench instances to autoclaude tasks."""
        try:
            tasks, errors = convert_batch(
                instances=instances,
                include_hints=self.config.include_hints,
                skip_errors=True,
            )

            if errors:
                for instance_id, error in errors:
                    logger.warning(f"Conversion error for {instance_id}: {error}")

            return tasks

        except ConversionError as e:
            logger.error(f"Conversion failed: {e}")
            raise OrchestrationError(f"Conversion failed: {e}") from e

    def _execute_tasks(
        self,
        tasks: list[AutoclaudeTask],
        task_executor: Optional[Callable[[AutoclaudeTask], InstanceResult]],
        checkpoint: Optional[Checkpoint],
        output_path: Path,
    ) -> list[InstanceResult]:
        """Execute tasks and collect results."""
        results: list[InstanceResult] = []
        skip_ids: set[str] = set()

        # Load results from checkpoint if available
        if checkpoint:
            skip_ids.update(checkpoint.completed_instance_ids)
            skip_ids.update(checkpoint.failed_instance_ids)

            # Reconstruct previous results
            for result_dict in checkpoint.results:
                try:
                    results.append(InstanceResult(**result_dict))
                except Exception as e:
                    logger.warning(f"Failed to restore checkpoint result: {e}")

        # Use default executor if none provided
        executor = task_executor or self._default_task_executor

        for task in tasks:
            # Check for cancellation
            if self._cancelled:
                logger.info("Execution cancelled, saving checkpoint")
                self._save_checkpoint(output_path, results)
                raise ExecutionInterruptedError("Execution cancelled by user")

            # Skip already processed instances
            if task.task_id in skip_ids:
                logger.debug(f"Skipping already processed: {task.task_id}")
                continue

            # Update progress
            self._progress.current_instance = task.task_id
            self._update_progress("executing_tasks")

            # Execute task
            try:
                logger.info(f"Executing task: {task.task_id}")
                started_at = datetime.now()

                result = executor(task)

                # Ensure result has correct instance_id
                if not result.instance_id:
                    result.instance_id = task.task_id

                # Set timing if not already set
                if not result.started_at:
                    result.started_at = started_at
                if not result.completed_at:
                    result.completed_at = datetime.now()

                results.append(result)

                # Update progress counters
                if result.status == ExecutionStatus.COMPLETED:
                    self._progress.completed_instances += 1
                elif result.status == ExecutionStatus.FAILED:
                    self._progress.failed_instances += 1

                # Append to predictions file for streaming export
                predictions_path = output_path / f"{self._run_id}_predictions.jsonl"
                try:
                    append_prediction(predictions_path, result)
                except ExportError as e:
                    logger.warning(f"Failed to append prediction: {e}")

            except Exception as e:
                logger.error(f"Task execution failed for {task.task_id}: {e}")

                result = InstanceResult(
                    instance_id=task.task_id,
                    status=ExecutionStatus.FAILED,
                    error_message=str(e),
                    started_at=datetime.now(),
                    completed_at=datetime.now(),
                )
                results.append(result)
                self._progress.failed_instances += 1

            # Save checkpoint periodically
            if len(results) % 10 == 0:
                self._save_checkpoint(output_path, results)

            # Update estimated time
            self._update_estimated_time()

        # Final checkpoint save
        self._save_checkpoint(output_path, results)

        return results

    def _default_task_executor(self, task: AutoclaudeTask) -> InstanceResult:
        """
        Default task executor stub.

        In production, this should be replaced with actual autoclaude execution.
        This stub simulates execution for testing purposes.
        """
        # TODO: Integrate with actual autoclaude execution pipeline
        logger.warning(
            f"Using default task executor stub for: {task.task_id}. "
            "Provide a task_executor for actual execution."
        )

        return InstanceResult(
            instance_id=task.task_id,
            status=ExecutionStatus.COMPLETED,
            model_patch="",  # Empty patch - stub result
            started_at=datetime.now(),
            completed_at=datetime.now(),
            execution_time_seconds=0.0,
        )

    def _create_benchmark_result(
        self,
        instances: list[SWEBenchInstance],
        instance_results: list[InstanceResult],
    ) -> BenchmarkResult:
        """Create benchmark result from execution results."""
        completed = sum(
            1 for r in instance_results
            if r.status == ExecutionStatus.COMPLETED
        )

        return BenchmarkResult(
            run_id=self._run_id or "",
            variant=self.config.variant,
            total_instances=len(instances),
            completed_instances=completed,
            instance_results=instance_results,
            started_at=datetime.fromtimestamp(self._start_time or time.time()),
            completed_at=datetime.now(),
        )

    def _export_predictions(
        self,
        instance_results: list[InstanceResult],
        output_path: Path,
    ) -> int:
        """Export instance results to JSONL predictions file."""
        try:
            count = export_predictions(
                results=instance_results,
                output_path=output_path,
                model_name="autoclaude",
            )
            logger.info(f"Exported {count} predictions to {output_path}")
            return count
        except ExportError as e:
            logger.error(f"Failed to export predictions: {e}")
            raise OrchestrationError(f"Failed to export predictions: {e}") from e

    def _run_evaluation(self, predictions_path: Path) -> dict[str, Any]:
        """Run SWE-bench evaluation harness."""
        # Check prerequisites
        passed, errors = check_evaluation_prerequisites(str(predictions_path))
        if not passed:
            raise EvaluationError("; ".join(errors))

        # Determine max workers
        max_workers = self.config.max_workers or get_recommended_max_workers()

        return execute_evaluation(
            predictions_path=str(predictions_path),
            run_id=self._run_id or "",
            variant=self.config.variant,
            max_workers=max_workers,
            cache_level=self.config.cache_level,
            timeout=self.config.timeout_per_instance,
            log_dir=str(Path(self.config.output_dir) / "logs"),
        )

    def _cleanup(self) -> None:
        """Clean up resources after run."""
        if self._run_id and self.config.cleanup_after_run:
            try:
                cleanup_docker_resources(
                    prune_containers=True,
                    prune_images=False,
                    prune_volumes=False,
                )
            except Exception as e:
                logger.warning(f"Cleanup failed: {e}")

    # -------------------------------------------------------------------------
    # Private Methods - Utilities
    # -------------------------------------------------------------------------

    def _normalize_variant(
        self,
        variant: Union[str, BenchmarkVariant],
    ) -> BenchmarkVariant:
        """Normalize variant input to BenchmarkVariant enum."""
        if isinstance(variant, BenchmarkVariant):
            return variant

        variant_lower = variant.lower().strip()
        for v in BenchmarkVariant:
            if v.value == variant_lower:
                return v

        valid_options = [v.value for v in BenchmarkVariant]
        raise ValueError(
            f"Unknown benchmark variant: '{variant}'. "
            f"Valid options: {valid_options}"
        )

    def _generate_run_id(self) -> str:
        """Generate unique run ID."""
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        short_uuid = str(uuid.uuid4())[:8]
        return f"{self.config.variant.value}-{timestamp}-{short_uuid}"

    def _setup_output_directory(self) -> Path:
        """Setup output directory for run."""
        output_dir = Path(self.config.output_dir)
        run_dir = output_dir / self._run_id

        run_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Output directory: {run_dir}")

        return run_dir

    def _update_progress(self, phase: str) -> None:
        """Update progress and notify callback."""
        self._progress.phase = phase

        if self._start_time:
            self._progress.elapsed_seconds = time.time() - self._start_time

        if self.progress_callback:
            try:
                self.progress_callback(self._progress)
            except Exception as e:
                logger.warning(f"Progress callback error: {e}")

    def _update_estimated_time(self) -> None:
        """Update estimated remaining time."""
        if self._progress.completed_instances > 0 and self._start_time:
            elapsed = time.time() - self._start_time
            avg_time_per_instance = elapsed / self._progress.completed_instances
            remaining_instances = (
                self._progress.total_instances - self._progress.completed_instances
            )
            self._progress.estimated_remaining_seconds = (
                avg_time_per_instance * remaining_instances
            )

    def _save_checkpoint(
        self,
        output_path: Path,
        results: list[InstanceResult],
    ) -> None:
        """Save checkpoint for resumable execution."""
        checkpoint = Checkpoint(
            run_id=self._run_id or "",
            variant=self.config.variant,
            completed_instance_ids=[
                r.instance_id for r in results
                if r.status == ExecutionStatus.COMPLETED and r.instance_id
            ],
            failed_instance_ids=[
                r.instance_id for r in results
                if r.status == ExecutionStatus.FAILED and r.instance_id
            ],
            results=[r.model_dump() for r in results],
        )

        checkpoint_path = output_path / "checkpoint.json"
        try:
            with open(checkpoint_path, "w", encoding="utf-8") as f:
                json.dump({
                    "run_id": checkpoint.run_id,
                    "variant": checkpoint.variant.value,
                    "completed_instance_ids": checkpoint.completed_instance_ids,
                    "failed_instance_ids": checkpoint.failed_instance_ids,
                    "results": checkpoint.results,
                    "created_at": checkpoint.created_at,
                }, f, indent=2, default=str)
            logger.debug(f"Saved checkpoint: {checkpoint_path}")
        except Exception as e:
            logger.warning(f"Failed to save checkpoint: {e}")

    def _load_checkpoint(self, output_path: Path) -> Optional[Checkpoint]:
        """Load checkpoint from previous run."""
        checkpoint_path = output_path / "checkpoint.json"

        if not checkpoint_path.exists():
            return None

        try:
            with open(checkpoint_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            return Checkpoint(
                run_id=data.get("run_id", ""),
                variant=BenchmarkVariant(data.get("variant", "lite")),
                completed_instance_ids=data.get("completed_instance_ids", []),
                failed_instance_ids=data.get("failed_instance_ids", []),
                results=data.get("results", []),
                created_at=data.get("created_at", ""),
            )

        except Exception as e:
            logger.warning(f"Failed to load checkpoint: {e}")
            return None

    def to_dict(self) -> dict[str, Any]:
        """Convert orchestrator state to dictionary."""
        return {
            "run_id": self._run_id,
            "config": {
                "variant": self.config.variant.value,
                "max_instances": self.config.max_instances,
                "max_workers": self.config.max_workers,
                "output_dir": str(self.config.output_dir),
                "cache_level": self.config.cache_level,
                "timeout_per_instance": self.config.timeout_per_instance,
                "skip_evaluation": self.config.skip_evaluation,
            },
            "progress": {
                "phase": self._progress.phase,
                "current_instance": self._progress.current_instance,
                "completed_instances": self._progress.completed_instances,
                "total_instances": self._progress.total_instances,
                "failed_instances": self._progress.failed_instances,
                "progress_percent": self._progress.progress_percent,
                "elapsed_seconds": self._progress.elapsed_seconds,
                "estimated_remaining_seconds": self._progress.estimated_remaining_seconds,
            },
        }


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================


def run_benchmark(
    variant: Union[str, BenchmarkVariant] = BenchmarkVariant.LITE,
    max_instances: Optional[int] = None,
    output_dir: Union[str, Path] = "./swebench_output",
    progress_callback: Optional[Callable[[OrchestrationProgress], None]] = None,
) -> OrchestrationResult:
    """
    Run a SWE-bench benchmark evaluation.

    Convenience function for simple benchmark execution.

    Args:
        variant: Benchmark variant to run.
        max_instances: Maximum instances to process.
        output_dir: Directory for output files.
        progress_callback: Optional progress callback.

    Returns:
        OrchestrationResult with run information.

    Example:
        >>> result = run_benchmark("lite", max_instances=10)
        >>> print(f"Completed: {result.benchmark_result.completed_instances}")
    """
    config = OrchestratorConfig(
        max_instances=max_instances,
        output_dir=output_dir,
    )

    orchestrator = BenchmarkOrchestrator(
        config=config,
        progress_callback=progress_callback,
    )

    return orchestrator.run(variant=variant)


def validate_benchmark_environment() -> tuple[bool, list[str], list[str]]:
    """
    Validate environment for benchmark execution.

    Returns:
        Tuple of (is_ready, errors, warnings).

    Example:
        >>> ready, errors, warnings = validate_benchmark_environment()
        >>> if ready:
        ...     print("Ready to run benchmarks!")
        ... else:
        ...     for error in errors:
        ...         print(f"Error: {error}")
    """
    status = check_infrastructure()
    return status.all_passed, status.errors, status.warnings


# =============================================================================
# CLI ENTRY POINT
# =============================================================================


def main() -> None:
    """CLI entry point for benchmark orchestration."""
    import argparse

    parser = argparse.ArgumentParser(
        description="SWE-bench Benchmark Orchestrator"
    )
    parser.add_argument(
        "--variant",
        type=str,
        default="lite",
        choices=["lite", "verified", "full", "multimodal", "multilingual"],
        help="Benchmark variant to run (default: lite)",
    )
    parser.add_argument(
        "--max-instances",
        type=int,
        default=None,
        help="Maximum instances to process",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="./swebench_output",
        help="Output directory for results",
    )
    parser.add_argument(
        "--skip-evaluation",
        action="store_true",
        help="Skip Docker-based evaluation (export only)",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Only validate environment, don't run benchmark",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON",
    )

    args = parser.parse_args()

    if args.validate_only:
        ready, errors, warnings = validate_benchmark_environment()

        if args.json:
            print(json.dumps({
                "ready": ready,
                "errors": errors,
                "warnings": warnings,
            }, indent=2))
        else:
            if ready:
                print("Environment is ready for benchmark execution.")
            else:
                print("Environment validation failed:")
                for error in errors:
                    print(f"  ERROR: {error}")

            if warnings:
                print("\nWarnings:")
                for warning in warnings:
                    print(f"  WARNING: {warning}")

        return

    # Run benchmark
    config = OrchestratorConfig(
        output_dir=args.output_dir,
        skip_evaluation=args.skip_evaluation,
    )

    orchestrator = BenchmarkOrchestrator(config=config)

    try:
        result = orchestrator.run(
            variant=args.variant,
            max_instances=args.max_instances,
        )

        if args.json:
            print(json.dumps({
                "success": result.success,
                "run_id": result.run_id,
                "predictions_path": str(result.predictions_path) if result.predictions_path else None,
                "total_instances": result.benchmark_result.total_instances if result.benchmark_result else 0,
                "completed_instances": result.benchmark_result.completed_instances if result.benchmark_result else 0,
                "resolve_rate": result.benchmark_result.resolve_rate if result.benchmark_result else None,
                "errors": result.errors,
                "warnings": result.warnings,
            }, indent=2))
        else:
            if result.success:
                print(f"\nBenchmark completed successfully!")
                print(f"  Run ID: {result.run_id}")
                print(f"  Predictions: {result.predictions_path}")
                if result.benchmark_result:
                    print(
                        f"  Instances: {result.benchmark_result.completed_instances}/"
                        f"{result.benchmark_result.total_instances}"
                    )
                    if result.benchmark_result.resolve_rate is not None:
                        print(f"  Resolve rate: {result.benchmark_result.resolve_rate}%")
            else:
                print("\nBenchmark failed:")
                for error in result.errors:
                    print(f"  ERROR: {error}")

            if result.warnings:
                print("\nWarnings:")
                for warning in result.warnings:
                    print(f"  WARNING: {warning}")

    except OrchestrationError as e:
        print(f"Orchestration failed: {e}")
        exit(1)


if __name__ == "__main__":
    main()
