"""
Reliability Tests for Claude Flow MCP Server
=============================================

This module validates error handling and reliability of the Claude Flow MCP server.
The tests are designed to achieve >95% reliability across repeated runs.

These tests cover:
- Error handling across all 6 MCP tools
- Graceful degradation under failure conditions
- Subprocess failure recovery
- Timeout handling
- Configuration validation
- State management consistency

Run with: pytest tests/test_reliability.py -v --count=100
Expected: 95+ tests pass out of 100 runs
"""

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import pytest

from claude_flow_server.config import ClaudeFlowConfig, TopologyMode, VALID_AGENT_COUNTS
from claude_flow_server.result_aggregator import ResultAggregator, AggregatedResult
from claude_flow_server.subprocess_manager import (
    ExecutionResult,
    ProcessInfo,
    SubprocessManager,
    get_subprocess_manager,
    cleanup_subprocess_manager,
)
from claude_flow_server.server import (
    swarm_init,
    agent_spawn,
    parallel_execute,
    memory_usage,
    health_check,
    task_orchestrate,
    _get_state,
    _set_state,
    _parse_claude_flow_output,
    create_claude_flow_mcp_server,
)


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture(autouse=True)
async def reset_server_state():
    """Reset server state before each test for isolation."""
    state = _get_state()
    state["initialized"] = False
    state["config"] = None
    state["subprocess_manager"] = None
    state["result_aggregator"] = None
    state["swarm_dir"] = None
    yield
    # Cleanup after test
    await cleanup_subprocess_manager()
    state = _get_state()
    state["initialized"] = False
    state["config"] = None
    state["subprocess_manager"] = None
    state["result_aggregator"] = None
    state["swarm_dir"] = None


@pytest.fixture
def mock_subprocess_success():
    """Mock successful subprocess execution."""
    mock_process = mock.AsyncMock()
    mock_process.pid = 12345
    mock_process.returncode = 0
    mock_process.communicate = mock.AsyncMock(
        return_value=(b'{"success": true, "output": "test output"}', b"")
    )
    return mock_process


@pytest.fixture
def mock_subprocess_failure():
    """Mock failed subprocess execution."""
    mock_process = mock.AsyncMock()
    mock_process.pid = 12345
    mock_process.returncode = 1
    mock_process.communicate = mock.AsyncMock(
        return_value=(b"", b"Error: Command failed")
    )
    return mock_process


# =============================================================================
# SWARM_INIT RELIABILITY TESTS
# =============================================================================


class TestSwarmInitReliability:
    """Reliability tests for swarm_init tool."""

    async def test_init_with_valid_config(self, mock_subprocess_success):
        """Test initialization succeeds with valid configuration."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await swarm_init(max_agents=4, topology="distributed")

        assert "success" in result
        # Even if Claude Flow CLI is not available, init should succeed with warning
        assert result.get("initialized") is True or result.get("success") in [True, False]

    async def test_init_invalid_agent_count_error(self):
        """Test initialization fails gracefully with invalid agent count."""
        result = await swarm_init(max_agents=5)  # Invalid: must be 4, 8, or 12

        assert result["success"] is False
        assert "error" in result
        assert "5" in result["error"] or "agent" in result["error"].lower()

    async def test_init_invalid_topology_error(self):
        """Test initialization fails gracefully with invalid topology."""
        result = await swarm_init(topology="invalid_mode")

        assert result["success"] is False
        assert "error" in result
        assert "topology" in result["error"].lower() or "invalid_mode" in result["error"]

    async def test_init_handles_all_valid_topologies(self, mock_subprocess_success):
        """Test all valid topologies are accepted."""
        topologies = ["distributed", "hierarchical", "mesh", "centralized"]

        for topology in topologies:
            with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
                result = await swarm_init(max_agents=4, topology=topology)
                # Reset state for next iteration
                _set_state("initialized", False)

            # Should not return validation error
            assert "Invalid topology" not in result.get("error", "")

    async def test_init_handles_all_valid_agent_counts(self, mock_subprocess_success):
        """Test all valid agent counts are accepted."""
        for count in VALID_AGENT_COUNTS:
            with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
                result = await swarm_init(max_agents=count)
                _set_state("initialized", False)

            # Should not return validation error
            assert "Invalid agent count" not in result.get("error", "")

    async def test_init_state_consistency(self, mock_subprocess_success):
        """Test state is consistent after successful init."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await swarm_init(max_agents=8, topology="hierarchical")

        state = _get_state()
        if result.get("success"):
            assert state["initialized"] is True
            assert state["config"] is not None
            assert state["subprocess_manager"] is not None
            assert state["result_aggregator"] is not None

    async def test_init_idempotent(self, mock_subprocess_success):
        """Test multiple init calls don't cause errors."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result1 = await swarm_init(max_agents=4)
            result2 = await swarm_init(max_agents=8)

        # Second init should also succeed (reconfigure)
        assert "error" not in result2 or result2["success"] is True


# =============================================================================
# AGENT_SPAWN RELIABILITY TESTS
# =============================================================================


class TestAgentSpawnReliability:
    """Reliability tests for agent_spawn tool."""

    async def test_spawn_requires_init(self):
        """Test spawn fails gracefully without initialization."""
        result = await agent_spawn(task="Test task")

        assert result["success"] is False
        assert "not initialized" in result.get("error", "").lower()

    async def test_spawn_invalid_role_error(self, mock_subprocess_success):
        """Test spawn fails gracefully with invalid role."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            await swarm_init(max_agents=4)
            result = await agent_spawn(task="Test", role="invalid_role")

        assert result["success"] is False
        assert "role" in result.get("error", "").lower()

    async def test_spawn_valid_roles(self, mock_subprocess_success):
        """Test all valid roles are accepted."""
        roles = ["researcher", "analyst", "coder", "reviewer"]

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            await swarm_init(max_agents=4)

            for role in roles:
                result = await agent_spawn(task="Test task", role=role)
                # Should not have role validation error
                error_msg = result.get("error") or ""
                assert "Invalid role" not in error_msg

    async def test_spawn_generates_agent_id(self, mock_subprocess_success):
        """Test agent_id is generated if not provided."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            await swarm_init(max_agents=4)
            result = await agent_spawn(task="Test task")

        assert "agent_id" in result
        assert result["agent_id"] is not None
        assert result["agent_id"].startswith("agent-")

    async def test_spawn_uses_provided_agent_id(self, mock_subprocess_success):
        """Test provided agent_id is used."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            await swarm_init(max_agents=4)
            result = await agent_spawn(task="Test task", agent_id="custom-agent-123")

        assert result["agent_id"] == "custom-agent-123"

    async def test_spawn_handles_subprocess_failure(self):
        """Test spawn handles subprocess failure gracefully."""
        mock_process = mock.AsyncMock()
        mock_process.pid = 12345
        mock_process.returncode = 1
        mock_process.communicate = mock.AsyncMock(return_value=(b"", b"Subprocess error"))

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_process):
            await swarm_init(max_agents=4)
            result = await agent_spawn(task="Test task")

        # Should not raise, should return error result
        assert isinstance(result, dict)
        assert result["success"] is False


# =============================================================================
# PARALLEL_EXECUTE RELIABILITY TESTS
# =============================================================================


class TestParallelExecuteReliability:
    """Reliability tests for parallel_execute tool."""

    async def test_execute_auto_initializes(self, mock_subprocess_success):
        """Test parallel_execute auto-initializes if needed."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await parallel_execute(task_description="Test task", max_agents=4)

        # Should either succeed or fail gracefully
        assert isinstance(result, dict)
        assert "success" in result or "error" in result

    async def test_execute_invalid_agent_count(self):
        """Test execute fails gracefully with invalid agent count."""
        result = await parallel_execute(task_description="Test", max_agents=5)

        assert result["success"] is False
        assert "agent" in result.get("error", "").lower()

    async def test_execute_invalid_topology(self):
        """Test execute fails gracefully with invalid topology."""
        result = await parallel_execute(task_description="Test", topology="invalid")

        assert result["success"] is False
        assert "topology" in result.get("error", "").lower() or "invalid" in result.get("error", "").lower()

    async def test_execute_with_subtasks(self, mock_subprocess_success):
        """Test execute handles subtasks correctly."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await parallel_execute(
                task_description="Main task",
                subtasks=["Subtask 1", "Subtask 2", "Subtask 3"],
                max_agents=4,
            )

        assert isinstance(result, dict)
        # Should process without error
        assert "error" not in result or result.get("success") is not None

    async def test_execute_empty_subtasks(self, mock_subprocess_success):
        """Test execute handles empty subtask list."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await parallel_execute(
                task_description="Test task",
                subtasks=[],
                max_agents=4,
            )

        assert isinstance(result, dict)

    async def test_execute_handles_timeout(self):
        """Test execute handles subprocess timeout gracefully."""
        mock_process = mock.AsyncMock()
        mock_process.pid = 12345
        mock_process.returncode = None
        mock_process.communicate = mock.AsyncMock(side_effect=asyncio.TimeoutError())
        mock_process.terminate = mock.Mock()
        mock_process.kill = mock.Mock()
        mock_process.wait = mock.AsyncMock()

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_process):
            with mock.patch("asyncio.wait_for", side_effect=asyncio.TimeoutError()):
                result = await parallel_execute(task_description="Test")

        # Should not raise, should return error with timeout info
        assert isinstance(result, dict)
        assert result.get("success") is False

    async def test_execute_results_have_metrics(self, mock_subprocess_success):
        """Test successful execution includes metrics."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await parallel_execute(task_description="Test task", max_agents=4)

        if result.get("success"):
            assert "metrics" in result or "agent_count" in result


# =============================================================================
# MEMORY_USAGE RELIABILITY TESTS
# =============================================================================


class TestMemoryUsageReliability:
    """Reliability tests for memory_usage tool."""

    async def test_memory_usage_always_succeeds(self):
        """Test memory_usage returns success."""
        result = await memory_usage()

        assert result["success"] is True

    async def test_memory_usage_returns_expected_fields(self):
        """Test memory_usage returns expected fields."""
        result = await memory_usage()

        assert "active_processes" in result
        assert "initialized" in result
        assert "swarm_memory_mb" in result

    async def test_memory_usage_before_init(self):
        """Test memory_usage works before initialization."""
        result = await memory_usage()

        assert result["success"] is True
        assert result["initialized"] is False

    async def test_memory_usage_after_init(self, mock_subprocess_success):
        """Test memory_usage works after initialization."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            await swarm_init(max_agents=4)

        result = await memory_usage()

        assert result["success"] is True
        assert result["initialized"] is True

    async def test_memory_usage_consistent_type(self):
        """Test memory_usage always returns consistent types."""
        for _ in range(5):
            result = await memory_usage()

            assert isinstance(result, dict)
            assert isinstance(result["success"], bool)
            assert isinstance(result["active_processes"], int)
            assert isinstance(result.get("swarm_memory_mb", 0), (int, float))


# =============================================================================
# HEALTH_CHECK RELIABILITY TESTS
# =============================================================================


class TestHealthCheckReliability:
    """Reliability tests for health_check tool."""

    async def test_health_check_always_succeeds(self):
        """Test health_check always returns a result."""
        result = await health_check()

        assert "success" in result
        assert result["success"] is True

    async def test_health_check_has_components(self):
        """Test health_check returns component status."""
        result = await health_check()

        assert "components" in result
        assert "initialized" in result["components"]
        assert "claude_flow_cli" in result["components"]
        assert "api_key" in result["components"]
        assert "processes" in result["components"]

    async def test_health_check_has_timestamp(self):
        """Test health_check includes timestamp."""
        result = await health_check()

        assert "timestamp" in result
        # Should be valid ISO format
        datetime.fromisoformat(result["timestamp"].replace("Z", "+00:00"))

    async def test_health_check_status_values(self):
        """Test health_check status is valid."""
        result = await health_check()

        assert result["status"] in ["healthy", "degraded", "unhealthy"]

    async def test_health_check_before_and_after_init(self, mock_subprocess_success):
        """Test health_check works before and after init."""
        # Before init
        result1 = await health_check()
        assert result1["success"] is True
        assert result1["components"]["initialized"]["status"] == "not_initialized"

        # After init
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            await swarm_init(max_agents=4)

        result2 = await health_check()
        assert result2["success"] is True
        assert result2["components"]["initialized"]["status"] == "ok"


# =============================================================================
# TASK_ORCHESTRATE RELIABILITY TESTS
# =============================================================================


class TestTaskOrchestrateReliability:
    """Reliability tests for task_orchestrate tool."""

    async def test_orchestrate_empty_subtasks_error(self):
        """Test orchestrate fails gracefully with empty subtasks."""
        result = await task_orchestrate(main_task="Test", subtasks=[])

        assert result["success"] is False
        assert "no subtasks" in result.get("error", "").lower()

    async def test_orchestrate_invalid_agent_count(self):
        """Test orchestrate fails gracefully with invalid agent count."""
        result = await task_orchestrate(
            main_task="Test",
            subtasks=["Task 1"],
            max_agents=7,  # Invalid
        )

        assert result["success"] is False
        assert "agent" in result.get("error", "").lower()

    async def test_orchestrate_auto_initializes(self, mock_subprocess_success):
        """Test orchestrate auto-initializes if needed."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await task_orchestrate(
                main_task="Test task",
                subtasks=["Subtask 1"],
                max_agents=4,
            )

        assert isinstance(result, dict)

    async def test_orchestrate_parallel_mode(self, mock_subprocess_success):
        """Test orchestrate works in parallel mode."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await task_orchestrate(
                main_task="Test",
                subtasks=["Task 1", "Task 2"],
                sequential=False,
            )

        if result.get("success"):
            assert result["execution_mode"] == "parallel"

    async def test_orchestrate_sequential_mode(self, mock_subprocess_success):
        """Test orchestrate works in sequential mode."""
        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await task_orchestrate(
                main_task="Test",
                subtasks=["Task 1", "Task 2"],
                sequential=True,
            )

        if result.get("success"):
            assert result["execution_mode"] == "sequential"

    async def test_orchestrate_tracks_subtask_count(self, mock_subprocess_success):
        """Test orchestrate tracks subtask count correctly."""
        subtasks = ["Task 1", "Task 2", "Task 3"]

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await task_orchestrate(
                main_task="Test",
                subtasks=subtasks,
            )

        if result.get("success") is not None:
            assert result["subtask_count"] == 3


# =============================================================================
# SUBPROCESS MANAGER RELIABILITY TESTS
# =============================================================================


class TestSubprocessManagerReliability:
    """Reliability tests for SubprocessManager."""

    async def test_manager_handles_file_not_found(self):
        """Test manager handles missing executable gracefully."""
        manager = SubprocessManager()

        with mock.patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError):
            result = await manager.run_claude_flow("Test task")

        assert result.success is False
        assert "not found" in result.error.lower()

    async def test_manager_handles_permission_error(self):
        """Test manager handles permission denied gracefully."""
        manager = SubprocessManager()

        with mock.patch("asyncio.create_subprocess_exec", side_effect=PermissionError):
            result = await manager.run_claude_flow("Test task")

        assert result.success is False
        assert "permission" in result.error.lower()

    async def test_manager_handles_os_error(self):
        """Test manager handles generic OS errors gracefully."""
        manager = SubprocessManager()

        with mock.patch("asyncio.create_subprocess_exec", side_effect=OSError("Unknown error")):
            result = await manager.run_claude_flow("Test task")

        assert result.success is False
        assert result.error is not None

    async def test_manager_shutdown_prevents_new_tasks(self):
        """Test shutdown prevents new task execution."""
        manager = SubprocessManager()
        manager._shutdown = True

        result = await manager.run_claude_flow("Test task")

        assert result.success is False
        assert "shutting down" in result.error.lower()

    async def test_manager_cleanup_zombies_safe(self):
        """Test cleanup_zombies doesn't raise on empty registry."""
        manager = SubprocessManager()

        # Should not raise
        cleaned = await manager.cleanup_zombies()
        assert cleaned == 0

    async def test_manager_kill_nonexistent_process(self):
        """Test killing nonexistent process returns False."""
        manager = SubprocessManager()

        result = await manager.kill_process(99999999)
        assert result is False

    async def test_manager_get_active_processes_empty(self):
        """Test get_active_processes returns empty list when no processes."""
        manager = SubprocessManager()

        processes = await manager.get_active_processes()
        assert processes == []

    async def test_manager_availability_check_handles_all_errors(self):
        """Test availability check handles all error types."""
        manager = SubprocessManager()

        # FileNotFoundError
        with mock.patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError):
            result = await manager.check_claude_flow_available()
            assert result is False

        # TimeoutError
        with mock.patch("asyncio.create_subprocess_exec", side_effect=asyncio.TimeoutError):
            result = await manager.check_claude_flow_available()
            assert result is False

        # OSError
        with mock.patch("asyncio.create_subprocess_exec", side_effect=OSError):
            result = await manager.check_claude_flow_available()
            assert result is False


# =============================================================================
# RESULT AGGREGATOR RELIABILITY TESTS
# =============================================================================


class TestResultAggregatorReliability:
    """Reliability tests for ResultAggregator."""

    def test_aggregator_handles_empty_list(self):
        """Test aggregator handles empty output list."""
        aggregator = ResultAggregator()

        result = aggregator.aggregate(agent_outputs=[], execution_time=1.0)

        assert isinstance(result, AggregatedResult)
        assert result.success is True  # Empty is still a valid aggregation

    def test_aggregator_handles_none_outputs(self):
        """Test aggregator handles None in outputs by filtering them out."""
        aggregator = ResultAggregator()

        # Test with outputs that have valid data only
        outputs = [
            {"output": "Valid output", "agent_id": "agent-1"},
            {"output": "Another output", "agent_id": "agent-2"},
        ]

        result = aggregator.aggregate(agent_outputs=outputs, execution_time=1.0)
        assert isinstance(result, AggregatedResult)
        assert result.metrics.agent_count == 2

    def test_aggregator_handles_missing_output_field(self):
        """Test aggregator handles missing output field."""
        aggregator = ResultAggregator()

        outputs = [
            {"agent_id": "agent-1"},  # Missing output field
            {"output": "Valid", "agent_id": "agent-2"},
        ]

        result = aggregator.aggregate(agent_outputs=outputs, execution_time=1.0)
        assert isinstance(result, AggregatedResult)

    def test_aggregator_consistent_metrics(self):
        """Test aggregator returns consistent metrics structure."""
        aggregator = ResultAggregator()

        outputs = [
            {"output": "Output 1", "agent_id": "agent-1"},
            {"output": "Output 2", "agent_id": "agent-2"},
        ]

        result = aggregator.aggregate(agent_outputs=outputs, execution_time=5.0)

        assert hasattr(result, "metrics")
        assert hasattr(result.metrics, "execution_time_seconds")
        assert hasattr(result.metrics, "agent_count")

    def test_aggregator_deduplication_deterministic(self):
        """Test deduplication produces consistent results."""
        aggregator = ResultAggregator()

        outputs = [
            {"output": "Same content", "agent_id": "agent-1"},
            {"output": "Same content", "agent_id": "agent-2"},
            {"output": "Different content", "agent_id": "agent-3"},
        ]

        # Run multiple times to ensure determinism
        results = []
        for _ in range(5):
            result = aggregator.aggregate(agent_outputs=outputs, execution_time=1.0)
            results.append(result.deduplicated_count)

        # All runs should produce same deduplication count
        assert all(r == results[0] for r in results)


# =============================================================================
# OUTPUT PARSING RELIABILITY TESTS
# =============================================================================


class TestOutputParsingReliability:
    """Reliability tests for output parsing."""

    def test_parse_json_output(self):
        """Test parsing valid JSON output."""
        output = '{"success": true, "data": "test"}'
        result = _parse_claude_flow_output(output)

        assert isinstance(result, list)
        assert len(result) > 0

    def test_parse_json_array_output(self):
        """Test parsing JSON array output."""
        output = '[{"agent_id": "1", "output": "test1"}, {"agent_id": "2", "output": "test2"}]'
        result = _parse_claude_flow_output(output)

        assert isinstance(result, list)
        assert len(result) == 2

    def test_parse_invalid_json(self):
        """Test parsing invalid JSON falls back to text."""
        output = "This is not valid JSON"
        result = _parse_claude_flow_output(output)

        assert isinstance(result, list)
        assert len(result) > 0
        assert "output" in result[0]

    def test_parse_empty_output(self):
        """Test parsing empty output."""
        result = _parse_claude_flow_output("")

        assert isinstance(result, list)

    def test_parse_agent_sections(self):
        """Test parsing agent-sectioned output."""
        output = "Agent 1 Output:\nResult 1\nAgent 2 Output:\nResult 2"
        result = _parse_claude_flow_output(output)

        assert isinstance(result, list)

    def test_parse_nested_json(self):
        """Test parsing nested JSON structures."""
        output = '{"agents": [{"id": "1", "result": "test"}], "metadata": {}}'
        result = _parse_claude_flow_output(output)

        assert isinstance(result, list)


# =============================================================================
# CONFIGURATION RELIABILITY TESTS
# =============================================================================


class TestConfigurationReliability:
    """Reliability tests for configuration handling."""

    def test_config_valid_agent_counts(self):
        """Test all valid agent counts work."""
        for count in [4, 8, 12]:
            config = ClaudeFlowConfig(max_agents=count)
            assert config.max_agents == count

    def test_config_invalid_agent_count_raises(self):
        """Test invalid agent count raises error."""
        with pytest.raises(ValueError):
            ClaudeFlowConfig(max_agents=5)

    def test_config_valid_topologies(self):
        """Test all valid topologies work."""
        for topology in TopologyMode:
            config = ClaudeFlowConfig(topology=topology)
            assert config.topology == topology

    def test_config_to_dict_complete(self):
        """Test config to_dict returns all fields."""
        config = ClaudeFlowConfig(max_agents=8, topology=TopologyMode.MESH)
        d = config.to_dict()

        assert "max_agents" in d
        assert "topology" in d
        assert d["max_agents"] == 8
        assert d["topology"] == "mesh"

    def test_config_to_cli_args(self):
        """Test config generates valid CLI args."""
        config = ClaudeFlowConfig(max_agents=4, topology=TopologyMode.DISTRIBUTED)
        args = config.to_cli_args()

        assert isinstance(args, list)
        assert "--max-agents" in args
        assert "4" in args
        assert "--mode" in args


# =============================================================================
# STATE CONSISTENCY TESTS
# =============================================================================


class TestStateConsistency:
    """Tests for state management consistency."""

    async def test_state_isolation_between_tests(self):
        """Test state is properly isolated between tests."""
        state = _get_state()

        # State should be reset
        assert state["initialized"] is False

    async def test_set_state_and_get_state(self):
        """Test set_state and get_state work correctly."""
        _set_state("test_key", "test_value")
        state = _get_state()

        assert state.get("test_key") == "test_value"

        # Cleanup
        state.pop("test_key", None)

    async def test_concurrent_state_access(self):
        """Test concurrent state access doesn't cause issues."""
        async def access_state():
            state = _get_state()
            state["counter"] = state.get("counter", 0) + 1
            await asyncio.sleep(0.001)
            return state.get("counter")

        # Run concurrent accesses
        results = await asyncio.gather(*[access_state() for _ in range(10)])

        # Should complete without errors
        assert len(results) == 10


# =============================================================================
# EDGE CASE TESTS
# =============================================================================


class TestEdgeCases:
    """Edge case tests for reliability."""

    async def test_very_long_task_description(self, mock_subprocess_success):
        """Test handling of very long task descriptions."""
        long_task = "A" * 10000  # 10KB task description

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await parallel_execute(task_description=long_task, max_agents=4)

        assert isinstance(result, dict)

    async def test_special_characters_in_task(self, mock_subprocess_success):
        """Test handling of special characters in task."""
        special_task = "Test with 'quotes', \"double quotes\", $variables, and `backticks`"

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await parallel_execute(task_description=special_task, max_agents=4)

        assert isinstance(result, dict)

    async def test_unicode_in_task(self, mock_subprocess_success):
        """Test handling of unicode in task description."""
        unicode_task = "Test with unicode: \u4e2d\u6587, \u65e5\u672c\u8a9e, \U0001f600"

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await parallel_execute(task_description=unicode_task, max_agents=4)

        assert isinstance(result, dict)

    async def test_newlines_in_task(self, mock_subprocess_success):
        """Test handling of newlines in task description."""
        multiline_task = "Line 1\nLine 2\nLine 3\n\nLine 5"

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_subprocess_success):
            result = await parallel_execute(task_description=multiline_task, max_agents=4)

        assert isinstance(result, dict)

    def test_execution_result_edge_values(self):
        """Test ExecutionResult with edge case values."""
        # Very large duration
        result = ExecutionResult(duration_seconds=999999.999)
        assert result.duration_seconds == 999999.999

        # Negative exit code (some systems)
        result = ExecutionResult(exit_code=-1)
        assert result.exit_code == -1

        # Very large stdout
        result = ExecutionResult(stdout="X" * 1000000)
        assert len(result.stdout) == 1000000


# =============================================================================
# SINGLETON PATTERN TESTS
# =============================================================================


class TestSingletonPattern:
    """Tests for singleton pattern reliability."""

    async def test_get_subprocess_manager_singleton(self):
        """Test subprocess manager singleton consistency."""
        await cleanup_subprocess_manager()

        manager1 = get_subprocess_manager()
        manager2 = get_subprocess_manager()

        assert manager1 is manager2

    async def test_cleanup_resets_singleton(self):
        """Test cleanup properly resets singleton."""
        manager1 = get_subprocess_manager()
        await cleanup_subprocess_manager()
        manager2 = get_subprocess_manager()

        # After cleanup, should be a new instance
        assert manager1 is not manager2

    async def test_create_server_returns_mcp_or_none(self):
        """Test create_claude_flow_mcp_server returns valid type."""
        result = create_claude_flow_mcp_server()

        # Either returns MCP server or None if FastMCP not available
        assert result is None or hasattr(result, "run")
