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
    {"event": "status_synced", "task_id": "...", "source": "github_issue|roadmap_feature",
        "from_status": "...", "to_status": "..."}
    {"event": "status_sync_failed", "operation": "...", "error": "..."}
    {"event": "status_sync_rate_limited", "operation": "...", "error": "..."}
    {"event": "guardrail_triggered", "reason": "max_failures", "details": {...}}
    {"event": "paused", "reason": "..."}
    {"event": "stopped", "stats": {...}}
"""

from __future__ import annotations

import argparse
import asyncio
import errno
import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
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
from runners.github.gh_client import GHClient, GHCommandError, GHTimeoutError

# Configure logger
logger = logging.getLogger(__name__)


# ============================================
# PR Creation Error
# ============================================


class PRCreationError(Exception):
    """Raised when PR creation fails."""

    pass


class AuthenticationError(Exception):
    """Raised when GitHub authentication fails or expires (401 errors)."""

    pass


class CriticalSystemError(Exception):
    """Raised for critical system errors (disk full, out of memory, etc.)."""

    pass


class DependencyCycleError(Exception):
    """Raised when a dependency cycle is detected."""

    def __init__(self, cycle: list[str], message: str = "Dependency cycle detected"):
        self.cycle = cycle
        super().__init__(f"{message}: {' -> '.join(cycle)}")


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

        # GitHub client for PR creation
        self.gh_client = GHClient(project_dir=self.project_dir)

        # Shutdown control
        self._shutdown_event = asyncio.Event()
        self._current_subprocess: subprocess.Popen | None = None

        # Auto-detect repository if not provided
        if not self.repository:
            self.repository = self._detect_repository()

        # Track base branch for PR creation
        self._base_branch: str | None = None

        # Rate limit tracking
        self._rate_limit_reset_time: datetime | None = None
        self._rate_limit_backoff_seconds: float = 60.0  # Initial backoff

        # Blocked tasks due to dependency cycles
        self._blocked_task_ids: set[str] = set()

        # Track original branch for rollback
        self._original_branch: str | None = None

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
    # Edge Case Handling
    # =========================================================================

    async def _handle_rate_limit(
        self,
        error: Exception,
        operation: str = "unknown",
    ) -> bool:
        """
        Handle GitHub API rate limiting with exponential backoff.

        Implements exponential backoff with jitter:
        - First hit: wait 60s
        - Subsequent hits: double the wait time up to 15 minutes
        - Jitter added to prevent thundering herd

        Args:
            error: The rate limit exception
            operation: Description of the operation that was rate limited

        Returns:
            True if we should retry, False if we should pause the queue
        """
        import random

        now = datetime.now(timezone.utc)

        # Check if we're already in a rate limit cooldown period
        if self._rate_limit_reset_time and now < self._rate_limit_reset_time:
            wait_seconds = (self._rate_limit_reset_time - now).total_seconds()
            logger.info(
                f"Rate limit cooldown active, waiting {wait_seconds:.0f}s "
                f"until {self._rate_limit_reset_time.isoformat()}"
            )
            emit_event(
                "rate_limit_wait",
                operation=operation,
                wait_seconds=wait_seconds,
                reset_time=self._rate_limit_reset_time.isoformat(),
            )
            await asyncio.sleep(wait_seconds)
            return True

        # Apply exponential backoff with jitter
        jitter = random.uniform(0.8, 1.2)
        wait_seconds = self._rate_limit_backoff_seconds * jitter

        # Cap at 15 minutes
        max_backoff = 900.0
        if wait_seconds > max_backoff:
            wait_seconds = max_backoff

        logger.warning(
            f"Rate limit exceeded during {operation}. "
            f"Backing off for {wait_seconds:.0f}s (backoff: {self._rate_limit_backoff_seconds:.0f}s)"
        )

        # Update rate limit tracking
        self._rate_limit_reset_time = now + timedelta(seconds=wait_seconds)

        # Double the backoff for next time (up to max)
        self._rate_limit_backoff_seconds = min(
            self._rate_limit_backoff_seconds * 2,
            max_backoff,
        )

        emit_event(
            "rate_limit_backoff",
            operation=operation,
            error=str(error),
            wait_seconds=wait_seconds,
            next_backoff_seconds=self._rate_limit_backoff_seconds,
            reset_time=self._rate_limit_reset_time.isoformat(),
        )

        # If backoff exceeds threshold, pause the queue
        if self._rate_limit_backoff_seconds >= max_backoff:
            logger.error("Rate limit backoff exceeded maximum. Pausing queue.")
            emit_event(
                "guardrail_triggered",
                reason="rate_limit_max_backoff",
                details={
                    "operation": operation,
                    "wait_seconds": wait_seconds,
                },
            )
            await self.pause(reason="Rate limit - maximum backoff exceeded")
            return False

        await asyncio.sleep(wait_seconds)
        return True

    def _reset_rate_limit_backoff(self) -> None:
        """Reset rate limit backoff after successful operations."""
        if self._rate_limit_backoff_seconds > 60.0:
            logger.debug(
                f"Resetting rate limit backoff from {self._rate_limit_backoff_seconds}s to 60s"
            )
        self._rate_limit_backoff_seconds = 60.0
        self._rate_limit_reset_time = None

    def _detect_auth_error(self, error: Exception) -> bool:
        """
        Detect if an error is due to authentication failure.

        Checks for 401 Unauthorized errors which indicate:
        - Expired GitHub token
        - Invalid credentials
        - Missing authentication

        Args:
            error: The exception to check

        Returns:
            True if this is an authentication error
        """
        error_str = str(error).lower()
        auth_indicators = [
            "401",
            "unauthorized",
            "authentication failed",
            "auth required",
            "bad credentials",
            "token expired",
            "invalid token",
            "not logged in",
            "gh auth login",
        ]
        return any(indicator in error_str for indicator in auth_indicators)

    async def _handle_auth_error(self, error: Exception) -> None:
        """
        Handle authentication errors by pausing and notifying.

        When authentication fails, the queue is paused and the user
        needs to re-authenticate using `gh auth login`.

        Args:
            error: The authentication error
        """
        logger.error(f"GitHub authentication error: {error}")
        emit_event(
            "auth_error",
            error=str(error),
            action_required="Run 'gh auth login' to re-authenticate",
        )
        emit_event(
            "guardrail_triggered",
            reason="auth_failure",
            details={
                "error": str(error),
                "action": "gh auth login",
            },
        )
        await self.pause(reason="Authentication failed - run 'gh auth login'")
        raise AuthenticationError(str(error))

    def _detect_dependency_cycles(
        self,
        tasks: list[AutonomousTask],
    ) -> list[list[str]]:
        """
        Detect circular dependencies in task list using DFS.

        Implements Tarjan's algorithm variant to find all cycles.

        Args:
            tasks: List of tasks to check

        Returns:
            List of cycles found (each cycle is a list of task IDs)
        """
        # Build dependency graph
        task_map = {task.id: task for task in tasks}
        cycles: list[list[str]] = []

        # Track visited states
        WHITE = 0  # Not visited
        GRAY = 1   # In current DFS path
        BLACK = 2  # Finished processing

        color: dict[str, int] = {task_id: WHITE for task_id in task_map}
        path: list[str] = []

        def dfs(task_id: str) -> None:
            """DFS to detect cycles."""
            if task_id not in task_map:
                return

            if color[task_id] == BLACK:
                return

            if color[task_id] == GRAY:
                # Found a cycle - extract it from path
                cycle_start = path.index(task_id)
                cycle = path[cycle_start:] + [task_id]
                cycles.append(cycle)
                return

            color[task_id] = GRAY
            path.append(task_id)

            # Visit dependencies
            task = task_map[task_id]
            for dep_id in task.dependencies:
                dfs(dep_id)

            path.pop()
            color[task_id] = BLACK

        # Run DFS from each unvisited node
        for task_id in task_map:
            if color[task_id] == WHITE:
                dfs(task_id)

        return cycles

    def _handle_dependency_cycles(
        self,
        tasks: list[AutonomousTask],
    ) -> list[AutonomousTask]:
        """
        Detect and handle dependency cycles.

        Cycles are detected and affected tasks are marked as blocked.
        Returns list of tasks with cycle participants excluded.

        Args:
            tasks: List of tasks to process

        Returns:
            List of tasks without cycle participants
        """
        cycles = self._detect_dependency_cycles(tasks)

        if not cycles:
            return tasks

        # Collect all task IDs involved in cycles
        cycle_task_ids: set[str] = set()
        for cycle in cycles:
            cycle_task_ids.update(cycle)
            # Log the cycle
            cycle_str = " -> ".join(cycle)
            logger.warning(f"Dependency cycle detected: {cycle_str}")
            emit_event(
                "dependency_cycle",
                cycle=cycle,
                message=f"Tasks blocked due to circular dependency: {cycle_str}",
            )

        # Add to blocked set
        self._blocked_task_ids.update(cycle_task_ids)

        # Filter out blocked tasks
        filtered_tasks = [
            task for task in tasks if task.id not in cycle_task_ids
        ]

        # Emit summary
        if cycle_task_ids:
            emit_event(
                "tasks_blocked",
                count=len(cycle_task_ids),
                task_ids=list(cycle_task_ids),
                reason="dependency_cycle",
            )

        return filtered_tasks

    def _detect_critical_error(self, error: Exception) -> bool:
        """
        Detect critical system errors that require immediate pause.

        Checks for:
        - Disk full (ENOSPC)
        - Out of memory
        - Network unreachable
        - Permission denied (on critical paths)

        Args:
            error: The exception to check

        Returns:
            True if this is a critical system error
        """
        error_str = str(error).lower()

        # Check for errno-based errors
        if isinstance(error, OSError):
            critical_errnos = [
                errno.ENOSPC,  # No space left on device
                errno.ENOMEM,  # Out of memory
                errno.ENETUNREACH,  # Network unreachable
                errno.EHOSTUNREACH,  # Host unreachable
                errno.ECONNREFUSED,  # Connection refused
            ]
            if error.errno in critical_errnos:
                return True

        # Check error message patterns
        critical_patterns = [
            "no space left",
            "disk full",
            "out of memory",
            "cannot allocate",
            "memory exhausted",
            "network is unreachable",
            "host is down",
            "connection timed out",
            "permission denied",
        ]
        return any(pattern in error_str for pattern in critical_patterns)

    async def _handle_critical_error(self, error: Exception) -> None:
        """
        Handle critical system errors by pausing and preserving state.

        Attempts to:
        1. Save current queue state
        2. Emit critical alert
        3. Pause the queue

        Args:
            error: The critical error
        """
        logger.critical(f"Critical system error: {error}")

        # Attempt to save queue state
        try:
            await self._save_queue_state()
        except Exception as save_error:
            logger.error(f"Failed to save queue state: {save_error}")

        # Emit critical alert
        emit_event(
            "critical_error",
            error=str(error),
            error_type=type(error).__name__,
            stats=self.stats.to_dict(),
        )

        emit_event(
            "guardrail_triggered",
            reason="critical_error",
            details={
                "error": str(error),
                "error_type": type(error).__name__,
            },
        )

        await self.pause(reason=f"Critical error: {type(error).__name__}")
        raise CriticalSystemError(str(error))

    async def _save_queue_state(self) -> None:
        """
        Save current queue state for recovery.

        Saves to .auto-claude/autonomous_queue_state.json
        """
        state_dir = self.project_dir / ".auto-claude"
        state_file = state_dir / "autonomous_queue_state.json"

        try:
            state_dir.mkdir(parents=True, exist_ok=True)

            state = {
                "saved_at": datetime.now(timezone.utc).isoformat(),
                "state": self.state.value,
                "stats": self.stats.to_dict(),
                "current_task": self.current_task.to_dict() if self.current_task else None,
                "queue": [task.to_dict() for task in self.task_queue],
                "completed_task_ids": list(self.completed_task_ids),
                "blocked_task_ids": list(self._blocked_task_ids),
            }

            # Write atomically
            temp_file = state_file.with_suffix(".tmp")
            temp_file.write_text(json.dumps(state, indent=2))
            temp_file.rename(state_file)

            logger.info(f"Queue state saved to {state_file}")
            emit_event(
                "queue_state_saved",
                file=str(state_file),
                task_count=len(self.task_queue),
            )

        except Exception as e:
            logger.error(f"Failed to save queue state: {e}")
            raise

    async def _check_disk_space(self, min_bytes: int = 100 * 1024 * 1024) -> bool:
        """
        Check if sufficient disk space is available.

        Args:
            min_bytes: Minimum required free space (default: 100MB)

        Returns:
            True if sufficient space, False otherwise
        """
        try:
            usage = shutil.disk_usage(self.project_dir)
            if usage.free < min_bytes:
                logger.warning(
                    f"Low disk space: {usage.free / (1024*1024):.1f}MB free, "
                    f"need {min_bytes / (1024*1024):.1f}MB"
                )
                emit_event(
                    "warning",
                    source="system",
                    message=f"Low disk space: {usage.free / (1024*1024):.1f}MB free",
                )
                return False
            return True
        except Exception as e:
            logger.warning(f"Failed to check disk space: {e}")
            return True  # Assume OK if check fails

    async def _rollback_task_changes(self, task: AutonomousTask) -> bool:
        """
        Rollback any uncommitted changes from a failed task.

        Attempts to:
        1. Discard any uncommitted changes (git checkout .)
        2. Return to base branch if we switched

        Args:
            task: The failed task

        Returns:
            True if rollback succeeded, False otherwise
        """
        try:
            logger.info(f"Rolling back changes for failed task: {task.id}")

            # Check for uncommitted changes
            result = await asyncio.create_subprocess_exec(
                "git", "status", "--porcelain",
                cwd=self.project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await result.communicate()

            if stdout.strip():
                # Discard all uncommitted changes
                logger.info("Discarding uncommitted changes...")
                result = await asyncio.create_subprocess_exec(
                    "git", "checkout", ".",
                    cwd=self.project_dir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await result.communicate()

                # Also clean untracked files
                result = await asyncio.create_subprocess_exec(
                    "git", "clean", "-fd",
                    cwd=self.project_dir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await result.communicate()

            # Return to base branch if we're on a task branch
            current_branch = await self._get_current_branch()
            if current_branch and current_branch.startswith("auto-claude/"):
                base_branch = await self._get_base_branch()
                logger.info(f"Returning to base branch: {base_branch}")
                result = await asyncio.create_subprocess_exec(
                    "git", "checkout", base_branch,
                    cwd=self.project_dir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await result.communicate()

            emit_event(
                "task_rollback",
                task_id=task.id,
                success=True,
            )
            logger.info(f"Rollback completed for task: {task.id}")
            return True

        except Exception as e:
            logger.error(f"Rollback failed for task {task.id}: {e}")
            emit_event(
                "task_rollback",
                task_id=task.id,
                success=False,
                error=str(e),
            )
            return False

    # =========================================================================
    # Task Fetching
    # =========================================================================

    async def _fetch_github_issues(self) -> list[AutonomousTask]:
        """
        Fetch GitHub issues with 'auto-claude-ready' label.

        Handles:
        - Rate limiting with exponential backoff
        - Authentication errors (401)
        - Critical system errors

        Returns:
            List of AutonomousTask objects from GitHub issues
        """
        tasks = []
        max_retries = 3

        for attempt in range(max_retries):
            try:
                issues = await self.issue_fetcher.fetch_ready_issues()
                for issue in issues:
                    task = create_task_from_github_issue(
                        issue=issue,
                        repository=self.repository or "unknown/unknown",
                    )
                    tasks.append(task)
                logger.info(f"Fetched {len(tasks)} tasks from GitHub issues")

                # Reset rate limit backoff on success
                self._reset_rate_limit_backoff()
                return tasks

            except RateLimitExceeded as e:
                logger.warning(f"GitHub rate limit exceeded: {e}")
                should_retry = await self._handle_rate_limit(e, "fetch_github_issues")
                if not should_retry:
                    return tasks
                # Retry on next loop iteration

            except IssueFetchError as e:
                # Check for auth errors
                if self._detect_auth_error(e):
                    await self._handle_auth_error(e)
                    return tasks

                # Check for critical errors
                if self._detect_critical_error(e):
                    await self._handle_critical_error(e)
                    return tasks

                logger.warning(f"Failed to fetch GitHub issues: {e}")
                emit_event("warning", source="github", message=str(e))
                return tasks

            except Exception as e:
                # Check for auth errors
                if self._detect_auth_error(e):
                    await self._handle_auth_error(e)
                    return tasks

                # Check for critical errors
                if self._detect_critical_error(e):
                    await self._handle_critical_error(e)
                    return tasks

                logger.warning(f"Unexpected error fetching GitHub issues: {e}")
                emit_event("warning", source="github", message=str(e))
                return tasks

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

        Performs:
        - Deduplication of tasks
        - Dependency cycle detection
        - Priority-based sorting
        - Disk space check before processing
        """
        logger.info("Refreshing task queue...")

        # Pre-flight check: disk space
        has_space = await self._check_disk_space()
        if not has_space:
            emit_event(
                "warning",
                source="system",
                message="Low disk space - proceeding with caution",
            )

        # Fetch from both sources
        github_tasks = await self._fetch_github_issues()
        roadmap_tasks = self._fetch_roadmap_features()

        # Combine and deduplicate
        all_tasks = github_tasks + roadmap_tasks
        task_map = {task.id: task for task in all_tasks}

        # Remove already completed tasks
        for completed_id in self.completed_task_ids:
            task_map.pop(completed_id, None)

        # Remove previously blocked tasks
        for blocked_id in self._blocked_task_ids:
            task_map.pop(blocked_id, None)

        # Detect and handle dependency cycles
        tasks_list = list(task_map.values())
        tasks_list = self._handle_dependency_cycles(tasks_list)

        # Sort by priority
        self.task_queue = sort_tasks_by_priority(
            tasks_list,
            completed_task_ids=self.completed_task_ids,
        )

        logger.info(f"Task queue refreshed: {len(self.task_queue)} tasks available")
        if self._blocked_task_ids:
            logger.info(f"Blocked tasks: {len(self._blocked_task_ids)} (dependency cycles)")

        emit_event(
            "queue_updated",
            count=len(self.task_queue),
            blocked_count=len(self._blocked_task_ids),
        )

    # =========================================================================
    # Task Execution
    # =========================================================================

    async def _execute_task(self, task: AutonomousTask) -> bool:
        """
        Execute a single task through the spec_runner.py -> run.py pipeline.

        Includes:
        - Pre-flight disk space check
        - Error categorization (auth, rate limit, critical)
        - Rollback on failure
        - Status synchronization with retry

        Args:
            task: Task to execute

        Returns:
            True if successful, False otherwise
        """
        logger.info(f"Starting task execution: {task.id} - {task.title}")

        # Pre-flight check: disk space
        has_space = await self._check_disk_space()
        if not has_space:
            task.mark_failed("Insufficient disk space")
            self.stats.record_failure()
            emit_event(
                "task_failed",
                task=task.to_dict(),
                error="Insufficient disk space",
            )
            return False

        # Save original branch for potential rollback
        self._original_branch = await self._get_current_branch()

        task.mark_in_progress()
        self.current_task = task

        emit_event("task_started", task=task.to_dict())

        try:
            # Update external status (GitHub label or roadmap status)
            await self._update_task_status_in_progress(task)

            # Generate spec and execute pipeline
            spec_id = await self._run_spec_pipeline(task)

            if spec_id:
                # Pipeline completed successfully, now create PR
                pr_url = await self._create_pr_for_task(task, spec_id)

                # Task completed successfully (PR creation is optional)
                task.mark_completed(spec_id=spec_id, pull_request_url=pr_url)
                self.completed_task_ids.add(task.id)
                self.stats.record_success()

                # Reset rate limit backoff on successful task
                self._reset_rate_limit_backoff()

                # Update external status (bidirectional sync)
                await self._update_task_status_completed(task, spec_id)

                # Add completion comment to GitHub issue
                await self._add_comment_on_completion(task, spec_id=spec_id, pr_url=pr_url)

                emit_event(
                    "task_completed",
                    task=task.to_dict(),
                    spec_id=spec_id,
                    pr_url=pr_url,
                )
                return True
            else:
                # Task failed - rollback any changes
                await self._rollback_task_changes(task)

                task.mark_failed("Pipeline execution failed")
                self.stats.record_failure()

                # Update external status (bidirectional sync)
                await self._update_task_status_failed(task)

                # Add failure comment to GitHub issue
                await self._add_comment_on_failure(task)

                emit_event(
                    "task_failed",
                    task=task.to_dict(),
                    error="Pipeline execution failed",
                )
                return False

        except RateLimitExceeded as e:
            logger.warning(f"Rate limit during task execution: {e}")
            # Rollback changes
            await self._rollback_task_changes(task)

            # Handle rate limit
            should_retry = await self._handle_rate_limit(e, f"execute_task:{task.id}")

            task.mark_failed(f"Rate limit: {e}")
            self.stats.record_failure()

            emit_event(
                "task_failed",
                task=task.to_dict(),
                error=str(e),
                retryable=should_retry,
            )
            return False

        except Exception as e:
            logger.error(f"Task execution error: {e}")

            # Rollback any partial changes
            await self._rollback_task_changes(task)

            # Check for auth errors
            if self._detect_auth_error(e):
                await self._handle_auth_error(e)
                return False

            # Check for critical system errors
            if self._detect_critical_error(e):
                await self._handle_critical_error(e)
                return False

            task.mark_failed(str(e))
            self.stats.record_failure()

            # Update external status (bidirectional sync)
            try:
                await self._update_task_status_failed(task)
                await self._add_comment_on_failure(task)
            except Exception as status_error:
                logger.warning(f"Failed to update status after error: {status_error}")

            emit_event(
                "task_failed",
                task=task.to_dict(),
                error=str(e),
            )
            return False

        finally:
            self.current_task = None
            self._original_branch = None

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

    async def _sync_status_with_retry(
        self,
        operation: str,
        sync_func,
        *args,
        max_retries: int = 2,
        retry_delay: float = 1.0,
        **kwargs,
    ) -> bool:
        """
        Execute a status sync operation with retry logic.

        Args:
            operation: Description of the operation for logging
            sync_func: The sync function to call (can be async or sync)
            *args: Positional arguments for sync_func
            max_retries: Maximum retry attempts
            retry_delay: Delay between retries in seconds
            **kwargs: Keyword arguments for sync_func

        Returns:
            True if sync succeeded, False otherwise
        """
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                # Check if function is async or sync
                import asyncio
                if asyncio.iscoroutinefunction(sync_func):
                    await sync_func(*args, **kwargs)
                else:
                    sync_func(*args, **kwargs)
                return True
            except RateLimitExceeded as e:
                # Don't retry on rate limit - propagate up
                logger.warning(f"Rate limit exceeded during {operation}: {e}")
                emit_event(
                    "status_sync_rate_limited",
                    operation=operation,
                    error=str(e),
                )
                raise
            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    logger.debug(
                        f"Retry {attempt + 1}/{max_retries} for {operation}: {e}"
                    )
                    await asyncio.sleep(retry_delay * (attempt + 1))  # Exponential backoff
                else:
                    logger.warning(f"Failed {operation} after {max_retries + 1} attempts: {e}")

        # Emit failure event
        emit_event(
            "status_sync_failed",
            operation=operation,
            error=str(last_error) if last_error else "Unknown error",
        )
        return False

    async def _update_task_status_in_progress(self, task: AutonomousTask) -> bool:
        """
        Update external status when task starts.

        For GitHub issues: Remove 'ready' label, add 'in-progress' label
        For Roadmap features: Update status to 'in_progress'

        Returns:
            True if sync succeeded, False otherwise
        """
        if task.source == TaskSource.GITHUB_ISSUE:
            issue_number = int(task.external_id) if task.external_id else None
            if not issue_number:
                logger.warning(f"No issue number for task {task.id}, skipping status sync")
                return False

            success = await self._sync_status_with_retry(
                operation=f"mark GitHub issue #{issue_number} in-progress",
                sync_func=self.issue_fetcher.mark_in_progress,
                issue_number=issue_number,
            )

            if success:
                logger.info(f"Updated GitHub issue #{issue_number}: ready -> in-progress")
                emit_event(
                    "status_synced",
                    task_id=task.id,
                    source="github_issue",
                    external_id=str(issue_number),
                    from_status="ready",
                    to_status="in-progress",
                )
            return success

        elif task.source == TaskSource.ROADMAP_FEATURE:
            feature_id = task.external_id
            if not feature_id:
                logger.warning(f"No feature ID for task {task.id}, skipping status sync")
                return False

            success = await self._sync_status_with_retry(
                operation=f"mark roadmap feature '{feature_id}' in_progress",
                sync_func=self.feature_fetcher.mark_in_progress,
                feature_id=feature_id,
            )

            if success:
                logger.info(f"Updated roadmap feature '{feature_id}': planned -> in_progress")
                emit_event(
                    "status_synced",
                    task_id=task.id,
                    source="roadmap_feature",
                    external_id=feature_id,
                    from_status="planned",
                    to_status="in_progress",
                )
            return success

        return False

    async def _update_task_status_completed(
        self,
        task: AutonomousTask,
        spec_id: str | None = None,
    ) -> bool:
        """
        Update external status when task completes.

        For GitHub issues: Remove 'in-progress' label, add 'completed' label
        For Roadmap features: Update status to 'done'

        Returns:
            True if sync succeeded, False otherwise
        """
        if task.source == TaskSource.GITHUB_ISSUE:
            issue_number = int(task.external_id) if task.external_id else None
            if not issue_number:
                logger.warning(f"No issue number for task {task.id}, skipping status sync")
                return False

            success = await self._sync_status_with_retry(
                operation=f"mark GitHub issue #{issue_number} completed",
                sync_func=self.issue_fetcher.mark_completed,
                issue_number=issue_number,
            )

            if success:
                logger.info(f"Updated GitHub issue #{issue_number}: in-progress -> completed")
                emit_event(
                    "status_synced",
                    task_id=task.id,
                    source="github_issue",
                    external_id=str(issue_number),
                    from_status="in-progress",
                    to_status="completed",
                    spec_id=spec_id,
                )
            return success

        elif task.source == TaskSource.ROADMAP_FEATURE:
            feature_id = task.external_id
            if not feature_id:
                logger.warning(f"No feature ID for task {task.id}, skipping status sync")
                return False

            success = await self._sync_status_with_retry(
                operation=f"mark roadmap feature '{feature_id}' done",
                sync_func=self.feature_fetcher.mark_done,
                feature_id=feature_id,
                linked_spec_id=spec_id,
            )

            if success:
                logger.info(f"Updated roadmap feature '{feature_id}': in_progress -> done")
                emit_event(
                    "status_synced",
                    task_id=task.id,
                    source="roadmap_feature",
                    external_id=feature_id,
                    from_status="in_progress",
                    to_status="done",
                    spec_id=spec_id,
                )
            return success

        return False

    async def _update_task_status_failed(self, task: AutonomousTask) -> bool:
        """
        Update external status when task fails.

        For GitHub issues: Remove 'in-progress' label, add 'failed' label
        For Roadmap features: Update status to 'under_review'

        Returns:
            True if sync succeeded, False otherwise
        """
        if task.source == TaskSource.GITHUB_ISSUE:
            issue_number = int(task.external_id) if task.external_id else None
            if not issue_number:
                logger.warning(f"No issue number for task {task.id}, skipping status sync")
                return False

            success = await self._sync_status_with_retry(
                operation=f"mark GitHub issue #{issue_number} failed",
                sync_func=self.issue_fetcher.mark_failed,
                issue_number=issue_number,
            )

            if success:
                logger.info(f"Updated GitHub issue #{issue_number}: in-progress -> failed")
                emit_event(
                    "status_synced",
                    task_id=task.id,
                    source="github_issue",
                    external_id=str(issue_number),
                    from_status="in-progress",
                    to_status="failed",
                    error=task.error_message,
                )
            return success

        elif task.source == TaskSource.ROADMAP_FEATURE:
            feature_id = task.external_id
            if not feature_id:
                logger.warning(f"No feature ID for task {task.id}, skipping status sync")
                return False

            success = await self._sync_status_with_retry(
                operation=f"mark roadmap feature '{feature_id}' under_review",
                sync_func=self.feature_fetcher.mark_under_review,
                feature_id=feature_id,
            )

            if success:
                logger.info(f"Updated roadmap feature '{feature_id}': in_progress -> under_review")
                emit_event(
                    "status_synced",
                    task_id=task.id,
                    source="roadmap_feature",
                    external_id=feature_id,
                    from_status="in_progress",
                    to_status="under_review",
                    error=task.error_message,
                )
            return success

        return False

    async def _add_comment_on_completion(
        self,
        task: AutonomousTask,
        spec_id: str | None = None,
        pr_url: str | None = None,
    ) -> bool:
        """
        Add a completion comment to GitHub issue with details.

        Args:
            task: The completed task
            spec_id: The generated spec ID
            pr_url: The PR URL if created

        Returns:
            True if comment was added successfully
        """
        if task.source != TaskSource.GITHUB_ISSUE:
            return False

        issue_number = int(task.external_id) if task.external_id else None
        if not issue_number:
            return False

        # Build comment body
        lines = [
            "## 🤖 Auto Claude - Task Completed",
            "",
            f"This issue has been automatically processed by Auto Claude.",
            "",
        ]

        if spec_id:
            lines.extend([
                f"**Specification:** `{spec_id}`",
                "",
            ])

        if pr_url:
            lines.extend([
                f"**Pull Request:** {pr_url}",
                "",
            ])

        if task.get_duration_ms():
            duration_mins = task.get_duration_ms() / 60000
            lines.extend([
                f"**Duration:** {duration_mins:.1f} minutes",
                "",
            ])

        lines.extend([
            "---",
            "_Please review the changes and merge when ready._",
        ])

        comment_body = "\n".join(lines)

        try:
            await self.issue_fetcher.add_comment(issue_number, comment_body)
            logger.info(f"Added completion comment to GitHub issue #{issue_number}")
            return True
        except Exception as e:
            logger.warning(f"Failed to add comment to issue #{issue_number}: {e}")
            return False

    async def _add_comment_on_failure(
        self,
        task: AutonomousTask,
    ) -> bool:
        """
        Add a failure comment to GitHub issue with error details.

        Args:
            task: The failed task

        Returns:
            True if comment was added successfully
        """
        if task.source != TaskSource.GITHUB_ISSUE:
            return False

        issue_number = int(task.external_id) if task.external_id else None
        if not issue_number:
            return False

        # Build comment body
        lines = [
            "## ⚠️ Auto Claude - Task Failed",
            "",
            "Auto Claude encountered an error while processing this issue.",
            "",
        ]

        if task.error_message:
            # Truncate error message if too long
            error_msg = task.error_message[:500]
            if len(task.error_message) > 500:
                error_msg += "..."
            lines.extend([
                "**Error:**",
                "```",
                error_msg,
                "```",
                "",
            ])

        lines.extend([
            f"**Retry Count:** {task.retry_count}/{task.max_retries}",
            "",
            "---",
            "_This issue has been marked with `auto-claude-failed` for review._",
        ])

        comment_body = "\n".join(lines)

        try:
            await self.issue_fetcher.add_comment(issue_number, comment_body)
            logger.info(f"Added failure comment to GitHub issue #{issue_number}")
            return True
        except Exception as e:
            logger.warning(f"Failed to add comment to issue #{issue_number}: {e}")
            return False

    # =========================================================================
    # PR Creation
    # =========================================================================

    async def _has_uncommitted_changes(self) -> bool:
        """
        Check if there are uncommitted changes in the repository.

        Returns:
            True if there are uncommitted changes, False otherwise
        """
        try:
            result = await asyncio.create_subprocess_exec(
                "git",
                "status",
                "--porcelain",
                cwd=self.project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await result.communicate()
            output = stdout.decode("utf-8").strip()
            return len(output) > 0
        except Exception as e:
            logger.error(f"Failed to check git status: {e}")
            return False

    async def _get_current_branch(self) -> str | None:
        """
        Get the current git branch name.

        Returns:
            Current branch name, or None if detection fails
        """
        try:
            result = await asyncio.create_subprocess_exec(
                "git",
                "rev-parse",
                "--abbrev-ref",
                "HEAD",
                cwd=self.project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await result.communicate()
            if result.returncode == 0:
                return stdout.decode("utf-8").strip()
        except Exception as e:
            logger.warning(f"Failed to get current branch: {e}")
        return None

    async def _get_base_branch(self) -> str:
        """
        Get the base branch for PR creation (main or master).

        Returns:
            Base branch name (defaults to "main")
        """
        if self._base_branch:
            return self._base_branch

        try:
            # Try to get the default branch from remote
            result = await asyncio.create_subprocess_exec(
                "git",
                "remote",
                "show",
                "origin",
                cwd=self.project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await result.communicate()
            output = stdout.decode("utf-8")

            # Parse "HEAD branch: main" from output
            for line in output.splitlines():
                if "HEAD branch:" in line:
                    self._base_branch = line.split(":")[-1].strip()
                    return self._base_branch

        except Exception as e:
            logger.warning(f"Failed to detect base branch: {e}")

        # Fallback to main
        self._base_branch = "main"
        return self._base_branch

    def _generate_branch_name(self, task: AutonomousTask) -> str:
        """
        Generate a branch name for the task.

        Naming convention:
        - GitHub issues: auto-claude/issue-{number}
        - Roadmap features: auto-claude/feature-{id}

        Args:
            task: The task to create a branch for

        Returns:
            Branch name string
        """
        if task.source == TaskSource.GITHUB_ISSUE:
            return f"auto-claude/issue-{task.external_id}"
        else:
            # Roadmap feature - sanitize the ID for branch name
            feature_id = task.external_id or task.id.replace("feature-", "")
            # Sanitize: replace spaces/special chars with hyphens
            sanitized = feature_id.lower()
            sanitized = "".join(c if c.isalnum() or c == "-" else "-" for c in sanitized)
            sanitized = sanitized.strip("-")
            # Limit length
            if len(sanitized) > 50:
                sanitized = sanitized[:50].rstrip("-")
            return f"auto-claude/feature-{sanitized}"

    def _generate_commit_message(self, task: AutonomousTask, spec_id: str | None) -> str:
        """
        Generate a commit message for the task.

        Args:
            task: The task being committed
            spec_id: The spec ID (if available)

        Returns:
            Formatted commit message
        """
        # Primary line - task title truncated to 72 chars
        title = task.title[:70] + "..." if len(task.title) > 72 else task.title

        # Reference line
        if task.source == TaskSource.GITHUB_ISSUE:
            ref = f"Closes #{task.external_id}"
        else:
            ref = f"Implements feature: {task.external_id}"

        # Build message
        lines = [
            f"auto-claude: {title}",
            "",
            ref,
            "",
        ]

        if spec_id:
            lines.append(f"Spec: {spec_id}")
            lines.append("")

        lines.extend([
            "🤖 Generated with Auto Claude",
            "",
            "Co-Authored-By: Auto Claude <noreply@anthropic.com>",
        ])

        return "\n".join(lines)

    async def _create_branch(self, branch_name: str) -> bool:
        """
        Create a new git branch and switch to it.

        Args:
            branch_name: Name of the branch to create

        Returns:
            True if successful, False otherwise
        """
        try:
            # Create and checkout new branch
            result = await asyncio.create_subprocess_exec(
                "git",
                "checkout",
                "-b",
                branch_name,
                cwd=self.project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await result.communicate()

            if result.returncode != 0:
                # Branch might already exist, try to checkout
                result = await asyncio.create_subprocess_exec(
                    "git",
                    "checkout",
                    branch_name,
                    cwd=self.project_dir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await result.communicate()

                if result.returncode != 0:
                    logger.error(f"Failed to create/checkout branch: {stderr.decode()}")
                    return False

            logger.info(f"Created/checked out branch: {branch_name}")
            return True

        except Exception as e:
            logger.error(f"Failed to create branch: {e}")
            return False

    async def _stage_and_commit(self, message: str) -> bool:
        """
        Stage all changes and create a commit.

        Args:
            message: Commit message

        Returns:
            True if successful, False otherwise
        """
        try:
            # Stage all changes
            result = await asyncio.create_subprocess_exec(
                "git",
                "add",
                "-A",
                cwd=self.project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await result.communicate()

            if result.returncode != 0:
                logger.error("Failed to stage changes")
                return False

            # Create commit
            result = await asyncio.create_subprocess_exec(
                "git",
                "commit",
                "-m",
                message,
                cwd=self.project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await result.communicate()

            if result.returncode != 0:
                error_msg = stderr.decode("utf-8")
                # Check if there's nothing to commit
                if "nothing to commit" in error_msg or "nothing to commit" in stdout.decode("utf-8"):
                    logger.warning("No changes to commit")
                    return False
                logger.error(f"Failed to commit: {error_msg}")
                return False

            logger.info("Successfully committed changes")
            return True

        except Exception as e:
            logger.error(f"Failed to stage and commit: {e}")
            return False

    async def _push_branch(self, branch_name: str) -> bool:
        """
        Push the branch to remote.

        Args:
            branch_name: Name of the branch to push

        Returns:
            True if successful, False otherwise
        """
        try:
            result = await asyncio.create_subprocess_exec(
                "git",
                "push",
                "-u",
                "origin",
                branch_name,
                cwd=self.project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await result.communicate()

            if result.returncode != 0:
                logger.error(f"Failed to push branch: {stderr.decode()}")
                return False

            logger.info(f"Successfully pushed branch: {branch_name}")
            return True

        except Exception as e:
            logger.error(f"Failed to push branch: {e}")
            return False

    def _generate_pr_body(
        self,
        task: AutonomousTask,
        spec_id: str | None,
    ) -> str:
        """
        Generate PR body with task description, spec summary, and QA results.

        Args:
            task: The task being submitted
            spec_id: The spec ID (if available)

        Returns:
            Formatted PR body markdown
        """
        lines = [
            "## Summary",
            "",
            task.description[:500] + "..." if len(task.description) > 500 else task.description,
            "",
        ]

        # Task source reference
        if task.source == TaskSource.GITHUB_ISSUE:
            lines.extend([
                "## Related Issue",
                f"Closes #{task.external_id}",
                "",
            ])
        else:
            lines.extend([
                "## Roadmap Feature",
                f"Implements: {task.external_id}",
                "",
            ])

        # Spec reference
        if spec_id:
            lines.extend([
                "## Specification",
                f"- Spec ID: `{spec_id}`",
                f"- Spec Path: `.auto-claude/specs/{spec_id}/`",
                "",
            ])

        # QA section
        lines.extend([
            "## QA Verification",
            "",
            "- [x] Automated spec generation",
            "- [x] Implementation completed",
            "- [x] QA verification passed",
            "",
        ])

        # Footer
        lines.extend([
            "---",
            "",
            "🤖 This PR was automatically generated by **Auto Claude**.",
            "",
            "_Please review the changes carefully before merging._",
        ])

        return "\n".join(lines)

    async def _create_pull_request(
        self,
        task: AutonomousTask,
        branch_name: str,
        spec_id: str | None,
    ) -> str | None:
        """
        Create a pull request using gh CLI.

        Args:
            task: The task being submitted
            branch_name: The branch to create PR from
            spec_id: The spec ID (if available)

        Returns:
            PR URL if successful, None otherwise
        """
        try:
            base_branch = await self._get_base_branch()

            # Generate PR title and body
            title = f"[Auto Claude] {task.title}"
            if len(title) > 100:
                title = title[:97] + "..."

            body = self._generate_pr_body(task, spec_id)

            # Create PR using gh CLI
            args = [
                "pr",
                "create",
                "--title",
                title,
                "--body",
                body,
                "--base",
                base_branch,
                "--head",
                branch_name,
            ]

            result = await self.gh_client.run(args, timeout=60.0)

            # Extract PR URL from output
            output = result.stdout.strip()
            if output.startswith("https://"):
                logger.info(f"Successfully created PR: {output}")
                return output

            # Try to parse URL from output
            for line in output.splitlines():
                if "github.com" in line and "/pull/" in line:
                    url = line.strip()
                    if url.startswith("https://"):
                        logger.info(f"Successfully created PR: {url}")
                        return url

            logger.warning(f"PR created but URL not found in output: {output}")
            return output if output else None

        except GHCommandError as e:
            logger.error(f"Failed to create PR: {e}")
            return None
        except GHTimeoutError as e:
            logger.error(f"PR creation timed out: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error creating PR: {e}")
            return None

    async def _checkout_base_branch(self) -> bool:
        """
        Switch back to the base branch.

        Returns:
            True if successful, False otherwise
        """
        try:
            base_branch = await self._get_base_branch()
            result = await asyncio.create_subprocess_exec(
                "git",
                "checkout",
                base_branch,
                cwd=self.project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await result.communicate()
            return result.returncode == 0
        except Exception as e:
            logger.warning(f"Failed to checkout base branch: {e}")
            return False

    async def _create_pr_for_task(
        self,
        task: AutonomousTask,
        spec_id: str | None,
    ) -> str | None:
        """
        Create a PR for a completed task.

        This method orchestrates the full PR creation workflow:
        1. Check for uncommitted changes
        2. Create a feature branch
        3. Commit changes
        4. Push branch
        5. Create PR

        Args:
            task: The completed task
            spec_id: The spec ID (if available)

        Returns:
            PR URL if successful, None otherwise
        """
        original_branch = await self._get_current_branch()

        try:
            # Check for changes
            has_changes = await self._has_uncommitted_changes()
            if not has_changes:
                logger.info("No changes to commit, skipping PR creation")
                emit_event(
                    "pr_skipped",
                    task_id=task.id,
                    reason="no_changes",
                )
                return None

            # Generate branch name
            branch_name = self._generate_branch_name(task)
            task.branch_name = branch_name

            # Create branch
            if not await self._create_branch(branch_name):
                raise PRCreationError(f"Failed to create branch: {branch_name}")

            # Generate commit message
            commit_message = self._generate_commit_message(task, spec_id)

            # Stage and commit
            if not await self._stage_and_commit(commit_message):
                raise PRCreationError("Failed to commit changes")

            # Push branch
            if not await self._push_branch(branch_name):
                raise PRCreationError(f"Failed to push branch: {branch_name}")

            # Create PR
            pr_url = await self._create_pull_request(task, branch_name, spec_id)
            if not pr_url:
                raise PRCreationError("Failed to create pull request")

            # Update task with PR URL
            task.pull_request_url = pr_url

            emit_event(
                "pr_created",
                task_id=task.id,
                branch_name=branch_name,
                pr_url=pr_url,
            )

            return pr_url

        except PRCreationError as e:
            logger.error(f"PR creation failed: {e}")
            emit_event(
                "pr_creation_failed",
                task_id=task.id,
                error=str(e),
            )
            return None

        except Exception as e:
            logger.error(f"Unexpected error in PR creation: {e}")
            emit_event(
                "pr_creation_failed",
                task_id=task.id,
                error=str(e),
            )
            return None

        finally:
            # Always try to return to original branch for next task
            if original_branch:
                await self._checkout_base_branch()

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

        Handles:
        - Empty queue with efficient polling
        - Rate limiting with exponential backoff
        - Authentication errors
        - Critical system errors
        - Graceful shutdown
        """
        if self.state == RunnerState.RUNNING:
            logger.warning("Runner is already running")
            return

        self.state = RunnerState.RUNNING
        self.stats = SessionStats()  # Reset stats for new session

        # Track consecutive empty polls for adaptive polling
        consecutive_empty_polls = 0
        max_consecutive_empty = 10  # Increase poll interval after this many

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
                try:
                    await self._refresh_task_queue()
                except (AuthenticationError, CriticalSystemError):
                    # Already handled - just break out of loop
                    break
                except Exception as refresh_error:
                    logger.error(f"Failed to refresh task queue: {refresh_error}")
                    emit_event(
                        "error",
                        source="queue_refresh",
                        message=str(refresh_error),
                    )
                    # Wait a bit before retrying
                    await asyncio.sleep(30)
                    continue

                # Get next task
                ready_tasks = get_ready_tasks(
                    self.task_queue,
                    completed_task_ids=self.completed_task_ids,
                )

                if not ready_tasks:
                    consecutive_empty_polls += 1

                    # Adaptive polling - increase interval after many empty polls
                    poll_interval = self.guardrails.poll_interval_seconds
                    if consecutive_empty_polls > max_consecutive_empty:
                        # Double the poll interval (up to 5 minutes)
                        poll_interval = min(poll_interval * 2, 300)

                    # Log based on situation
                    if consecutive_empty_polls == 1:
                        logger.info("No tasks available, waiting for next poll...")
                    elif consecutive_empty_polls % 5 == 0:
                        logger.info(
                            f"Queue empty for {consecutive_empty_polls} consecutive polls "
                            f"(poll interval: {poll_interval}s)"
                        )

                    # Emit idle event with details
                    emit_event(
                        "idle",
                        message="No tasks available",
                        consecutive_empty_polls=consecutive_empty_polls,
                        poll_interval_seconds=poll_interval,
                        blocked_tasks=len(self._blocked_task_ids),
                    )

                    # Wait for poll interval or shutdown signal
                    try:
                        await asyncio.wait_for(
                            self._shutdown_event.wait(),
                            timeout=poll_interval,
                        )
                        # Shutdown was requested
                        break
                    except asyncio.TimeoutError:
                        # Poll interval elapsed, continue loop
                        continue
                else:
                    # Reset consecutive empty counter when we have tasks
                    consecutive_empty_polls = 0

                # Execute highest priority task
                next_task = ready_tasks[0]
                try:
                    success = await self._execute_task(next_task)
                except (AuthenticationError, CriticalSystemError):
                    # Already handled and paused - break out of loop
                    break
                except Exception as task_error:
                    logger.error(f"Unexpected task error: {task_error}")
                    # Continue with next task after brief pause
                    await asyncio.sleep(5)
                    continue

                # Brief pause between tasks
                if not self._shutdown_event.is_set():
                    await asyncio.sleep(1)

        except (AuthenticationError, CriticalSystemError) as e:
            # Already handled, just log
            logger.info(f"Runner paused due to: {type(e).__name__}")

        except Exception as e:
            logger.error(f"Runner error: {e}")

            # Check if this is a critical error
            if self._detect_critical_error(e):
                try:
                    await self._handle_critical_error(e)
                except CriticalSystemError:
                    pass  # Already logged and handled

            emit_event("error", message=str(e), error_type=type(e).__name__)

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
