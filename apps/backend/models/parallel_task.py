"""
Data Models for Parallel Task Results
=====================================

Core data structures for representing parallel task execution results,
performance metrics, and telemetry data for Claude Flow integration.

These models support PostgreSQL storage via JSON serialization.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class ExecutionMetrics:
    """
    Performance metrics for parallel task execution.

    Tracks timing, agent utilization, and speedup compared to sequential execution.

    Attributes:
        execution_time_seconds: Total execution time in seconds
        agent_count: Number of agents used in parallel execution
        speedup_factor: Ratio of sequential baseline to actual execution time
        sequential_baseline_seconds: Estimated time for sequential execution
        agents_successful: Number of agents that completed successfully
        agents_failed: Number of agents that failed
        api_calls_total: Total API calls made across all agents
        started_at: ISO timestamp when execution started
        completed_at: ISO timestamp when execution completed
    """

    execution_time_seconds: float = 0.0
    agent_count: int = 0
    speedup_factor: float = 1.0
    sequential_baseline_seconds: float = 0.0
    agents_successful: int = 0
    agents_failed: int = 0
    api_calls_total: int = 0
    started_at: str = ""
    completed_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Convert metrics to JSON-serializable dict for PostgreSQL storage."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExecutionMetrics":
        """Load metrics from dict (e.g., from PostgreSQL JSON column)."""
        return cls(
            execution_time_seconds=data.get("execution_time_seconds", 0.0),
            agent_count=data.get("agent_count", 0),
            speedup_factor=data.get("speedup_factor", 1.0),
            sequential_baseline_seconds=data.get("sequential_baseline_seconds", 0.0),
            agents_successful=data.get("agents_successful", 0),
            agents_failed=data.get("agents_failed", 0),
            api_calls_total=data.get("api_calls_total", 0),
            started_at=data.get("started_at", ""),
            completed_at=data.get("completed_at", ""),
        )

    @classmethod
    def create_with_timestamps(
        cls,
        agent_count: int,
        execution_time_seconds: float,
        sequential_baseline_seconds: float | None = None,
        agents_successful: int | None = None,
        agents_failed: int = 0,
        api_calls_total: int = 0,
    ) -> "ExecutionMetrics":
        """
        Create metrics with calculated speedup and auto-generated timestamps.

        Args:
            agent_count: Number of agents used
            execution_time_seconds: Actual execution time
            sequential_baseline_seconds: Baseline for sequential execution (estimated if not provided)
            agents_successful: Number of successful agents (defaults to agent_count - agents_failed)
            agents_failed: Number of failed agents
            api_calls_total: Total API calls made

        Returns:
            ExecutionMetrics with calculated speedup factor
        """
        # Estimate sequential baseline if not provided (assume linear scaling)
        if sequential_baseline_seconds is None:
            sequential_baseline_seconds = execution_time_seconds * agent_count

        # Calculate speedup factor
        speedup = 1.0
        if execution_time_seconds > 0:
            speedup = sequential_baseline_seconds / execution_time_seconds

        # Default successful agents
        if agents_successful is None:
            agents_successful = agent_count - agents_failed

        now = datetime.now(timezone.utc)
        started = now.replace(
            microsecond=0
        ) - __import__("datetime").timedelta(seconds=int(execution_time_seconds))

        return cls(
            execution_time_seconds=execution_time_seconds,
            agent_count=agent_count,
            speedup_factor=round(speedup, 2),
            sequential_baseline_seconds=sequential_baseline_seconds,
            agents_successful=agents_successful,
            agents_failed=agents_failed,
            api_calls_total=api_calls_total,
            started_at=started.isoformat(),
            completed_at=now.isoformat(),
        )


@dataclass
class AgentResult:
    """
    Result from a single agent in parallel execution.

    Attributes:
        agent_id: Unique identifier for the agent
        output: Raw output from the agent
        status: Execution status (success, failed, timeout)
        execution_time_seconds: Time taken by this agent
        error: Error message if agent failed
    """

    agent_id: str = ""
    output: str = ""
    status: str = "success"
    execution_time_seconds: float = 0.0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "agent_id": self.agent_id,
            "output": self.output,
            "status": self.status,
            "execution_time_seconds": self.execution_time_seconds,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentResult":
        """Load from dict."""
        return cls(
            agent_id=data.get("agent_id", ""),
            output=data.get("output", ""),
            status=data.get("status", "success"),
            execution_time_seconds=data.get("execution_time_seconds", 0.0),
            error=data.get("error"),
        )


@dataclass
class ParallelTaskResult:
    """
    Complete result of a parallel task execution.

    This model is designed to be stored in PostgreSQL with JSON columns
    for results and metrics.

    PostgreSQL Schema:
        CREATE TABLE parallel_task_results (
            id SERIAL PRIMARY KEY,
            task_id VARCHAR(255) NOT NULL,
            agent_count INTEGER NOT NULL,
            topology VARCHAR(50) NOT NULL,
            results JSONB NOT NULL,
            metrics JSONB NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX idx_parallel_task_results_task_id ON parallel_task_results(task_id);

    Attributes:
        id: Database primary key (optional, set by DB)
        task_id: Unique identifier for the task
        agent_count: Number of agents used
        topology: Coordination topology (distributed, hierarchical, mesh, centralized)
        results: Aggregated results from all agents
        metrics: Performance metrics and telemetry
        created_at: Timestamp when result was created
        task_description: Description of the task that was executed
        status: Overall execution status (pending, running, completed, failed)
    """

    task_id: str
    agent_count: int
    topology: str
    results: dict[str, Any] = field(default_factory=dict)
    metrics: ExecutionMetrics = field(default_factory=ExecutionMetrics)
    id: int | None = None
    created_at: str = ""
    task_description: str = ""
    status: str = "completed"
    agent_results: list[AgentResult] = field(default_factory=list)

    def __post_init__(self) -> None:
        """Set created_at timestamp if not provided."""
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict[str, Any]:
        """
        Convert to JSON-serializable dict for PostgreSQL storage.

        Returns:
            Dictionary matching PostgreSQL schema with JSON columns
        """
        return {
            "id": self.id,
            "task_id": self.task_id,
            "agent_count": self.agent_count,
            "topology": self.topology,
            "results": self.results,
            "metrics": self.metrics.to_dict(),
            "created_at": self.created_at,
            "task_description": self.task_description,
            "status": self.status,
            "agent_results": [ar.to_dict() for ar in self.agent_results],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ParallelTaskResult":
        """
        Load from dict (e.g., from PostgreSQL query result).

        Args:
            data: Dictionary with task result data

        Returns:
            ParallelTaskResult instance
        """
        metrics_data = data.get("metrics", {})
        if isinstance(metrics_data, dict):
            metrics = ExecutionMetrics.from_dict(metrics_data)
        else:
            metrics = ExecutionMetrics()

        agent_results_data = data.get("agent_results", [])
        agent_results = [
            AgentResult.from_dict(ar) if isinstance(ar, dict) else ar
            for ar in agent_results_data
        ]

        return cls(
            id=data.get("id"),
            task_id=data.get("task_id", ""),
            agent_count=data.get("agent_count", 0),
            topology=data.get("topology", "distributed"),
            results=data.get("results", {}),
            metrics=metrics,
            created_at=data.get("created_at", ""),
            task_description=data.get("task_description", ""),
            status=data.get("status", "completed"),
            agent_results=agent_results,
        )

    @classmethod
    def create(
        cls,
        task_id: str,
        task_description: str,
        agent_count: int,
        topology: str = "distributed",
        results: dict[str, Any] | None = None,
        agent_results: list[AgentResult] | None = None,
        execution_time_seconds: float = 0.0,
        sequential_baseline_seconds: float | None = None,
        agents_failed: int = 0,
        api_calls_total: int = 0,
    ) -> "ParallelTaskResult":
        """
        Create a new parallel task result with auto-generated metrics.

        Args:
            task_id: Unique task identifier
            task_description: Description of the task
            agent_count: Number of agents used
            topology: Coordination topology used
            results: Aggregated results dictionary
            agent_results: List of individual agent results
            execution_time_seconds: Total execution time
            sequential_baseline_seconds: Estimated sequential time (optional)
            agents_failed: Number of agents that failed
            api_calls_total: Total API calls made

        Returns:
            ParallelTaskResult with calculated metrics
        """
        metrics = ExecutionMetrics.create_with_timestamps(
            agent_count=agent_count,
            execution_time_seconds=execution_time_seconds,
            sequential_baseline_seconds=sequential_baseline_seconds,
            agents_failed=agents_failed,
            api_calls_total=api_calls_total,
        )

        return cls(
            task_id=task_id,
            task_description=task_description,
            agent_count=agent_count,
            topology=topology,
            results=results or {},
            metrics=metrics,
            status="completed" if agents_failed < agent_count else "failed",
            agent_results=agent_results or [],
        )

    def is_successful(self) -> bool:
        """Check if the task completed successfully."""
        return self.status == "completed" and self.metrics.agents_failed == 0

    def get_speedup_summary(self) -> str:
        """Get a human-readable summary of performance."""
        m = self.metrics
        return (
            f"Executed with {m.agent_count} agents in {m.execution_time_seconds:.1f}s "
            f"({m.speedup_factor:.1f}x speedup vs sequential baseline of "
            f"{m.sequential_baseline_seconds:.1f}s)"
        )
