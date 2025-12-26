"""
Merge Orchestrator
==================

Main coordinator for the intent-aware merge system.

This orchestrates the complete merge pipeline:
1. Load file evolution data (baselines + task changes)
2. Analyze semantic changes from each task
3. Detect conflicts between tasks
4. Apply deterministic merges where possible (AutoMerger)
5. Call AI resolver for ambiguous conflicts (AIResolver)
6. Produce final merged content and detailed report

The goal is to merge changes from multiple parallel tasks
with maximum automation and minimum AI token usage.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from .ai_resolver import AIResolver, create_claude_resolver
from .auto_merger import AutoMerger
from .conflict_detector import ConflictDetector
from .conflict_resolver import ConflictResolver
from .file_evolution import FileEvolutionTracker
from .git_utils import find_worktree, get_file_from_branch
from .merge_pipeline import MergePipeline

# Re-export models for backwards compatibility
from .models import MergeReport, MergeStats, TaskMergeRequest
from .semantic_analyzer import SemanticAnalyzer
from .types import (
    ConflictRegion,
    FileAnalysis,
    MergeDecision,
)

# Import debug utilities
try:
    from debug import (
        debug,
        debug_detailed,
        debug_error,
        debug_section,
        debug_success,
        debug_verbose,
        debug_warning,
        is_debug_enabled,
    )
except ImportError:

    def debug(*args, **kwargs):
        pass

    def debug_detailed(*args, **kwargs):
        pass

    def debug_verbose(*args, **kwargs):
        pass

    def debug_success(*args, **kwargs):
        pass

    def debug_error(*args, **kwargs):
        pass

    def debug_warning(*args, **kwargs):
        pass

    def debug_section(*args, **kwargs):
        pass

    def is_debug_enabled():
        return False


logger = logging.getLogger(__name__)
MODULE = "merge.orchestrator"


class MergeProgressStep(Enum):
    """
    Progress steps during file merge operations.

    These represent the stages of processing a single file,
    enabling real-time progress tracking in the UI.
    """

    FILE_START = "file_start"
    LOADING_BASELINE = "loading_baseline"
    DETECTING_CONFLICTS = "detecting_conflicts"
    RESOLVING_CONFLICTS = "resolving_conflicts"
    APPLYING_CHANGES = "applying_changes"
    FILE_COMPLETE = "file_complete"
    FILE_FAILED = "file_failed"


@dataclass
class MergeProgressEvent:
    """
    Progress event emitted during merge operations.

    This provides real-time updates about merge progress
    for consumption by the UI or logging systems.

    Attributes:
        file_path: Path to the file being processed
        task_ids: Task IDs involved in this file merge
        step: Current processing step
        progress_percent: Estimated progress (0-100)
        message: Human-readable status message
        conflicts_detected: Number of conflicts found so far
        conflicts_resolved: Number of conflicts resolved so far
        error: Error message if step failed
        metadata: Additional context information
    """

    file_path: str
    task_ids: list[str]
    step: MergeProgressStep
    progress_percent: int = 0
    message: str = ""
    conflicts_detected: int = 0
    conflicts_resolved: int = 0
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "file_path": self.file_path,
            "task_ids": self.task_ids,
            "step": self.step.value,
            "progress_percent": self.progress_percent,
            "message": self.message,
            "conflicts_detected": self.conflicts_detected,
            "conflicts_resolved": self.conflicts_resolved,
            "error": self.error,
            "metadata": self.metadata,
        }


# Type alias for progress callback
MergeProgressCallback = Callable[[MergeProgressEvent], None]


# Export all public classes for backwards compatibility
__all__ = [
    "MergeOrchestrator",
    "MergeProgressEvent",
    "MergeProgressStep",
    "MergeProgressCallback",
    "MergeReport",
    "MergeStats",
    "TaskMergeRequest",
]


class MergeOrchestrator:
    """
    Orchestrates the complete merge pipeline.

    This is the main entry point for merging task changes.
    It coordinates all components to produce merged content
    with maximum automation and detailed reporting.

    Example:
        orchestrator = MergeOrchestrator(project_dir)

        # Merge a single task
        result = orchestrator.merge_task("task-001-feature")

        # Merge multiple tasks
        report = orchestrator.merge_tasks([
            TaskMergeRequest(task_id="task-001", worktree_path=path1),
            TaskMergeRequest(task_id="task-002", worktree_path=path2),
        ])
    """

    def __init__(
        self,
        project_dir: Path,
        storage_dir: Path | None = None,
        enable_ai: bool = True,
        ai_resolver: AIResolver | None = None,
        dry_run: bool = False,
        progress_callback: MergeProgressCallback | None = None,
    ):
        """
        Initialize the merge orchestrator.

        Args:
            project_dir: Root directory of the project
            storage_dir: Directory for merge data (default: .auto-claude/)
            enable_ai: Whether to use AI for ambiguous conflicts
            ai_resolver: Optional pre-configured AI resolver
            dry_run: If True, don't write any files
            progress_callback: Optional callback for progress events
        """
        debug_section(MODULE, "Initializing MergeOrchestrator")
        debug(
            MODULE,
            "Configuration",
            project_dir=str(project_dir),
            enable_ai=enable_ai,
            dry_run=dry_run,
        )

        self.project_dir = Path(project_dir).resolve()
        self.storage_dir = storage_dir or (self.project_dir / ".auto-claude")
        self.enable_ai = enable_ai
        self.dry_run = dry_run
        self._progress_callback = progress_callback

        # Initialize components
        debug_detailed(MODULE, "Initializing sub-components...")
        self.analyzer = SemanticAnalyzer()
        self.conflict_detector = ConflictDetector()
        self.auto_merger = AutoMerger()
        self.evolution_tracker = FileEvolutionTracker(
            project_dir=self.project_dir,
            storage_dir=self.storage_dir,
            semantic_analyzer=self.analyzer,
        )

        # AI resolver - lazy init if not provided
        self._ai_resolver = ai_resolver
        self._ai_resolver_initialized = ai_resolver is not None

        # Initialize conflict resolver and merge pipeline
        self._conflict_resolver: ConflictResolver | None = None
        self._merge_pipeline: MergePipeline | None = None

        # Merge output directory
        self.merge_output_dir = self.storage_dir / "merge_output"
        self.reports_dir = self.storage_dir / "merge_reports"

        debug_success(
            MODULE, "MergeOrchestrator initialized", storage_dir=str(self.storage_dir)
        )

    @property
    def ai_resolver(self) -> AIResolver:
        """Get the AI resolver, initializing if needed."""
        if not self._ai_resolver_initialized:
            if self.enable_ai:
                self._ai_resolver = create_claude_resolver()
            else:
                self._ai_resolver = AIResolver()  # No AI function
            self._ai_resolver_initialized = True
        return self._ai_resolver

    @property
    def conflict_resolver(self) -> ConflictResolver:
        """Get the conflict resolver, initializing if needed."""
        if self._conflict_resolver is None:
            self._conflict_resolver = ConflictResolver(
                auto_merger=self.auto_merger,
                ai_resolver=self.ai_resolver if self.enable_ai else None,
                enable_ai=self.enable_ai,
            )
        return self._conflict_resolver

    @property
    def merge_pipeline(self) -> MergePipeline:
        """Get the merge pipeline, initializing if needed."""
        if self._merge_pipeline is None:
            self._merge_pipeline = MergePipeline(
                conflict_detector=self.conflict_detector,
                conflict_resolver=self.conflict_resolver,
            )
        return self._merge_pipeline

    def merge_task(
        self,
        task_id: str,
        worktree_path: Path | None = None,
        target_branch: str = "main",
    ) -> MergeReport:
        """
        Merge a single task's changes into the target branch.

        Args:
            task_id: The task identifier
            worktree_path: Path to the task's worktree (auto-detected if not provided)
            target_branch: Branch to merge into

        Returns:
            MergeReport with results
        """
        debug_section(MODULE, f"Merging Task: {task_id}")
        debug(
            MODULE,
            "merge_task() called",
            task_id=task_id,
            worktree_path=str(worktree_path) if worktree_path else "auto-detect",
            target_branch=target_branch,
        )

        report = MergeReport(started_at=datetime.now(), tasks_merged=[task_id])
        start_time = datetime.now()

        try:
            # Find worktree if not provided
            if worktree_path is None:
                debug_detailed(MODULE, "Auto-detecting worktree path...")
                worktree_path = find_worktree(self.project_dir, task_id)
                if not worktree_path:
                    debug_error(MODULE, f"Could not find worktree for task {task_id}")
                    report.success = False
                    report.error = f"Could not find worktree for task {task_id}"
                    return report
                debug_detailed(MODULE, f"Found worktree: {worktree_path}")

            # Ensure evolution data is up to date
            debug(MODULE, "Refreshing evolution data from git...")
            self.evolution_tracker.refresh_from_git(
                task_id, worktree_path, target_branch=target_branch
            )

            # Get files modified by this task
            modifications = self.evolution_tracker.get_task_modifications(task_id)
            debug(
                MODULE,
                f"Found {len(modifications) if modifications else 0} modified files",
            )

            if not modifications:
                debug_warning(MODULE, f"No modifications found for task {task_id}")
                logger.info(f"No modifications found for task {task_id}")
                report.completed_at = datetime.now()
                return report

            # Process each modified file
            for file_path, snapshot in modifications:
                debug_detailed(
                    MODULE,
                    f"Processing file: {file_path}",
                    changes=len(snapshot.semantic_changes),
                )
                result = self._merge_file(
                    file_path=file_path,
                    task_snapshots=[snapshot],
                    target_branch=target_branch,
                )
                report.file_results[file_path] = result
                self._update_stats(report.stats, result)
                debug_verbose(
                    MODULE,
                    f"File merge result: {result.decision.value}",
                    file=file_path,
                )

            report.success = report.stats.files_failed == 0

        except Exception as e:
            debug_error(MODULE, f"Merge failed for task {task_id}", error=str(e))
            logger.exception(f"Merge failed for task {task_id}")
            report.success = False
            report.error = str(e)

        report.completed_at = datetime.now()
        report.stats.duration_seconds = (
            report.completed_at - start_time
        ).total_seconds()

        # Save report
        if not self.dry_run:
            self._save_report(report, task_id)

        debug_success(
            MODULE,
            f"Merge complete for {task_id}",
            success=report.success,
            files_processed=report.stats.files_processed,
            files_auto_merged=report.stats.files_auto_merged,
            conflicts_detected=report.stats.conflicts_detected,
            duration=f"{report.stats.duration_seconds:.2f}s",
        )

        return report

    def merge_tasks(
        self,
        requests: list[TaskMergeRequest],
        target_branch: str = "main",
    ) -> MergeReport:
        """
        Merge multiple tasks' changes.

        This is the main entry point for merging multiple parallel tasks.
        It handles conflicts between tasks and produces a combined result.

        Args:
            requests: List of merge requests (one per task)
            target_branch: Branch to merge into

        Returns:
            MergeReport with combined results
        """
        report = MergeReport(
            started_at=datetime.now(),
            tasks_merged=[r.task_id for r in requests],
        )
        start_time = datetime.now()

        try:
            # Sort by priority (higher first)
            requests = sorted(requests, key=lambda r: -r.priority)

            # Refresh evolution data for all tasks
            for request in requests:
                if request.worktree_path and request.worktree_path.exists():
                    self.evolution_tracker.refresh_from_git(
                        request.task_id,
                        request.worktree_path,
                        target_branch=target_branch,
                    )

            # Find all files modified by any task
            task_ids = [r.task_id for r in requests]
            file_tasks = self.evolution_tracker.get_files_modified_by_tasks(task_ids)

            # Process each file
            for file_path, modifying_tasks in file_tasks.items():
                # Get snapshots from all tasks that modified this file
                evolution = self.evolution_tracker.get_file_evolution(file_path)
                if not evolution:
                    continue

                snapshots = [
                    evolution.get_task_snapshot(tid)
                    for tid in modifying_tasks
                    if evolution.get_task_snapshot(tid)
                ]

                if not snapshots:
                    continue

                result = self._merge_file(
                    file_path=file_path,
                    task_snapshots=snapshots,
                    target_branch=target_branch,
                )
                report.file_results[file_path] = result
                self._update_stats(report.stats, result)

            report.success = report.stats.files_failed == 0

        except Exception as e:
            logger.exception("Merge failed")
            report.success = False
            report.error = str(e)

        report.completed_at = datetime.now()
        report.stats.duration_seconds = (
            report.completed_at - start_time
        ).total_seconds()

        # Save report
        if not self.dry_run:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            self._save_report(report, f"multi_{timestamp}")

        return report

    def set_progress_callback(self, callback: MergeProgressCallback | None) -> None:
        """
        Set the progress callback for real-time merge updates.

        Args:
            callback: Function to call with progress events, or None to disable
        """
        self._progress_callback = callback
        debug(MODULE, f"Progress callback {'set' if callback else 'cleared'}")

    def _emit_progress(
        self,
        file_path: str,
        task_ids: list[str],
        step: MergeProgressStep,
        progress_percent: int = 0,
        message: str = "",
        conflicts_detected: int = 0,
        conflicts_resolved: int = 0,
        error: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """
        Emit a progress event for merge tracking.

        This method creates and dispatches a MergeProgressEvent to the
        configured callback (if any) and logs the event for debugging.

        Args:
            file_path: Path to the file being processed
            task_ids: Task IDs involved in this file merge
            step: Current processing step
            progress_percent: Estimated progress (0-100)
            message: Human-readable status message
            conflicts_detected: Number of conflicts found so far
            conflicts_resolved: Number of conflicts resolved so far
            error: Error message if step failed
            metadata: Additional context information
        """
        event = MergeProgressEvent(
            file_path=file_path,
            task_ids=task_ids,
            step=step,
            progress_percent=progress_percent,
            message=message,
            conflicts_detected=conflicts_detected,
            conflicts_resolved=conflicts_resolved,
            error=error,
            metadata=metadata or {},
        )

        # Log the event
        debug_detailed(
            MODULE,
            f"Progress: {step.value} ({progress_percent}%)",
            file=file_path,
            tasks=task_ids,
            conflicts_detected=conflicts_detected,
            conflicts_resolved=conflicts_resolved,
        )

        # Dispatch to callback if configured
        if self._progress_callback is not None:
            try:
                self._progress_callback(event)
            except Exception as e:
                debug_error(
                    MODULE,
                    "Progress callback failed",
                    error=str(e),
                    step=step.value,
                )
                logger.warning(f"Progress callback error: {e}")

    def _merge_file(
        self,
        file_path: str,
        task_snapshots: list,
        target_branch: str,
    ):
        """
        Merge changes from multiple tasks for a single file.

        Emits progress events at each stage:
        - FILE_START: Beginning file processing
        - LOADING_BASELINE: Loading baseline content
        - DETECTING_CONFLICTS: Analyzing for conflicts
        - RESOLVING_CONFLICTS: Resolving detected conflicts
        - APPLYING_CHANGES: Applying merge changes
        - FILE_COMPLETE/FILE_FAILED: Processing finished

        Args:
            file_path: Path to the file
            task_snapshots: Snapshots from tasks that modified this file
            target_branch: Branch to merge into

        Returns:
            MergeResult with merged content or conflict info
        """
        task_ids = [s.task_id for s in task_snapshots]
        debug(
            MODULE,
            f"_merge_file: {file_path}",
            tasks=task_ids,
            target_branch=target_branch,
        )

        # Emit FILE_START event
        self._emit_progress(
            file_path=file_path,
            task_ids=task_ids,
            step=MergeProgressStep.FILE_START,
            progress_percent=0,
            message=f"Starting merge for {file_path}",
            metadata={"target_branch": target_branch},
        )

        try:
            # Emit LOADING_BASELINE event
            self._emit_progress(
                file_path=file_path,
                task_ids=task_ids,
                step=MergeProgressStep.LOADING_BASELINE,
                progress_percent=10,
                message="Loading baseline content",
            )

            # Get baseline content
            baseline_content = self.evolution_tracker.get_baseline_content(file_path)
            if baseline_content is None:
                # Try to get from target branch
                baseline_content = get_file_from_branch(
                    self.project_dir, file_path, target_branch
                )

            if baseline_content is None:
                # File is new - created by task(s)
                baseline_content = ""

            # Emit DETECTING_CONFLICTS event
            self._emit_progress(
                file_path=file_path,
                task_ids=task_ids,
                step=MergeProgressStep.DETECTING_CONFLICTS,
                progress_percent=30,
                message="Detecting conflicts",
            )

            # Delegate to merge pipeline for the actual merge
            # The pipeline handles conflict detection and resolution internally
            result = self.merge_pipeline.merge_file(
                file_path=file_path,
                baseline_content=baseline_content,
                task_snapshots=task_snapshots,
            )

            # Calculate conflict counts from result
            conflicts_detected = len(result.conflicts_resolved) + len(
                result.conflicts_remaining
            )
            conflicts_resolved = len(result.conflicts_resolved)

            # Emit RESOLVING_CONFLICTS if there were conflicts
            if conflicts_detected > 0:
                self._emit_progress(
                    file_path=file_path,
                    task_ids=task_ids,
                    step=MergeProgressStep.RESOLVING_CONFLICTS,
                    progress_percent=60,
                    message=f"Resolved {conflicts_resolved}/{conflicts_detected} conflicts",
                    conflicts_detected=conflicts_detected,
                    conflicts_resolved=conflicts_resolved,
                    metadata={
                        "ai_calls_made": result.ai_calls_made,
                        "decision": result.decision.value,
                    },
                )

            # Emit APPLYING_CHANGES event
            self._emit_progress(
                file_path=file_path,
                task_ids=task_ids,
                step=MergeProgressStep.APPLYING_CHANGES,
                progress_percent=80,
                message="Applying merged changes",
                conflicts_detected=conflicts_detected,
                conflicts_resolved=conflicts_resolved,
            )

            # Emit completion event
            if result.success:
                self._emit_progress(
                    file_path=file_path,
                    task_ids=task_ids,
                    step=MergeProgressStep.FILE_COMPLETE,
                    progress_percent=100,
                    message=f"Merge complete: {result.decision.value}",
                    conflicts_detected=conflicts_detected,
                    conflicts_resolved=conflicts_resolved,
                    metadata={
                        "decision": result.decision.value,
                        "explanation": result.explanation,
                    },
                )
            else:
                self._emit_progress(
                    file_path=file_path,
                    task_ids=task_ids,
                    step=MergeProgressStep.FILE_FAILED,
                    progress_percent=100,
                    message=f"Merge failed: {result.error or 'Unknown error'}",
                    conflicts_detected=conflicts_detected,
                    conflicts_resolved=conflicts_resolved,
                    error=result.error,
                    metadata={
                        "decision": result.decision.value,
                        "conflicts_remaining": len(result.conflicts_remaining),
                    },
                )

            return result

        except Exception as e:
            # Emit FILE_FAILED event on exception
            error_msg = str(e)
            self._emit_progress(
                file_path=file_path,
                task_ids=task_ids,
                step=MergeProgressStep.FILE_FAILED,
                progress_percent=100,
                message=f"Merge error: {error_msg}",
                error=error_msg,
            )
            raise

    def get_pending_conflicts(self) -> list[tuple[str, list[ConflictRegion]]]:
        """
        Get files with pending conflicts that need human review.

        Returns:
            List of (file_path, conflicts) tuples
        """
        pending = []
        active_tasks = list(self.evolution_tracker.get_active_tasks())

        if len(active_tasks) < 2:
            return pending

        # Check for conflicts between active tasks
        conflicting_files = self.evolution_tracker.get_conflicting_files(active_tasks)

        for file_path in conflicting_files:
            evolution = self.evolution_tracker.get_file_evolution(file_path)
            if not evolution:
                continue

            # Build analyses for conflict detection
            analyses = {}
            for snapshot in evolution.task_snapshots:
                if snapshot.task_id in active_tasks:
                    analyses[snapshot.task_id] = FileAnalysis(
                        file_path=file_path,
                        changes=snapshot.semantic_changes,
                    )

            conflicts = self.conflict_detector.detect_conflicts(analyses)
            if conflicts:
                # Filter to only non-auto-mergeable conflicts
                hard_conflicts = [c for c in conflicts if not c.can_auto_merge]
                if hard_conflicts:
                    pending.append((file_path, hard_conflicts))

        return pending

    def preview_merge(
        self,
        task_ids: list[str],
    ) -> dict[str, Any]:
        """
        Preview what a merge would look like without executing.

        Args:
            task_ids: List of task IDs to preview merging

        Returns:
            Dictionary with preview information
        """
        debug_section(MODULE, "Preview Merge")
        debug(MODULE, "preview_merge() called", task_ids=task_ids)

        file_tasks = self.evolution_tracker.get_files_modified_by_tasks(task_ids)
        conflicting = self.evolution_tracker.get_conflicting_files(task_ids)

        debug(
            MODULE,
            "Files analysis",
            files_modified=len(file_tasks),
            files_with_conflicts=len(conflicting),
        )

        preview = {
            "tasks": task_ids,
            "files_to_merge": list(file_tasks.keys()),
            "files_with_potential_conflicts": conflicting,
            "conflicts": [],
        }

        # Analyze conflicts
        for file_path in conflicting:
            debug_detailed(MODULE, f"Analyzing conflicts for: {file_path}")
            evolution = self.evolution_tracker.get_file_evolution(file_path)
            if not evolution:
                debug_warning(MODULE, f"No evolution data for {file_path}")
                continue

            analyses = {}
            for snapshot in evolution.task_snapshots:
                if snapshot.task_id in task_ids:
                    analyses[snapshot.task_id] = FileAnalysis(
                        file_path=file_path,
                        changes=snapshot.semantic_changes,
                    )

            conflicts = self.conflict_detector.detect_conflicts(analyses)
            debug_detailed(MODULE, f"Found {len(conflicts)} conflicts in {file_path}")

            for c in conflicts:
                debug_verbose(
                    MODULE,
                    f"Conflict: {c.location}",
                    severity=c.severity.value,
                    can_auto_merge=c.can_auto_merge,
                )
                preview["conflicts"].append(
                    {
                        "file": c.file_path,
                        "location": c.location,
                        "tasks": c.tasks_involved,
                        "severity": c.severity.value,
                        "can_auto_merge": c.can_auto_merge,
                        "strategy": c.merge_strategy.value
                        if c.merge_strategy
                        else None,
                        "reason": c.reason,
                    }
                )

        preview["summary"] = {
            "total_files": len(file_tasks),
            "conflict_files": len(conflicting),
            "total_conflicts": len(preview["conflicts"]),
            "auto_mergeable": sum(
                1 for c in preview["conflicts"] if c["can_auto_merge"]
            ),
        }

        debug_success(MODULE, "Preview complete", summary=preview["summary"])

        return preview

    def write_merged_files(
        self,
        report: MergeReport,
        output_dir: Path | None = None,
    ) -> list[Path]:
        """
        Write merged files to disk.

        Args:
            report: The merge report with results
            output_dir: Directory to write to (default: merge_output/)

        Returns:
            List of written file paths
        """
        if self.dry_run:
            logger.info("Dry run - not writing files")
            return []

        output_dir = output_dir or self.merge_output_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        written = []
        for file_path, result in report.file_results.items():
            if result.merged_content:
                out_path = output_dir / file_path
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(result.merged_content, encoding="utf-8")
                written.append(out_path)
                logger.debug(f"Wrote merged file: {out_path}")

        logger.info(f"Wrote {len(written)} merged files to {output_dir}")
        return written

    def apply_to_project(
        self,
        report: MergeReport,
    ) -> bool:
        """
        Apply merged files directly to the project.

        Args:
            report: The merge report with results

        Returns:
            True if all files were applied successfully
        """
        if self.dry_run:
            logger.info("Dry run - not applying to project")
            return True

        success = True
        for file_path, result in report.file_results.items():
            if result.merged_content and result.success:
                target_path = self.project_dir / file_path
                target_path.parent.mkdir(parents=True, exist_ok=True)
                try:
                    target_path.write_text(result.merged_content, encoding="utf-8")
                    logger.debug(f"Applied merged content to: {target_path}")
                except Exception as e:
                    logger.error(f"Failed to write {target_path}: {e}")
                    success = False

        return success

    def _update_stats(self, stats: MergeStats, result) -> None:
        """Update stats from a merge result."""
        stats.files_processed += 1
        stats.ai_calls_made += result.ai_calls_made
        stats.estimated_tokens_used += result.tokens_used
        stats.conflicts_detected += len(result.conflicts_resolved) + len(
            result.conflicts_remaining
        )
        stats.conflicts_auto_resolved += len(result.conflicts_resolved)

        if result.decision == MergeDecision.AUTO_MERGED:
            stats.files_auto_merged += 1
        elif result.decision == MergeDecision.AI_MERGED:
            stats.files_ai_merged += 1
            stats.conflicts_ai_resolved += len(result.conflicts_resolved)
        elif result.decision == MergeDecision.NEEDS_HUMAN_REVIEW:
            stats.files_need_review += 1
        elif result.decision == MergeDecision.FAILED:
            stats.files_failed += 1

    def _save_report(self, report: MergeReport, name: str) -> None:
        """Save a merge report to disk."""
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        report_path = self.reports_dir / f"{name}_{timestamp}.json"
        report.save(report_path)
        logger.info(f"Saved merge report to {report_path}")
