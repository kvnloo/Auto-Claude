#!/usr/bin/env python3
"""
Autonomous Runner - Main Orchestrator for Autonomous Task Execution
====================================================================

This module provides the main orchestrator for autonomous task execution.
It fetches tasks from GitHub Issues and Roadmap features, prioritizes them,
executes through the spec_runner.py -> run.py pipeline, creates PRs, and
updates statuses.

Key Features:
- Continuous loop with configurable polling interval
- Task prioritization using complexity, impact, priority, recency
- Pipeline execution via spec_runner.py subprocess
- Guardrail enforcement (max failures, session time limit)
- Graceful shutdown on SIGTERM/SIGINT
- Progress events emitted to stdout for IPC parsing

Usage:
    python -m runners.autonomous_runner --project-dir /path/to/project

    # With guardrails
    python -m runners.autonomous_runner \\
        --project-dir /path/to/project \\
        --max-failures 3 \\
        --session-time-limit 240 \\
        --poll-interval 60

Events (JSON on stdout):
    {"event": "started", "timestamp": "...", "settings": {...}}
    {"event": "task_started", "task": {...}}
    {"event": "task_completed", "task": {...}, "spec_id": "...", "pr_url": "..."}
    {"event": "task_failed", "task": {...}, "error": "..."}
    {"event": "guardrail_triggered", "reason": "max_failures", "details": {...}}
    {"event": "paused", "reason": "..."}
    {"event": "stopped", "stats": {...}}
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load .env file
from dotenv import load_dotenv

env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)

# Import from autonomous module
from runners.autonomous.models import (
    AutonomousTask,
    TaskSource,
    TaskStatus,
    create_task_from_github_issue,
    create_task_from_roadmap_feature,
    get_ready_tasks,
    sort_tasks_by_priority,
)

# Import fetchers
from runners.github.issue_fetcher import (
    LABEL_COMPLETED,
    LABEL_FAILED,
    LABEL_IN_PROGRESS,
    LABEL_READY,
    IssueFetcher,
    IssueFetchError,
)
from runners.github.rate_limiter import RateLimitExceeded
from runners.roadmap.feature_fetcher import (
    FeatureFetcher,
    FeatureFetchError,
    FeatureStatus,
)

# Configure logger
logger = logging.getLogger(__name__)


# ============================================
# Runner State Enum
# ============================================


class RunnerState(str, Enum):
    """State of the autonomous runner."""

    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"
    STOPPED = "stopped"


# ============================================
# Guardrail Configuration
# ============================================


@dataclass
class GuardrailConfig:
    """
    Configuration for autonomous mode guardrails.

    Attributes:
        max_consecutive_failures: Maximum consecutive failures before auto-pause (1-5)
        session_time_limit_minutes: Maximum session time in minutes (60-480)
        poll_interval_seconds: Task polling interval in seconds (30+)
        max_concurrent_tasks: Maximum concurrent tasks (currently always 1)
        token_budget: Optional token budget limit
    """

    max_consecutive_failures: int = 3
    session_time_limit_minutes: int = 240  # 4 hours
    poll_interval_seconds: int = 60
    max_concurrent_tasks: int = 1
    token_budget: int | None = None

    def __post_init__(self):
        """Validate configuration values."""
        self.max_consecutive_failures = max(1, min(5, self.max_consecutive_failures))
        self.session_time_limit_minutes = max(60, min(480, self.session_time_limit_minutes))
        self.poll_interval_seconds = max(30, self.poll_interval_seconds)
        self.max_concurrent_tasks = max(1, min(3, self.max_concurrent_tasks))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "max_consecutive_failures": self.max_consecutive_failures,
            "session_time_limit_minutes": self.session_time_limit_minutes,
            "poll_interval_seconds": self.poll_interval_seconds,
            "max_concurrent_tasks": self.max_concurrent_tasks,
            "token_budget": self.token_budget,
        }


# ============================================
# Session Statistics
# ============================================


@dataclass
class SessionStats:
    """
    Statistics for the current autonomous session.

    Tracks tasks completed, failures, time elapsed, and tokens used.
    """

    tasks_completed: int = 0
    tasks_failed: int = 0
    consecutive_failures: int = 0
    tokens_used: int = 0
    session_start_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_task_completion_time: datetime | None = None

    def elapsed_time_seconds(self) -> float:
        """Get elapsed session time in seconds."""
        return (datetime.now(timezone.utc) - self.session_start_time).total_seconds()

    def elapsed_time_minutes(self) -> float:
        """Get elapsed session time in minutes."""
        return self.elapsed_time_seconds() / 60

    def record_success(self, tokens_used: int = 0) -> None:
        """Record a successful task completion."""
        self.tasks_completed += 1
        self.consecutive_failures = 0  # Reset consecutive failures on success
        self.tokens_used += tokens_used
        self.last_task_completion_time = datetime.now(timezone.utc)

    def record_failure(self, tokens_used: int = 0) -> None:
        """Record a task failure."""
        self.tasks_failed += 1
        self.consecutive_failures += 1
        self.tokens_used += tokens_used
        self.last_task_completion_time = datetime.now(timezone.utc)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "tasks_completed": self.tasks_completed,
            "tasks_failed": self.tasks_failed,
            "consecutive_failures": self.consecutive_failures,
            "tokens_used": self.tokens_used,
            "elapsed_time_seconds": int(self.elapsed_time_seconds()),
            "elapsed_time_minutes": round(self.elapsed_time_minutes(), 1),
            "session_start_time": self.session_start_time.isoformat(),
            "last_task_completion_time": (
                self.last_task_completion_time.isoformat()
                if self.last_task_completion_time
                else None
            ),
        }


# ============================================
# Event Emitter
# ============================================


def emit_event(event_type: str, **data) -> None:
    """
    Emit a JSON event to stdout for IPC parsing.

    Events are JSON objects with:
    - event: The event type
    - timestamp: ISO timestamp
    - Additional data fields

    Args:
        event_type: Type of event (started, task_started, task_completed, etc.)
        **data: Additional event data
    """
    event = {
        "event": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **data,
    }
    # Print as single line JSON for easy parsing
    print(json.dumps(event), flush=True)


# ============================================
# Autonomous Runner Class
# ============================================


class AutonomousRunner:
    """
    Main orchestrator for autonomous task execution.

    Fetches tasks from GitHub Issues and Roadmap features, prioritizes them,
    and executes through the spec_runner.py -> run.py pipeline.

    Usage:
        runner = AutonomousRunner(project_dir=Path("/path/to/project"))

        # Start the runner
        await runner.start()

        # Stop gracefully
        await runner.stop()
    """

    def __init__(
        self,
        project_dir: Path,
        guardrails: GuardrailConfig | None = None,
        repository: str | None = None,
    ):
        """
        Initialize the autonomous runner.

        Args:
            project_dir: Project directory path
            guardrails: Optional guardrail configuration
            repository: Optional repository in owner/repo format (auto-detected if not provided)
        """
        self.project_dir = Path(project_dir).resolve()
        self.guardrails = guardrails or GuardrailConfig()
        self.repository = repository

        # State management
        self.state = RunnerState.IDLE
        self.stats = SessionStats()
        self.current_task: AutonomousTask | None = None
        self.task_queue: list[AutonomousTask] = []
        self.completed_task_ids: set[str] = set()

        # Fetchers
        self.issue_fetcher = IssueFetcher(project_dir=self.project_dir)
        self.feature_fetcher = FeatureFetcher(project_dir=self.project_dir)

        # Shutdown control
        self._shutdown_event = asyncio.Event()
        self._current_subprocess: subprocess.Popen | None = None

        # Auto-detect repository if not provided
        if not self.repository:
            self.repository = self._detect_repository()

    def _detect_repository(self) -> str | None:
        """
        Auto-detect repository from git remote.

        Returns:
            Repository in owner/repo format, or None if detection fails
        """
        try:
            result = subprocess.run(
                ["gh", "repo", "view", "--json", "owner,name"],
                cwd=self.project_dir,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                owner = data.get("owner", {}).get("login", "")
                name = data.get("name", "")
                if owner and name:
                    return f"{owner}/{name}"
        except Exception as e:
            logger.warning(f"Failed to auto-detect repository: {e}")
        return None

    # =========================================================================
    # Task Fetching
    # =========================================================================

    async def _fetch_github_issues(self) -> list[AutonomousTask]:
        """
        Fetch GitHub issues with 'auto-claude-ready' label.

        Returns:
            List of AutonomousTask objects from GitHub issues
        """
        tasks = []
        try:
            issues = await self.issue_fetcher.fetch_ready_issues()
            for issue in issues:
                task = create_task_from_github_issue(
                    issue=issue,
                    repository=self.repository or "unknown/unknown",
                )
                tasks.append(task)
            logger.info(f"Fetched {len(tasks)} tasks from GitHub issues")
        except IssueFetchError as e:
            logger.warning(f"Failed to fetch GitHub issues: {e}")
            emit_event("warning", source="github", message=str(e))
        except RateLimitExceeded as e:
            logger.warning(f"GitHub rate limit exceeded: {e}")
            emit_event("rate_limit", source="github", message=str(e))
        return tasks

    def _fetch_roadmap_features(self) -> list[AutonomousTask]:
        """
        Fetch roadmap features with status='planned'.

        Returns:
            List of AutonomousTask objects from roadmap features
        """
        tasks = []
        try:
            # Get features with dependencies met
            features = self.feature_fetcher.get_features_with_dependencies_met(
                completed_feature_ids={
                    tid.replace("feature-", "")
                    for tid in self.completed_task_ids
                    if tid.startswith("feature-")
                }
            )
            for feature in features:
                task = create_task_from_roadmap_feature(feature=feature)
                tasks.append(task)
            logger.info(f"Fetched {len(tasks)} tasks from roadmap features")
        except FeatureFetchError as e:
            logger.warning(f"Failed to fetch roadmap features: {e}")
            emit_event("warning", source="roadmap", message=str(e))
        return tasks

    async def _refresh_task_queue(self) -> None:
        """
        Refresh the task queue by fetching from all sources.

        Deduplicates tasks and sorts by priority.
        """
        logger.info("Refreshing task queue...")

        # Fetch from both sources
        github_tasks = await self._fetch_github_issues()
        roadmap_tasks = self._fetch_roadmap_features()

        # Combine and deduplicate
        all_tasks = github_tasks + roadmap_tasks
        task_map = {task.id: task for task in all_tasks}

        # Remove already completed tasks
        for completed_id in self.completed_task_ids:
            task_map.pop(completed_id, None)

        # Sort by priority
        self.task_queue = sort_tasks_by_priority(
            list(task_map.values()),
            completed_task_ids=self.completed_task_ids,
        )

        logger.info(f"Task queue refreshed: {len(self.task_queue)} tasks available")
        emit_event("queue_updated", count=len(self.task_queue))

    # =========================================================================
    # Task Execution
    # =========================================================================

    async def _execute_task(self, task: AutonomousTask) -> bool:
        """
        Execute a single task through the spec_runner.py -> run.py pipeline.

        Args:
            task: Task to execute

        Returns:
            True if successful, False otherwise
        """
        logger.info(f"Starting task execution: {task.id} - {task.title}")
        task.mark_in_progress()
        self.current_task = task

        emit_event("task_started", task=task.to_dict())

        try:
            # Update external status (GitHub label or roadmap status)
            await self._update_task_status_in_progress(task)

            # Generate spec and execute pipeline
            spec_id = await self._run_spec_pipeline(task)

            if spec_id:
                # Task completed successfully
                task.mark_completed(spec_id=spec_id)
                self.completed_task_ids.add(task.id)
                self.stats.record_success()

                # Update external status
                await self._update_task_status_completed(task, spec_id)

                emit_event(
                    "task_completed",
                    task=task.to_dict(),
                    spec_id=spec_id,
                )
                return True
            else:
                # Task failed
                task.mark_failed("Pipeline execution failed")
                self.stats.record_failure()

                # Update external status
                await self._update_task_status_failed(task)

                emit_event(
                    "task_failed",
                    task=task.to_dict(),
                    error="Pipeline execution failed",
                )
                return False

        except Exception as e:
            logger.error(f"Task execution error: {e}")
            task.mark_failed(str(e))
            self.stats.record_failure()

            # Update external status
            await self._update_task_status_failed(task)

            emit_event(
                "task_failed",
                task=task.to_dict(),
                error=str(e),
            )
            return False

        finally:
            self.current_task = None

    async def _run_spec_pipeline(self, task: AutonomousTask) -> str | None:
        """
        Run the spec_runner.py -> run.py pipeline for a task.

        Args:
            task: Task to execute

        Returns:
            Spec ID if successful, None otherwise
        """
        # Build spec_runner.py command
        spec_runner_path = Path(__file__).parent / "spec_runner.py"

        # Build task description from title and description
        task_description = f"{task.title}\n\n{task.description}"

        # Create command
        cmd = [
            sys.executable,
            str(spec_runner_path),
            "--project-dir",
            str(self.project_dir),
            "--task",
            task_description,
            "--auto-approve",  # Skip human review for autonomous mode
        ]

        logger.info(f"Running spec pipeline: {' '.join(cmd[:5])}...")

        try:
            # Run subprocess with timeout (use session time limit as max)
            # Note: Actual task execution time is tracked separately
            timeout_seconds = max(1800, self.guardrails.session_time_limit_minutes * 60)

            process = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=self.project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            self._current_subprocess = process

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout_seconds,
                )

                if process.returncode == 0:
                    # Extract spec ID from output
                    output = stdout.decode("utf-8", errors="replace")
                    spec_id = self._extract_spec_id(output)
                    if spec_id:
                        logger.info(f"Spec pipeline completed: {spec_id}")
                        return spec_id
                    else:
                        logger.warning("Spec pipeline completed but no spec ID found")
                        return None
                else:
                    stderr_text = stderr.decode("utf-8", errors="replace")
                    logger.error(f"Spec pipeline failed: {stderr_text[:500]}")
                    return None

            except asyncio.TimeoutError:
                logger.error("Spec pipeline timed out")
                process.kill()
                await process.wait()
                return None

        except Exception as e:
            logger.error(f"Spec pipeline error: {e}")
            return None

        finally:
            self._current_subprocess = None

    def _extract_spec_id(self, output: str) -> str | None:
        """
        Extract spec ID from pipeline output.

        Looks for patterns like:
        - "Spec directory: .auto-claude/specs/001-feature-name"
        - "spec_dir=str(orchestrator.spec_dir)"

        Args:
            output: Pipeline output text

        Returns:
            Spec ID if found, None otherwise
        """
        import re

        # Look for spec directory in output
        patterns = [
            r"specs[/\\]([0-9]{3}-[a-zA-Z0-9-]+)",
            r"Spec:\s*([0-9]{3}-[a-zA-Z0-9-]+)",
            r"spec_dir.*[/\\]([0-9]{3}-[a-zA-Z0-9-]+)",
        ]

        for pattern in patterns:
            match = re.search(pattern, output)
            if match:
                return match.group(1)

        return None

    # =========================================================================
    # Status Synchronization
    # =========================================================================

    async def _update_task_status_in_progress(self, task: AutonomousTask) -> None:
        """
        Update external status when task starts.

        For GitHub issues: Remove 'ready' label, add 'in-progress' label
        For Roadmap features: Update status to 'in_progress'
        """
        try:
            if task.source == TaskSource.GITHUB_ISSUE:
                issue_number = int(task.external_id) if task.external_id else None
                if issue_number:
                    await self.issue_fetcher.mark_in_progress(issue_number)
                    logger.info(f"Updated GitHub issue #{issue_number} to in-progress")

            elif task.source == TaskSource.ROADMAP_FEATURE:
                feature_id = task.external_id
                if feature_id:
                    self.feature_fetcher.mark_in_progress(feature_id)
                    logger.info(f"Updated roadmap feature '{feature_id}' to in_progress")

        except Exception as e:
            logger.warning(f"Failed to update task status to in-progress: {e}")

    async def _update_task_status_completed(
        self,
        task: AutonomousTask,
        spec_id: str | None = None,
    ) -> None:
        """
        Update external status when task completes.

        For GitHub issues: Remove 'in-progress' label, add 'completed' label
        For Roadmap features: Update status to 'done'
        """
        try:
            if task.source == TaskSource.GITHUB_ISSUE:
                issue_number = int(task.external_id) if task.external_id else None
                if issue_number:
                    await self.issue_fetcher.mark_completed(issue_number)
                    logger.info(f"Updated GitHub issue #{issue_number} to completed")

            elif task.source == TaskSource.ROADMAP_FEATURE:
                feature_id = task.external_id
                if feature_id:
                    self.feature_fetcher.mark_done(feature_id, linked_spec_id=spec_id)
                    logger.info(f"Updated roadmap feature '{feature_id}' to done")

        except Exception as e:
            logger.warning(f"Failed to update task status to completed: {e}")

    async def _update_task_status_failed(self, task: AutonomousTask) -> None:
        """
        Update external status when task fails.

        For GitHub issues: Remove 'in-progress' label, add 'failed' label
        For Roadmap features: Update status to 'under_review'
        """
        try:
            if task.source == TaskSource.GITHUB_ISSUE:
                issue_number = int(task.external_id) if task.external_id else None
                if issue_number:
                    await self.issue_fetcher.mark_failed(issue_number)
                    logger.info(f"Updated GitHub issue #{issue_number} to failed")

            elif task.source == TaskSource.ROADMAP_FEATURE:
                feature_id = task.external_id
                if feature_id:
                    self.feature_fetcher.mark_under_review(feature_id)
                    logger.info(f"Updated roadmap feature '{feature_id}' to under_review")

        except Exception as e:
            logger.warning(f"Failed to update task status to failed: {e}")

    # =========================================================================
    # Guardrail Checks
    # =========================================================================

    def _check_guardrails(self) -> tuple[bool, str | None]:
        """
        Check if any guardrails have been triggered.

        Returns:
            Tuple of (should_continue, reason_if_not)
        """
        # Check consecutive failures
        if self.stats.consecutive_failures >= self.guardrails.max_consecutive_failures:
            return False, "max_consecutive_failures"

        # Check session time limit
        elapsed_minutes = self.stats.elapsed_time_minutes()
        if elapsed_minutes >= self.guardrails.session_time_limit_minutes:
            return False, "session_time_limit"

        # Check token budget (if configured)
        if self.guardrails.token_budget:
            if self.stats.tokens_used >= self.guardrails.token_budget:
                return False, "token_budget"

        return True, None

    # =========================================================================
    # Main Loop
    # =========================================================================

    async def start(self) -> None:
        """
        Start the autonomous runner main loop.

        Continuously fetches tasks, executes them, and respects guardrails.
        """
        if self.state == RunnerState.RUNNING:
            logger.warning("Runner is already running")
            return

        self.state = RunnerState.RUNNING
        self.stats = SessionStats()  # Reset stats for new session

        logger.info("Autonomous runner started")
        emit_event("started", settings=self.guardrails.to_dict())

        try:
            while self.state == RunnerState.RUNNING and not self._shutdown_event.is_set():
                # Check guardrails
                should_continue, guardrail_reason = self._check_guardrails()
                if not should_continue:
                    logger.warning(f"Guardrail triggered: {guardrail_reason}")
                    emit_event(
                        "guardrail_triggered",
                        reason=guardrail_reason,
                        details=self.stats.to_dict(),
                    )
                    await self.pause(reason=f"Guardrail: {guardrail_reason}")
                    break

                # Refresh task queue
                await self._refresh_task_queue()

                # Get next task
                ready_tasks = get_ready_tasks(
                    self.task_queue,
                    completed_task_ids=self.completed_task_ids,
                )

                if not ready_tasks:
                    logger.info("No tasks available, waiting for next poll...")
                    emit_event("idle", message="No tasks available")

                    # Wait for poll interval or shutdown signal
                    try:
                        await asyncio.wait_for(
                            self._shutdown_event.wait(),
                            timeout=self.guardrails.poll_interval_seconds,
                        )
                        # Shutdown was requested
                        break
                    except asyncio.TimeoutError:
                        # Poll interval elapsed, continue loop
                        continue

                # Execute highest priority task
                next_task = ready_tasks[0]
                success = await self._execute_task(next_task)

                # Brief pause between tasks
                if not self._shutdown_event.is_set():
                    await asyncio.sleep(1)

        except Exception as e:
            logger.error(f"Runner error: {e}")
            emit_event("error", message=str(e))

        finally:
            await self._cleanup()

    async def stop(self) -> None:
        """
        Stop the autonomous runner gracefully.

        Waits for current task to complete before stopping.
        """
        if self.state in (RunnerState.STOPPED, RunnerState.STOPPING):
            return

        logger.info("Stopping autonomous runner...")
        self.state = RunnerState.STOPPING
        self._shutdown_event.set()

        # Wait for current task if any
        if self.current_task:
            logger.info("Waiting for current task to complete...")
            # Give current task some time to complete gracefully
            await asyncio.sleep(5)

            # If still running, kill the subprocess
            if self._current_subprocess and self._current_subprocess.poll() is None:
                logger.warning("Killing current task subprocess...")
                self._current_subprocess.kill()

    async def pause(self, reason: str = "manual") -> None:
        """
        Pause the autonomous runner.

        Args:
            reason: Reason for pausing
        """
        if self.state != RunnerState.RUNNING:
            return

        logger.info(f"Pausing autonomous runner: {reason}")
        self.state = RunnerState.PAUSED
        emit_event("paused", reason=reason, stats=self.stats.to_dict())

    async def resume(self) -> None:
        """
        Resume the autonomous runner from paused state.
        """
        if self.state != RunnerState.PAUSED:
            logger.warning("Cannot resume: runner is not paused")
            return

        logger.info("Resuming autonomous runner...")
        self.state = RunnerState.RUNNING
        emit_event("resumed")

        # Continue main loop (caller should await start() again)

    async def _cleanup(self) -> None:
        """
        Clean up resources and emit final statistics.
        """
        self.state = RunnerState.STOPPED
        logger.info("Autonomous runner stopped")
        emit_event("stopped", stats=self.stats.to_dict())


# ============================================
# Signal Handlers
# ============================================


def setup_signal_handlers(runner: AutonomousRunner) -> None:
    """
    Set up signal handlers for graceful shutdown.

    Args:
        runner: The autonomous runner instance
    """

    def signal_handler(sig, frame):
        logger.info(f"Received signal {sig}, initiating graceful shutdown...")
        asyncio.create_task(runner.stop())

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)


# ============================================
# CLI Entry Point
# ============================================


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Autonomous Runner - Execute tasks from GitHub Issues and Roadmap",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path.cwd(),
        help="Project directory (default: current directory)",
    )

    parser.add_argument(
        "--repository",
        type=str,
        default=None,
        help="Repository in owner/repo format (default: auto-detect)",
    )

    parser.add_argument(
        "--max-failures",
        type=int,
        default=3,
        help="Maximum consecutive failures before auto-pause (1-5, default: 3)",
    )

    parser.add_argument(
        "--session-time-limit",
        type=int,
        default=240,
        help="Session time limit in minutes (60-480, default: 240)",
    )

    parser.add_argument(
        "--poll-interval",
        type=int,
        default=60,
        help="Task polling interval in seconds (30+, default: 60)",
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    return parser.parse_args()


async def main():
    """Main entry point for autonomous runner."""
    args = parse_args()

    # Configure logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stderr,  # Log to stderr, events to stdout
    )

    # Create guardrail config
    guardrails = GuardrailConfig(
        max_consecutive_failures=args.max_failures,
        session_time_limit_minutes=args.session_time_limit,
        poll_interval_seconds=args.poll_interval,
    )

    # Create runner
    runner = AutonomousRunner(
        project_dir=args.project_dir,
        guardrails=guardrails,
        repository=args.repository,
    )

    # Set up signal handlers
    setup_signal_handlers(runner)

    # Start runner
    await runner.start()


if __name__ == "__main__":
    asyncio.run(main())
