"""
Tests for Subprocess Manager Module
====================================

Unit tests for SubprocessManager, ProcessInfo, ExecutionResult,
and subprocess lifecycle management.
"""

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import pytest

from claude_flow_server.config import ClaudeFlowConfig, TopologyMode
from claude_flow_server.subprocess_manager import (
    ExecutionResult,
    ProcessInfo,
    SubprocessManager,
    cleanup_subprocess_manager,
    get_subprocess_manager,
)


# =============================================================================
# EXECUTION RESULT TESTS
# =============================================================================


class TestExecutionResult:
    """Tests for ExecutionResult dataclass."""

    def test_default_values(self):
        """Test ExecutionResult default values."""
        result = ExecutionResult()
        assert result.success is False
        assert result.stdout == ""
        assert result.stderr == ""
        assert result.exit_code is None
        assert result.duration_seconds == 0.0
        assert result.error is None
        assert result.timed_out is False

    def test_successful_result(self):
        """Test ExecutionResult for successful execution."""
        result = ExecutionResult(
            success=True,
            stdout="Hello World",
            stderr="",
            exit_code=0,
            duration_seconds=1.5,
        )
        assert result.success is True
        assert result.stdout == "Hello World"
        assert result.exit_code == 0

    def test_failed_result(self):
        """Test ExecutionResult for failed execution."""
        result = ExecutionResult(
            success=False,
            stderr="Error occurred",
            exit_code=1,
            error="Command failed",
        )
        assert result.success is False
        assert result.error == "Command failed"
        assert result.exit_code == 1

    def test_timed_out_result(self):
        """Test ExecutionResult for timeout."""
        result = ExecutionResult(
            success=False,
            timed_out=True,
            error="Process timed out",
            duration_seconds=300.0,
        )
        assert result.timed_out is True
        assert result.success is False

    def test_to_dict(self):
        """Test ExecutionResult to_dict conversion."""
        result = ExecutionResult(
            success=True,
            stdout="output",
            stderr="",
            exit_code=0,
            duration_seconds=2.5,
            error=None,
            timed_out=False,
        )
        d = result.to_dict()
        assert d["success"] is True
        assert d["stdout"] == "output"
        assert d["stderr"] == ""
        assert d["exit_code"] == 0
        assert d["duration_seconds"] == 2.5
        assert d["error"] is None
        assert d["timed_out"] is False


class TestProcessInfo:
    """Tests for ProcessInfo dataclass."""

    def test_process_info_creation(self):
        """Test ProcessInfo creation with mock process."""
        mock_process = mock.Mock()
        mock_process.pid = 12345

        started_at = datetime.now(timezone.utc)
        info = ProcessInfo(
            pid=12345,
            process=mock_process,
            command=["npx", "claude-flow@alpha", "swarm", "test"],
            started_at=started_at,
            task_id="task-001",
        )

        assert info.pid == 12345
        assert info.process == mock_process
        assert info.command == ["npx", "claude-flow@alpha", "swarm", "test"]
        assert info.started_at == started_at
        assert info.task_id == "task-001"

    def test_process_info_without_task_id(self):
        """Test ProcessInfo without task_id."""
        mock_process = mock.Mock()
        info = ProcessInfo(
            pid=123,
            process=mock_process,
            command=["echo", "hello"],
            started_at=datetime.now(timezone.utc),
        )
        assert info.task_id is None


# =============================================================================
# SUBPROCESS MANAGER INITIALIZATION TESTS
# =============================================================================


class TestSubprocessManagerInit:
    """Tests for SubprocessManager initialization."""

    def test_default_initialization(self):
        """Test SubprocessManager with default config."""
        manager = SubprocessManager()
        assert manager.config is not None
        assert manager.working_dir == Path.cwd()
        assert len(manager._processes) == 0
        assert manager._shutdown is False

    def test_custom_config_initialization(self):
        """Test SubprocessManager with custom config."""
        config = ClaudeFlowConfig(max_agents=12, topology=TopologyMode.HIERARCHICAL)
        manager = SubprocessManager(config=config)
        assert manager.config.max_agents == 12
        assert manager.config.topology == TopologyMode.HIERARCHICAL

    def test_custom_working_dir(self):
        """Test SubprocessManager with custom working directory."""
        work_dir = Path("/tmp/test_work")
        manager = SubprocessManager(working_dir=work_dir)
        assert manager.working_dir == work_dir


# =============================================================================
# SUBPROCESS MANAGER BUILD COMMAND TESTS
# =============================================================================


class TestSubprocessManagerBuildCommand:
    """Tests for SubprocessManager._build_command method."""

    def test_build_command_default(self):
        """Test _build_command with default configuration."""
        manager = SubprocessManager()
        cmd = manager._build_command("research task")

        assert "npx" in cmd
        assert "claude-flow@alpha" in cmd
        assert "swarm" in cmd
        assert "research task" in cmd
        assert "--mode" in cmd
        assert "--max-agents" in cmd
        assert "--parallel" in cmd
        assert "--executor" in cmd

    def test_build_command_with_config_override(self):
        """Test _build_command with configuration override."""
        manager = SubprocessManager()
        config = {"topology": "hierarchical", "max_agents": 8}
        cmd = manager._build_command("test task", config)

        assert "hierarchical" in cmd
        assert "8" in cmd

    def test_build_command_uses_default_topology(self):
        """Test _build_command uses default topology from config."""
        config = ClaudeFlowConfig(topology=TopologyMode.MESH)
        manager = SubprocessManager(config=config)
        cmd = manager._build_command("task")

        assert "mesh" in cmd


# =============================================================================
# SUBPROCESS MANAGER RUN TESTS
# =============================================================================


class TestSubprocessManagerRun:
    """Tests for SubprocessManager.run_claude_flow method."""

    @pytest.fixture
    def manager(self):
        """Create a SubprocessManager instance for testing."""
        return SubprocessManager()

    async def test_run_returns_error_when_shutdown(self, manager):
        """Test run_claude_flow returns error when manager is shutting down."""
        manager._shutdown = True
        result = await manager.run_claude_flow("test task")

        assert result.success is False
        assert "shutting down" in result.error.lower()

    async def test_run_handles_file_not_found(self, manager):
        """Test run_claude_flow handles missing executable."""
        # Mock subprocess to raise FileNotFoundError
        with mock.patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError):
            result = await manager.run_claude_flow("test task")

        assert result.success is False
        assert "not found" in result.error.lower()

    async def test_run_handles_permission_error(self, manager):
        """Test run_claude_flow handles permission denied."""
        with mock.patch("asyncio.create_subprocess_exec", side_effect=PermissionError("Access denied")):
            result = await manager.run_claude_flow("test task")

        assert result.success is False
        assert "permission" in result.error.lower()

    async def test_run_handles_os_error(self, manager):
        """Test run_claude_flow handles generic OS errors."""
        with mock.patch("asyncio.create_subprocess_exec", side_effect=OSError("Unknown error")):
            result = await manager.run_claude_flow("test task")

        assert result.success is False
        assert "error" in result.error.lower()

    async def test_run_successful_execution(self, manager):
        """Test run_claude_flow successful subprocess execution."""
        mock_process = mock.AsyncMock()
        mock_process.pid = 12345
        mock_process.returncode = 0
        mock_process.communicate = mock.AsyncMock(
            return_value=(b"Success output", b"")
        )

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_process):
            result = await manager.run_claude_flow("test task")

        assert result.success is True
        assert result.stdout == "Success output"
        assert result.exit_code == 0

    async def test_run_failed_execution(self, manager):
        """Test run_claude_flow with non-zero exit code."""
        mock_process = mock.AsyncMock()
        mock_process.pid = 12345
        mock_process.returncode = 1
        mock_process.communicate = mock.AsyncMock(
            return_value=(b"", b"Error message")
        )

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_process):
            result = await manager.run_claude_flow("test task")

        assert result.success is False
        assert result.stderr == "Error message"
        assert result.exit_code == 1

    async def test_run_with_timeout(self, manager):
        """Test run_claude_flow handles timeout correctly."""
        mock_process = mock.AsyncMock()
        mock_process.pid = 12345
        mock_process.returncode = None

        # Simulate timeout
        mock_process.communicate = mock.AsyncMock(
            side_effect=asyncio.TimeoutError()
        )
        mock_process.terminate = mock.Mock()
        mock_process.kill = mock.Mock()
        mock_process.wait = mock.AsyncMock()

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_process):
            with mock.patch("asyncio.wait_for", side_effect=asyncio.TimeoutError()):
                result = await manager.run_claude_flow(
                    "test task", config={"timeout_seconds": 1}
                )

        assert result.success is False
        assert result.timed_out is True

    async def test_run_registers_process(self, manager):
        """Test run_claude_flow registers process in registry."""
        mock_process = mock.AsyncMock()
        mock_process.pid = 99999
        mock_process.returncode = 0
        mock_process.communicate = mock.AsyncMock(return_value=(b"", b""))

        registered_pid = None

        async def capture_registration(*args, **kwargs):
            nonlocal registered_pid
            # Simulate adding to registry
            return mock_process

        with mock.patch("asyncio.create_subprocess_exec", side_effect=capture_registration):
            result = await manager.run_claude_flow("test task")

        assert result.success is True
        # Process should be unregistered after completion
        assert mock_process.pid not in manager._processes


# =============================================================================
# SUBPROCESS MANAGER CHECK AVAILABILITY TESTS
# =============================================================================


class TestSubprocessManagerCheckAvailability:
    """Tests for SubprocessManager.check_claude_flow_available method."""

    async def test_check_available_when_installed(self):
        """Test check_claude_flow_available returns True when installed."""
        manager = SubprocessManager()

        mock_process = mock.AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate = mock.AsyncMock(return_value=(b"v2.0.0", b""))

        with mock.patch("asyncio.create_subprocess_exec", return_value=mock_process):
            result = await manager.check_claude_flow_available()

        assert result is True

    async def test_check_available_when_not_installed(self):
        """Test check_claude_flow_available returns False when not installed."""
        manager = SubprocessManager()

        with mock.patch("asyncio.create_subprocess_exec", side_effect=FileNotFoundError):
            result = await manager.check_claude_flow_available()

        assert result is False

    async def test_check_available_handles_timeout(self):
        """Test check_claude_flow_available handles timeout."""
        manager = SubprocessManager()

        with mock.patch("asyncio.create_subprocess_exec", side_effect=asyncio.TimeoutError):
            result = await manager.check_claude_flow_available()

        assert result is False

    async def test_check_available_handles_os_error(self):
        """Test check_claude_flow_available handles OS errors."""
        manager = SubprocessManager()

        with mock.patch("asyncio.create_subprocess_exec", side_effect=OSError):
            result = await manager.check_claude_flow_available()

        assert result is False


# =============================================================================
# SUBPROCESS MANAGER ACTIVE PROCESSES TESTS
# =============================================================================


class TestSubprocessManagerActiveProcesses:
    """Tests for SubprocessManager.get_active_processes method."""

    async def test_get_active_processes_empty(self):
        """Test get_active_processes returns empty list when no processes."""
        manager = SubprocessManager()
        processes = await manager.get_active_processes()
        assert processes == []

    async def test_get_active_processes_returns_info(self):
        """Test get_active_processes returns correct information."""
        manager = SubprocessManager()

        mock_process = mock.Mock()
        mock_process.pid = 54321

        started_at = datetime.now(timezone.utc)
        manager._processes[54321] = ProcessInfo(
            pid=54321,
            process=mock_process,
            command=["npx", "claude-flow@alpha", "swarm", "test"],
            started_at=started_at,
            task_id="test-task-1",
        )

        processes = await manager.get_active_processes()

        assert len(processes) == 1
        assert processes[0]["pid"] == 54321
        assert processes[0]["task_id"] == "test-task-1"
        assert "running_seconds" in processes[0]


# =============================================================================
# SUBPROCESS MANAGER KILL PROCESS TESTS
# =============================================================================


class TestSubprocessManagerKillProcess:
    """Tests for SubprocessManager.kill_process method."""

    async def test_kill_nonexistent_process(self):
        """Test kill_process returns False for nonexistent PID."""
        manager = SubprocessManager()
        result = await manager.kill_process(99999)
        assert result is False

    async def test_kill_existing_process(self):
        """Test kill_process terminates and removes process."""
        manager = SubprocessManager()

        mock_process = mock.AsyncMock()
        mock_process.pid = 11111
        mock_process.returncode = None
        mock_process.terminate = mock.Mock()
        mock_process.wait = mock.AsyncMock()

        manager._processes[11111] = ProcessInfo(
            pid=11111,
            process=mock_process,
            command=["test"],
            started_at=datetime.now(timezone.utc),
        )

        result = await manager.kill_process(11111)

        assert result is True
        assert 11111 not in manager._processes


# =============================================================================
# SUBPROCESS MANAGER CLEANUP ZOMBIES TESTS
# =============================================================================


class TestSubprocessManagerCleanupZombies:
    """Tests for SubprocessManager.cleanup_zombies method."""

    async def test_cleanup_zombies_no_zombies(self):
        """Test cleanup_zombies with no zombie processes."""
        manager = SubprocessManager()
        cleaned = await manager.cleanup_zombies()
        assert cleaned == 0

    async def test_cleanup_zombies_removes_terminated(self):
        """Test cleanup_zombies removes terminated processes."""
        manager = SubprocessManager()

        mock_process = mock.Mock()
        mock_process.returncode = 0  # Already terminated

        manager._processes[22222] = ProcessInfo(
            pid=22222,
            process=mock_process,
            command=["test"],
            started_at=datetime.now(timezone.utc),
        )

        cleaned = await manager.cleanup_zombies()

        assert cleaned == 1
        assert 22222 not in manager._processes

    async def test_cleanup_zombies_keeps_running(self):
        """Test cleanup_zombies keeps running processes."""
        manager = SubprocessManager()

        mock_process = mock.Mock()
        mock_process.returncode = None  # Still running

        manager._processes[33333] = ProcessInfo(
            pid=33333,
            process=mock_process,
            command=["test"],
            started_at=datetime.now(timezone.utc),
        )

        cleaned = await manager.cleanup_zombies()

        assert cleaned == 0
        assert 33333 in manager._processes


# =============================================================================
# SUBPROCESS MANAGER SHUTDOWN TESTS
# =============================================================================


class TestSubprocessManagerShutdown:
    """Tests for SubprocessManager.shutdown method."""

    async def test_shutdown_sets_flag(self):
        """Test shutdown sets the shutdown flag."""
        manager = SubprocessManager()
        await manager.shutdown()
        assert manager._shutdown is True

    async def test_shutdown_clears_processes(self):
        """Test shutdown clears all processes."""
        manager = SubprocessManager()

        mock_process = mock.AsyncMock()
        mock_process.returncode = None
        mock_process.terminate = mock.Mock()
        mock_process.wait = mock.AsyncMock()

        manager._processes[44444] = ProcessInfo(
            pid=44444,
            process=mock_process,
            command=["test"],
            started_at=datetime.now(timezone.utc),
        )

        await manager.shutdown()

        assert len(manager._processes) == 0


# =============================================================================
# SINGLETON FUNCTIONS TESTS
# =============================================================================


class TestSingletonFunctions:
    """Tests for singleton manager functions."""

    async def test_get_subprocess_manager_creates_instance(self):
        """Test get_subprocess_manager creates singleton instance."""
        # First, cleanup any existing instance
        await cleanup_subprocess_manager()

        manager = get_subprocess_manager()
        assert manager is not None
        assert isinstance(manager, SubprocessManager)

    async def test_get_subprocess_manager_returns_same_instance(self):
        """Test get_subprocess_manager returns same instance."""
        await cleanup_subprocess_manager()

        manager1 = get_subprocess_manager()
        manager2 = get_subprocess_manager()
        assert manager1 is manager2

    async def test_cleanup_subprocess_manager(self):
        """Test cleanup_subprocess_manager clears singleton."""
        get_subprocess_manager()
        await cleanup_subprocess_manager()

        # After cleanup, a new instance should be created
        import claude_flow_server.subprocess_manager as sm
        assert sm._manager_instance is None


# =============================================================================
# ENVIRONMENT VARIABLE TESTS
# =============================================================================


class TestSubprocessManagerEnv:
    """Tests for SubprocessManager._get_env method."""

    def test_get_env_includes_current_env(self):
        """Test _get_env includes current environment variables."""
        manager = SubprocessManager()
        env = manager._get_env()
        # PATH should be included from current environment
        assert "PATH" in env or len(env) > 0

    def test_get_env_with_api_key(self):
        """Test _get_env includes API key when available."""
        config = ClaudeFlowConfig()
        manager = SubprocessManager(config=config)

        with mock.patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-key"}):
            env = manager._get_env()
            assert env.get("ANTHROPIC_API_KEY") == "test-key"


# =============================================================================
# TERMINATE PROCESS TESTS
# =============================================================================


class TestSubprocessManagerTerminate:
    """Tests for SubprocessManager._terminate_process method."""

    async def test_terminate_already_finished_process(self):
        """Test _terminate_process handles already finished process."""
        manager = SubprocessManager()

        mock_process = mock.Mock()
        mock_process.returncode = 0  # Already terminated

        # Should not raise
        await manager._terminate_process(mock_process)

    async def test_terminate_graceful_shutdown(self):
        """Test _terminate_process tries graceful termination first."""
        manager = SubprocessManager()

        mock_process = mock.AsyncMock()
        mock_process.returncode = None
        mock_process.terminate = mock.Mock()
        mock_process.wait = mock.AsyncMock()

        with mock.patch("asyncio.wait_for", new_callable=mock.AsyncMock):
            await manager._terminate_process(mock_process)

        mock_process.terminate.assert_called_once()

    async def test_terminate_force_kill_on_timeout(self):
        """Test _terminate_process force kills on timeout."""
        manager = SubprocessManager()

        mock_process = mock.AsyncMock()
        mock_process.returncode = None
        mock_process.terminate = mock.Mock()
        mock_process.kill = mock.Mock()
        mock_process.wait = mock.AsyncMock()

        # First wait_for times out, second one succeeds
        with mock.patch("asyncio.wait_for", side_effect=[asyncio.TimeoutError(), None]):
            await manager._terminate_process(mock_process, timeout=0.1)

        mock_process.terminate.assert_called_once()
        mock_process.kill.assert_called_once()

    async def test_terminate_handles_process_lookup_error(self):
        """Test _terminate_process handles ProcessLookupError."""
        manager = SubprocessManager()

        mock_process = mock.Mock()
        mock_process.returncode = None
        mock_process.terminate = mock.Mock(side_effect=ProcessLookupError)

        # Should not raise
        await manager._terminate_process(mock_process)
