"""
Task Service Module
===================

Service for managing parallel task execution with result storage.

This module provides:
- Parallel task execution using Claude Flow MCP server
- Result storage and retrieval (in-memory and PostgreSQL compatible)
- Progress tracking for parallel operations
- Integration with MCP server registry

Usage:
    from services.task_service import TaskService

    task_service = TaskService()
    result = await task_service.execute_parallel_task(
        task_description="Research API patterns",
        agent_count=8,
        topology="distributed"
    )
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from models.parallel_task import AgentResult, ExecutionMetrics, ParallelTaskResult

# =============================================================================
# LOGGING
# =============================================================================

logger = logging.getLogger(__name__)

# =============================================================================
# CONSTANTS
# =============================================================================

# Valid agent counts (from spec)
VALID_AGENT_COUNTS = [4, 8, 12]

# Valid topology modes (from spec)
VALID_TOPOLOGIES = ["distributed", "hierarchical", "mesh", "centralized"]

# Default timeout for parallel execution (5 minutes)
DEFAULT_EXECUTION_TIMEOUT = 300

# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class TaskConfig:
    """
    Configuration for a parallel task execution.

    Attributes:
        task_description: Description of the task to execute
        agent_count: Number of parallel agents to use (4, 8, or 12)
        topology: Coordination topology (distributed, hierarchical, mesh, centralized)
        timeout_seconds: Maximum execution time in seconds
        model: Model to use for agents (default: claude-sonnet-4-20250514)
    """

    task_description: str
    agent_count: int = 8
    topology: str = "distributed"
    timeout_seconds: int = DEFAULT_EXECUTION_TIMEOUT
    model: str = "claude-sonnet-4-20250514"

    def __post_init__(self) -> None:
        """Validate configuration after initialization."""
        if self.agent_count not in VALID_AGENT_COUNTS:
            raise ValueError(
                f"Invalid agent_count {self.agent_count}. "
                f"Must be one of {VALID_AGENT_COUNTS}"
            )
        if self.topology not in VALID_TOPOLOGIES:
            raise ValueError(
                f"Invalid topology '{self.topology}'. "
                f"Must be one of {VALID_TOPOLOGIES}"
            )


@dataclass
class TaskProgress:
    """
    Progress tracking for a parallel task.

    Attributes:
        task_id: Unique task identifier
        status: Current status (pending, running, completed, failed)
        progress_percent: Completion percentage (0-100)
        agents_completed: Number of agents that have completed
        agents_total: Total number of agents
        started_at: ISO timestamp when task started
        message: Current status message
    """

    task_id: str
    status: str = "pending"
    progress_percent: float = 0.0
    agents_completed: int = 0
    agents_total: int = 0
    started_at: str = ""
    message: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "task_id": self.task_id,
            "status": self.status,
            "progress_percent": self.progress_percent,
            "agents_completed": self.agents_completed,
            "agents_total": self.agents_total,
            "started_at": self.started_at,
            "message": self.message,
        }


# =============================================================================
# TASK SERVICE
# =============================================================================


class TaskService:
    """
    Service for managing parallel task execution.

    Supports:
    - Parallel task execution via Claude Flow MCP server
    - In-memory result storage (with PostgreSQL adapter interface)
    - Progress tracking for running tasks
    - Task history and retrieval
    """

    def __init__(self, working_dir: Path | None = None) -> None:
        """
        Initialize the task service.

        Args:
            working_dir: Working directory for task execution
        """
        self.working_dir = working_dir or Path.cwd()
        self._results: dict[str, ParallelTaskResult] = {}
        self._progress: dict[str, TaskProgress] = {}
        self._callbacks: dict[str, list[Callable[[TaskProgress], None]]] = {}
        self._lock = asyncio.Lock()

    # =========================================================================
    # TASK EXECUTION
    # =========================================================================

    async def execute_parallel_task(
        self,
        task_description: str,
        agent_count: int = 8,
        topology: str = "distributed",
        timeout_seconds: int = DEFAULT_EXECUTION_TIMEOUT,
        model: str = "claude-sonnet-4-20250514",
    ) -> ParallelTaskResult:
        """
        Execute a task using parallel Claude agents.

        This is the main entry point for parallel task execution. It:
        1. Creates a task configuration
        2. Spawns parallel agents via Claude Flow MCP server
        3. Tracks progress during execution
        4. Aggregates and stores results

        Args:
            task_description: Description of the task to execute
            agent_count: Number of parallel agents (4, 8, or 12)
            topology: Coordination topology
            timeout_seconds: Maximum execution time
            model: Model to use for agents

        Returns:
            ParallelTaskResult with aggregated results and metrics

        Raises:
            ValueError: If configuration is invalid
            TimeoutError: If execution times out
        """
        # Validate configuration
        config = TaskConfig(
            task_description=task_description,
            agent_count=agent_count,
            topology=topology,
            timeout_seconds=timeout_seconds,
            model=model,
        )

        # Generate task ID
        task_id = self._generate_task_id()

        # Initialize progress tracking
        progress = TaskProgress(
            task_id=task_id,
            status="running",
            agents_total=agent_count,
            started_at=datetime.now(timezone.utc).isoformat(),
            message="Initializing parallel execution...",
        )
        self._progress[task_id] = progress
        await self._notify_progress(task_id)

        try:
            # Execute the parallel task
            result = await self._execute_with_claude_flow(task_id, config)

            # Update progress to completed
            progress.status = "completed"
            progress.progress_percent = 100.0
            progress.agents_completed = agent_count
            progress.message = "Task completed successfully"
            await self._notify_progress(task_id)

            # Store result
            async with self._lock:
                self._results[task_id] = result

            return result

        except asyncio.TimeoutError:
            progress.status = "failed"
            progress.message = f"Task timed out after {timeout_seconds}s"
            await self._notify_progress(task_id)
            raise

        except Exception as e:
            progress.status = "failed"
            progress.message = f"Task failed: {str(e)}"
            await self._notify_progress(task_id)
            raise

    async def _execute_with_claude_flow(
        self,
        task_id: str,
        config: TaskConfig,
    ) -> ParallelTaskResult:
        """
        Execute task using Claude Flow MCP server.

        This method integrates with the Claude Flow MCP server to run
        parallel agents. If the server is not available, it falls back
        to simulation mode for testing.

        Args:
            task_id: Unique task identifier
            config: Task configuration

        Returns:
            ParallelTaskResult with execution results
        """
        start_time = datetime.now(timezone.utc)

        # Try to use Claude Flow MCP server
        try:
            from services.mcp_integration import get_server, is_server_registered

            if is_server_registered("claude-flow"):
                server = get_server("claude-flow")
                if server is not None:
                    return await self._execute_via_mcp(task_id, config, server)
        except ImportError:
            pass

        # Fallback: simulate parallel execution (for testing/development)
        return await self._simulate_parallel_execution(task_id, config, start_time)

    async def _execute_via_mcp(
        self,
        task_id: str,
        config: TaskConfig,
        server: Any,
    ) -> ParallelTaskResult:
        """
        Execute task via MCP server.

        Args:
            task_id: Unique task identifier
            config: Task configuration
            server: MCP server instance

        Returns:
            ParallelTaskResult with execution results
        """
        start_time = datetime.now(timezone.utc)

        # Update progress
        progress = self._progress.get(task_id)
        if progress:
            progress.message = "Spawning parallel agents..."
            await self._notify_progress(task_id)

        try:
            # Call the parallel_execute tool on the MCP server
            # This follows the BatchTool single-message pattern from the spec
            result_data = await asyncio.wait_for(
                self._call_mcp_parallel_execute(server, config),
                timeout=config.timeout_seconds,
            )

            end_time = datetime.now(timezone.utc)
            execution_time = (end_time - start_time).total_seconds()

            # Parse results from MCP response
            return self._parse_mcp_result(
                task_id=task_id,
                config=config,
                result_data=result_data,
                execution_time=execution_time,
            )

        except asyncio.TimeoutError:
            logger.warning(f"MCP execution timed out for task {task_id}")
            raise

        except Exception as e:
            logger.exception(f"MCP execution failed for task {task_id}: {e}")
            raise

    async def _call_mcp_parallel_execute(
        self,
        server: Any,
        config: TaskConfig,
    ) -> dict[str, Any]:
        """
        Call the parallel_execute tool on the MCP server.

        Args:
            server: MCP server instance
            config: Task configuration

        Returns:
            Result dictionary from MCP server
        """
        # The server should have a parallel_execute method or tool
        # This is the integration point with the claude-flow-server
        if hasattr(server, "call_tool"):
            return await server.call_tool(
                "parallel_execute",
                {
                    "task_description": config.task_description,
                    "max_agents": config.agent_count,
                    "topology": config.topology,
                    "model": config.model,
                },
            )
        elif hasattr(server, "parallel_execute"):
            return await server.parallel_execute(
                task_description=config.task_description,
                max_agents=config.agent_count,
                topology=config.topology,
            )
        else:
            raise AttributeError(
                "MCP server does not have parallel_execute capability"
            )

    def _parse_mcp_result(
        self,
        task_id: str,
        config: TaskConfig,
        result_data: dict[str, Any],
        execution_time: float,
    ) -> ParallelTaskResult:
        """
        Parse MCP server response into ParallelTaskResult.

        Args:
            task_id: Unique task identifier
            config: Task configuration
            result_data: Raw result from MCP server
            execution_time: Total execution time in seconds

        Returns:
            ParallelTaskResult with parsed data
        """
        # Extract agent results from response
        agent_results_data = result_data.get("agent_results", [])
        agent_results = [
            AgentResult.from_dict(ar) if isinstance(ar, dict) else ar
            for ar in agent_results_data
        ]

        # Count successes and failures
        agents_failed = sum(
            1 for ar in agent_results if ar.status in ("failed", "timeout")
        )

        # Create result with auto-generated metrics
        return ParallelTaskResult.create(
            task_id=task_id,
            task_description=config.task_description,
            agent_count=config.agent_count,
            topology=config.topology,
            results=result_data.get("aggregated_result", result_data),
            agent_results=agent_results,
            execution_time_seconds=execution_time,
            sequential_baseline_seconds=result_data.get("sequential_baseline"),
            agents_failed=agents_failed,
            api_calls_total=result_data.get("api_calls_total", 0),
        )

    async def _simulate_parallel_execution(
        self,
        task_id: str,
        config: TaskConfig,
        start_time: datetime,
    ) -> ParallelTaskResult:
        """
        Simulate parallel execution for testing.

        This is used when the Claude Flow MCP server is not available,
        allowing development and testing of the task service.

        Args:
            task_id: Unique task identifier
            config: Task configuration
            start_time: When execution started

        Returns:
            ParallelTaskResult with simulated results
        """
        logger.info(
            f"Simulating parallel execution for task {task_id} "
            f"with {config.agent_count} agents"
        )

        # Update progress periodically
        progress = self._progress.get(task_id)
        agents_per_step = max(1, config.agent_count // 4)

        for i in range(4):
            if progress:
                completed = min((i + 1) * agents_per_step, config.agent_count)
                progress.agents_completed = completed
                progress.progress_percent = (completed / config.agent_count) * 100
                progress.message = f"Processing... ({completed}/{config.agent_count} agents)"
                await self._notify_progress(task_id)

            # Simulate agent execution time (faster for simulation)
            await asyncio.sleep(0.1)

        end_time = datetime.now(timezone.utc)
        execution_time = (end_time - start_time).total_seconds()

        # Generate simulated agent results
        agent_results = [
            AgentResult(
                agent_id=f"agent-{i+1}",
                output=f"Simulated output from agent {i+1} for task: {config.task_description[:50]}...",
                status="success",
                execution_time_seconds=execution_time / config.agent_count,
            )
            for i in range(config.agent_count)
        ]

        # Create result
        return ParallelTaskResult.create(
            task_id=task_id,
            task_description=config.task_description,
            agent_count=config.agent_count,
            topology=config.topology,
            results={
                "summary": f"Simulated parallel execution with {config.agent_count} agents",
                "findings": [
                    f"Finding {i+1} from simulated agent"
                    for i in range(config.agent_count)
                ],
            },
            agent_results=agent_results,
            execution_time_seconds=execution_time,
            agents_failed=0,
        )

    # =========================================================================
    # PROGRESS TRACKING
    # =========================================================================

    def get_task_progress(self, task_id: str) -> TaskProgress | None:
        """
        Get progress for a running or completed task.

        Args:
            task_id: Unique task identifier

        Returns:
            TaskProgress if found, None otherwise
        """
        return self._progress.get(task_id)

    def subscribe_to_progress(
        self,
        task_id: str,
        callback: Callable[[TaskProgress], None],
    ) -> None:
        """
        Subscribe to progress updates for a task.

        Args:
            task_id: Unique task identifier
            callback: Function to call with progress updates
        """
        if task_id not in self._callbacks:
            self._callbacks[task_id] = []
        self._callbacks[task_id].append(callback)

    def unsubscribe_from_progress(
        self,
        task_id: str,
        callback: Callable[[TaskProgress], None],
    ) -> None:
        """
        Unsubscribe from progress updates.

        Args:
            task_id: Unique task identifier
            callback: Previously registered callback
        """
        if task_id in self._callbacks:
            try:
                self._callbacks[task_id].remove(callback)
            except ValueError:
                pass

    async def _notify_progress(self, task_id: str) -> None:
        """
        Notify all subscribers of progress update.

        Args:
            task_id: Unique task identifier
        """
        progress = self._progress.get(task_id)
        if progress and task_id in self._callbacks:
            for callback in self._callbacks[task_id]:
                try:
                    callback(progress)
                except Exception as e:
                    logger.warning(f"Progress callback error: {e}")

    # =========================================================================
    # RESULT STORAGE
    # =========================================================================

    async def get_task_result(self, task_id: str) -> ParallelTaskResult | None:
        """
        Get result for a completed task.

        Args:
            task_id: Unique task identifier

        Returns:
            ParallelTaskResult if found, None otherwise
        """
        async with self._lock:
            return self._results.get(task_id)

    async def list_task_results(
        self,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ParallelTaskResult]:
        """
        List stored task results.

        Args:
            limit: Maximum number of results to return
            offset: Number of results to skip

        Returns:
            List of ParallelTaskResult objects
        """
        async with self._lock:
            results = list(self._results.values())
            # Sort by created_at descending
            results.sort(key=lambda r: r.created_at, reverse=True)
            return results[offset : offset + limit]

    async def store_task_result(self, result: ParallelTaskResult) -> None:
        """
        Store a task result.

        This method allows external storage of results (e.g., from
        PostgreSQL adapter).

        Args:
            result: ParallelTaskResult to store
        """
        async with self._lock:
            self._results[result.task_id] = result

    async def delete_task_result(self, task_id: str) -> bool:
        """
        Delete a stored task result.

        Args:
            task_id: Unique task identifier

        Returns:
            True if result was deleted, False if not found
        """
        async with self._lock:
            if task_id in self._results:
                del self._results[task_id]
                return True
            return False

    # =========================================================================
    # UTILITY METHODS
    # =========================================================================

    def _generate_task_id(self) -> str:
        """Generate a unique task ID."""
        return f"task-{uuid.uuid4().hex[:12]}"

    def get_task_count(self) -> int:
        """Get the number of stored task results."""
        return len(self._results)

    def clear_results(self) -> int:
        """
        Clear all stored task results.

        Returns:
            Number of results cleared
        """
        count = len(self._results)
        self._results.clear()
        self._progress.clear()
        self._callbacks.clear()
        return count


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================


async def execute_parallel_task(
    task_description: str,
    agent_count: int = 8,
    topology: str = "distributed",
    working_dir: Path | None = None,
) -> ParallelTaskResult:
    """
    Convenience function for parallel task execution.

    Args:
        task_description: Description of the task
        agent_count: Number of parallel agents (4, 8, or 12)
        topology: Coordination topology
        working_dir: Working directory for execution

    Returns:
        ParallelTaskResult with aggregated results
    """
    service = TaskService(working_dir=working_dir)
    return await service.execute_parallel_task(
        task_description=task_description,
        agent_count=agent_count,
        topology=topology,
    )


def validate_task_config(
    agent_count: int = 8,
    topology: str = "distributed",
) -> bool:
    """
    Validate task configuration without creating a TaskConfig.

    Args:
        agent_count: Number of agents
        topology: Coordination topology

    Returns:
        True if configuration is valid, False otherwise
    """
    return agent_count in VALID_AGENT_COUNTS and topology in VALID_TOPOLOGIES


# =============================================================================
# POSTGRESQL ADAPTER INTERFACE
# =============================================================================


class PostgresTaskAdapter:
    """
    Adapter for PostgreSQL storage of parallel task results.

    This class provides the interface for persisting task results
    to PostgreSQL. It's designed to work with the in-memory TaskService.

    Usage:
        adapter = PostgresTaskAdapter(connection_string)
        await adapter.save_result(result)
        results = await adapter.load_results(limit=10)
    """

    def __init__(self, connection_string: str | None = None) -> None:
        """
        Initialize the PostgreSQL adapter.

        Args:
            connection_string: PostgreSQL connection string
        """
        self.connection_string = connection_string
        self._connected = False

    async def connect(self) -> bool:
        """
        Connect to PostgreSQL database.

        Returns:
            True if connection successful
        """
        if not self.connection_string:
            logger.warning("No PostgreSQL connection string provided")
            return False

        try:
            # Placeholder for actual PostgreSQL connection
            # Would use asyncpg or similar in production
            self._connected = True
            logger.info("Connected to PostgreSQL (placeholder)")
            return True
        except Exception as e:
            logger.exception(f"Failed to connect to PostgreSQL: {e}")
            return False

    async def disconnect(self) -> None:
        """Disconnect from PostgreSQL database."""
        self._connected = False

    async def save_result(self, result: ParallelTaskResult) -> bool:
        """
        Save a task result to PostgreSQL.

        Args:
            result: ParallelTaskResult to save

        Returns:
            True if saved successfully
        """
        if not self._connected:
            logger.warning("Not connected to PostgreSQL")
            return False

        try:
            # Placeholder for actual INSERT
            # Would use the schema defined in ParallelTaskResult docstring
            data = result.to_dict()
            logger.info(f"Saved task result {result.task_id} (placeholder)")
            return True
        except Exception as e:
            logger.exception(f"Failed to save task result: {e}")
            return False

    async def load_result(self, task_id: str) -> ParallelTaskResult | None:
        """
        Load a task result from PostgreSQL.

        Args:
            task_id: Unique task identifier

        Returns:
            ParallelTaskResult if found, None otherwise
        """
        if not self._connected:
            return None

        try:
            # Placeholder for actual SELECT
            logger.info(f"Load task result {task_id} (placeholder)")
            return None
        except Exception as e:
            logger.exception(f"Failed to load task result: {e}")
            return None

    async def load_results(
        self,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ParallelTaskResult]:
        """
        Load multiple task results from PostgreSQL.

        Args:
            limit: Maximum number of results
            offset: Number of results to skip

        Returns:
            List of ParallelTaskResult objects
        """
        if not self._connected:
            return []

        try:
            # Placeholder for actual SELECT with pagination
            logger.info(f"Load task results (limit={limit}, offset={offset}) (placeholder)")
            return []
        except Exception as e:
            logger.exception(f"Failed to load task results: {e}")
            return []

    async def delete_result(self, task_id: str) -> bool:
        """
        Delete a task result from PostgreSQL.

        Args:
            task_id: Unique task identifier

        Returns:
            True if deleted successfully
        """
        if not self._connected:
            return False

        try:
            # Placeholder for actual DELETE
            logger.info(f"Delete task result {task_id} (placeholder)")
            return True
        except Exception as e:
            logger.exception(f"Failed to delete task result: {e}")
            return False
