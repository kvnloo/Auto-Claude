"""
Tests for Parallel Task Models
==============================

Comprehensive test suite for parallel task execution models covering:
- ParallelTaskResult data model
- ExecutionMetrics calculations
- AgentResult handling
- PostgreSQL JSON serialization
- Task result storage and retrieval
"""

import asyncio
from datetime import datetime, timezone

import pytest

from models.parallel_task import (
    AgentResult,
    ExecutionMetrics,
    ParallelTaskResult,
)
from services.task_service import (
    PostgresTaskAdapter,
    TaskConfig,
    TaskProgress,
    TaskService,
    VALID_AGENT_COUNTS,
    VALID_TOPOLOGIES,
    validate_task_config,
)


class TestExecutionMetrics:
    """Test ExecutionMetrics data model."""

    def test_default_values(self):
        """Metrics have sensible defaults."""
        metrics = ExecutionMetrics()
        assert metrics.execution_time_seconds == 0.0
        assert metrics.agent_count == 0
        assert metrics.speedup_factor == 1.0
        assert metrics.agents_successful == 0
        assert metrics.agents_failed == 0

    def test_to_dict(self):
        """Metrics serialize to dict correctly."""
        metrics = ExecutionMetrics(
            execution_time_seconds=45.2,
            agent_count=8,
            speedup_factor=6.8,
            sequential_baseline_seconds=307.4,
            agents_successful=8,
            agents_failed=0,
            api_calls_total=96,
            started_at="2025-12-26T13:00:00Z",
            completed_at="2025-12-26T13:00:45Z",
        )
        data = metrics.to_dict()

        assert data["execution_time_seconds"] == 45.2
        assert data["agent_count"] == 8
        assert data["speedup_factor"] == 6.8
        assert data["agents_successful"] == 8
        assert data["api_calls_total"] == 96

    def test_from_dict(self):
        """Metrics deserialize from dict correctly."""
        data = {
            "execution_time_seconds": 45.2,
            "agent_count": 8,
            "speedup_factor": 6.8,
            "sequential_baseline_seconds": 307.4,
            "agents_successful": 8,
            "agents_failed": 0,
        }
        metrics = ExecutionMetrics.from_dict(data)

        assert metrics.execution_time_seconds == 45.2
        assert metrics.agent_count == 8
        assert metrics.speedup_factor == 6.8
        assert metrics.agents_successful == 8

    def test_from_dict_with_missing_fields(self):
        """Metrics handle missing fields gracefully."""
        metrics = ExecutionMetrics.from_dict({})
        assert metrics.execution_time_seconds == 0.0
        assert metrics.agent_count == 0

    def test_create_with_timestamps(self):
        """Create metrics with auto-calculated speedup."""
        metrics = ExecutionMetrics.create_with_timestamps(
            agent_count=8,
            execution_time_seconds=50.0,
            sequential_baseline_seconds=400.0,
            agents_failed=0,
        )

        assert metrics.agent_count == 8
        assert metrics.execution_time_seconds == 50.0
        assert metrics.speedup_factor == 8.0  # 400/50 = 8x speedup
        assert metrics.agents_successful == 8
        assert metrics.agents_failed == 0
        assert metrics.started_at != ""
        assert metrics.completed_at != ""

    def test_create_with_auto_baseline(self):
        """Speedup calculated from estimated baseline."""
        metrics = ExecutionMetrics.create_with_timestamps(
            agent_count=4,
            execution_time_seconds=100.0,
            # No baseline provided - estimated as execution_time * agent_count
        )

        assert metrics.speedup_factor == 4.0  # 400/100 = 4x

    def test_create_with_failed_agents(self):
        """Successful agents calculated from failures."""
        metrics = ExecutionMetrics.create_with_timestamps(
            agent_count=12,
            execution_time_seconds=60.0,
            agents_failed=2,
        )

        assert metrics.agents_successful == 10
        assert metrics.agents_failed == 2


class TestAgentResult:
    """Test AgentResult data model."""

    def test_default_values(self):
        """Agent result has sensible defaults."""
        result = AgentResult()
        assert result.agent_id == ""
        assert result.output == ""
        assert result.status == "success"
        assert result.error is None

    def test_to_dict(self):
        """Agent result serializes correctly."""
        result = AgentResult(
            agent_id="agent-1",
            output="Found 5 API patterns",
            status="success",
            execution_time_seconds=12.5,
        )
        data = result.to_dict()

        assert data["agent_id"] == "agent-1"
        assert data["output"] == "Found 5 API patterns"
        assert data["status"] == "success"
        assert data["error"] is None

    def test_from_dict(self):
        """Agent result deserializes correctly."""
        data = {
            "agent_id": "agent-2",
            "output": "Analyzed 10 files",
            "status": "success",
            "execution_time_seconds": 8.3,
        }
        result = AgentResult.from_dict(data)

        assert result.agent_id == "agent-2"
        assert result.output == "Analyzed 10 files"
        assert result.execution_time_seconds == 8.3

    def test_failed_agent(self):
        """Failed agent captures error."""
        result = AgentResult(
            agent_id="agent-3",
            status="failed",
            error="API rate limit exceeded",
        )

        assert result.status == "failed"
        assert result.error == "API rate limit exceeded"


class TestParallelTaskResult:
    """Test ParallelTaskResult data model."""

    def test_minimal_creation(self):
        """Create result with minimal fields."""
        result = ParallelTaskResult(
            task_id="task-123",
            agent_count=8,
            topology="distributed",
        )

        assert result.task_id == "task-123"
        assert result.agent_count == 8
        assert result.topology == "distributed"
        assert result.status == "completed"
        assert result.created_at != ""  # Auto-generated

    def test_full_creation(self):
        """Create result with all fields."""
        metrics = ExecutionMetrics(
            execution_time_seconds=45.0,
            agent_count=8,
            speedup_factor=6.0,
        )
        agent_results = [
            AgentResult(agent_id=f"agent-{i}", status="success")
            for i in range(8)
        ]

        result = ParallelTaskResult(
            task_id="task-456",
            agent_count=8,
            topology="hierarchical",
            results={"summary": "Research complete"},
            metrics=metrics,
            task_description="Research API patterns",
            status="completed",
            agent_results=agent_results,
        )

        assert result.task_id == "task-456"
        assert result.topology == "hierarchical"
        assert len(result.agent_results) == 8

    def test_to_dict(self):
        """Result serializes to dict for PostgreSQL storage."""
        result = ParallelTaskResult.create(
            task_id="task-789",
            task_description="Analyze codebase",
            agent_count=4,
            topology="distributed",
            execution_time_seconds=30.0,
        )
        data = result.to_dict()

        assert data["task_id"] == "task-789"
        assert data["agent_count"] == 4
        assert data["topology"] == "distributed"
        assert "metrics" in data
        assert isinstance(data["metrics"], dict)

    def test_from_dict(self):
        """Result deserializes from PostgreSQL query result."""
        data = {
            "id": 1,
            "task_id": "task-abc",
            "agent_count": 12,
            "topology": "mesh",
            "results": {"findings": ["A", "B", "C"]},
            "metrics": {
                "execution_time_seconds": 60.0,
                "agent_count": 12,
                "speedup_factor": 10.0,
            },
            "task_description": "Deep analysis",
            "status": "completed",
        }
        result = ParallelTaskResult.from_dict(data)

        assert result.id == 1
        assert result.task_id == "task-abc"
        assert result.agent_count == 12
        assert result.topology == "mesh"
        assert result.metrics.speedup_factor == 10.0

    def test_create_factory_method(self):
        """Factory method creates result with metrics."""
        result = ParallelTaskResult.create(
            task_id="task-factory",
            task_description="Test task",
            agent_count=8,
            topology="distributed",
            execution_time_seconds=50.0,
            sequential_baseline_seconds=400.0,
            agents_failed=1,
        )

        assert result.task_id == "task-factory"
        assert result.metrics.speedup_factor == 8.0
        assert result.metrics.agents_failed == 1
        assert result.metrics.agents_successful == 7

    def test_is_successful(self):
        """Success check works correctly."""
        success = ParallelTaskResult.create(
            task_id="success",
            task_description="Test",
            agent_count=8,
            execution_time_seconds=30.0,
        )
        assert success.is_successful() is True

        failed = ParallelTaskResult(
            task_id="failed",
            agent_count=8,
            topology="distributed",
            status="failed",
        )
        assert failed.is_successful() is False

    def test_get_speedup_summary(self):
        """Speedup summary is human-readable."""
        result = ParallelTaskResult.create(
            task_id="summary-test",
            task_description="Test",
            agent_count=8,
            execution_time_seconds=50.0,
            sequential_baseline_seconds=400.0,
        )
        summary = result.get_speedup_summary()

        assert "8 agents" in summary
        assert "50.0s" in summary
        assert "8.0x speedup" in summary


class TestTaskConfig:
    """Test TaskConfig validation."""

    def test_valid_config(self):
        """Valid configuration accepted."""
        config = TaskConfig(
            task_description="Research patterns",
            agent_count=8,
            topology="distributed",
        )
        assert config.agent_count == 8
        assert config.topology == "distributed"

    def test_invalid_agent_count(self):
        """Invalid agent count rejected."""
        with pytest.raises(ValueError) as exc_info:
            TaskConfig(
                task_description="Test",
                agent_count=5,  # Invalid - must be 4, 8, or 12
            )
        assert "agent_count" in str(exc_info.value)

    def test_invalid_topology(self):
        """Invalid topology rejected."""
        with pytest.raises(ValueError) as exc_info:
            TaskConfig(
                task_description="Test",
                topology="invalid",  # Invalid topology
            )
        assert "topology" in str(exc_info.value)

    def test_all_valid_agent_counts(self):
        """All valid agent counts work."""
        for count in VALID_AGENT_COUNTS:
            config = TaskConfig(task_description="Test", agent_count=count)
            assert config.agent_count == count

    def test_all_valid_topologies(self):
        """All valid topologies work."""
        for topology in VALID_TOPOLOGIES:
            config = TaskConfig(task_description="Test", topology=topology)
            assert config.topology == topology


class TestTaskProgress:
    """Test TaskProgress tracking."""

    def test_initial_state(self):
        """Progress starts in pending state."""
        progress = TaskProgress(task_id="test-1")
        assert progress.status == "pending"
        assert progress.progress_percent == 0.0
        assert progress.agents_completed == 0

    def test_to_dict(self):
        """Progress serializes for API response."""
        progress = TaskProgress(
            task_id="test-2",
            status="running",
            progress_percent=50.0,
            agents_completed=4,
            agents_total=8,
            message="Processing...",
        )
        data = progress.to_dict()

        assert data["task_id"] == "test-2"
        assert data["status"] == "running"
        assert data["progress_percent"] == 50.0


class TestTaskService:
    """Test TaskService functionality."""

    def setup_method(self):
        """Reset service before each test."""
        self.service = TaskService()

    @pytest.mark.asyncio
    async def test_execute_parallel_task(self):
        """Execute parallel task returns result."""
        result = await self.service.execute_parallel_task(
            task_description="Test research task",
            agent_count=4,
            topology="distributed",
        )

        assert result is not None
        assert result.agent_count == 4
        assert result.topology == "distributed"
        assert result.task_description == "Test research task"
        assert result.status == "completed"

    @pytest.mark.asyncio
    async def test_execute_with_different_agent_counts(self):
        """Execute with each valid agent count."""
        for count in [4, 8, 12]:
            result = await self.service.execute_parallel_task(
                task_description=f"Test with {count} agents",
                agent_count=count,
            )
            assert result.agent_count == count

    @pytest.mark.asyncio
    async def test_execute_with_different_topologies(self):
        """Execute with each topology mode."""
        for topology in VALID_TOPOLOGIES:
            result = await self.service.execute_parallel_task(
                task_description=f"Test {topology}",
                topology=topology,
            )
            assert result.topology == topology

    @pytest.mark.asyncio
    async def test_progress_tracking(self):
        """Progress tracked during execution."""
        progress_updates = []

        def on_progress(p: TaskProgress):
            progress_updates.append(p.to_dict())

        # Start task
        task = asyncio.create_task(
            self.service.execute_parallel_task(
                task_description="Track progress",
                agent_count=4,
            )
        )

        # Wait a moment for task to start
        await asyncio.sleep(0.05)

        # Get progress
        if self.service._progress:
            task_id = list(self.service._progress.keys())[0]
            progress = self.service.get_task_progress(task_id)
            assert progress is not None
            assert progress.status in ("pending", "running", "completed")

        # Wait for completion
        result = await task
        assert result is not None

    @pytest.mark.asyncio
    async def test_result_storage(self):
        """Results stored and retrievable."""
        result = await self.service.execute_parallel_task(
            task_description="Store this result",
            agent_count=4,
        )

        # Retrieve stored result
        stored = await self.service.get_task_result(result.task_id)
        assert stored is not None
        assert stored.task_id == result.task_id
        assert stored.task_description == "Store this result"

    @pytest.mark.asyncio
    async def test_list_results(self):
        """List all stored results."""
        # Execute multiple tasks
        for i in range(3):
            await self.service.execute_parallel_task(
                task_description=f"Task {i}",
                agent_count=4,
            )

        # List results
        results = await self.service.list_task_results()
        assert len(results) == 3

    @pytest.mark.asyncio
    async def test_delete_result(self):
        """Delete stored result."""
        result = await self.service.execute_parallel_task(
            task_description="Delete me",
            agent_count=4,
        )

        # Delete
        deleted = await self.service.delete_task_result(result.task_id)
        assert deleted is True

        # Verify deleted
        stored = await self.service.get_task_result(result.task_id)
        assert stored is None

    def test_clear_results(self):
        """Clear all stored results."""
        self.service._results = {
            "task-1": None,
            "task-2": None,
            "task-3": None,
        }

        count = self.service.clear_results()
        assert count == 3
        assert self.service.get_task_count() == 0

    def test_generate_task_id(self):
        """Task IDs are unique."""
        ids = [self.service._generate_task_id() for _ in range(100)]
        assert len(set(ids)) == 100  # All unique


class TestValidateTaskConfig:
    """Test validate_task_config helper."""

    def test_valid_combinations(self):
        """Valid combinations return True."""
        assert validate_task_config(agent_count=4, topology="distributed") is True
        assert validate_task_config(agent_count=8, topology="hierarchical") is True
        assert validate_task_config(agent_count=12, topology="mesh") is True

    def test_invalid_agent_count(self):
        """Invalid agent count returns False."""
        assert validate_task_config(agent_count=5) is False
        assert validate_task_config(agent_count=10) is False
        assert validate_task_config(agent_count=0) is False

    def test_invalid_topology(self):
        """Invalid topology returns False."""
        assert validate_task_config(topology="invalid") is False
        assert validate_task_config(topology="") is False


class TestPostgresTaskAdapter:
    """Test PostgresTaskAdapter interface."""

    def setup_method(self):
        """Create adapter without real connection."""
        self.adapter = PostgresTaskAdapter()

    @pytest.mark.asyncio
    async def test_connect_without_string(self):
        """Connect fails without connection string."""
        result = await self.adapter.connect()
        assert result is False

    @pytest.mark.asyncio
    async def test_save_without_connection(self):
        """Save fails when not connected."""
        result = ParallelTaskResult(
            task_id="test",
            agent_count=4,
            topology="distributed",
        )
        saved = await self.adapter.save_result(result)
        assert saved is False

    @pytest.mark.asyncio
    async def test_load_without_connection(self):
        """Load returns None when not connected."""
        result = await self.adapter.load_result("test-id")
        assert result is None

    @pytest.mark.asyncio
    async def test_load_results_without_connection(self):
        """Load results returns empty list when not connected."""
        results = await self.adapter.load_results()
        assert results == []

    @pytest.mark.asyncio
    async def test_delete_without_connection(self):
        """Delete fails when not connected."""
        result = await self.adapter.delete_result("test-id")
        assert result is False


class TestIntegration:
    """Integration tests for parallel task execution."""

    def setup_method(self):
        """Create fresh service."""
        self.service = TaskService()

    @pytest.mark.asyncio
    async def test_full_workflow(self):
        """Complete workflow from execution to retrieval."""
        # 1. Execute task
        result = await self.service.execute_parallel_task(
            task_description="Research codebase patterns",
            agent_count=8,
            topology="distributed",
        )

        # 2. Verify result
        assert result.is_successful()
        assert result.metrics.speedup_factor >= 1.0

        # 3. Retrieve from storage
        stored = await self.service.get_task_result(result.task_id)
        assert stored is not None
        assert stored.task_id == result.task_id

        # 4. Verify metrics persisted
        assert stored.metrics.agent_count == 8
        assert stored.metrics.execution_time_seconds > 0

    @pytest.mark.asyncio
    async def test_concurrent_tasks(self):
        """Multiple tasks can run concurrently."""
        tasks = [
            self.service.execute_parallel_task(
                task_description=f"Concurrent task {i}",
                agent_count=4,
            )
            for i in range(3)
        ]

        results = await asyncio.gather(*tasks)

        assert len(results) == 3
        for result in results:
            assert result.is_successful()

    @pytest.mark.asyncio
    async def test_metrics_accuracy(self):
        """Metrics reflect actual execution."""
        result = await self.service.execute_parallel_task(
            task_description="Metrics test",
            agent_count=8,
            topology="hierarchical",
        )

        metrics = result.metrics

        # Execution time should be positive
        assert metrics.execution_time_seconds > 0

        # Agent count should match
        assert metrics.agent_count == 8

        # Successful agents should equal agent count (simulation)
        assert metrics.agents_successful == 8
        assert metrics.agents_failed == 0

        # Speedup should be calculated
        assert metrics.speedup_factor >= 1.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
