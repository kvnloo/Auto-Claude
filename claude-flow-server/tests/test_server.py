"""
Tests for MCP Server Module
============================

Unit tests for MCP server, tool implementations, and server state management.
"""

import os
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import pytest

from claude_flow_server.config import ClaudeFlowConfig, TopologyMode, VALID_AGENT_COUNTS
from claude_flow_server.result_aggregator import ResultAggregator
from claude_flow_server.subprocess_manager import ExecutionResult, SubprocessManager

# Import server components
from claude_flow_server.server import (
    FASTMCP_AVAILABLE,
    TOOL_AGENT_SPAWN,
    TOOL_HEALTH_CHECK,
    TOOL_MEMORY_USAGE,
    TOOL_PARALLEL_EXECUTE,
    TOOL_SWARM_INIT,
    TOOL_TASK_ORCHESTRATE,
    _get_state,
    _parse_claude_flow_output,
    _set_state,
    agent_spawn,
    create_claude_flow_tools,
    health_check,
    is_tools_available,
    memory_usage,
    parallel_execute,
    swarm_init,
    task_orchestrate,
)


# =============================================================================
# SERVER STATE TESTS
# =============================================================================


class TestServerState:
    """Tests for server state management."""

    def test_get_state_returns_dict(self):
        """Test _get_state returns a dictionary."""
        state = _get_state()
        assert isinstance(state, dict)

    def test_set_state_updates_value(self):
        """Test _set_state updates a value."""
        _set_state("test_key", "test_value")
        state = _get_state()
        assert state.get("test_key") == "test_value"
        # Cleanup
        _set_state("test_key", None)

    def test_state_contains_expected_keys(self):
        """Test state contains expected initial keys."""
        state = _get_state()
        assert "initialized" in state
        assert "config" in state
        assert "subprocess_manager" in state
        assert "result_aggregator" in state
        assert "swarm_dir" in state


# =============================================================================
# TOOL NAME CONSTANTS TESTS
# =============================================================================


class TestToolNameConstants:
    """Tests for tool name constants."""

    def test_tool_names_prefixed(self):
        """Test all tool names have correct prefix."""
        prefix = "mcp__claude-flow__"
        assert TOOL_SWARM_INIT.startswith(prefix)
        assert TOOL_AGENT_SPAWN.startswith(prefix)
        assert TOOL_PARALLEL_EXECUTE.startswith(prefix)
        assert TOOL_MEMORY_USAGE.startswith(prefix)
        assert TOOL_HEALTH_CHECK.startswith(prefix)
        assert TOOL_TASK_ORCHESTRATE.startswith(prefix)

    def test_all_six_tools_defined(self):
        """Test all 6 expected tools have constants."""
        tools = [
            TOOL_SWARM_INIT,
            TOOL_AGENT_SPAWN,
            TOOL_PARALLEL_EXECUTE,
            TOOL_MEMORY_USAGE,
            TOOL_HEALTH_CHECK,
            TOOL_TASK_ORCHESTRATE,
        ]
        assert len(tools) == 6
        # All should be unique
        assert len(set(tools)) == 6


# =============================================================================
# SWARM INIT TESTS
# =============================================================================


class TestSwarmInit:
    """Tests for swarm_init tool."""

    @pytest.fixture(autouse=True)
    def reset_state(self):
        """Reset server state before each test."""
        _set_state("initialized", False)
        _set_state("config", None)
        _set_state("subprocess_manager", None)
        _set_state("result_aggregator", None)
        _set_state("swarm_dir", None)
        yield
        # Cleanup after test
        _set_state("initialized", False)
        _set_state("config", None)
        _set_state("subprocess_manager", None)
        _set_state("result_aggregator", None)
        _set_state("swarm_dir", None)

    async def test_swarm_init_success(self):
        """Test successful swarm initialization."""
        with mock.patch.object(
            SubprocessManager, "check_claude_flow_available", return_value=True
        ):
            result = await swarm_init(max_agents=4, topology="distributed")

        assert result["success"] is True
        assert result["initialized"] is True
        assert "config" in result
        assert result["config"]["max_agents"] == 4
        assert result["config"]["topology"] == "distributed"

    async def test_swarm_init_invalid_agent_count(self):
        """Test swarm_init with invalid agent count."""
        result = await swarm_init(max_agents=5, topology="distributed")

        assert result["success"] is False
        assert "Invalid agent count" in result["error"]

    async def test_swarm_init_invalid_topology(self):
        """Test swarm_init with invalid topology."""
        result = await swarm_init(max_agents=4, topology="invalid")

        assert result["success"] is False
        assert "Invalid topology" in result["error"]

    async def test_swarm_init_updates_state(self):
        """Test swarm_init updates server state."""
        with mock.patch.object(
            SubprocessManager, "check_claude_flow_available", return_value=True
        ):
            await swarm_init(max_agents=8, topology="hierarchical")

        state = _get_state()
        assert state["initialized"] is True
        assert state["config"] is not None
        assert state["config"].max_agents == 8

    async def test_swarm_init_with_working_dir(self):
        """Test swarm_init with custom working directory."""
        with mock.patch.object(
            SubprocessManager, "check_claude_flow_available", return_value=True
        ):
            result = await swarm_init(working_dir="/tmp/test")

        assert result["success"] is True
        assert result["working_dir"] == "/tmp/test"

    async def test_swarm_init_claude_flow_not_available(self):
        """Test swarm_init when Claude Flow is not installed."""
        with mock.patch.object(
            SubprocessManager, "check_claude_flow_available", return_value=False
        ):
            result = await swarm_init()

        assert result["success"] is True  # Still succeeds but with warning
        assert result["claude_flow_available"] is False
        assert "not found" in result["message"].lower() or "Install" in result["message"]

    async def test_swarm_init_all_valid_agent_counts(self):
        """Test swarm_init accepts all valid agent counts."""
        for count in VALID_AGENT_COUNTS:
            _set_state("initialized", False)
            with mock.patch.object(
                SubprocessManager, "check_claude_flow_available", return_value=True
            ):
                result = await swarm_init(max_agents=count)
            assert result["success"] is True

    async def test_swarm_init_all_valid_topologies(self):
        """Test swarm_init accepts all valid topologies."""
        topologies = ["distributed", "hierarchical", "mesh", "centralized"]
        for topology in topologies:
            _set_state("initialized", False)
            with mock.patch.object(
                SubprocessManager, "check_claude_flow_available", return_value=True
            ):
                result = await swarm_init(topology=topology)
            assert result["success"] is True


# =============================================================================
# AGENT SPAWN TESTS
# =============================================================================


class TestAgentSpawn:
    """Tests for agent_spawn tool."""

    @pytest.fixture(autouse=True)
    def setup_state(self):
        """Setup initialized state for tests."""
        config = ClaudeFlowConfig()
        manager = mock.Mock(spec=SubprocessManager)
        _set_state("initialized", True)
        _set_state("config", config)
        _set_state("subprocess_manager", manager)
        _set_state("result_aggregator", ResultAggregator())
        yield
        _set_state("initialized", False)
        _set_state("config", None)
        _set_state("subprocess_manager", None)
        _set_state("result_aggregator", None)

    async def test_agent_spawn_requires_init(self):
        """Test agent_spawn requires initialization."""
        _set_state("initialized", False)
        result = await agent_spawn(task="test task")

        assert result["success"] is False
        assert "not initialized" in result["error"].lower()

    async def test_agent_spawn_success(self):
        """Test successful agent spawn."""
        mock_result = ExecutionResult(success=True, stdout="Agent output", duration_seconds=5.0)
        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_result)

        result = await agent_spawn(task="research task", role="researcher")

        assert result["success"] is True
        assert result["role"] == "researcher"
        assert "agent_id" in result
        assert result["output"] == "Agent output"

    async def test_agent_spawn_with_custom_id(self):
        """Test agent spawn with custom agent ID."""
        mock_result = ExecutionResult(success=True, stdout="Output")
        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_result)

        result = await agent_spawn(task="task", agent_id="custom-agent-123")

        assert result["agent_id"] == "custom-agent-123"

    async def test_agent_spawn_invalid_role(self):
        """Test agent spawn with invalid role."""
        result = await agent_spawn(task="test", role="invalid_role")

        assert result["success"] is False
        assert "Invalid role" in result["error"]

    async def test_agent_spawn_valid_roles(self):
        """Test agent spawn accepts all valid roles."""
        mock_result = ExecutionResult(success=True, stdout="Output")
        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_result)

        valid_roles = ["researcher", "analyst", "coder", "reviewer"]
        for role in valid_roles:
            result = await agent_spawn(task="test", role=role)
            assert result["success"] is True
            assert result["role"] == role


# =============================================================================
# PARALLEL EXECUTE TESTS
# =============================================================================


class TestParallelExecute:
    """Tests for parallel_execute tool."""

    @pytest.fixture(autouse=True)
    def reset_state(self):
        """Reset server state before each test."""
        _set_state("initialized", False)
        _set_state("config", None)
        _set_state("subprocess_manager", None)
        _set_state("result_aggregator", None)
        yield
        _set_state("initialized", False)
        _set_state("config", None)
        _set_state("subprocess_manager", None)
        _set_state("result_aggregator", None)

    async def test_parallel_execute_auto_init(self):
        """Test parallel_execute auto-initializes if needed."""
        mock_result = ExecutionResult(
            success=True,
            stdout='[{"agent_id": "agent-1", "output": "Result"}]',
        )

        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            with mock.patch.object(SubprocessManager, "run_claude_flow", return_value=mock_result):
                result = await parallel_execute(task_description="research task")

        # Should auto-initialize and succeed
        state = _get_state()
        assert state["initialized"] is True

    async def test_parallel_execute_invalid_agent_count(self):
        """Test parallel_execute with invalid agent count."""
        # First initialize
        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            await swarm_init()

        result = await parallel_execute(task_description="test", max_agents=5)

        assert result["success"] is False
        assert "Invalid agent count" in result["error"]

    async def test_parallel_execute_invalid_topology(self):
        """Test parallel_execute with invalid topology."""
        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            await swarm_init()

        result = await parallel_execute(task_description="test", topology="invalid")

        assert result["success"] is False
        assert "Invalid topology" in result["error"]

    async def test_parallel_execute_success(self):
        """Test successful parallel execution."""
        mock_result = ExecutionResult(
            success=True,
            stdout='[{"agent_id": "agent-1", "output": "Finding 1"}, {"agent_id": "agent-2", "output": "Finding 2"}]',
            duration_seconds=10.0,
        )

        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            await swarm_init(max_agents=4)

        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_result)

        result = await parallel_execute(task_description="research task", max_agents=4)

        assert result["success"] is True
        assert "combined_output" in result
        assert "metrics" in result

    async def test_parallel_execute_with_subtasks(self):
        """Test parallel execution with subtasks."""
        mock_result = ExecutionResult(success=True, stdout='{"output": "Done"}')

        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            await swarm_init()

        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_result)

        subtasks = ["Subtask 1", "Subtask 2", "Subtask 3"]
        result = await parallel_execute(
            task_description="main task",
            subtasks=subtasks,
        )

        # Verify subtasks were passed
        call_args = state["subprocess_manager"].run_claude_flow.call_args
        assert "Subtask 1" in call_args[1]["task"] or "Subtask 1" in str(call_args)

    async def test_parallel_execute_handles_failure(self):
        """Test parallel execution handles subprocess failure."""
        mock_result = ExecutionResult(
            success=False,
            error="Subprocess failed",
            stderr="Error details",
        )

        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            await swarm_init()

        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_result)

        result = await parallel_execute(task_description="failing task")

        assert result["success"] is False
        assert "error" in result


# =============================================================================
# MEMORY USAGE TESTS
# =============================================================================


class TestMemoryUsage:
    """Tests for memory_usage tool."""

    async def test_memory_usage_success(self):
        """Test memory_usage returns expected structure."""
        result = await memory_usage()

        assert result["success"] is True
        assert "swarm_memory_mb" in result
        assert "active_processes" in result
        assert "initialized" in result

    async def test_memory_usage_with_initialized_manager(self):
        """Test memory_usage with initialized subprocess manager."""
        manager = mock.Mock(spec=SubprocessManager)
        manager.get_active_processes = mock.AsyncMock(return_value=[
            {"pid": 123, "task_id": "task-1"},
        ])
        _set_state("subprocess_manager", manager)

        result = await memory_usage()

        assert result["success"] is True
        assert result["active_processes"] == 1

        _set_state("subprocess_manager", None)

    async def test_memory_usage_without_manager(self):
        """Test memory_usage without subprocess manager."""
        _set_state("subprocess_manager", None)

        result = await memory_usage()

        assert result["success"] is True
        assert result["active_processes"] == 0


# =============================================================================
# HEALTH CHECK TESTS
# =============================================================================


class TestHealthCheck:
    """Tests for health_check tool."""

    async def test_health_check_returns_components(self):
        """Test health_check returns all component statuses."""
        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
                result = await health_check()

        assert result["success"] is True
        assert "components" in result
        assert "initialized" in result["components"]
        assert "claude_flow_cli" in result["components"]
        assert "api_key" in result["components"]
        assert "processes" in result["components"]

    async def test_health_check_healthy_when_available(self):
        """Test health_check reports healthy when all available."""
        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
                result = await health_check()

        assert result["status"] == "healthy"

    async def test_health_check_degraded_without_api_key(self):
        """Test health_check reports degraded without API key."""
        _set_state("subprocess_manager", None)

        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            with mock.patch.dict(os.environ, {}, clear=True):
                result = await health_check()

        assert result["status"] == "degraded"
        assert "API key not configured" in result.get("issues", [])

    async def test_health_check_degraded_without_claude_flow(self):
        """Test health_check reports degraded without Claude Flow."""
        _set_state("subprocess_manager", None)

        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=False):
            with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "key"}):
                result = await health_check()

        assert result["status"] == "degraded"
        assert any("Claude Flow" in issue for issue in result.get("issues", []))

    async def test_health_check_includes_timestamp(self):
        """Test health_check includes timestamp."""
        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            result = await health_check()

        assert "timestamp" in result
        # Should be ISO format
        datetime.fromisoformat(result["timestamp"].replace("Z", "+00:00"))


# =============================================================================
# TASK ORCHESTRATE TESTS
# =============================================================================


class TestTaskOrchestrate:
    """Tests for task_orchestrate tool."""

    @pytest.fixture(autouse=True)
    def reset_state(self):
        """Reset server state before each test."""
        _set_state("initialized", False)
        _set_state("config", None)
        _set_state("subprocess_manager", None)
        _set_state("result_aggregator", None)
        yield
        _set_state("initialized", False)
        _set_state("config", None)
        _set_state("subprocess_manager", None)
        _set_state("result_aggregator", None)

    async def test_task_orchestrate_no_subtasks(self):
        """Test task_orchestrate with no subtasks fails."""
        result = await task_orchestrate(main_task="main", subtasks=[])

        assert result["success"] is False
        assert "No subtasks" in result["error"]

    async def test_task_orchestrate_invalid_agent_count(self):
        """Test task_orchestrate with invalid agent count."""
        result = await task_orchestrate(
            main_task="main",
            subtasks=["subtask1"],
            max_agents=5,
        )

        assert result["success"] is False
        assert "Invalid agent count" in result["error"]

    async def test_task_orchestrate_parallel_mode(self):
        """Test task_orchestrate in parallel mode."""
        mock_result = ExecutionResult(
            success=True,
            stdout='{"output": "Done"}',
            duration_seconds=5.0,
        )

        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            await swarm_init()

        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_result)

        result = await task_orchestrate(
            main_task="main task",
            subtasks=["subtask1", "subtask2"],
            sequential=False,
        )

        assert result["success"] is True
        assert result["execution_mode"] == "parallel"

    async def test_task_orchestrate_sequential_mode(self):
        """Test task_orchestrate in sequential mode."""
        mock_result = ExecutionResult(
            success=True,
            stdout='{"output": "Done"}',
            duration_seconds=5.0,
        )

        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            await swarm_init()

        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_result)

        result = await task_orchestrate(
            main_task="main task",
            subtasks=["subtask1", "subtask2"],
            sequential=True,
        )

        assert result["success"] is True
        assert result["execution_mode"] == "sequential"

    async def test_task_orchestrate_counts_subtasks(self):
        """Test task_orchestrate counts subtasks correctly."""
        mock_result = ExecutionResult(success=True, stdout='{"output": "Done"}')

        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            await swarm_init()

        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_result)

        subtasks = ["task1", "task2", "task3"]
        result = await task_orchestrate(main_task="main", subtasks=subtasks)

        assert result["subtask_count"] == 3


# =============================================================================
# PARSE OUTPUT TESTS
# =============================================================================


class TestParseClaudeFlowOutput:
    """Tests for _parse_claude_flow_output helper."""

    def test_parse_json_array(self):
        """Test parsing JSON array output."""
        output = '[{"agent_id": "agent-1", "output": "A"}, {"agent_id": "agent-2", "output": "B"}]'
        result = _parse_claude_flow_output(output)
        assert len(result) == 2
        assert result[0]["agent_id"] == "agent-1"

    def test_parse_json_object_with_agents(self):
        """Test parsing JSON object with agents key."""
        output = '{"agents": [{"agent_id": "agent-1", "output": "Result"}]}'
        result = _parse_claude_flow_output(output)
        assert len(result) == 1
        assert result[0]["output"] == "Result"

    def test_parse_json_object_with_results(self):
        """Test parsing JSON object with results key."""
        output = '{"results": [{"agent_id": "agent-1", "output": "Data"}]}'
        result = _parse_claude_flow_output(output)
        assert len(result) == 1
        assert result[0]["output"] == "Data"

    def test_parse_json_object_with_output(self):
        """Test parsing JSON object with output key."""
        output = '{"output": "Single result"}'
        result = _parse_claude_flow_output(output)
        assert len(result) == 1
        assert result[0]["output"] == "Single result"

    def test_parse_plain_text(self):
        """Test parsing plain text output."""
        output = "Plain text result without JSON"
        result = _parse_claude_flow_output(output)
        assert len(result) == 1
        assert result[0]["output"] == output

    def test_parse_text_with_agent_sections(self):
        """Test parsing text with Agent sections."""
        output = "Agent 1 Output:\nResult 1\n\nAgent 2 Output:\nResult 2"
        result = _parse_claude_flow_output(output)
        # Should detect and split agent sections
        assert len(result) >= 1


# =============================================================================
# HELPER FUNCTION TESTS
# =============================================================================


class TestHelperFunctions:
    """Tests for server helper functions."""

    def test_create_claude_flow_tools(self):
        """Test create_claude_flow_tools returns all tools."""
        tools = create_claude_flow_tools()
        assert len(tools) == 6
        assert swarm_init in tools
        assert agent_spawn in tools
        assert parallel_execute in tools
        assert memory_usage in tools
        assert health_check in tools
        assert task_orchestrate in tools

    def test_is_tools_available(self):
        """Test is_tools_available returns correct value."""
        result = is_tools_available()
        assert result == FASTMCP_AVAILABLE


# =============================================================================
# MCP SERVER CREATION TESTS
# =============================================================================


class TestMCPServerCreation:
    """Tests for MCP server creation."""

    @pytest.mark.skipif(not FASTMCP_AVAILABLE, reason="FastMCP not installed")
    def test_create_mcp_server(self):
        """Test creating MCP server when FastMCP is available."""
        from claude_flow_server.server import create_claude_flow_mcp_server

        server = create_claude_flow_mcp_server()
        assert server is not None

    def test_mcp_server_without_fastmcp(self):
        """Test MCP server creation without FastMCP."""
        from claude_flow_server.server import create_claude_flow_mcp_server

        with mock.patch("claude_flow_server.server.FASTMCP_AVAILABLE", False):
            server = create_claude_flow_mcp_server()
            assert server is None


# =============================================================================
# INTEGRATION-STYLE TESTS
# =============================================================================


class TestToolIntegration:
    """Integration-style tests for tool workflows."""

    @pytest.fixture(autouse=True)
    def reset_state(self):
        """Reset server state before each test."""
        _set_state("initialized", False)
        _set_state("config", None)
        _set_state("subprocess_manager", None)
        _set_state("result_aggregator", None)
        _set_state("swarm_dir", None)
        yield
        _set_state("initialized", False)
        _set_state("config", None)
        _set_state("subprocess_manager", None)
        _set_state("result_aggregator", None)
        _set_state("swarm_dir", None)

    async def test_init_then_spawn_workflow(self):
        """Test initializing then spawning an agent."""
        # Initialize
        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            init_result = await swarm_init(max_agents=4)
        assert init_result["success"] is True

        # Spawn agent
        mock_execution = ExecutionResult(success=True, stdout="Agent completed")
        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_execution)

        spawn_result = await agent_spawn(task="research task")
        assert spawn_result["success"] is True

    async def test_init_then_parallel_execute_workflow(self):
        """Test initializing then running parallel execution."""
        # Initialize
        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            init_result = await swarm_init(max_agents=8)
        assert init_result["success"] is True

        # Execute parallel task
        mock_execution = ExecutionResult(
            success=True,
            stdout='[{"agent_id": "a1", "output": "R1"}, {"agent_id": "a2", "output": "R2"}]',
            duration_seconds=15.0,
        )
        state = _get_state()
        state["subprocess_manager"].run_claude_flow = mock.AsyncMock(return_value=mock_execution)

        exec_result = await parallel_execute(task_description="research")
        assert exec_result["success"] is True
        assert exec_result["agent_count"] == 2

    async def test_health_check_after_init(self):
        """Test health check shows initialized state."""
        # Initialize
        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            await swarm_init()

        # Check health
        with mock.patch.object(SubprocessManager, "check_claude_flow_available", return_value=True):
            with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "key"}):
                health = await health_check()

        assert health["components"]["initialized"]["status"] == "ok"
