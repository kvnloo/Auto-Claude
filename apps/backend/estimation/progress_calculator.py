"""
Progress Calculator Module
===========================

Computes remaining time based on current progress and updates estimates
as subtasks complete. Provides real-time progress tracking and adaptive
time estimation based on actual completion data.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from implementation_plan import ImplementationPlan, Phase, Subtask
from implementation_plan.enums import SubtaskStatus


@dataclass
class ProgressSnapshot:
    """
    Represents a point-in-time snapshot of build progress.

    Captures current state including completed work, remaining work,
    and time estimates that can be used for reporting and tracking.
    """

    # Subtask counts
    total_subtasks: int
    completed_subtasks: int
    in_progress_subtasks: int
    pending_subtasks: int
    failed_subtasks: int

    # Time estimates (in minutes)
    total_estimated_minutes: float
    elapsed_estimated_minutes: float  # Estimated time for completed tasks
    remaining_estimated_minutes: float  # Estimated time for pending tasks

    # Actual time tracking (if available)
    actual_elapsed_minutes: Optional[float] = None  # Actual time spent

    # Adjusted estimates based on velocity
    adjusted_remaining_minutes: Optional[float] = None  # Velocity-adjusted estimate
    velocity_ratio: Optional[float] = None  # actual / estimated ratio

    # Completion percentage
    percent_complete: float = 0.0

    # Timestamp
    snapshot_time: str = ""

    def __post_init__(self):
        """Set snapshot timestamp if not provided."""
        if not self.snapshot_time:
            self.snapshot_time = datetime.now().isoformat()

    def to_dict(self) -> dict:
        """Convert snapshot to dictionary representation."""
        result = {
            "total_subtasks": self.total_subtasks,
            "completed_subtasks": self.completed_subtasks,
            "in_progress_subtasks": self.in_progress_subtasks,
            "pending_subtasks": self.pending_subtasks,
            "failed_subtasks": self.failed_subtasks,
            "total_estimated_minutes": self.total_estimated_minutes,
            "elapsed_estimated_minutes": self.elapsed_estimated_minutes,
            "remaining_estimated_minutes": self.remaining_estimated_minutes,
            "percent_complete": self.percent_complete,
            "snapshot_time": self.snapshot_time,
        }
        if self.actual_elapsed_minutes is not None:
            result["actual_elapsed_minutes"] = self.actual_elapsed_minutes
        if self.adjusted_remaining_minutes is not None:
            result["adjusted_remaining_minutes"] = self.adjusted_remaining_minutes
        if self.velocity_ratio is not None:
            result["velocity_ratio"] = self.velocity_ratio
        return result

    @classmethod
    def from_dict(cls, data: dict) -> "ProgressSnapshot":
        """Create ProgressSnapshot from dictionary."""
        return cls(
            total_subtasks=data["total_subtasks"],
            completed_subtasks=data["completed_subtasks"],
            in_progress_subtasks=data.get("in_progress_subtasks", 0),
            pending_subtasks=data["pending_subtasks"],
            failed_subtasks=data.get("failed_subtasks", 0),
            total_estimated_minutes=data["total_estimated_minutes"],
            elapsed_estimated_minutes=data["elapsed_estimated_minutes"],
            remaining_estimated_minutes=data["remaining_estimated_minutes"],
            actual_elapsed_minutes=data.get("actual_elapsed_minutes"),
            adjusted_remaining_minutes=data.get("adjusted_remaining_minutes"),
            velocity_ratio=data.get("velocity_ratio"),
            percent_complete=data.get("percent_complete", 0.0),
            snapshot_time=data.get("snapshot_time", ""),
        )


class ProgressCalculator:
    """
    Calculates real-time progress and remaining time for an implementation plan.

    Tracks subtask completion and adjusts remaining time estimates based on
    actual vs estimated completion times (velocity). Provides adaptive time
    estimation that improves as work progresses.
    """

    def __init__(self, plan: ImplementationPlan):
        """
        Initialize progress calculator with an implementation plan.

        Args:
            plan: ImplementationPlan to track progress for
        """
        self.plan = plan
        self._cached_snapshot: Optional[ProgressSnapshot] = None

    def calculate_progress(self, force_refresh: bool = False) -> ProgressSnapshot:
        """
        Calculate current progress snapshot with time estimates.

        Computes subtask completion counts, elapsed time, remaining time,
        and velocity-adjusted estimates based on actual completion data.

        Args:
            force_refresh: If True, ignores cached snapshot and recalculates

        Returns:
            ProgressSnapshot with current progress and time estimates
        """
        # Return cached snapshot if available and not forcing refresh
        if self._cached_snapshot and not force_refresh:
            return self._cached_snapshot

        # Count subtasks by status
        all_subtasks = [s for p in self.plan.phases for s in p.subtasks]

        total = len(all_subtasks)
        completed = sum(1 for s in all_subtasks if s.status == SubtaskStatus.COMPLETED)
        in_progress = sum(1 for s in all_subtasks if s.status == SubtaskStatus.IN_PROGRESS)
        failed = sum(1 for s in all_subtasks if s.status == SubtaskStatus.FAILED)
        pending = total - completed - in_progress - failed

        # Calculate time estimates
        total_estimated = 0.0
        elapsed_estimated = 0.0
        remaining_estimated = 0.0

        for subtask in all_subtasks:
            est_time = subtask.estimated_duration_minutes or 0.0
            total_estimated += est_time

            if subtask.status == SubtaskStatus.COMPLETED:
                elapsed_estimated += est_time
            else:
                remaining_estimated += est_time

        # Calculate actual elapsed time (if subtasks have timestamps)
        actual_elapsed = self._calculate_actual_elapsed_time(all_subtasks)

        # Calculate velocity and adjust remaining time
        velocity_ratio = None
        adjusted_remaining = None

        if actual_elapsed is not None and elapsed_estimated > 0:
            # Velocity = actual / estimated (>1 means slower, <1 means faster)
            velocity_ratio = actual_elapsed / elapsed_estimated

            # Adjust remaining time based on velocity
            # If we're going slower than estimated, remaining time increases
            # If we're going faster, remaining time decreases
            adjusted_remaining = remaining_estimated * velocity_ratio

        # Calculate completion percentage
        percent_complete = round(100 * completed / total, 1) if total > 0 else 0.0

        # Create snapshot
        snapshot = ProgressSnapshot(
            total_subtasks=total,
            completed_subtasks=completed,
            in_progress_subtasks=in_progress,
            pending_subtasks=pending,
            failed_subtasks=failed,
            total_estimated_minutes=total_estimated,
            elapsed_estimated_minutes=elapsed_estimated,
            remaining_estimated_minutes=remaining_estimated,
            actual_elapsed_minutes=actual_elapsed,
            adjusted_remaining_minutes=adjusted_remaining,
            velocity_ratio=velocity_ratio,
            percent_complete=percent_complete,
        )

        # Cache the snapshot
        self._cached_snapshot = snapshot

        return snapshot

    def _calculate_actual_elapsed_time(self, subtasks: list[Subtask]) -> Optional[float]:
        """
        Calculate actual elapsed time based on subtask timestamps.

        Computes the sum of actual time spent on completed subtasks by
        comparing started_at and completed_at timestamps.

        Args:
            subtasks: List of subtasks to analyze

        Returns:
            Total elapsed time in minutes, or None if no timing data available
        """
        total_minutes = 0.0
        has_data = False

        for subtask in subtasks:
            if subtask.status != SubtaskStatus.COMPLETED:
                continue

            # Need both timestamps to calculate duration
            if not subtask.started_at or not subtask.completed_at:
                continue

            try:
                # Parse ISO format timestamps
                started = datetime.fromisoformat(subtask.started_at.replace('Z', '+00:00'))
                completed = datetime.fromisoformat(subtask.completed_at.replace('Z', '+00:00'))

                # Calculate duration in minutes
                duration = (completed - started).total_seconds() / 60.0
                total_minutes += duration
                has_data = True

            except (ValueError, AttributeError):
                # Skip subtasks with invalid timestamps
                continue

        return total_minutes if has_data else None

    def get_remaining_time(self) -> float:
        """
        Get the best estimate of remaining time in minutes.

        Returns velocity-adjusted estimate if available, otherwise
        returns the raw estimated remaining time.

        Returns:
            Remaining time estimate in minutes
        """
        snapshot = self.calculate_progress()

        # Use adjusted estimate if available (accounts for velocity)
        if snapshot.adjusted_remaining_minutes is not None:
            return snapshot.adjusted_remaining_minutes

        # Fall back to raw estimate
        return snapshot.remaining_estimated_minutes

    def get_estimated_completion_time(self) -> Optional[str]:
        """
        Get estimated completion time as ISO format datetime string.

        Calculates when the build is expected to complete based on
        remaining time estimate.

        Returns:
            ISO format timestamp of estimated completion, or None if unavailable
        """
        remaining = self.get_remaining_time()

        if remaining <= 0:
            return None

        # Calculate completion time from now
        from datetime import timedelta
        completion_time = datetime.now() + timedelta(minutes=remaining)

        return completion_time.isoformat()

    def update_plan_time_fields(self) -> None:
        """
        Update the ImplementationPlan's time tracking fields with current values.

        Syncs total_estimated_minutes, elapsed_minutes, and remaining_minutes
        in the plan object based on current progress calculations.
        """
        snapshot = self.calculate_progress()

        # Update plan fields
        self.plan.total_estimated_minutes = int(snapshot.total_estimated_minutes)

        # Use actual elapsed time if available, otherwise use estimated
        if snapshot.actual_elapsed_minutes is not None:
            self.plan.elapsed_minutes = int(snapshot.actual_elapsed_minutes)
        else:
            self.plan.elapsed_minutes = int(snapshot.elapsed_estimated_minutes)

        # Use adjusted remaining time if available, otherwise use estimated
        if snapshot.adjusted_remaining_minutes is not None:
            self.plan.remaining_minutes = int(snapshot.adjusted_remaining_minutes)
        else:
            self.plan.remaining_minutes = int(snapshot.remaining_estimated_minutes)

    def invalidate_cache(self) -> None:
        """
        Invalidate cached progress snapshot to force recalculation.

        Call this when subtasks are updated to ensure fresh calculations.
        """
        self._cached_snapshot = None

    def on_subtask_complete(self, subtask: Subtask) -> None:
        """
        Hook called when a subtask completes to trigger real-time updates.

        Invalidates the cached snapshot and optionally updates plan time fields
        to reflect the latest progress. This enables real-time remaining time
        calculation as work progresses.

        Args:
            subtask: The subtask that was just completed

        Usage:
            When a subtask completes, call this method to ensure the next
            call to calculate_progress() returns fresh data.
        """
        # Invalidate cache to force recalculation with updated data
        self.invalidate_cache()

        # Optionally update plan time fields for persistence
        # This ensures the plan JSON reflects current progress
        self.update_plan_time_fields()

    def get_remaining_time_formatted(self) -> str:
        """
        Get remaining time in human-readable format.

        Formats the remaining time estimate as a readable string
        (e.g., "2 hours 30 minutes" or "45 minutes").

        Returns:
            Human-readable remaining time string
        """
        remaining = self.get_remaining_time()

        if remaining <= 0:
            return "Complete"

        # Convert to hours and minutes
        hours = int(remaining // 60)
        minutes = int(remaining % 60)

        if hours > 0:
            if minutes > 0:
                return f"{hours} hour{'s' if hours != 1 else ''} {minutes} minute{'s' if minutes != 1 else ''}"
            else:
                return f"{hours} hour{'s' if hours != 1 else ''}"
        else:
            return f"{minutes} minute{'s' if minutes != 1 else ''}"

    def get_velocity_summary(self) -> dict:
        """
        Get a summary of current velocity and time accuracy.

        Provides insights into whether the build is progressing faster
        or slower than estimated.

        Returns:
            Dictionary with velocity metrics and status
        """
        snapshot = self.calculate_progress()

        if snapshot.velocity_ratio is None:
            return {
                "status": "insufficient_data",
                "message": "Not enough completed subtasks to calculate velocity",
            }

        velocity = snapshot.velocity_ratio

        # Categorize velocity
        if velocity < 0.8:
            status = "ahead_of_schedule"
            message = f"Work is progressing {int((1 - velocity) * 100)}% faster than estimated"
        elif velocity > 1.2:
            status = "behind_schedule"
            message = f"Work is progressing {int((velocity - 1) * 100)}% slower than estimated"
        else:
            status = "on_track"
            message = "Work is progressing on schedule"

        return {
            "status": status,
            "velocity_ratio": round(velocity, 2),
            "message": message,
            "completed_subtasks": snapshot.completed_subtasks,
            "total_subtasks": snapshot.total_subtasks,
        }
