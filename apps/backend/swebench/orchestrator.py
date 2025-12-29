"""
SWE-bench Evaluation Orchestrator
=================================

Main orchestration logic for SWE-bench benchmark evaluations.

This orchestrator manages the evaluation loop:
1. Load dataset from HuggingFace
2. Load or create checkpoint for resumable evaluations
3. For each instance:
   a. Convert to autoclaude spec format
   b. Invoke SpecOrchestrator for evaluation
   c. Collect results
   d. Save checkpoint after each instance
4. Export results in SWE-bench format

Usage:
    from swebench.orchestrator import SWEBenchOrchestrator

    orchestrator = SWEBenchOrchestrator(
        dataset_name="princeton-nlp/SWE-bench_Lite",
        max_instances=10,
    )
    results = await orchestrator.run()
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from swebench.adapters.instance_adapter import (
    AutoClaudeSpec,
    convert_to_autoclaude_spec,
    save_spec_to_directory,
)
from swebench.adapters.results_adapter import (
    convert_results_batch,
    convert_to_swebench_prediction,
    export_predictions_to_jsonl,
)
from swebench.exporters import (
    export_predictions,
    generate_metrics_report,
)
from swebench.checkpoint_manager import (
    CheckpointCorruptedError,
    CheckpointManager,
    CheckpointNotFoundError,
)
from swebench.checkpoint_models import Checkpoint, InstanceCheckpointState
from swebench.dataset_loader import (
    DatasetLoadError,
    DatasetNotFoundError,
    get_dataset_info,
    load_swebench_dataset,
)
from swebench.docker_checker import DockerNotAvailableError, check_docker
from swebench.models import (
    EvaluationMetrics,
    InstanceResult,
    SWEBenchInstance,
    SWEBenchPrediction,
)

if TYPE_CHECKING:
    pass


logger = logging.getLogger(__name__)


class EvaluationError(Exception):
    """Raised when an evaluation error occurs."""

    pass


class SWEBenchOrchestrator:
    """Orchestrates SWE-bench benchmark evaluations.

    This class manages the end-to-end evaluation process:
    - Loading datasets from HuggingFace
    - Converting instances to autoclaude format
    - Running evaluations via SpecOrchestrator
    - Checkpointing for resumable evaluations
    - Collecting and exporting results

    The orchestrator is designed to support:
    - Checkpointing: saves progress after each instance for resume capability
    - Parallel worker execution (controlled externally)
    - Progress tracking and metrics collection
    """

    def __init__(
        self,
        dataset_name: str = "princeton-nlp/SWE-bench_Lite",
        *,
        max_instances: int | None = None,
        max_workers: int = 1,
        run_id: str | None = None,
        output_dir: Path | None = None,
        timeout_per_instance: int = 1800,
        model: str | None = None,
        project_dir: Path | None = None,
        skip_docker_check: bool = False,
    ):
        """Initialize the SWE-bench orchestrator.

        Args:
            dataset_name: HuggingFace dataset identifier
                (default: "princeton-nlp/SWE-bench_Lite")
            max_instances: Maximum number of instances to evaluate (None for all)
            max_workers: Number of parallel workers (default: 1)
            run_id: Unique identifier for this run (auto-generated if None)
            output_dir: Directory for output files
                (default: .auto-claude/swebench/)
            timeout_per_instance: Timeout per instance in seconds (default: 1800)
            model: Model to use for evaluation (default: from environment)
            project_dir: Project directory for evaluations
            skip_docker_check: Skip Docker availability check (for testing)
        """
        self.dataset_name = dataset_name
        self.max_instances = max_instances
        self.max_workers = max_workers
        self.run_id = run_id or self._generate_run_id()
        self.timeout_per_instance = timeout_per_instance
        self.model = model
        self.skip_docker_check = skip_docker_check

        # Set up directories
        if project_dir:
            self.project_dir = Path(project_dir)
        else:
            self.project_dir = Path.cwd()

        if output_dir:
            self.output_dir = Path(output_dir)
        else:
            self.output_dir = self.project_dir / ".auto-claude" / "swebench"

        # Ensure output directory exists
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # State tracking
        self._instances: list[SWEBenchInstance] = []
        self._results: dict[str, InstanceResult] = {}
        self._metrics: EvaluationMetrics | None = None
        self._start_time: float | None = None
        self._end_time: float | None = None

        # Checkpointing
        self._checkpoint_manager = CheckpointManager(
            checkpoint_dir=self.output_dir / "checkpoints"
        )
        self._checkpoint: Checkpoint | None = None

        # Flags
        self._is_initialized = False
        self._is_running = False

        logger.info(
            f"SWEBenchOrchestrator initialized: "
            f"dataset={dataset_name}, run_id={self.run_id}"
        )

    @staticmethod
    def _generate_run_id() -> str:
        """Generate a unique run identifier.

        Returns:
            Unique run ID string in format "swebench-YYYYMMDD-HHMMSS-XXXX"
        """
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        suffix = uuid.uuid4().hex[:4]
        return f"swebench-{timestamp}-{suffix}"

    @property
    def predictions_file(self) -> Path:
        """Path to the predictions JSONL file (with run_id prefix)."""
        return self.output_dir / f"{self.run_id}-predictions.jsonl"

    @property
    def report_file(self) -> Path:
        """Path to the metrics report JSON file (with run_id prefix)."""
        return self.output_dir / f"{self.run_id}-report.json"

    @property
    def standard_predictions_file(self) -> Path:
        """Path to the standard predictions JSONL file (without run_id prefix).

        This is the standard location expected by SWE-bench evaluation harness.
        """
        return self.output_dir / "predictions.jsonl"

    @property
    def standard_report_file(self) -> Path:
        """Path to the standard report JSON file (without run_id prefix).

        This is the standard location for the metrics report.
        """
        return self.output_dir / "report.json"

    @property
    def checkpoint_file(self) -> Path:
        """Path to the checkpoint file."""
        return self.output_dir / "checkpoints" / f"{self.run_id}.json"

    @property
    def specs_dir(self) -> Path:
        """Directory for generated spec files."""
        return self.output_dir / "specs" / self.run_id

    def get_instance_count(self) -> int:
        """Get the total number of instances to evaluate.

        Returns:
            Number of instances loaded or 0 if not initialized
        """
        return len(self._instances)

    def get_completed_count(self) -> int:
        """Get the number of completed instances.

        Returns:
            Number of instances with terminal status (success, failed, error, skipped)
        """
        terminal_states = {"success", "failed", "error", "skipped"}
        return sum(
            1 for r in self._results.values() if r.status in terminal_states
        )

    def get_progress(self) -> dict[str, Any]:
        """Get current evaluation progress.

        Returns:
            Dictionary with progress information:
                - total: Total instances
                - completed: Completed instances
                - pending: Pending instances
                - running: Currently running instances
                - success: Successful instances
                - failed: Failed instances
                - error: Error instances
                - progress_pct: Progress percentage (0-100)
        """
        total = len(self._instances)
        status_counts = {
            "pending": 0,
            "running": 0,
            "success": 0,
            "failed": 0,
            "error": 0,
            "skipped": 0,
        }

        for result in self._results.values():
            if result.status in status_counts:
                status_counts[result.status] += 1

        completed = status_counts["success"] + status_counts["failed"] + \
            status_counts["error"] + status_counts["skipped"]

        # Instances not yet in results are pending
        not_started = total - len(self._results)
        status_counts["pending"] += not_started

        progress_pct = (completed / total * 100) if total > 0 else 0

        return {
            "run_id": self.run_id,
            "total": total,
            "completed": completed,
            "progress_pct": round(progress_pct, 1),
            **status_counts,
        }

    async def initialize(self) -> None:
        """Initialize the orchestrator by loading dataset and validating environment.

        This must be called before run(). It:
        1. Checks Docker availability (if not skipped)
        2. Loads the dataset from HuggingFace
        3. Initializes instance result tracking

        Raises:
            DockerNotAvailableError: If Docker is not available
            DatasetNotFoundError: If the dataset cannot be found
            DatasetLoadError: If the dataset cannot be loaded
        """
        if self._is_initialized:
            logger.warning("Orchestrator already initialized")
            return

        logger.info(f"Initializing orchestrator for dataset: {self.dataset_name}")

        # Check Docker availability
        if not self.skip_docker_check:
            logger.info("Checking Docker availability...")
            try:
                check_docker()
                logger.info("Docker daemon is available")
            except DockerNotAvailableError:
                logger.error("Docker daemon not available")
                raise

        # Load dataset
        logger.info(f"Loading dataset: {self.dataset_name}")
        try:
            self._instances = load_swebench_dataset(
                self.dataset_name,
                max_instances=self.max_instances,
            )
            logger.info(f"Loaded {len(self._instances)} instances")
        except (DatasetNotFoundError, DatasetLoadError):
            logger.error(f"Failed to load dataset: {self.dataset_name}")
            raise

        # Initialize result tracking for all instances
        for instance in self._instances:
            self._results[instance.instance_id] = InstanceResult(
                instance_id=instance.instance_id,
                status="pending",
            )

        # Create specs directory
        self.specs_dir.mkdir(parents=True, exist_ok=True)

        self._is_initialized = True
        logger.info("Orchestrator initialization complete")

    async def run(self, resume: bool = False) -> EvaluationMetrics:
        """Run the SWE-bench evaluation.

        This is the main entry point that:
        1. Initializes if not already done
        2. Optionally loads checkpoint for resume
        3. Loops through instances
        4. Collects and exports results

        Args:
            resume: Whether to resume from checkpoint (if available)

        Returns:
            EvaluationMetrics with aggregated results

        Raises:
            EvaluationError: If evaluation fails critically
        """
        if self._is_running:
            raise EvaluationError("Evaluation is already running")

        # Initialize if needed
        if not self._is_initialized:
            await self.initialize()

        self._is_running = True
        self._start_time = time.time()

        try:
            logger.info(
                f"Starting evaluation: {len(self._instances)} instances, "
                f"run_id={self.run_id}"
            )

            # Load or create checkpoint
            resumed_count = 0
            if resume and self._checkpoint_manager.exists(self.run_id):
                try:
                    self._checkpoint = self._checkpoint_manager.load(self.run_id)
                    resumed_count = self._load_checkpoint_state()
                    logger.info(
                        f"Resumed from checkpoint: {resumed_count} instances "
                        f"already completed"
                    )
                except (CheckpointNotFoundError, CheckpointCorruptedError) as e:
                    logger.warning(
                        f"Failed to load checkpoint, starting fresh: {e}"
                    )
                    self._checkpoint = self._create_checkpoint()
            else:
                self._checkpoint = self._create_checkpoint()

            # Mark checkpoint as started
            self._checkpoint.mark_started()
            self._save_checkpoint()

            # Process instances sequentially
            # TODO: Add parallel processing with max_workers (future enhancement)
            for i, instance in enumerate(self._instances):
                instance_id = instance.instance_id

                # Skip if already completed (for resume)
                result = self._results.get(instance_id)
                if result and result.status in {
                    "success", "failed", "error", "skipped"
                }:
                    logger.info(f"Skipping already completed: {instance_id}")
                    continue

                logger.info(
                    f"Processing instance {i + 1}/{len(self._instances)}: "
                    f"{instance_id}"
                )

                # Update status to running
                self._results[instance_id].status = "running"
                self._update_checkpoint_instance_started(instance_id)

                # Process this instance
                try:
                    result = await self._process_instance(instance)
                    self._results[instance_id] = result
                    self._update_checkpoint_instance_completed(instance_id, result)
                except Exception as e:
                    logger.error(f"Instance {instance_id} failed with error: {e}")
                    self._results[instance_id] = InstanceResult(
                        instance_id=instance_id,
                        status="error",
                        error_message=str(e),
                    )
                    self._update_checkpoint_instance_error(instance_id, str(e))

                # Save checkpoint after each instance
                self._save_checkpoint()

            # Mark checkpoint as finished
            self._checkpoint.mark_finished()
            self._save_checkpoint()

            # Calculate final metrics
            self._end_time = time.time()
            self._metrics = self._calculate_metrics()

            # Export results
            await self._export_results()

            logger.info(
                f"Evaluation complete: "
                f"{self._metrics.successful_instances}/{self._metrics.total_instances} "
                f"successful ({self._metrics.resolution_rate:.1%})"
            )

            return self._metrics

        finally:
            self._is_running = False

    async def _process_instance(
        self,
        instance: SWEBenchInstance,
    ) -> InstanceResult:
        """Process a single SWE-bench instance.

        This method:
        1. Converts the instance to autoclaude spec format
        2. Saves the spec to the specs directory
        3. Invokes SpecOrchestrator (stub for now)
        4. Collects and returns the result

        Args:
            instance: The SWEBenchInstance to process

        Returns:
            InstanceResult with evaluation outcome
        """
        instance_id = instance.instance_id
        start_time = time.time()

        logger.debug(f"Processing instance: {instance_id}")

        # Convert to autoclaude spec
        spec = convert_to_autoclaude_spec(instance, include_test_info=False)

        # Create instance spec directory
        instance_spec_dir = self.specs_dir / instance_id.replace("/", "_")
        instance_spec_dir.mkdir(parents=True, exist_ok=True)

        # Save spec to directory
        save_spec_to_directory(spec, instance_spec_dir, overwrite=True)
        logger.debug(f"Saved spec to: {instance_spec_dir}")

        # TODO: Invoke SpecOrchestrator
        # This is where we would call the actual SpecOrchestrator
        # For now, we create a stub result to validate the pipeline
        #
        # Future implementation:
        # orchestrator = SpecOrchestrator(
        #     project_dir=repo_dir,  # cloned repo at base_commit
        #     spec_dir=instance_spec_dir,
        #     model=self.model,
        # )
        # success = await orchestrator.run(auto_approve=True)
        # patch = extract_patch_from_spec_dir(instance_spec_dir)

        # Stub result - marks as pending until SpecOrchestrator integration
        # In the real implementation, this would contain the actual patch
        model_patch = ""  # Will be populated by SpecOrchestrator
        status = "pending"  # Will be "success" or "failed" after real evaluation

        execution_time = time.time() - start_time

        return InstanceResult(
            instance_id=instance_id,
            status=status,
            model_patch=model_patch if model_patch else None,
            execution_time_seconds=execution_time,
            tests_total=len(instance.fail_to_pass),
        )

    def _calculate_metrics(self) -> EvaluationMetrics:
        """Calculate aggregated metrics from instance results.

        Returns:
            EvaluationMetrics with aggregated statistics
        """
        total = len(self._instances)
        completed = 0
        successful = 0
        failed = 0
        errors = 0
        skipped = 0
        total_time = 0.0

        for result in self._results.values():
            if result.status == "success":
                completed += 1
                successful += 1
            elif result.status == "failed":
                completed += 1
                failed += 1
            elif result.status == "error":
                completed += 1
                errors += 1
            elif result.status == "skipped":
                completed += 1
                skipped += 1

            if result.execution_time_seconds:
                total_time += result.execution_time_seconds

        return EvaluationMetrics(
            total_instances=total,
            completed_instances=completed,
            successful_instances=successful,
            failed_instances=failed,
            error_instances=errors,
            skipped_instances=skipped,
            total_execution_time_seconds=total_time,
        )

    # -------------------------------------------------------------------------
    # Checkpointing Methods
    # -------------------------------------------------------------------------

    def _create_checkpoint(self) -> Checkpoint:
        """Create a new checkpoint for this evaluation run.

        Returns:
            A new Checkpoint instance initialized with current instances.
        """
        instance_ids = [inst.instance_id for inst in self._instances]
        return self._checkpoint_manager.create_checkpoint(
            run_id=self.run_id,
            dataset_name=self.dataset_name,
            instance_ids=instance_ids,
            max_instances=self.max_instances,
            max_workers=self.max_workers,
            timeout_seconds=self.timeout_per_instance,
            model_name=self.model or "autoclaude",
        )

    def _save_checkpoint(self) -> None:
        """Save the current checkpoint to disk."""
        if self._checkpoint is None:
            logger.warning("No checkpoint to save")
            return

        try:
            self._checkpoint_manager.save(self._checkpoint)
            logger.debug(f"Checkpoint saved: {self._checkpoint.completed_count} complete")
        except Exception as e:
            logger.error(f"Failed to save checkpoint: {e}")
            # Don't raise - checkpoint failures shouldn't stop evaluation

    def _load_checkpoint_state(self) -> int:
        """Load state from checkpoint and restore completed results.

        Returns:
            Number of instances restored from checkpoint.
        """
        if self._checkpoint is None:
            return 0

        restored_count = 0
        for state in self._checkpoint.instance_states:
            if state.is_terminal():
                # Restore the result from checkpoint state
                self._results[state.instance_id] = InstanceResult(
                    instance_id=state.instance_id,
                    status=self._map_checkpoint_status(state.status),
                    model_patch=state.model_patch,
                    error_message=state.error_message,
                    execution_time_seconds=state.execution_time_seconds,
                )
                restored_count += 1
            elif state.status == "running":
                # Instance was interrupted mid-run, reset to pending
                state.status = "pending"
                state.started_at = None
                self._results[state.instance_id] = InstanceResult(
                    instance_id=state.instance_id,
                    status="pending",
                )

        return restored_count

    def _map_checkpoint_status(self, checkpoint_status: str) -> str:
        """Map checkpoint status to InstanceResult status.

        Args:
            checkpoint_status: Status from checkpoint ('completed', 'failed', etc.)

        Returns:
            Status string for InstanceResult.
        """
        # Map 'completed' in checkpoint to 'success' in results
        if checkpoint_status == "completed":
            return "success"
        return checkpoint_status

    def _update_checkpoint_instance_started(self, instance_id: str) -> None:
        """Mark an instance as started in the checkpoint.

        Args:
            instance_id: The instance identifier.
        """
        if self._checkpoint is None:
            return

        state = self._checkpoint.get_instance_state(instance_id)
        if state:
            state.mark_started()

    def _update_checkpoint_instance_completed(
        self,
        instance_id: str,
        result: InstanceResult,
    ) -> None:
        """Update checkpoint with completed instance result.

        Args:
            instance_id: The instance identifier.
            result: The evaluation result for this instance.
        """
        if self._checkpoint is None:
            return

        state = self._checkpoint.get_instance_state(instance_id)
        if state is None:
            # Create new state if not found
            state = InstanceCheckpointState(instance_id=instance_id)
            self._checkpoint.instance_states.append(state)

        if result.status == "success":
            state.mark_completed(result.model_patch or "")
        elif result.status == "failed":
            state.mark_failed(result.error_message or "Evaluation failed")
        elif result.status == "skipped":
            state.mark_skipped(result.error_message or "Skipped")
        else:
            # For pending status (stub evaluation), mark as completed
            # This allows checkpoint to track progress during development
            state.mark_completed(result.model_patch or "")

        state.execution_time_seconds = result.execution_time_seconds
        self._checkpoint._update_counts()

    def _update_checkpoint_instance_error(
        self,
        instance_id: str,
        error_message: str,
    ) -> None:
        """Mark an instance as errored in the checkpoint.

        Args:
            instance_id: The instance identifier.
            error_message: The error message.
        """
        if self._checkpoint is None:
            return

        state = self._checkpoint.get_instance_state(instance_id)
        if state:
            state.mark_error(error_message)
            self._checkpoint._update_counts()

    def get_checkpoint(self) -> Checkpoint | None:
        """Get the current checkpoint object.

        Returns:
            Current Checkpoint if available, None otherwise.
        """
        return self._checkpoint

    async def _export_results(self) -> None:
        """Export evaluation results to files.

        Creates:
        - predictions.jsonl: SWE-bench format predictions (standard + run_id prefixed)
        - report.json: Metrics and statistics (standard + run_id prefixed)

        Uses the exporters from swebench.exporters for proper formatting:
        - export_predictions: JSONL with instance_id, model_patch, model_name_or_path
        - generate_metrics_report: JSON with resolution_rate, aggregated stats, etc.
        """
        logger.info(f"Exporting results to: {self.output_dir}")

        result_list = list(self._results.values())

        # Export predictions using the JSONL exporter
        # Export to both standard and run_id prefixed locations
        model_name = self.model or "autoclaude"

        # Export to standard location (predictions.jsonl)
        export_stats = export_predictions(
            result_list,
            self.standard_predictions_file,
            model_name_or_path=model_name,
            include_failed=True,
            include_empty_patches=True,
            overwrite=True,
        )
        logger.info(
            f"Exported {export_stats['total_exported']} predictions to: "
            f"{self.standard_predictions_file}"
        )

        # Also export to run_id prefixed location for historical tracking
        export_predictions(
            result_list,
            self.predictions_file,
            model_name_or_path=model_name,
            include_failed=True,
            include_empty_patches=True,
            overwrite=True,
        )
        logger.info(f"Exported predictions to: {self.predictions_file}")

        # Generate metrics report using the metrics exporter
        # Export to standard location (report.json)
        generate_metrics_report(
            result_list,
            self.standard_report_file,
            run_id=self.run_id,
            dataset_name=self.dataset_name,
            model_name=model_name,
            include_instance_results=True,
            include_per_repo_stats=True,
            include_timing_stats=True,
            overwrite=True,
        )
        logger.info(f"Exported report to: {self.standard_report_file}")

        # Also export to run_id prefixed location for historical tracking
        generate_metrics_report(
            result_list,
            self.report_file,
            run_id=self.run_id,
            dataset_name=self.dataset_name,
            model_name=model_name,
            include_instance_results=True,
            include_per_repo_stats=True,
            include_timing_stats=True,
            overwrite=True,
        )
        logger.info(f"Exported report to: {self.report_file}")

    def get_result(self, instance_id: str) -> InstanceResult | None:
        """Get the result for a specific instance.

        Args:
            instance_id: The instance identifier

        Returns:
            InstanceResult if found, None otherwise
        """
        return self._results.get(instance_id)

    def get_all_results(self) -> list[InstanceResult]:
        """Get all instance results.

        Returns:
            List of all InstanceResult objects
        """
        return list(self._results.values())

    def get_instances(self) -> list[SWEBenchInstance]:
        """Get all loaded instances.

        Returns:
            List of SWEBenchInstance objects
        """
        return self._instances.copy()

    async def process_single_instance(
        self,
        instance_id: str,
    ) -> InstanceResult | None:
        """Process a single instance by ID.

        Useful for targeted evaluation or retrying specific instances.

        Args:
            instance_id: The instance identifier to process

        Returns:
            InstanceResult if instance found and processed, None otherwise
        """
        # Find the instance
        instance = None
        for inst in self._instances:
            if inst.instance_id == instance_id:
                instance = inst
                break

        if instance is None:
            logger.warning(f"Instance not found: {instance_id}")
            return None

        # Process it
        result = await self._process_instance(instance)
        self._results[instance_id] = result
        return result


# Convenience function for CLI usage
async def run_evaluation(
    dataset_name: str = "princeton-nlp/SWE-bench_Lite",
    max_instances: int | None = None,
    max_workers: int = 1,
    run_id: str | None = None,
    output_dir: Path | None = None,
    timeout: int = 1800,
    model: str | None = None,
    resume: bool = False,
    verbose: bool = False,
) -> EvaluationMetrics:
    """Run a SWE-bench evaluation with the given configuration.

    This is a convenience function for CLI usage that creates an
    orchestrator and runs the evaluation.

    Args:
        dataset_name: HuggingFace dataset to evaluate
        max_instances: Maximum instances to process
        max_workers: Number of parallel workers
        run_id: Unique run identifier
        output_dir: Output directory path
        timeout: Timeout per instance in seconds
        model: Model to use
        resume: Resume from checkpoint
        verbose: Enable verbose logging

    Returns:
        EvaluationMetrics with results
    """
    if verbose:
        logging.basicConfig(level=logging.DEBUG)
    else:
        logging.basicConfig(level=logging.INFO)

    orchestrator = SWEBenchOrchestrator(
        dataset_name=dataset_name,
        max_instances=max_instances,
        max_workers=max_workers,
        run_id=run_id,
        output_dir=output_dir,
        timeout_per_instance=timeout,
        model=model,
    )

    return await orchestrator.run(resume=resume)
