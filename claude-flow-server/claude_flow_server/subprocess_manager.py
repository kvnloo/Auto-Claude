"""
Subprocess Manager Module
=========================

Manages Claude Flow CLI subprocess lifecycle with proper cleanup.
Handles async execution, timeouts, and zombie process prevention.

The subprocess manager is used by:
- MCP Server: To execute Claude Flow CLI commands
- Health checks: To verify Claude Flow availability

Usage:
    from claude_flow_server.subprocess_manager import SubprocessManager

    manager = SubprocessManager()
    result = await manager.run_claude_flow("research task", config)
"""

import asyncio
import atexit
import logging
import os
import signal
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from claude_flow_server.config import ClaudeFlowConfig, get_default_config

# =============================================================================
# LOGGING
# =============================================================================

logger = logging.getLogger(__name__)


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class ProcessInfo:
    """
    Information about a running subprocess.

    Attributes:
        pid: Process ID
        process: The asyncio subprocess object
        command: Command that was executed
        started_at: When the process was started
        task_id: Optional task identifier
    """

    pid: int
    process: asyncio.subprocess.Process
    command: list[str]
    started_at: datetime
    task_id: str | None = None


@dataclass
class ExecutionResult:
    """
    Result of a subprocess execution.

    Attributes:
        success: Whether execution completed successfully
        stdout: Standard output from the process
        stderr: Standard error from the process
        exit_code: Process exit code
        duration_seconds: Execution duration in seconds
        error: Error message if execution failed
        timed_out: Whether execution timed out
    """

    success: bool = False
    stdout: str = ""
    stderr: str = ""
    exit_code: int | None = None
    duration_seconds: float = 0.0
    error: str | None = None
    timed_out: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Convert result to dictionary."""
        return {
            "success": self.success,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "exit_code": self.exit_code,
            "duration_seconds": self.duration_seconds,
            "error": self.error,
            "timed_out": self.timed_out,
        }


# =============================================================================
# SUBPROCESS MANAGER
# =============================================================================


class SubprocessManager:
    """
    Manages Claude Flow CLI subprocess lifecycle.

    Supports:
    - Async subprocess execution
    - Timeout handling
    - Zombie process cleanup
    - Process registry for tracking active processes
    """

    def __init__(
        self,
        config: ClaudeFlowConfig | None = None,
        working_dir: Path | None = None,
    ) -> None:
        """
        Initialize the subprocess manager.

        Args:
            config: Claude Flow configuration (uses defaults if not provided)
            working_dir: Working directory for subprocess execution
        """
        self.config = config or get_default_config()
        self.working_dir = working_dir or Path.cwd()
        self._processes: dict[int, ProcessInfo] = {}
        self._lock = asyncio.Lock()
        self._shutdown = False

        # Register cleanup on exit
        atexit.register(self._cleanup_sync)

    # =========================================================================
    # PUBLIC METHODS
    # =========================================================================

    async def run_claude_flow(
        self,
        task: str,
        config: dict[str, Any] | None = None,
        task_id: str | None = None,
    ) -> ExecutionResult:
        """
        Run Claude Flow CLI as subprocess with proper cleanup.

        Args:
            task: Task description for Claude Flow
            config: Optional configuration overrides
            task_id: Optional identifier for the task

        Returns:
            ExecutionResult with stdout, stderr, and execution metadata
        """
        if self._shutdown:
            return ExecutionResult(
                success=False,
                error="Subprocess manager is shutting down",
            )

        # Build command
        cmd = self._build_command(task, config)
        timeout = config.get("timeout_seconds", self.config.timeout_seconds) if config else self.config.timeout_seconds

        start_time = time.monotonic()

        try:
            # Create subprocess
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.working_dir,
                env=self._get_env(),
            )

            # Register process
            async with self._lock:
                self._processes[process.pid] = ProcessInfo(
                    pid=process.pid,
                    process=process,
                    command=cmd,
                    started_at=datetime.now(timezone.utc),
                    task_id=task_id,
                )

            try:
                # Wait for completion with timeout
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout,
                )

                duration = time.monotonic() - start_time

                return ExecutionResult(
                    success=process.returncode == 0,
                    stdout=stdout_bytes.decode("utf-8", errors="replace"),
                    stderr=stderr_bytes.decode("utf-8", errors="replace"),
                    exit_code=process.returncode,
                    duration_seconds=duration,
                )

            except asyncio.TimeoutError:
                duration = time.monotonic() - start_time
                await self._terminate_process(process)
                return ExecutionResult(
                    success=False,
                    error=f"Process timed out after {timeout} seconds",
                    duration_seconds=duration,
                    timed_out=True,
                )

            finally:
                # Always unregister process
                async with self._lock:
                    self._processes.pop(process.pid, None)

        except FileNotFoundError:
            return ExecutionResult(
                success=False,
                error="Claude Flow CLI not found. Install with: npm install -g claude-flow@alpha",
                duration_seconds=time.monotonic() - start_time,
            )
        except PermissionError as e:
            return ExecutionResult(
                success=False,
                error=f"Permission denied: {e}",
                duration_seconds=time.monotonic() - start_time,
            )
        except OSError as e:
            return ExecutionResult(
                success=False,
                error=f"OS error: {e}",
                duration_seconds=time.monotonic() - start_time,
            )

    async def check_claude_flow_available(self) -> bool:
        """
        Check if Claude Flow CLI is available.

        Returns:
            True if Claude Flow CLI is installed and accessible
        """
        try:
            process = await asyncio.create_subprocess_exec(
                "npx",
                "claude-flow@alpha",
                "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            await asyncio.wait_for(process.communicate(), timeout=30)
            return process.returncode == 0
        except (FileNotFoundError, asyncio.TimeoutError, OSError):
            return False

    async def get_active_processes(self) -> list[dict[str, Any]]:
        """
        Get information about active processes.

        Returns:
            List of process information dictionaries
        """
        async with self._lock:
            return [
                {
                    "pid": info.pid,
                    "command": " ".join(info.command),
                    "started_at": info.started_at.isoformat(),
                    "task_id": info.task_id,
                    "running_seconds": (
                        datetime.now(timezone.utc) - info.started_at
                    ).total_seconds(),
                }
                for info in self._processes.values()
            ]

    async def kill_process(self, pid: int) -> bool:
        """
        Kill a specific process by PID.

        Args:
            pid: Process ID to kill

        Returns:
            True if process was killed successfully
        """
        async with self._lock:
            info = self._processes.get(pid)
            if not info:
                return False

            try:
                await self._terminate_process(info.process)
                self._processes.pop(pid, None)
                return True
            except Exception as e:
                logger.error(f"Failed to kill process {pid}: {e}")
                return False

    async def cleanup_zombies(self) -> int:
        """
        Clean up zombie processes.

        Returns:
            Number of zombie processes cleaned up
        """
        cleaned = 0

        async with self._lock:
            pids_to_remove = []

            for pid, info in self._processes.items():
                # Check if process is still running
                try:
                    if info.process.returncode is not None:
                        # Process has already terminated
                        pids_to_remove.append(pid)
                        cleaned += 1
                except Exception:
                    pids_to_remove.append(pid)
                    cleaned += 1

            for pid in pids_to_remove:
                self._processes.pop(pid, None)

        return cleaned

    async def shutdown(self) -> None:
        """
        Shutdown the subprocess manager, terminating all active processes.
        """
        self._shutdown = True

        async with self._lock:
            for pid, info in list(self._processes.items()):
                try:
                    await self._terminate_process(info.process)
                except Exception as e:
                    logger.error(f"Error terminating process {pid}: {e}")

            self._processes.clear()

    # =========================================================================
    # PRIVATE METHODS
    # =========================================================================

    def _build_command(
        self,
        task: str,
        config: dict[str, Any] | None = None,
    ) -> list[str]:
        """
        Build the Claude Flow CLI command.

        Args:
            task: Task description
            config: Optional configuration overrides

        Returns:
            List of command arguments
        """
        cmd = [
            "npx",
            "claude-flow@alpha",
            "swarm",
            task,
        ]

        # Apply configuration
        # Note: Claude Flow CLI uses --mode (not --topology) for coordination mode
        topology = config.get("topology", self.config.topology.value) if config else self.config.topology.value
        max_agents = config.get("max_agents", self.config.max_agents) if config else self.config.max_agents

        cmd.extend([
            "--mode",
            str(topology),
            "--max-agents",
            str(max_agents),
            "--parallel",
            "--executor",  # Use built-in executor instead of Claude Code CLI
        ])

        return cmd

    def _get_env(self) -> dict[str, str]:
        """
        Get environment variables for subprocess execution.

        Returns:
            Dictionary of environment variables
        """
        env = os.environ.copy()

        # Ensure API key is available
        if self.config.model.has_api_key():
            api_key = self.config.model.get_api_key()
            if api_key:
                env[self.config.model.api_key_env] = api_key

        return env

    async def _terminate_process(
        self,
        process: asyncio.subprocess.Process,
        timeout: float = 10.0,
    ) -> None:
        """
        Gracefully terminate a process.

        First sends SIGTERM, then SIGKILL if the process doesn't terminate.

        Args:
            process: The process to terminate
            timeout: Timeout in seconds before sending SIGKILL
        """
        if process.returncode is not None:
            # Process already terminated
            return

        try:
            # Try graceful termination first
            process.terminate()

            try:
                await asyncio.wait_for(process.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                # Force kill if graceful termination fails
                process.kill()
                try:
                    await asyncio.wait_for(process.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    logger.warning(f"Process {process.pid} did not terminate after SIGKILL")

        except ProcessLookupError:
            # Process already gone
            pass
        except Exception as e:
            logger.error(f"Error terminating process: {e}")

    def _cleanup_sync(self) -> None:
        """
        Synchronous cleanup for atexit registration.
        """
        for pid, info in list(self._processes.items()):
            try:
                # Send SIGTERM
                os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
            except Exception as e:
                logger.error(f"Error in sync cleanup for process {pid}: {e}")

        self._processes.clear()


# =============================================================================
# SINGLETON INSTANCE
# =============================================================================

_manager_instance: SubprocessManager | None = None


def get_subprocess_manager(
    config: ClaudeFlowConfig | None = None,
) -> SubprocessManager:
    """
    Get the singleton subprocess manager instance.

    Args:
        config: Optional configuration (only used on first call)

    Returns:
        SubprocessManager instance
    """
    global _manager_instance

    if _manager_instance is None:
        _manager_instance = SubprocessManager(config=config)

    return _manager_instance


async def cleanup_subprocess_manager() -> None:
    """
    Cleanup the singleton subprocess manager.
    """
    global _manager_instance

    if _manager_instance is not None:
        await _manager_instance.shutdown()
        _manager_instance = None
