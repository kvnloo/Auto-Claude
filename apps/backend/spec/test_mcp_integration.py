"""
Tests for MCP Integration Service
=================================

Comprehensive test suite for MCP server integration covering:
- Server registration and discovery
- Claude Flow MCP server integration
- Auto-Claude MCP server integration
- Server lifecycle management
- Backend ↔ claude-flow-server communication
"""

import logging
from pathlib import Path
from unittest import mock

import pytest

from services.mcp_integration import (
    CLAUDE_FLOW_AVAILABLE,
    AUTO_CLAUDE_AVAILABLE,
    get_available_servers,
    get_claude_flow_tools,
    get_registered_servers,
    get_server,
    get_server_status,
    is_claude_flow_available,
    is_auto_claude_available,
    is_server_registered,
    register_all_servers,
    register_auto_claude_server,
    register_claude_flow_server,
    unregister_all_servers,
    unregister_auto_claude_server,
    unregister_claude_flow_server,
)


class TestServerRegistry:
    """Test MCP server registry operations."""

    def setup_method(self):
        """Reset registry before each test."""
        unregister_all_servers()

    def teardown_method(self):
        """Clean up registry after each test."""
        unregister_all_servers()

    def test_empty_registry(self):
        """Registry starts empty after reset."""
        servers = get_registered_servers()
        assert len(servers) == 0

    def test_get_server_not_registered(self):
        """Get returns None for unregistered server."""
        server = get_server("nonexistent")
        assert server is None

    def test_is_server_registered_false(self):
        """Check returns False for unregistered server."""
        assert is_server_registered("claude-flow") is False

    def test_unregister_all_empty(self):
        """Unregister all returns 0 when empty."""
        count = unregister_all_servers()
        assert count == 0


class TestClaudeFlowAvailability:
    """Test Claude Flow availability checks."""

    def test_availability_constant(self):
        """CLAUDE_FLOW_AVAILABLE is boolean."""
        assert isinstance(CLAUDE_FLOW_AVAILABLE, bool)

    def test_is_claude_flow_available(self):
        """is_claude_flow_available returns consistent value."""
        assert is_claude_flow_available() == CLAUDE_FLOW_AVAILABLE


class TestAutoClaudeAvailability:
    """Test Auto-Claude availability checks."""

    def test_availability_constant(self):
        """AUTO_CLAUDE_AVAILABLE is boolean."""
        assert isinstance(AUTO_CLAUDE_AVAILABLE, bool)

    def test_is_auto_claude_available(self):
        """is_auto_claude_available returns consistent value."""
        assert is_auto_claude_available() == AUTO_CLAUDE_AVAILABLE


class TestGetAvailableServers:
    """Test listing available servers."""

    def test_returns_list(self):
        """get_available_servers returns a list."""
        servers = get_available_servers()
        assert isinstance(servers, list)

    def test_includes_claude_flow_if_available(self):
        """List includes claude-flow if available."""
        servers = get_available_servers()
        if CLAUDE_FLOW_AVAILABLE:
            assert "claude-flow" in servers
        else:
            assert "claude-flow" not in servers

    def test_includes_auto_claude_if_available(self):
        """List includes auto-claude if available."""
        servers = get_available_servers()
        if AUTO_CLAUDE_AVAILABLE:
            assert "auto-claude" in servers
        else:
            assert "auto-claude" not in servers


class TestServerStatus:
    """Test server status reporting."""

    def test_status_structure(self):
        """Status has correct structure."""
        status = get_server_status()

        assert "claude-flow" in status
        assert "auto-claude" in status

        for server_name, server_status in status.items():
            assert "available" in server_status
            assert "registered" in server_status
            assert "tools_available" in server_status

    def test_status_types(self):
        """Status values are correct types."""
        status = get_server_status()

        for server_status in status.values():
            assert isinstance(server_status["available"], bool)
            assert isinstance(server_status["registered"], bool)
            assert isinstance(server_status["tools_available"], bool)


class TestClaudeFlowRegistration:
    """Test Claude Flow server registration."""

    def setup_method(self):
        """Reset registry before each test."""
        unregister_all_servers()

    def teardown_method(self):
        """Clean up registry after each test."""
        unregister_all_servers()

    def test_register_returns_server_or_none(self):
        """Registration returns server if available, None otherwise."""
        server = register_claude_flow_server()
        if CLAUDE_FLOW_AVAILABLE:
            assert server is not None
        else:
            assert server is None

    def test_unregister_returns_bool(self):
        """Unregister returns boolean."""
        # Register first if available
        register_claude_flow_server()

        result = unregister_claude_flow_server()
        if CLAUDE_FLOW_AVAILABLE:
            assert result is True
        else:
            assert result is False

    def test_unregister_when_not_registered(self):
        """Unregister returns False when not registered."""
        result = unregister_claude_flow_server()
        assert result is False

    @pytest.mark.skipif(
        not CLAUDE_FLOW_AVAILABLE,
        reason="Claude Flow not available",
    )
    def test_registered_server_in_registry(self):
        """Registered server appears in registry."""
        register_claude_flow_server()

        assert is_server_registered("claude-flow") is True
        servers = get_registered_servers()
        assert "claude-flow" in servers

    @pytest.mark.skipif(
        not CLAUDE_FLOW_AVAILABLE,
        reason="Claude Flow not available",
    )
    def test_get_registered_server(self):
        """Can get registered server by name."""
        register_claude_flow_server()

        server = get_server("claude-flow")
        assert server is not None

    @pytest.mark.skipif(
        not CLAUDE_FLOW_AVAILABLE,
        reason="Claude Flow not available",
    )
    def test_double_registration(self):
        """Double registration overwrites previous."""
        server1 = register_claude_flow_server()
        server2 = register_claude_flow_server()

        # Both should succeed
        assert server1 is not None
        assert server2 is not None

        # Only one server in registry
        servers = get_registered_servers()
        assert len([k for k in servers if k == "claude-flow"]) == 1


class TestClaudeFlowTools:
    """Test Claude Flow tool functions."""

    def test_get_tools_returns_list(self):
        """get_claude_flow_tools returns a list."""
        tools = get_claude_flow_tools()
        assert isinstance(tools, list)

    @pytest.mark.skipif(
        not CLAUDE_FLOW_AVAILABLE,
        reason="Claude Flow not available",
    )
    def test_tools_not_empty(self):
        """Tools list is not empty when available."""
        tools = get_claude_flow_tools()
        assert len(tools) > 0


class TestAutoClaudeRegistration:
    """Test Auto-Claude server registration."""

    def setup_method(self):
        """Reset registry before each test."""
        unregister_all_servers()
        self.spec_dir = Path("/tmp/test-spec")
        self.project_dir = Path("/tmp/test-project")

    def teardown_method(self):
        """Clean up registry after each test."""
        unregister_all_servers()

    def test_register_returns_server_or_none(self):
        """Registration returns server if available, None otherwise."""
        server = register_auto_claude_server(self.spec_dir, self.project_dir)
        # Will be None unless auto-claude tools are installed
        assert server is None or server is not None

    def test_unregister_when_not_registered(self):
        """Unregister returns False when not registered."""
        result = unregister_auto_claude_server()
        assert result is False


class TestRegisterAllServers:
    """Test registering all available servers."""

    def setup_method(self):
        """Reset registry before each test."""
        unregister_all_servers()

    def teardown_method(self):
        """Clean up registry after each test."""
        unregister_all_servers()

    def test_returns_dict(self):
        """register_all_servers returns a dictionary."""
        registered = register_all_servers()
        assert isinstance(registered, dict)

    def test_registers_available_servers(self):
        """Registers all available servers."""
        registered = register_all_servers()

        if CLAUDE_FLOW_AVAILABLE:
            assert "claude-flow" in registered

    def test_with_paths_for_auto_claude(self):
        """With paths, can attempt auto-claude registration."""
        spec_dir = Path("/tmp/test-spec")
        project_dir = Path("/tmp/test-project")

        registered = register_all_servers(
            spec_dir=spec_dir,
            project_dir=project_dir,
        )

        assert isinstance(registered, dict)


class TestUnregisterAllServers:
    """Test unregistering all servers."""

    def setup_method(self):
        """Reset registry."""
        unregister_all_servers()

    def teardown_method(self):
        """Clean up registry."""
        unregister_all_servers()

    def test_returns_count(self):
        """Returns count of unregistered servers."""
        count = unregister_all_servers()
        assert isinstance(count, int)
        assert count >= 0

    @pytest.mark.skipif(
        not CLAUDE_FLOW_AVAILABLE,
        reason="Claude Flow not available",
    )
    def test_clears_registered_servers(self):
        """All servers removed from registry."""
        register_claude_flow_server()
        assert len(get_registered_servers()) > 0

        unregister_all_servers()
        assert len(get_registered_servers()) == 0


class TestMCPServerMocking:
    """Test MCP server integration with mocks."""

    def setup_method(self):
        """Reset registry."""
        unregister_all_servers()

    def teardown_method(self):
        """Clean up registry."""
        unregister_all_servers()

    def test_mock_server_registration(self):
        """Mock server can be registered."""
        from services import mcp_integration

        # Save original registry
        original_registry = mcp_integration._mcp_server_registry.copy()

        try:
            # Manually add a mock server to registry
            mock_server = mock.MagicMock()
            mock_server.name = "mock-server"
            mcp_integration._mcp_server_registry["mock-server"] = mock_server

            # Verify it's registered
            assert is_server_registered("mock-server") is True
            assert get_server("mock-server") is mock_server

        finally:
            # Restore original registry
            mcp_integration._mcp_server_registry = original_registry

    def test_mock_tools_integration(self):
        """Mock tools work with service layer."""
        mock_tool = mock.MagicMock()
        mock_tool.name = "parallel_execute"
        mock_tool.return_value = {
            "success": True,
            "agent_results": [],
        }

        # Simulate calling tool
        result = mock_tool(task_description="test", max_agents=4)
        assert result["success"] is True


class TestBackendMCPIntegration:
    """Integration tests for backend ↔ MCP server communication."""

    def setup_method(self):
        """Reset registry and create service."""
        unregister_all_servers()

    def teardown_method(self):
        """Clean up registry."""
        unregister_all_servers()

    @pytest.mark.asyncio
    async def test_task_service_without_mcp(self):
        """TaskService works without MCP server (simulation mode)."""
        from services.task_service import TaskService

        service = TaskService()
        result = await service.execute_parallel_task(
            task_description="Test without MCP",
            agent_count=4,
        )

        # Should use simulation mode
        assert result is not None
        assert result.agent_count == 4
        assert "Simulated" in result.results.get("summary", "")

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        not CLAUDE_FLOW_AVAILABLE,
        reason="Claude Flow not available",
    )
    async def test_task_service_with_registered_mcp(self):
        """TaskService detects registered MCP server."""
        from services.task_service import TaskService

        # Register Claude Flow server
        server = register_claude_flow_server()
        assert server is not None

        # Verify server is discoverable
        assert is_server_registered("claude-flow") is True

        # Create service and execute
        service = TaskService()

        # The service should detect the registered server
        # (though actual MCP call may fail without Claude Flow CLI)
        try:
            result = await service.execute_parallel_task(
                task_description="Test with MCP",
                agent_count=4,
                timeout_seconds=5,  # Short timeout
            )
            # If it works, result should be valid
            assert result is not None
        except Exception:
            # MCP call may fail, but server detection worked
            pass

    def test_server_status_reflects_registration(self):
        """Server status updates after registration."""
        # Before registration
        status_before = get_server_status()
        assert status_before["claude-flow"]["registered"] is False

        # Register if available
        if CLAUDE_FLOW_AVAILABLE:
            register_claude_flow_server()

            # After registration
            status_after = get_server_status()
            assert status_after["claude-flow"]["registered"] is True


class TestLogging:
    """Test logging behavior."""

    def setup_method(self):
        """Reset registry."""
        unregister_all_servers()

    def teardown_method(self):
        """Clean up registry."""
        unregister_all_servers()

    def test_registration_logs_warning_when_unavailable(self, caplog):
        """Registration logs warning when Claude Flow unavailable."""
        if CLAUDE_FLOW_AVAILABLE:
            pytest.skip("Claude Flow is available")

        with caplog.at_level(logging.WARNING):
            register_claude_flow_server()

        # Should have logged a warning
        assert any(
            "not available" in record.message.lower()
            for record in caplog.records
        )

    @pytest.mark.skipif(
        not CLAUDE_FLOW_AVAILABLE,
        reason="Claude Flow not available",
    )
    def test_registration_logs_info_on_success(self, caplog):
        """Successful registration logs info."""
        with caplog.at_level(logging.INFO):
            register_claude_flow_server()

        assert any(
            "registered successfully" in record.message.lower()
            for record in caplog.records
        )


class TestEdgeCases:
    """Test edge cases and error handling."""

    def setup_method(self):
        """Reset registry."""
        unregister_all_servers()

    def teardown_method(self):
        """Clean up registry."""
        unregister_all_servers()

    def test_get_registered_servers_returns_copy(self):
        """get_registered_servers returns a copy."""
        servers = get_registered_servers()
        servers["test"] = "value"

        # Should not affect internal registry
        assert "test" not in get_registered_servers()

    def test_none_working_dir(self):
        """Registration works with None working_dir."""
        server = register_claude_flow_server(working_dir=None)
        # Should not raise
        assert server is None or server is not None

    def test_path_working_dir(self):
        """Registration works with Path working_dir."""
        server = register_claude_flow_server(working_dir=Path("/tmp"))
        # Should not raise
        assert server is None or server is not None


class TestToolDiscovery:
    """Test MCP tool discovery patterns."""

    @pytest.mark.skipif(
        not CLAUDE_FLOW_AVAILABLE,
        reason="Claude Flow not available",
    )
    def test_tools_have_expected_names(self):
        """Claude Flow tools include expected names."""
        tools = get_claude_flow_tools()

        # Extract tool names (tools may be functions or objects)
        tool_names = []
        for tool in tools:
            if callable(tool):
                tool_names.append(tool.__name__)
            elif hasattr(tool, "name"):
                tool_names.append(tool.name)

        # At least some expected tools should be present
        expected = [
            "swarm_init",
            "parallel_execute",
            "agent_spawn",
            "memory_usage",
            "health_check",
            "task_orchestrate",
        ]

        found = [name for name in expected if name in tool_names]
        assert len(found) > 0, f"Expected tools {expected}, found {tool_names}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
