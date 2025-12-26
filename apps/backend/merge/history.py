"""
Merge History Persistence Layer
================================

Append-only storage for merge attempt history.

This module provides persistent storage for merge tracking data,
enabling historical analysis and audit trails for merge operations.

Key Features:
- Append-only storage for auditability (no UPDATE/DELETE operations)
- Atomic writes to prevent corruption from concurrent access
- Task-based organization for efficient querying
- JSON storage for human-readable history files
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .tracking import MergeAttempt

logger = logging.getLogger(__name__)

# Import debug utilities
try:
    from debug import debug
except ImportError:

    def debug(*args, **kwargs):
        pass


MODULE = "merge.history"


class MergeHistoryStore:
    """
    Append-only storage for merge attempt history.

    Provides persistent storage for merge tracking data with:
    - One history file per task for efficient access
    - Append-only operations for auditability
    - Atomic writes to prevent corruption
    - Index file for listing all tracked tasks

    Example:
        store = MergeHistoryStore('.auto-claude')
        store.append(merge_attempt)
        history = store.get_task_history('task-001')
    """

    HISTORY_DIR = "merge_history"
    INDEX_FILE = "index.json"

    def __init__(self, storage_path: str | Path):
        """
        Initialize the merge history store.

        Args:
            storage_path: Base directory for storage (e.g., '.auto-claude')
        """
        self.storage_path = Path(storage_path).resolve()
        self.history_dir = self.storage_path / self.HISTORY_DIR

        # Ensure storage directory exists
        self.history_dir.mkdir(parents=True, exist_ok=True)
        debug(MODULE, f"Initialized merge history store at {self.history_dir}")

    def append(self, attempt: MergeAttempt) -> None:
        """
        Append a merge attempt to history (append-only).

        This is the primary write operation. It appends to existing
        history for the task rather than overwriting, ensuring
        auditability and preventing data loss.

        Args:
            attempt: The MergeAttempt to store
        """
        task_id = attempt.task_id
        history_file = self._get_task_history_path(task_id)

        # Load existing history or create new
        history = self._load_task_history_raw(task_id)
        if history is None:
            history = {
                "task_id": task_id,
                "created_at": self._timestamp(),
                "updated_at": self._timestamp(),
                "attempts": [],
            }

        # Append the new attempt
        history["attempts"].append(attempt.to_dict())
        history["updated_at"] = self._timestamp()

        # Atomic write
        self._atomic_write(history_file, history)

        # Update the index
        self._update_index(task_id)

        debug(
            MODULE,
            f"Appended merge attempt {attempt.id} for task {task_id}",
        )

    def get_task_history(self, task_id: str) -> list[MergeAttempt]:
        """
        Get all merge attempts for a specific task.

        Args:
            task_id: The task identifier

        Returns:
            List of MergeAttempt objects, ordered by started_at (oldest first)
        """
        history = self._load_task_history_raw(task_id)
        if history is None:
            return []

        attempts = [
            MergeAttempt.from_dict(data) for data in history.get("attempts", [])
        ]

        # Sort by started_at
        attempts.sort(key=lambda a: a.started_at)
        return attempts

    def get_latest_attempt(self, task_id: str) -> MergeAttempt | None:
        """
        Get the most recent merge attempt for a task.

        Args:
            task_id: The task identifier

        Returns:
            The most recent MergeAttempt, or None if no history exists
        """
        history = self.get_task_history(task_id)
        if not history:
            return None
        return history[-1]

    def get_attempt_by_id(
        self,
        task_id: str,
        attempt_id: str,
    ) -> MergeAttempt | None:
        """
        Get a specific merge attempt by its ID.

        Args:
            task_id: The task identifier
            attempt_id: The unique attempt identifier

        Returns:
            The MergeAttempt if found, None otherwise
        """
        history = self.get_task_history(task_id)
        for attempt in history:
            if attempt.id == attempt_id:
                return attempt
        return None

    def list_tasks(self) -> list[str]:
        """
        List all task IDs that have merge history.

        Returns:
            List of task IDs with recorded merge history
        """
        index = self._load_index()
        return list(index.get("tasks", []))

    def get_all_history(self) -> dict[str, list[MergeAttempt]]:
        """
        Load all merge history for all tasks.

        Returns:
            Dictionary mapping task_id to list of MergeAttempt objects
        """
        all_history = {}
        for task_id in self.list_tasks():
            all_history[task_id] = self.get_task_history(task_id)
        return all_history

    def get_stats(self) -> dict[str, Any]:
        """
        Get summary statistics for all merge history.

        Returns:
            Dictionary with total counts and success rates
        """
        total_attempts = 0
        successful_attempts = 0
        failed_attempts = 0
        timeout_attempts = 0
        total_conflicts = 0
        resolved_conflicts = 0

        for task_id in self.list_tasks():
            for attempt in self.get_task_history(task_id):
                total_attempts += 1
                total_conflicts += attempt.conflicts_detected
                resolved_conflicts += attempt.conflicts_resolved

                status = attempt.status.value
                if status == "complete":
                    successful_attempts += 1
                elif status == "failed":
                    failed_attempts += 1
                elif status == "timeout":
                    timeout_attempts += 1

        return {
            "total_tasks": len(self.list_tasks()),
            "total_attempts": total_attempts,
            "successful_attempts": successful_attempts,
            "failed_attempts": failed_attempts,
            "timeout_attempts": timeout_attempts,
            "success_rate": (
                successful_attempts / total_attempts if total_attempts > 0 else 0.0
            ),
            "total_conflicts": total_conflicts,
            "resolved_conflicts": resolved_conflicts,
            "conflict_resolution_rate": (
                resolved_conflicts / total_conflicts if total_conflicts > 0 else 1.0
            ),
        }

    def _get_task_history_path(self, task_id: str) -> Path:
        """
        Get the storage path for a task's history file.

        Args:
            task_id: The task identifier

        Returns:
            Path to the task's history JSON file
        """
        # Sanitize task_id for safe filename
        safe_name = task_id.replace("/", "_").replace("\\", "_")
        return self.history_dir / f"{safe_name}.json"

    def _load_task_history_raw(self, task_id: str) -> dict[str, Any] | None:
        """
        Load raw history data for a task.

        Args:
            task_id: The task identifier

        Returns:
            Raw dictionary data, or None if file doesn't exist
        """
        history_file = self._get_task_history_path(task_id)
        if not history_file.exists():
            return None

        try:
            with open(history_file, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            logger.error(f"Failed to load history for task {task_id}: {e}")
            return None

    def _atomic_write(self, path: Path, data: dict[str, Any]) -> None:
        """
        Write data to file atomically to prevent corruption.

        Uses temp file + os.replace pattern for atomic operation.

        Args:
            path: Target file path
            data: Data to write as JSON
        """
        try:
            # Create parent directory if needed
            path.parent.mkdir(parents=True, exist_ok=True)

            # Write to temp file first
            fd, tmp_path = tempfile.mkstemp(
                dir=path.parent,
                prefix=".merge_history_",
                suffix=".tmp",
            )
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                # Atomic rename (on POSIX systems, rename is atomic)
                os.replace(tmp_path, path)
            except Exception:
                # Clean up temp file on failure
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                raise

        except OSError as e:
            logger.error(f"Failed to write history file {path}: {e}")
            raise

    def _load_index(self) -> dict[str, Any]:
        """
        Load the task index file.

        Returns:
            Index dictionary with task list
        """
        index_path = self.history_dir / self.INDEX_FILE
        if not index_path.exists():
            return {"tasks": [], "updated_at": None}

        try:
            with open(index_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            logger.error(f"Failed to load merge history index: {e}")
            return {"tasks": [], "updated_at": None}

    def _update_index(self, task_id: str) -> None:
        """
        Update the index to include a task.

        Args:
            task_id: Task ID to add to the index
        """
        index = self._load_index()
        tasks = set(index.get("tasks", []))
        tasks.add(task_id)

        index["tasks"] = sorted(list(tasks))
        index["updated_at"] = self._timestamp()

        index_path = self.history_dir / self.INDEX_FILE
        self._atomic_write(index_path, index)

    def _timestamp(self) -> str:
        """
        Get current timestamp in ISO format with timezone.

        Returns:
            ISO 8601 formatted timestamp string
        """
        return datetime.now(timezone.utc).isoformat()
