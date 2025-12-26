"""
MCP Integration Service
=======================

Central service for registering and managing MCP servers in AutoClaude.

This module provides:
- Registration of MCP servers (claude-flow-server, auto-claude, etc.)
- Server lifecycle management
- Discovery of available MCP servers
- Integration with the backend orchestrator

Usage:
    from services.mcp_integration import register_claude_flow_server

    server = register_claude_flow_server()
    if server is not None:
        # Server registered successfully
        pass
"""

import logging
from pathlib import Path
from typing import Any

# =============================================================================
# IMPORTS WITH AVAILABILITY CHECKS
# =============================================================================

# Check for claude-flow-server availability
try:
    from claude_flow_server.server import (
        create_claude_flow_mcp_server,
        create_claude_flow_tools,
        is_tools_available as is_claude_flow_tools_available,
    )

    CLAUDE_FLOW_AVAILABLE = True
except ImportError:
    CLAUDE_FLOW_AVAILABLE = False
    create_claude_flow_mcp_server = None
    create_claude_flow_tools = None
    is_claude_flow_tools_available = None

# Check for auto-claude tools availability
try:
    from agents.tools_pkg.registry import (
        create_auto_claude_mcp_server,
        is_tools_available as is_auto_claude_tools_available,
    )

    AUTO_CLAUDE_AVAILABLE = True
except ImportError:
    AUTO_CLAUDE_AVAILABLE = False
    create_auto_claude_mcp_server = None
    is_auto_claude_tools_available = None

# =============================================================================
# LOGGING
# =============================================================================

logger = logging.getLogger(__name__)

# =============================================================================
# MCP SERVER REGISTRY
# =============================================================================

# Registry of MCP servers by name
_mcp_server_registry: dict[str, Any] = {}


def get_registered_servers() -> dict[str, Any]:
    """
    Get all registered MCP servers.

    Returns:
        Dictionary mapping server names to server instances
    """
    return _mcp_server_registry.copy()


def get_server(name: str) -> Any | None:
    """
    Get a registered MCP server by name.

    Args:
        name: Server name (e.g., 'claude-flow', 'auto-claude')

    Returns:
        Server instance, or None if not registered
    """
    return _mcp_server_registry.get(name)


def is_server_registered(name: str) -> bool:
    """
    Check if an MCP server is registered.

    Args:
        name: Server name

    Returns:
        True if server is registered
    """
    return name in _mcp_server_registry


# =============================================================================
# CLAUDE FLOW SERVER REGISTRATION
# =============================================================================


def register_claude_flow_server(
    working_dir: Path | None = None,
) -> Any | None:
    """
    Register the Claude Flow MCP server.

    This function creates and registers the claude-flow-server MCP server,
    which provides parallel agent orchestration capabilities.

    Args:
        working_dir: Optional working directory for Claude Flow operations

    Returns:
        MCP server instance, or None if claude-flow-server is not available

    Example:
        server = register_claude_flow_server()
        if server is not None:
            print("Claude Flow MCP server registered")
    """
    global _mcp_server_registry

    if not CLAUDE_FLOW_AVAILABLE:
        logger.warning(
            "claude-flow-server not available. "
            "Install with: pip install -e claude-flow-server"
        )
        return None

    if not is_claude_flow_tools_available():
        logger.warning(
            "Claude Flow MCP tools not available. "
            "FastMCP may not be installed. "
            "Install with: pip install mcp"
        )
        return None

    try:
        # Create the MCP server
        server = create_claude_flow_mcp_server()

        if server is None:
            logger.error("Failed to create Claude Flow MCP server")
            return None

        # Register the server
        _mcp_server_registry["claude-flow"] = server

        logger.info("Claude Flow MCP server registered successfully")
        return server

    except Exception as e:
        logger.exception(f"Error registering Claude Flow MCP server: {e}")
        return None


def unregister_claude_flow_server() -> bool:
    """
    Unregister the Claude Flow MCP server.

    Returns:
        True if server was unregistered, False if not registered
    """
    global _mcp_server_registry

    if "claude-flow" in _mcp_server_registry:
        del _mcp_server_registry["claude-flow"]
        logger.info("Claude Flow MCP server unregistered")
        return True

    return False


def get_claude_flow_tools() -> list:
    """
    Get the Claude Flow tool functions without creating a server.

    Returns:
        List of tool functions, or empty list if not available
    """
    if not CLAUDE_FLOW_AVAILABLE or create_claude_flow_tools is None:
        return []

    try:
        return create_claude_flow_tools()
    except Exception as e:
        logger.exception(f"Error getting Claude Flow tools: {e}")
        return []


# =============================================================================
# AUTO-CLAUDE SERVER REGISTRATION
# =============================================================================


def register_auto_claude_server(
    spec_dir: Path,
    project_dir: Path,
) -> Any | None:
    """
    Register the Auto-Claude MCP server.

    This function creates and registers the auto-claude MCP server,
    which provides task management, memory, and progress tracking tools.

    Args:
        spec_dir: Path to the spec directory
        project_dir: Path to the project root

    Returns:
        MCP server instance, or None if auto-claude tools are not available
    """
    global _mcp_server_registry

    if not AUTO_CLAUDE_AVAILABLE:
        logger.warning("auto-claude tools not available")
        return None

    if not is_auto_claude_tools_available():
        logger.warning("Auto-Claude SDK tools not available")
        return None

    try:
        # Create the MCP server
        server = create_auto_claude_mcp_server(spec_dir, project_dir)

        if server is None:
            logger.error("Failed to create Auto-Claude MCP server")
            return None

        # Register the server
        _mcp_server_registry["auto-claude"] = server

        logger.info("Auto-Claude MCP server registered successfully")
        return server

    except Exception as e:
        logger.exception(f"Error registering Auto-Claude MCP server: {e}")
        return None


def unregister_auto_claude_server() -> bool:
    """
    Unregister the Auto-Claude MCP server.

    Returns:
        True if server was unregistered, False if not registered
    """
    global _mcp_server_registry

    if "auto-claude" in _mcp_server_registry:
        del _mcp_server_registry["auto-claude"]
        logger.info("Auto-Claude MCP server unregistered")
        return True

    return False


# =============================================================================
# COMBINED REGISTRATION
# =============================================================================


def register_all_servers(
    spec_dir: Path | None = None,
    project_dir: Path | None = None,
    working_dir: Path | None = None,
) -> dict[str, Any]:
    """
    Register all available MCP servers.

    Args:
        spec_dir: Path to the spec directory (for auto-claude)
        project_dir: Path to the project root (for auto-claude)
        working_dir: Working directory for Claude Flow operations

    Returns:
        Dictionary of registered servers (name -> server instance)
    """
    registered = {}

    # Register Claude Flow server
    claude_flow_server = register_claude_flow_server(working_dir=working_dir)
    if claude_flow_server is not None:
        registered["claude-flow"] = claude_flow_server

    # Register Auto-Claude server if paths provided
    if spec_dir is not None and project_dir is not None:
        auto_claude_server = register_auto_claude_server(spec_dir, project_dir)
        if auto_claude_server is not None:
            registered["auto-claude"] = auto_claude_server

    return registered


def unregister_all_servers() -> int:
    """
    Unregister all MCP servers.

    Returns:
        Number of servers unregistered
    """
    global _mcp_server_registry

    count = len(_mcp_server_registry)
    _mcp_server_registry.clear()

    logger.info(f"Unregistered {count} MCP server(s)")
    return count


# =============================================================================
# AVAILABILITY CHECKS
# =============================================================================


def is_claude_flow_available() -> bool:
    """Check if Claude Flow MCP server is available."""
    return CLAUDE_FLOW_AVAILABLE


def is_auto_claude_available() -> bool:
    """Check if Auto-Claude MCP server is available."""
    return AUTO_CLAUDE_AVAILABLE


def get_available_servers() -> list[str]:
    """
    Get list of available MCP servers that can be registered.

    Returns:
        List of server names that are available
    """
    available = []

    if CLAUDE_FLOW_AVAILABLE:
        available.append("claude-flow")

    if AUTO_CLAUDE_AVAILABLE:
        available.append("auto-claude")

    return available


def get_server_status() -> dict[str, dict[str, Any]]:
    """
    Get status of all MCP servers.

    Returns:
        Dictionary with server status information
    """
    status = {}

    # Claude Flow status
    status["claude-flow"] = {
        "available": CLAUDE_FLOW_AVAILABLE,
        "registered": is_server_registered("claude-flow"),
        "tools_available": (
            is_claude_flow_tools_available()
            if is_claude_flow_tools_available is not None
            else False
        ),
    }

    # Auto-Claude status
    status["auto-claude"] = {
        "available": AUTO_CLAUDE_AVAILABLE,
        "registered": is_server_registered("auto-claude"),
        "tools_available": (
            is_auto_claude_tools_available()
            if is_auto_claude_tools_available is not None
            else False
        ),
    }

    return status
