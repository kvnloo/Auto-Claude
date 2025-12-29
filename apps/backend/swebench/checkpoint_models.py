"""
Pydantic Models for SWE-bench Checkpoint Data Schemas
=====================================================

These models define the data structures for checkpointing SWE-bench evaluation
runs. Checkpoints enable resuming interrupted evaluations without re-processing
completed instances.

Checkpoint Storage Location:
    .auto-claude/swebench/checkpoints/[run_id].json

Checkpoint Schema:
    {
        "run_id": "unique-run-identifier",
        "dataset_name": "princeton-nlp/SWE-bench_Lite",
        "total_instances": 300,
        "completed_instances": 150,
        "instance_states": [
            {"instance_id": "owner__repo-123", "status": "completed", ...},
            ...
        ]
    }

Usage:
    from swebench.checkpoint_models import Checkpoint, InstanceCheckpointState

    # Create new checkpoint
    checkpoint = Checkpoint(
        run_id="eval-2024-01-15-001",
        dataset_name="princeton-nlp/SWE-bench_Lite",
        total_instances=300,
    )

    # Update instance state
    instance_state = InstanceCheckpointState(
        instance_id="django__django-11001",
        status="completed",
        model_patch="...",
    )
    checkpoint.update_instance(instance_state)
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# =============================================================================
# Instance Checkpoint State Schema
# =============================================================================


InstanceStatus = Literal["pending", "running", "completed", "failed", "error", "skipped"]


class InstanceCheckpointState(BaseModel):
    """State of a single instance within a checkpoint.

    Tracks the evaluation status, timing information, and results for each
    SWE-bench instance being processed.
    """

    model_config = ConfigDict(populate_by_name=True)

    instance_id: str = Field(
        description="Unique instance identifier in format 'owner__repo-issue_number'"
    )
    status: InstanceStatus = Field(
        default="pending",
        description="Current evaluation status of this instance",
    )
    started_at: datetime | None = Field(
        default=None,
        description="Timestamp when evaluation started for this instance",
    )
    completed_at: datetime | None = Field(
        default=None,
        description="Timestamp when evaluation completed (success, failed, or error)",
    )
    model_patch: str | None = Field(
        default=None,
        description="Generated patch if evaluation completed successfully",
    )
    error_message: str | None = Field(
        default=None,
        description="Error message if evaluation failed or errored",
    )
    execution_time_seconds: float | None = Field(
        default=None,
        description="Total execution time for this instance in seconds",
    )
    retry_count: int = Field(
        default=0,
        description="Number of times this instance has been retried",
    )
    worker_id: str | None = Field(
        default=None,
        description="ID of the worker that processed this instance (for parallel runs)",
    )

    @field_validator("instance_id")
    @classmethod
    def validate_instance_id(cls, v: str) -> str:
        """Validate that instance_id is not empty."""
        if not v or not v.strip():
            raise ValueError("instance_id cannot be empty")
        return v

    def mark_started(self, worker_id: str | None = None) -> None:
        """Mark this instance as started (in progress)."""
        self.status = "running"
        self.started_at = datetime.now(timezone.utc)
        self.worker_id = worker_id

    def mark_completed(self, model_patch: str) -> None:
        """Mark this instance as successfully completed with a patch."""
        self.status = "completed"
        self.completed_at = datetime.now(timezone.utc)
        self.model_patch = model_patch
        if self.started_at:
            delta = self.completed_at - self.started_at
            self.execution_time_seconds = delta.total_seconds()

    def mark_failed(self, error_message: str) -> None:
        """Mark this instance as failed (evaluation ran but didn't produce valid patch)."""
        self.status = "failed"
        self.completed_at = datetime.now(timezone.utc)
        self.error_message = error_message
        if self.started_at:
            delta = self.completed_at - self.started_at
            self.execution_time_seconds = delta.total_seconds()

    def mark_error(self, error_message: str) -> None:
        """Mark this instance as errored (unexpected exception during evaluation)."""
        self.status = "error"
        self.completed_at = datetime.now(timezone.utc)
        self.error_message = error_message
        if self.started_at:
            delta = self.completed_at - self.started_at
            self.execution_time_seconds = delta.total_seconds()

    def mark_skipped(self, reason: str = "Skipped by user") -> None:
        """Mark this instance as skipped (not processed for some reason)."""
        self.status = "skipped"
        self.completed_at = datetime.now(timezone.utc)
        self.error_message = reason

    def is_terminal(self) -> bool:
        """Check if this instance is in a terminal state (no more processing needed)."""
        return self.status in ("completed", "failed", "error", "skipped")

    def is_retriable(self, max_retries: int = 3) -> bool:
        """Check if this instance can be retried."""
        return self.status in ("failed", "error") and self.retry_count < max_retries


# =============================================================================
# Checkpoint Schema
# =============================================================================


class Checkpoint(BaseModel):
    """Checkpoint for a SWE-bench evaluation run.

    Stores the complete state of an evaluation run, allowing it to be
    paused and resumed without re-processing completed instances.

    The checkpoint is saved to disk after each instance completes to ensure
    minimal data loss if the process is interrupted.
    """

    model_config = ConfigDict(populate_by_name=True)

    # Run identification
    run_id: str = Field(
        description="Unique identifier for this evaluation run"
    )
    dataset_name: str = Field(
        description="HuggingFace dataset path (e.g., 'princeton-nlp/SWE-bench_Lite')"
    )
    dataset_split: str = Field(
        default="test",
        description="Dataset split being evaluated (usually 'test')",
    )

    # Configuration
    max_instances: int | None = Field(
        default=None,
        description="Maximum number of instances to process (None for all)",
    )
    max_workers: int = Field(
        default=1,
        description="Number of parallel workers for this run",
    )
    timeout_seconds: int = Field(
        default=1800,
        description="Timeout in seconds for each instance evaluation",
    )
    model_name: str = Field(
        default="autoclaude",
        description="Name of the model being evaluated",
    )

    # Progress tracking
    total_instances: int = Field(
        description="Total number of instances in the evaluation"
    )
    completed_count: int = Field(
        default=0,
        description="Number of instances that have completed processing",
    )
    successful_count: int = Field(
        default=0,
        description="Number of instances that completed successfully",
    )
    failed_count: int = Field(
        default=0,
        description="Number of instances that failed",
    )
    error_count: int = Field(
        default=0,
        description="Number of instances that errored",
    )
    skipped_count: int = Field(
        default=0,
        description="Number of instances that were skipped",
    )

    # Instance states
    instance_states: list[InstanceCheckpointState] = Field(
        default_factory=list,
        description="State of each instance in the evaluation",
    )

    # Timestamps
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Timestamp when this checkpoint was created",
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Timestamp when this checkpoint was last updated",
    )
    started_at: datetime | None = Field(
        default=None,
        description="Timestamp when the evaluation run started",
    )
    finished_at: datetime | None = Field(
        default=None,
        description="Timestamp when the evaluation run finished",
    )

    # Metadata
    version: str = Field(
        default="1.0",
        description="Checkpoint schema version for forward compatibility",
    )
    checksum: str | None = Field(
        default=None,
        description="Checksum for validating checkpoint integrity",
    )

    @field_validator("run_id")
    @classmethod
    def validate_run_id(cls, v: str) -> str:
        """Validate that run_id is not empty."""
        if not v or not v.strip():
            raise ValueError("run_id cannot be empty")
        return v

    @field_validator("dataset_name")
    @classmethod
    def validate_dataset_name(cls, v: str) -> str:
        """Validate that dataset_name is not empty."""
        if not v or not v.strip():
            raise ValueError("dataset_name cannot be empty")
        return v

    @model_validator(mode="after")
    def update_timestamp(self) -> "Checkpoint":
        """Update the updated_at timestamp on any modification."""
        self.updated_at = datetime.now(timezone.utc)
        return self

    @classmethod
    def generate_run_id(cls, dataset_name: str, prefix: str = "swebench") -> str:
        """Generate a unique run ID based on dataset and timestamp."""
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        # Create a short hash from dataset name for uniqueness
        dataset_hash = hashlib.md5(dataset_name.encode()).hexdigest()[:6]
        unique_suffix = str(uuid.uuid4())[:4]
        return f"{prefix}-{timestamp}-{dataset_hash}-{unique_suffix}"

    def initialize_instances(self, instance_ids: list[str]) -> None:
        """Initialize instance states for all instances in the evaluation.

        Args:
            instance_ids: List of instance IDs to track
        """
        self.instance_states = [
            InstanceCheckpointState(instance_id=instance_id)
            for instance_id in instance_ids
        ]
        self.total_instances = len(instance_ids)

    def get_instance_state(self, instance_id: str) -> InstanceCheckpointState | None:
        """Get the state for a specific instance.

        Args:
            instance_id: Instance ID to look up

        Returns:
            Instance state if found, None otherwise
        """
        for state in self.instance_states:
            if state.instance_id == instance_id:
                return state
        return None

    def update_instance(self, state: InstanceCheckpointState) -> None:
        """Update or add the state for an instance.

        Args:
            state: New state for the instance
        """
        for i, existing in enumerate(self.instance_states):
            if existing.instance_id == state.instance_id:
                self.instance_states[i] = state
                self._update_counts()
                return

        # Instance not found, add it
        self.instance_states.append(state)
        self._update_counts()

    def _update_counts(self) -> None:
        """Update the progress counts based on instance states."""
        self.completed_count = sum(
            1 for s in self.instance_states if s.is_terminal()
        )
        self.successful_count = sum(
            1 for s in self.instance_states if s.status == "completed"
        )
        self.failed_count = sum(
            1 for s in self.instance_states if s.status == "failed"
        )
        self.error_count = sum(
            1 for s in self.instance_states if s.status == "error"
        )
        self.skipped_count = sum(
            1 for s in self.instance_states if s.status == "skipped"
        )
        self.updated_at = datetime.now(timezone.utc)

    def get_pending_instances(self) -> list[InstanceCheckpointState]:
        """Get all instances that haven't been processed yet.

        Returns:
            List of instance states with 'pending' status
        """
        return [s for s in self.instance_states if s.status == "pending"]

    def get_running_instances(self) -> list[InstanceCheckpointState]:
        """Get all instances currently being processed.

        Returns:
            List of instance states with 'running' status
        """
        return [s for s in self.instance_states if s.status == "running"]

    def get_completed_instances(self) -> list[InstanceCheckpointState]:
        """Get all instances that completed successfully.

        Returns:
            List of instance states with 'completed' status
        """
        return [s for s in self.instance_states if s.status == "completed"]

    def get_failed_instances(self) -> list[InstanceCheckpointState]:
        """Get all instances that failed.

        Returns:
            List of instance states with 'failed' or 'error' status
        """
        return [s for s in self.instance_states if s.status in ("failed", "error")]

    def get_retriable_instances(self, max_retries: int = 3) -> list[InstanceCheckpointState]:
        """Get all instances that can be retried.

        Args:
            max_retries: Maximum number of retries allowed

        Returns:
            List of instance states that can be retried
        """
        return [s for s in self.instance_states if s.is_retriable(max_retries)]

    def is_complete(self) -> bool:
        """Check if the evaluation run is complete.

        Returns:
            True if all instances are in a terminal state
        """
        return all(s.is_terminal() for s in self.instance_states)

    def get_progress_percentage(self) -> float:
        """Get the completion percentage.

        Returns:
            Percentage of instances completed (0.0 - 100.0)
        """
        if self.total_instances == 0:
            return 0.0
        return (self.completed_count / self.total_instances) * 100.0

    def get_success_rate(self) -> float:
        """Get the success rate.

        Returns:
            Percentage of completed instances that succeeded (0.0 - 100.0)
        """
        if self.completed_count == 0:
            return 0.0
        return (self.successful_count / self.completed_count) * 100.0

    def get_total_execution_time(self) -> float:
        """Get the total execution time across all instances.

        Returns:
            Total execution time in seconds
        """
        total = 0.0
        for state in self.instance_states:
            if state.execution_time_seconds:
                total += state.execution_time_seconds
        return total

    def get_average_execution_time(self) -> float:
        """Get the average execution time per completed instance.

        Returns:
            Average execution time in seconds
        """
        completed_times = [
            s.execution_time_seconds
            for s in self.instance_states
            if s.execution_time_seconds is not None
        ]
        if not completed_times:
            return 0.0
        return sum(completed_times) / len(completed_times)

    def get_estimated_remaining_time(self) -> float | None:
        """Estimate the remaining time to complete the evaluation.

        Returns:
            Estimated remaining time in seconds, or None if not enough data
        """
        avg_time = self.get_average_execution_time()
        if avg_time == 0:
            return None

        pending_count = len(self.get_pending_instances())
        running_count = len(self.get_running_instances())

        # Account for running instances (assume half done on average)
        remaining = pending_count + (running_count * 0.5)
        return remaining * avg_time

    def compute_checksum(self) -> str:
        """Compute a checksum for the checkpoint data.

        Returns:
            MD5 checksum of the serialized checkpoint
        """
        # Exclude checksum and updated_at from the hash
        data = self.model_dump(exclude={"checksum", "updated_at"})
        serialized = str(sorted(data.items())).encode()
        return hashlib.md5(serialized).hexdigest()

    def validate_integrity(self) -> bool:
        """Validate the checkpoint integrity using the stored checksum.

        Returns:
            True if the checksum matches, False otherwise
        """
        if not self.checksum:
            return True  # No checksum stored, assume valid
        return self.checksum == self.compute_checksum()

    def mark_started(self) -> None:
        """Mark the evaluation run as started."""
        self.started_at = datetime.now(timezone.utc)

    def mark_finished(self) -> None:
        """Mark the evaluation run as finished."""
        self.finished_at = datetime.now(timezone.utc)

    def to_summary(self) -> dict:
        """Get a summary of the checkpoint status.

        Returns:
            Dictionary with summary statistics
        """
        return {
            "run_id": self.run_id,
            "dataset_name": self.dataset_name,
            "total_instances": self.total_instances,
            "completed": self.completed_count,
            "successful": self.successful_count,
            "failed": self.failed_count,
            "errors": self.error_count,
            "skipped": self.skipped_count,
            "pending": len(self.get_pending_instances()),
            "running": len(self.get_running_instances()),
            "progress_percent": round(self.get_progress_percentage(), 2),
            "success_rate_percent": round(self.get_success_rate(), 2),
            "total_execution_time_seconds": round(self.get_total_execution_time(), 2),
            "average_execution_time_seconds": round(self.get_average_execution_time(), 2),
            "is_complete": self.is_complete(),
        }
