"""
Merge Tracking Models
=====================

Data models for tracking merge operations, attempts, and health status.

This module provides the core types for the merge tracking system:
- MergeStatus: Current state of a merge operation
- MergeHealth: Health indicator (pass/fail/warning) for merge outcomes
- MergeAttempt: Complete record of a single merge attempt
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class MergeStatus(Enum):
    """
    Current status of a merge operation.

    These states represent the lifecycle of a merge:
    - IDLE: No merge in progress
    - MERGING: Merge operation is running
    - RESOLVING: Conflicts are being resolved
    - COMPLETE: Merge finished successfully
    - FAILED: Merge failed (unresolved conflicts or error)
    - TIMEOUT: Merge exceeded time limit
    """

    IDLE = "idle"
    MERGING = "merging"
    RESOLVING = "resolving"
    COMPLETE = "complete"
    FAILED = "failed"
    TIMEOUT = "timeout"


class MergeHealth(Enum):
    """
    Health indicator for merge outcomes.

    Three-state system providing nuanced merge status:
    - PASS: Clean merge with no conflicts (green)
    - WARNING: Conflicts occurred but were resolved (yellow)
    - FAIL: Unresolved conflicts remain (red)
    """

    PASS = "pass"
    WARNING = "warning"
    FAIL = "fail"

    @classmethod
    def calculate(
        cls,
        conflicts_detected: int,
        conflicts_resolved: int,
    ) -> MergeHealth:
        """
        Calculate merge health based on conflict statistics.

        Args:
            conflicts_detected: Total number of conflicts found
            conflicts_resolved: Number of conflicts that were resolved

        Returns:
            MergeHealth indicator based on conflict resolution status
        """
        if conflicts_detected == 0:
            return cls.PASS
        elif conflicts_resolved >= conflicts_detected:
            return cls.WARNING
        else:
            return cls.FAIL


@dataclass
class MergeConflict:
    """
    Information about a single merge conflict.

    Attributes:
        file_path: Path to the file with the conflict
        resolved: Whether the conflict has been resolved
        resolution_method: How the conflict was resolved (auto, ai, manual)
        details: Additional information about the conflict
    """

    file_path: str
    resolved: bool = False
    resolution_method: str | None = None
    details: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "file_path": self.file_path,
            "resolved": self.resolved,
            "resolution_method": self.resolution_method,
            "details": self.details,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MergeConflict:
        """Create from dictionary."""
        return cls(
            file_path=data["file_path"],
            resolved=data.get("resolved", False),
            resolution_method=data.get("resolution_method"),
            details=data.get("details", ""),
        )


@dataclass
class MergeAttempt:
    """
    Complete record of a single merge attempt.

    This captures all metadata about a merge operation for tracking,
    history, and debugging purposes.

    Attributes:
        id: Unique identifier for this merge attempt
        task_id: The task whose changes are being merged
        worktree_path: Path to the worktree being merged
        started_at: When the merge began
        completed_at: When the merge finished (None if still in progress)
        status: Current status of the merge
        health: Health indicator based on conflict resolution
        conflicts: List of conflicts encountered
        progress_percent: Current progress (0-100)
        current_step: Description of current merge step
        error_message: Error details if merge failed
        is_fast_forward: Whether this was a fast-forward merge
        commit_hash: The resulting merge commit hash (if successful)
        duration_seconds: Total time taken for the merge
    """

    id: str
    task_id: str
    worktree_path: str
    started_at: datetime
    completed_at: datetime | None = None
    status: MergeStatus = MergeStatus.IDLE
    health: MergeHealth = MergeHealth.PASS
    conflicts: list[MergeConflict] = field(default_factory=list)
    progress_percent: int = 0
    current_step: str = ""
    error_message: str | None = None
    is_fast_forward: bool = False
    commit_hash: str | None = None
    duration_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "id": self.id,
            "task_id": self.task_id,
            "worktree_path": self.worktree_path,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat()
            if self.completed_at
            else None,
            "status": self.status.value,
            "health": self.health.value,
            "conflicts": [c.to_dict() for c in self.conflicts],
            "progress_percent": self.progress_percent,
            "current_step": self.current_step,
            "error_message": self.error_message,
            "is_fast_forward": self.is_fast_forward,
            "commit_hash": self.commit_hash,
            "duration_seconds": self.duration_seconds,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MergeAttempt:
        """Create from dictionary."""
        return cls(
            id=data["id"],
            task_id=data["task_id"],
            worktree_path=data["worktree_path"],
            started_at=datetime.fromisoformat(data["started_at"]),
            completed_at=datetime.fromisoformat(data["completed_at"])
            if data.get("completed_at")
            else None,
            status=MergeStatus(data.get("status", "idle")),
            health=MergeHealth(data.get("health", "pass")),
            conflicts=[
                MergeConflict.from_dict(c) for c in data.get("conflicts", [])
            ],
            progress_percent=data.get("progress_percent", 0),
            current_step=data.get("current_step", ""),
            error_message=data.get("error_message"),
            is_fast_forward=data.get("is_fast_forward", False),
            commit_hash=data.get("commit_hash"),
            duration_seconds=data.get("duration_seconds", 0.0),
        )

    @property
    def conflicts_detected(self) -> int:
        """Get total number of conflicts detected."""
        return len(self.conflicts)

    @property
    def conflicts_resolved(self) -> int:
        """Get number of conflicts that were resolved."""
        return sum(1 for c in self.conflicts if c.resolved)

    @property
    def conflicts_remaining(self) -> int:
        """Get number of unresolved conflicts."""
        return self.conflicts_detected - self.conflicts_resolved

    def update_health(self) -> None:
        """Update health indicator based on current conflict state."""
        self.health = MergeHealth.calculate(
            self.conflicts_detected,
            self.conflicts_resolved,
        )

    def mark_complete(self, commit_hash: str | None = None) -> None:
        """Mark merge as successfully completed."""
        self.completed_at = datetime.now()
        self.status = MergeStatus.COMPLETE
        self.progress_percent = 100
        self.commit_hash = commit_hash
        self.update_health()
        if self.started_at and self.completed_at:
            self.duration_seconds = (
                self.completed_at - self.started_at
            ).total_seconds()

    def mark_failed(self, error: str) -> None:
        """Mark merge as failed with an error message."""
        self.completed_at = datetime.now()
        self.status = MergeStatus.FAILED
        self.error_message = error
        self.health = MergeHealth.FAIL
        if self.started_at and self.completed_at:
            self.duration_seconds = (
                self.completed_at - self.started_at
            ).total_seconds()

    def mark_timeout(self) -> None:
        """Mark merge as timed out."""
        self.completed_at = datetime.now()
        self.status = MergeStatus.TIMEOUT
        self.health = MergeHealth.FAIL
        self.error_message = "Merge operation exceeded timeout threshold"
        if self.started_at and self.completed_at:
            self.duration_seconds = (
                self.completed_at - self.started_at
            ).total_seconds()

    def add_conflict(
        self,
        file_path: str,
        details: str = "",
    ) -> MergeConflict:
        """Add a new conflict to this merge attempt."""
        conflict = MergeConflict(
            file_path=file_path,
            resolved=False,
            details=details,
        )
        self.conflicts.append(conflict)
        self.update_health()
        return conflict

    def resolve_conflict(
        self,
        file_path: str,
        resolution_method: str = "auto",
    ) -> bool:
        """
        Mark a conflict as resolved.

        Args:
            file_path: Path to the resolved file
            resolution_method: How it was resolved (auto, ai, manual)

        Returns:
            True if conflict was found and marked resolved, False otherwise
        """
        for conflict in self.conflicts:
            if conflict.file_path == file_path:
                conflict.resolved = True
                conflict.resolution_method = resolution_method
                self.update_health()
                return True
        return False

    def update_progress(self, percent: int, step: str = "") -> None:
        """Update the progress of this merge attempt."""
        self.progress_percent = min(max(percent, 0), 100)
        if step:
            self.current_step = step
