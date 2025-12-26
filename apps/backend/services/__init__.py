"""
Services Module
===============

Background services and orchestration for Auto Claude.
"""

from .context import ServiceContext
from .mcp_integration import (
    get_available_servers,
    get_registered_servers,
    get_server,
    get_server_status,
    is_claude_flow_available,
    register_all_servers,
    register_claude_flow_server,
    unregister_all_servers,
)
from .orchestrator import ServiceOrchestrator
from .recovery import RecoveryManager

__all__ = [
    "ServiceContext",
    "ServiceOrchestrator",
    "RecoveryManager",
    # MCP Integration
    "register_claude_flow_server",
    "register_all_servers",
    "unregister_all_servers",
    "get_registered_servers",
    "get_server",
    "get_available_servers",
    "get_server_status",
    "is_claude_flow_available",
]
