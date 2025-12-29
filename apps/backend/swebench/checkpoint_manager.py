"""
Checkpoint Manager for SWE-bench Evaluations
=============================================

This module provides functionality for saving, loading, and validating checkpoints
for SWE-bench evaluation runs. Checkpoints enable resuming interrupted evaluations
without re-processing completed instances.

Checkpoint Storage Location:
    .auto-claude/swebench/checkpoints/[run_id].json

Usage:
    from swebench.checkpoint_manager import CheckpointManager

    # Create a new checkpoint manager
    manager = CheckpointManager()

    # Create a new checkpoint
    checkpoint = manager.create_checkpoint(
        run_id="eval-2024-01-15-001",
        dataset_name="princeton-nlp/SWE-bench_Lite",
        instance_ids=["django__django-11001", "django__django-11002"],
    )

    # Save checkpoint after each instance
    manager.save(checkpoint)

    # Load existing checkpoint
    checkpoint = manager.load("eval-2024-01-15-001")

    # List all checkpoints
    checkpoints = manager.list_checkpoints()
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from swebench.checkpoint_models import Checkpoint, InstanceCheckpointState


logger = logging.getLogger(__name__)


# Default checkpoint directory relative to the working directory
DEFAULT_CHECKPOINT_DIR = ".auto-claude/swebench/checkpoints"


class CheckpointError(Exception):
    """Base exception for checkpoint-related errors."""

    pass


class CheckpointNotFoundError(CheckpointError):
    """Raised when a checkpoint file cannot be found."""

    pass


class CheckpointCorruptedError(CheckpointError):
    """Raised when a checkpoint file is corrupted or invalid."""

    pass


class CheckpointSaveError(CheckpointError):
    """Raised when a checkpoint cannot be saved."""

    pass


class CheckpointManager:
    """Manager for SWE-bench evaluation checkpoints.

    Handles saving, loading, and validating checkpoints for evaluation runs.
    Checkpoints are stored as JSON files in the checkpoint directory.

    Attributes:
        checkpoint_dir: Path to the directory where checkpoints are stored.
    """

    def __init__(self, checkpoint_dir: str | Path | None = None) -> None:
        """Initialize the checkpoint manager.

        Args:
            checkpoint_dir: Path to the checkpoint directory. If None, uses the
                default location (.auto-claude/swebench/checkpoints).
        """
        if checkpoint_dir is None:
            self.checkpoint_dir = Path(DEFAULT_CHECKPOINT_DIR)
        else:
            self.checkpoint_dir = Path(checkpoint_dir)

        logger.debug(f"CheckpointManager initialized with dir: {self.checkpoint_dir}")

    def _ensure_dir_exists(self) -> None:
        """Ensure the checkpoint directory exists, creating it if necessary."""
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

    def _get_checkpoint_path(self, run_id: str) -> Path:
        """Get the file path for a checkpoint.

        Args:
            run_id: The run ID of the checkpoint.

        Returns:
            Path to the checkpoint file.
        """
        # Sanitize run_id to prevent directory traversal
        safe_run_id = run_id.replace("/", "_").replace("\\", "_").replace("..", "_")
        return self.checkpoint_dir / f"{safe_run_id}.json"

    def create_checkpoint(
        self,
        run_id: str,
        dataset_name: str,
        instance_ids: list[str],
        max_instances: int | None = None,
        max_workers: int = 1,
        timeout_seconds: int = 1800,
        model_name: str = "autoclaude",
        dataset_split: str = "test",
    ) -> Checkpoint:
        """Create a new checkpoint for an evaluation run.

        Args:
            run_id: Unique identifier for this evaluation run.
            dataset_name: HuggingFace dataset path.
            instance_ids: List of instance IDs to track.
            max_instances: Maximum number of instances to process.
            max_workers: Number of parallel workers.
            timeout_seconds: Timeout per instance in seconds.
            model_name: Name of the model being evaluated.
            dataset_split: Dataset split being evaluated.

        Returns:
            A new Checkpoint instance.
        """
        checkpoint = Checkpoint(
            run_id=run_id,
            dataset_name=dataset_name,
            dataset_split=dataset_split,
            max_instances=max_instances,
            max_workers=max_workers,
            timeout_seconds=timeout_seconds,
            model_name=model_name,
            total_instances=len(instance_ids),
        )
        checkpoint.initialize_instances(instance_ids)

        logger.info(
            f"Created checkpoint for run '{run_id}' with {len(instance_ids)} instances"
        )
        return checkpoint

    def save(self, checkpoint: Checkpoint, update_checksum: bool = True) -> Path:
        """Save a checkpoint to disk.

        Args:
            checkpoint: The checkpoint to save.
            update_checksum: Whether to update the checksum before saving.

        Returns:
            Path to the saved checkpoint file.

        Raises:
            CheckpointSaveError: If the checkpoint cannot be saved.
        """
        self._ensure_dir_exists()

        if update_checksum:
            checkpoint.checksum = checkpoint.compute_checksum()

        checkpoint_path = self._get_checkpoint_path(checkpoint.run_id)

        # Write to a temporary file first, then rename (atomic operation)
        temp_path = checkpoint_path.with_suffix(".json.tmp")

        try:
            # Serialize checkpoint to JSON with datetime handling
            data = checkpoint.model_dump(mode="json")
            json_str = json.dumps(data, indent=2, default=str)

            temp_path.write_text(json_str, encoding="utf-8")

            # Atomic rename (works on same filesystem)
            shutil.move(str(temp_path), str(checkpoint_path))

            logger.debug(f"Saved checkpoint to: {checkpoint_path}")
            return checkpoint_path

        except (OSError, json.JSONEncodeError) as e:
            # Clean up temp file if it exists
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass

            raise CheckpointSaveError(
                f"Failed to save checkpoint '{checkpoint.run_id}': {e}"
            ) from e

    def load(
        self,
        run_id: str,
        validate_integrity: bool = True,
        fallback_to_fresh: bool = True,
    ) -> Checkpoint:
        """Load a checkpoint from disk.

        Args:
            run_id: The run ID of the checkpoint to load.
            validate_integrity: Whether to validate the checkpoint checksum.
            fallback_to_fresh: If True and checkpoint is corrupted, return None
                instead of raising an exception.

        Returns:
            The loaded Checkpoint instance.

        Raises:
            CheckpointNotFoundError: If the checkpoint file doesn't exist.
            CheckpointCorruptedError: If the checkpoint is corrupted and
                fallback_to_fresh is False.
        """
        checkpoint_path = self._get_checkpoint_path(run_id)

        if not checkpoint_path.exists():
            raise CheckpointNotFoundError(
                f"Checkpoint not found for run '{run_id}' at {checkpoint_path}"
            )

        try:
            json_str = checkpoint_path.read_text(encoding="utf-8")
            data = json.loads(json_str)

            # Parse into Pydantic model
            checkpoint = Checkpoint.model_validate(data)

            # Validate integrity if requested
            if validate_integrity and not checkpoint.validate_integrity():
                logger.warning(
                    f"Checkpoint integrity check failed for run '{run_id}'"
                )
                if not fallback_to_fresh:
                    raise CheckpointCorruptedError(
                        f"Checkpoint for run '{run_id}' failed integrity check. "
                        "The file may be corrupted."
                    )
                # Return the checkpoint anyway if fallback is allowed
                logger.warning("Proceeding with potentially corrupted checkpoint")

            logger.info(
                f"Loaded checkpoint for run '{run_id}': "
                f"{checkpoint.completed_count}/{checkpoint.total_instances} complete"
            )
            return checkpoint

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse checkpoint JSON for run '{run_id}': {e}")
            if fallback_to_fresh:
                raise CheckpointCorruptedError(
                    f"Checkpoint for run '{run_id}' contains invalid JSON: {e}"
                ) from e
            raise CheckpointCorruptedError(
                f"Checkpoint for run '{run_id}' contains invalid JSON: {e}"
            ) from e

        except Exception as e:
            logger.error(f"Failed to load checkpoint for run '{run_id}': {e}")
            raise CheckpointCorruptedError(
                f"Failed to load checkpoint for run '{run_id}': {e}"
            ) from e

    def exists(self, run_id: str) -> bool:
        """Check if a checkpoint exists for a given run ID.

        Args:
            run_id: The run ID to check.

        Returns:
            True if the checkpoint exists, False otherwise.
        """
        checkpoint_path = self._get_checkpoint_path(run_id)
        return checkpoint_path.exists()

    def delete(self, run_id: str) -> bool:
        """Delete a checkpoint.

        Args:
            run_id: The run ID of the checkpoint to delete.

        Returns:
            True if the checkpoint was deleted, False if it didn't exist.
        """
        checkpoint_path = self._get_checkpoint_path(run_id)

        if not checkpoint_path.exists():
            return False

        try:
            checkpoint_path.unlink()
            logger.info(f"Deleted checkpoint for run '{run_id}'")
            return True
        except OSError as e:
            logger.error(f"Failed to delete checkpoint for run '{run_id}': {e}")
            raise CheckpointError(
                f"Failed to delete checkpoint for run '{run_id}': {e}"
            ) from e

    def list_checkpoints(self) -> list[dict[str, Any]]:
        """List all available checkpoints.

        Returns:
            List of dictionaries containing checkpoint summaries:
                - run_id: Run identifier
                - path: Path to checkpoint file
                - size_bytes: File size in bytes
                - modified_at: Last modification time
                - summary: Checkpoint summary (if loadable)
        """
        if not self.checkpoint_dir.exists():
            return []

        checkpoints = []
        for path in self.checkpoint_dir.glob("*.json"):
            # Skip temp files
            if path.suffix == ".tmp":
                continue

            info: dict[str, Any] = {
                "run_id": path.stem,
                "path": str(path),
                "size_bytes": path.stat().st_size,
                "modified_at": datetime.fromtimestamp(
                    path.stat().st_mtime, tz=timezone.utc
                ).isoformat(),
                "summary": None,
            }

            # Try to load and get summary
            try:
                checkpoint = self.load(path.stem, validate_integrity=False)
                info["summary"] = checkpoint.to_summary()
            except CheckpointError:
                info["summary"] = {"error": "Failed to load checkpoint"}

            checkpoints.append(info)

        # Sort by modification time (most recent first)
        checkpoints.sort(key=lambda x: x["modified_at"], reverse=True)
        return checkpoints

    def get_or_create(
        self,
        run_id: str,
        dataset_name: str,
        instance_ids: list[str],
        max_instances: int | None = None,
        max_workers: int = 1,
        timeout_seconds: int = 1800,
        model_name: str = "autoclaude",
        dataset_split: str = "test",
    ) -> tuple[Checkpoint, bool]:
        """Get an existing checkpoint or create a new one.

        Args:
            run_id: Unique identifier for this evaluation run.
            dataset_name: HuggingFace dataset path.
            instance_ids: List of instance IDs to track.
            max_instances: Maximum number of instances to process.
            max_workers: Number of parallel workers.
            timeout_seconds: Timeout per instance in seconds.
            model_name: Name of the model being evaluated.
            dataset_split: Dataset split being evaluated.

        Returns:
            Tuple of (checkpoint, is_new) where is_new is True if a new
            checkpoint was created.
        """
        if self.exists(run_id):
            try:
                checkpoint = self.load(run_id)
                return (checkpoint, False)
            except CheckpointCorruptedError:
                logger.warning(
                    f"Checkpoint for run '{run_id}' is corrupted, creating new one"
                )

        checkpoint = self.create_checkpoint(
            run_id=run_id,
            dataset_name=dataset_name,
            instance_ids=instance_ids,
            max_instances=max_instances,
            max_workers=max_workers,
            timeout_seconds=timeout_seconds,
            model_name=model_name,
            dataset_split=dataset_split,
        )
        return (checkpoint, True)

    def cleanup_old_checkpoints(
        self,
        max_age_days: int = 30,
        keep_completed: bool = True,
    ) -> list[str]:
        """Clean up old checkpoint files.

        Args:
            max_age_days: Maximum age in days before a checkpoint is deleted.
            keep_completed: If True, don't delete checkpoints for completed runs.

        Returns:
            List of run IDs that were deleted.
        """
        if not self.checkpoint_dir.exists():
            return []

        deleted = []
        now = datetime.now(timezone.utc)

        for path in self.checkpoint_dir.glob("*.json"):
            # Skip temp files
            if path.suffix == ".tmp":
                continue

            # Check age
            modified_time = datetime.fromtimestamp(
                path.stat().st_mtime, tz=timezone.utc
            )
            age_days = (now - modified_time).days

            if age_days < max_age_days:
                continue

            # Check if completed
            if keep_completed:
                try:
                    checkpoint = self.load(path.stem, validate_integrity=False)
                    if checkpoint.is_complete():
                        continue
                except CheckpointError:
                    pass  # Delete corrupted checkpoints

            # Delete the checkpoint
            try:
                path.unlink()
                deleted.append(path.stem)
                logger.info(f"Cleaned up old checkpoint: {path.stem}")
            except OSError as e:
                logger.warning(f"Failed to delete old checkpoint {path.stem}: {e}")

        return deleted

    def repair_checkpoint(self, run_id: str) -> Checkpoint | None:
        """Attempt to repair a corrupted checkpoint.

        Tries to load the checkpoint without validation and re-save it
        with a fresh checksum.

        Args:
            run_id: The run ID of the checkpoint to repair.

        Returns:
            The repaired Checkpoint if successful, None otherwise.
        """
        checkpoint_path = self._get_checkpoint_path(run_id)

        if not checkpoint_path.exists():
            logger.error(f"Cannot repair: checkpoint '{run_id}' not found")
            return None

        try:
            # Load without validation
            json_str = checkpoint_path.read_text(encoding="utf-8")
            data = json.loads(json_str)
            checkpoint = Checkpoint.model_validate(data)

            # Re-save with new checksum
            self.save(checkpoint, update_checksum=True)

            logger.info(f"Repaired checkpoint for run '{run_id}'")
            return checkpoint

        except Exception as e:
            logger.error(f"Failed to repair checkpoint '{run_id}': {e}")
            return None

    def get_checkpoint_path(self, run_id: str) -> Path:
        """Get the file path for a checkpoint.

        Args:
            run_id: The run ID of the checkpoint.

        Returns:
            Path to the checkpoint file.
        """
        return self._get_checkpoint_path(run_id)


# Convenience functions for common operations


def save_checkpoint(
    checkpoint: Checkpoint,
    checkpoint_dir: str | Path | None = None,
) -> Path:
    """Save a checkpoint to disk.

    Args:
        checkpoint: The checkpoint to save.
        checkpoint_dir: Optional custom checkpoint directory.

    Returns:
        Path to the saved checkpoint file.
    """
    manager = CheckpointManager(checkpoint_dir)
    return manager.save(checkpoint)


def load_checkpoint(
    run_id: str,
    checkpoint_dir: str | Path | None = None,
    validate_integrity: bool = True,
) -> Checkpoint:
    """Load a checkpoint from disk.

    Args:
        run_id: The run ID of the checkpoint to load.
        checkpoint_dir: Optional custom checkpoint directory.
        validate_integrity: Whether to validate the checkpoint checksum.

    Returns:
        The loaded Checkpoint instance.
    """
    manager = CheckpointManager(checkpoint_dir)
    return manager.load(run_id, validate_integrity=validate_integrity)


def checkpoint_exists(
    run_id: str,
    checkpoint_dir: str | Path | None = None,
) -> bool:
    """Check if a checkpoint exists.

    Args:
        run_id: The run ID to check.
        checkpoint_dir: Optional custom checkpoint directory.

    Returns:
        True if the checkpoint exists, False otherwise.
    """
    manager = CheckpointManager(checkpoint_dir)
    return manager.exists(run_id)
