"""
Claude Flow MCP Server
=======================

MCP server for Claude Flow parallel agent orchestration.

This module provides:
- 6 MCP tools for parallel agent execution
- FastMCP-based server implementation
- Integration with SubprocessManager and ResultAggregator

Tools:
    - swarm_init: Initialize swarm configuration
    - agent_spawn: Spawn a new agent for a specific task
    - parallel_execute: Execute a task in parallel using multiple agents
    - memory_usage: Get memory usage statistics
    - health_check: Check system health and Claude Flow availability
    - task_orchestrate: Orchestrate a complex task with multiple subtasks

Usage:
    python -m claude_flow_server.server

    Or programmatically:
        from claude_flow_server.server import create_claude_flow_mcp_server
        server = create_claude_flow_mcp_server()
"""

import asyncio
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from claude_flow_server.config import (
    ClaudeFlowConfig,
    TopologyMode,
    VALID_AGENT_COUNTS,
    get_default_config,
    validate_agent_count,
    validate_topology,
)
from claude_flow_server.result_aggregator import ResultAggregator, aggregate_outputs
from claude_flow_server.subprocess_manager import (
    SubprocessManager,
    get_subprocess_manager,
    cleanup_subprocess_manager,
)

# =============================================================================
# SDK AVAILABILITY CHECK
# =============================================================================

try:
    from mcp.server.fastmcp import FastMCP

    FASTMCP_AVAILABLE = True
except ImportError:
    FASTMCP_AVAILABLE = False
    FastMCP = None

# =============================================================================
# LOGGING
# =============================================================================

logger = logging.getLogger(__name__)

# =============================================================================
# TOOL NAME CONSTANTS
# =============================================================================

# Claude Flow MCP tool names (prefixed with mcp__claude-flow__)
TOOL_SWARM_INIT = "mcp__claude-flow__swarm_init"
TOOL_AGENT_SPAWN = "mcp__claude-flow__agent_spawn"
TOOL_PARALLEL_EXECUTE = "mcp__claude-flow__parallel_execute"
TOOL_MEMORY_USAGE = "mcp__claude-flow__memory_usage"
TOOL_HEALTH_CHECK = "mcp__claude-flow__health_check"
TOOL_TASK_ORCHESTRATE = "mcp__claude-flow__task_orchestrate"

# =============================================================================
# SERVER STATE
# =============================================================================

# Global state for the MCP server
_server_state: dict[str, Any] = {
    "initialized": False,
    "config": None,
    "subprocess_manager": None,
    "result_aggregator": None,
    "swarm_dir": None,
}


def _get_state() -> dict[str, Any]:
    """Get the global server state."""
    return _server_state


def _set_state(key: str, value: Any) -> None:
    """Set a value in the global server state."""
    _server_state[key] = value


# =============================================================================
# TOOL IMPLEMENTATIONS
# =============================================================================


async def swarm_init(
    max_agents: int = 4,
    topology: str = "distributed",
    timeout_seconds: int = 300,
    working_dir: str | None = None,
) -> dict[str, Any]:
    """
    Initialize the Claude Flow swarm configuration.

    This tool sets up the swarm environment and validates configuration
    before executing parallel tasks.

    Args:
        max_agents: Maximum number of parallel agents (4, 8, or 12)
        topology: Agent orchestration topology mode
            - distributed: Agents work independently on subtasks
            - hierarchical: Lead agent coordinates worker agents
            - mesh: Agents communicate peer-to-peer
            - centralized: Single coordinator manages all agents
        timeout_seconds: Timeout for task execution in seconds (30-3600)
        working_dir: Working directory for swarm operations

    Returns:
        dict: Initialization result with configuration details
    """
    state = _get_state()

    # Validate agent count
    if not validate_agent_count(max_agents):
        return {
            "success": False,
            "error": f"Invalid agent count: {max_agents}. Must be one of: {sorted(VALID_AGENT_COUNTS)}",
        }

    # Validate topology
    if not validate_topology(topology):
        return {
            "success": False,
            "error": f"Invalid topology: {topology}. Must be one of: distributed, hierarchical, mesh, centralized",
        }

    try:
        # Create configuration
        config = ClaudeFlowConfig(
            max_agents=max_agents,
            topology=TopologyMode(topology),
            timeout_seconds=timeout_seconds,
        )

        # Set working directory
        work_path = Path(working_dir) if working_dir else Path.cwd()

        # Initialize subprocess manager
        subprocess_manager = SubprocessManager(config=config, working_dir=work_path)

        # Check if Claude Flow is available
        claude_flow_available = await subprocess_manager.check_claude_flow_available()

        # Initialize result aggregator
        result_aggregator = ResultAggregator()

        # Update state
        _set_state("initialized", True)
        _set_state("config", config)
        _set_state("subprocess_manager", subprocess_manager)
        _set_state("result_aggregator", result_aggregator)
        _set_state("swarm_dir", work_path / config.swarm_dir)

        return {
            "success": True,
            "initialized": True,
            "config": config.to_dict(),
            "working_dir": str(work_path),
            "swarm_dir": str(work_path / config.swarm_dir),
            "claude_flow_available": claude_flow_available,
            "message": "Swarm initialized successfully" if claude_flow_available else "Swarm initialized but Claude Flow CLI not found. Install with: npm install -g claude-flow@alpha",
        }

    except ValueError as e:
        return {
            "success": False,
            "error": f"Configuration error: {str(e)}",
        }
    except Exception as e:
        logger.exception("Failed to initialize swarm")
        return {
            "success": False,
            "error": f"Initialization failed: {str(e)}",
        }


async def agent_spawn(
    task: str,
    agent_id: str | None = None,
    role: str = "researcher",
) -> dict[str, Any]:
    """
    Spawn a new agent for a specific task.

    This tool creates a single agent instance to work on a specific subtask.
    For parallel execution of multiple agents, use parallel_execute instead.

    Args:
        task: Task description for the agent
        agent_id: Optional unique identifier for the agent
        role: Agent role (researcher, analyst, coder, reviewer)

    Returns:
        dict: Agent spawn result with agent ID and status
    """
    state = _get_state()

    if not state["initialized"]:
        return {
            "success": False,
            "error": "Swarm not initialized. Call swarm_init first.",
        }

    # Generate agent ID if not provided
    if agent_id is None:
        agent_id = f"agent-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"

    # Validate role
    valid_roles = {"researcher", "analyst", "coder", "reviewer"}
    if role not in valid_roles:
        return {
            "success": False,
            "error": f"Invalid role: {role}. Must be one of: {sorted(valid_roles)}",
        }

    try:
        subprocess_manager: SubprocessManager = state["subprocess_manager"]
        config: ClaudeFlowConfig = state["config"]

        # Execute single agent task
        result = await subprocess_manager.run_claude_flow(
            task=task,
            config={
                "max_agents": 1,  # Single agent spawn
                "topology": config.topology.value,
            },
            task_id=agent_id,
        )

        return {
            "success": result.success,
            "agent_id": agent_id,
            "role": role,
            "task": task,
            "output": result.stdout if result.success else None,
            "error": result.error,
            "duration_seconds": result.duration_seconds,
        }

    except Exception as e:
        logger.exception(f"Failed to spawn agent {agent_id}")
        return {
            "success": False,
            "agent_id": agent_id,
            "error": f"Agent spawn failed: {str(e)}",
        }


async def parallel_execute(
    task_description: str,
    max_agents: int = 4,
    topology: str = "distributed",
    subtasks: list[str] | None = None,
) -> dict[str, Any]:
    """
    Execute a task in parallel using multiple Claude agents.

    This is the primary tool for parallel task execution. It distributes work
    across multiple agents and aggregates their results.

    IMPORTANT: For optimal parallelism, submit all subtasks in a single call.
    Breaking the batch into multiple calls destroys parallel execution benefits.

    Args:
        task_description: Main task description for agents
        max_agents: Number of parallel agents to use (4, 8, or 12)
        topology: Agent orchestration topology mode
        subtasks: Optional list of specific subtasks to distribute

    Returns:
        dict: Execution result with aggregated outputs and metrics
    """
    state = _get_state()

    # Auto-initialize if not already done
    if not state["initialized"]:
        init_result = await swarm_init(max_agents=max_agents, topology=topology)
        if not init_result["success"]:
            return init_result

    # Validate agent count
    if not validate_agent_count(max_agents):
        return {
            "success": False,
            "error": f"Invalid agent count: {max_agents}. Must be one of: {sorted(VALID_AGENT_COUNTS)}",
        }

    # Validate topology
    if not validate_topology(topology):
        return {
            "success": False,
            "error": f"Invalid topology: {topology}. Must be one of: distributed, hierarchical, mesh, centralized",
        }

    try:
        subprocess_manager: SubprocessManager = state["subprocess_manager"]
        result_aggregator: ResultAggregator = state["result_aggregator"]

        # Build full task with subtasks if provided
        full_task = task_description
        if subtasks:
            subtask_list = "\n".join(f"- {st}" for st in subtasks)
            full_task = f"{task_description}\n\nSubtasks:\n{subtask_list}"

        started_at = datetime.now(timezone.utc)

        # Execute parallel task
        result = await subprocess_manager.run_claude_flow(
            task=full_task,
            config={
                "max_agents": max_agents,
                "topology": topology,
            },
        )

        completed_at = datetime.now(timezone.utc)

        if not result.success:
            return {
                "success": False,
                "error": result.error,
                "stderr": result.stderr,
                "duration_seconds": result.duration_seconds,
                "timed_out": result.timed_out,
            }

        # Parse and aggregate results
        # Claude Flow CLI outputs JSON with agent results
        agent_outputs = _parse_claude_flow_output(result.stdout)

        aggregated = result_aggregator.aggregate(
            agent_outputs=agent_outputs,
            execution_time=result.duration_seconds,
            started_at=started_at,
            completed_at=completed_at,
        )

        return {
            "success": aggregated.success,
            "combined_output": aggregated.combined_output,
            "agent_count": aggregated.metrics.agent_count,
            "metrics": aggregated.metrics.to_dict(),
            "errors": aggregated.errors,
            "deduplicated_count": aggregated.deduplicated_count,
        }

    except Exception as e:
        logger.exception("Failed to execute parallel task")
        return {
            "success": False,
            "error": f"Parallel execution failed: {str(e)}",
        }


async def memory_usage() -> dict[str, Any]:
    """
    Get memory usage statistics for the Claude Flow swarm.

    This tool provides information about system memory usage and
    the resources consumed by active agents.

    Returns:
        dict: Memory usage statistics including:
            - system_memory_mb: Total system memory in MB
            - used_memory_mb: Used system memory in MB
            - available_memory_mb: Available system memory in MB
            - swarm_memory_mb: Memory used by swarm processes
            - active_processes: Number of active subprocess
    """
    state = _get_state()

    try:
        import resource

        # Get resource usage for current process
        usage = resource.getrusage(resource.RUSAGE_CHILDREN)
        max_rss_kb = usage.ru_maxrss  # Maximum resident set size in KB

        # Convert to MB
        swarm_memory_mb = max_rss_kb / 1024

    except ImportError:
        swarm_memory_mb = 0.0

    # Get active process count
    active_processes = 0
    if state["subprocess_manager"]:
        subprocess_manager: SubprocessManager = state["subprocess_manager"]
        active_processes = len(await subprocess_manager.get_active_processes())

    # Try to get system memory info
    system_memory = {}
    try:
        with open("/proc/meminfo", "r") as f:
            meminfo = f.read()
            for line in meminfo.split("\n"):
                if line.startswith("MemTotal:"):
                    system_memory["total_mb"] = int(line.split()[1]) / 1024
                elif line.startswith("MemAvailable:"):
                    system_memory["available_mb"] = int(line.split()[1]) / 1024
    except (FileNotFoundError, PermissionError, ValueError):
        # Fall back to defaults if /proc/meminfo is not available
        pass

    return {
        "success": True,
        "system_memory_mb": system_memory.get("total_mb"),
        "available_memory_mb": system_memory.get("available_mb"),
        "used_memory_mb": (
            system_memory.get("total_mb", 0) - system_memory.get("available_mb", 0)
            if system_memory.get("total_mb") and system_memory.get("available_mb")
            else None
        ),
        "swarm_memory_mb": round(swarm_memory_mb, 2),
        "active_processes": active_processes,
        "initialized": state["initialized"],
    }


async def health_check() -> dict[str, Any]:
    """
    Check the health of the Claude Flow MCP server and dependencies.

    This tool verifies:
    - Server initialization status
    - Claude Flow CLI availability
    - Active subprocess status
    - API key configuration

    Returns:
        dict: Health status with component details
    """
    state = _get_state()

    health = {
        "success": True,
        "status": "healthy",
        "components": {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Check initialization
    health["components"]["initialized"] = {
        "status": "ok" if state["initialized"] else "not_initialized",
        "message": "Swarm is initialized" if state["initialized"] else "Call swarm_init to initialize",
    }

    # Check Claude Flow CLI availability
    claude_flow_available = False
    if state["subprocess_manager"]:
        subprocess_manager: SubprocessManager = state["subprocess_manager"]
        claude_flow_available = await subprocess_manager.check_claude_flow_available()
    else:
        # Create temporary manager to check
        temp_manager = SubprocessManager()
        claude_flow_available = await temp_manager.check_claude_flow_available()

    health["components"]["claude_flow_cli"] = {
        "status": "ok" if claude_flow_available else "unavailable",
        "message": "Claude Flow CLI is available" if claude_flow_available else "Install with: npm install -g claude-flow@alpha",
    }

    # Check API key
    api_key_available = bool(os.environ.get("ANTHROPIC_API_KEY"))
    health["components"]["api_key"] = {
        "status": "ok" if api_key_available else "missing",
        "message": "ANTHROPIC_API_KEY is set" if api_key_available else "ANTHROPIC_API_KEY environment variable not set",
    }

    # Check active processes
    active_processes = []
    if state["subprocess_manager"]:
        subprocess_manager = state["subprocess_manager"]
        active_processes = await subprocess_manager.get_active_processes()

    health["components"]["processes"] = {
        "status": "ok",
        "active_count": len(active_processes),
        "processes": active_processes,
    }

    # Determine overall status
    critical_issues = []
    if not claude_flow_available:
        critical_issues.append("Claude Flow CLI not available")
    if not api_key_available:
        critical_issues.append("API key not configured")

    if critical_issues:
        health["status"] = "degraded"
        health["issues"] = critical_issues

    return health


async def task_orchestrate(
    main_task: str,
    subtasks: list[str],
    max_agents: int = 8,
    topology: str = "hierarchical",
    sequential: bool = False,
) -> dict[str, Any]:
    """
    Orchestrate a complex task with multiple subtasks.

    This tool provides higher-level orchestration for complex workflows,
    allowing sequential or parallel execution of multiple subtasks.

    Args:
        main_task: Main task description providing context
        subtasks: List of subtasks to execute
        max_agents: Maximum agents to use across all subtasks (4, 8, or 12)
        topology: Orchestration topology (hierarchical recommended for complex tasks)
        sequential: If True, execute subtasks sequentially; if False, execute in parallel

    Returns:
        dict: Orchestration result with subtask results and overall metrics
    """
    state = _get_state()

    # Validate inputs
    if not subtasks:
        return {
            "success": False,
            "error": "No subtasks provided",
        }

    if not validate_agent_count(max_agents):
        return {
            "success": False,
            "error": f"Invalid agent count: {max_agents}. Must be one of: {sorted(VALID_AGENT_COUNTS)}",
        }

    # Auto-initialize if needed
    if not state["initialized"]:
        init_result = await swarm_init(max_agents=max_agents, topology=topology)
        if not init_result["success"]:
            return init_result

    started_at = datetime.now(timezone.utc)
    subtask_results = []
    total_duration = 0.0

    try:
        if sequential:
            # Execute subtasks one at a time
            for i, subtask in enumerate(subtasks):
                result = await parallel_execute(
                    task_description=f"{main_task}\n\nCurrent subtask: {subtask}",
                    max_agents=max(4, max_agents // len(subtasks)),  # Divide agents
                    topology=topology,
                )
                subtask_results.append({
                    "index": i,
                    "subtask": subtask,
                    "result": result,
                })
                if result.get("metrics", {}).get("execution_time_seconds"):
                    total_duration += result["metrics"]["execution_time_seconds"]
        else:
            # Execute all subtasks in parallel using BatchTool pattern
            result = await parallel_execute(
                task_description=main_task,
                max_agents=max_agents,
                topology=topology,
                subtasks=subtasks,
            )
            subtask_results.append({
                "index": 0,
                "subtask": "All subtasks (parallel)",
                "result": result,
            })
            if result.get("metrics", {}).get("execution_time_seconds"):
                total_duration = result["metrics"]["execution_time_seconds"]

        completed_at = datetime.now(timezone.utc)

        # Aggregate results
        successful_subtasks = sum(1 for r in subtask_results if r["result"].get("success"))

        return {
            "success": successful_subtasks > 0,
            "main_task": main_task,
            "subtask_count": len(subtasks),
            "successful_subtasks": successful_subtasks,
            "failed_subtasks": len(subtasks) - successful_subtasks if sequential else (0 if subtask_results[0]["result"].get("success") else len(subtasks)),
            "subtask_results": subtask_results,
            "total_duration_seconds": total_duration,
            "execution_mode": "sequential" if sequential else "parallel",
            "started_at": started_at.isoformat(),
            "completed_at": completed_at.isoformat(),
        }

    except Exception as e:
        logger.exception("Failed to orchestrate task")
        return {
            "success": False,
            "error": f"Orchestration failed: {str(e)}",
        }


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def _parse_claude_flow_output(stdout: str) -> list[dict[str, Any]]:
    """
    Parse Claude Flow CLI output to extract agent results.

    Args:
        stdout: Standard output from Claude Flow CLI

    Returns:
        List of agent output dictionaries
    """
    import json

    # Try to parse as JSON first
    try:
        data = json.loads(stdout)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            # Check for common output structures
            if "agents" in data:
                return data["agents"]
            if "results" in data:
                return data["results"]
            if "output" in data:
                return [{"output": data["output"], "agent_id": "agent-1"}]
            return [data]
    except json.JSONDecodeError:
        pass

    # Fall back to text parsing
    # Split output by agent sections if present
    if "Agent" in stdout and "Output:" in stdout:
        import re
        agent_sections = re.split(r"(?=Agent\s+\d+)", stdout)
        results = []
        for i, section in enumerate(agent_sections):
            if section.strip():
                results.append({
                    "output": section.strip(),
                    "agent_id": f"agent-{i + 1}",
                })
        return results if results else [{"output": stdout, "agent_id": "agent-1"}]

    # Return as single output
    return [{"output": stdout, "agent_id": "agent-1"}]


# =============================================================================
# MCP SERVER CREATION
# =============================================================================


def create_claude_flow_tools() -> list:
    """
    Create all Claude Flow MCP tools.

    Returns:
        List of tool functions
    """
    return [
        swarm_init,
        agent_spawn,
        parallel_execute,
        memory_usage,
        health_check,
        task_orchestrate,
    ]


def create_claude_flow_mcp_server():
    """
    Create an MCP server with Claude Flow tools.

    Returns:
        MCP server instance, or None if FastMCP not available
    """
    if not FASTMCP_AVAILABLE:
        logger.warning("FastMCP not available. Install with: pip install mcp")
        return None

    # Create FastMCP server
    mcp = FastMCP(name="claude-flow")

    # Register tools using decorators
    @mcp.tool()
    async def swarm_init_tool(
        max_agents: int = 4,
        topology: str = "distributed",
        timeout_seconds: int = 300,
        working_dir: str | None = None,
    ) -> dict[str, Any]:
        """Initialize the Claude Flow swarm configuration."""
        return await swarm_init(
            max_agents=max_agents,
            topology=topology,
            timeout_seconds=timeout_seconds,
            working_dir=working_dir,
        )

    @mcp.tool()
    async def agent_spawn_tool(
        task: str,
        agent_id: str | None = None,
        role: str = "researcher",
    ) -> dict[str, Any]:
        """Spawn a new agent for a specific task."""
        return await agent_spawn(task=task, agent_id=agent_id, role=role)

    @mcp.tool()
    async def parallel_execute_tool(
        task_description: str,
        max_agents: int = 4,
        topology: str = "distributed",
        subtasks: list[str] | None = None,
    ) -> dict[str, Any]:
        """Execute a task in parallel using multiple Claude agents."""
        return await parallel_execute(
            task_description=task_description,
            max_agents=max_agents,
            topology=topology,
            subtasks=subtasks,
        )

    @mcp.tool()
    async def memory_usage_tool() -> dict[str, Any]:
        """Get memory usage statistics for the Claude Flow swarm."""
        return await memory_usage()

    @mcp.tool()
    async def health_check_tool() -> dict[str, Any]:
        """Check the health of the Claude Flow MCP server."""
        return await health_check()

    @mcp.tool()
    async def task_orchestrate_tool(
        main_task: str,
        subtasks: list[str],
        max_agents: int = 8,
        topology: str = "hierarchical",
        sequential: bool = False,
    ) -> dict[str, Any]:
        """Orchestrate a complex task with multiple subtasks."""
        return await task_orchestrate(
            main_task=main_task,
            subtasks=subtasks,
            max_agents=max_agents,
            topology=topology,
            sequential=sequential,
        )

    return mcp


def is_tools_available() -> bool:
    """Check if MCP tools functionality is available."""
    return FASTMCP_AVAILABLE


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================


def main():
    """Main entry point for running the MCP server."""
    import argparse

    parser = argparse.ArgumentParser(description="Claude Flow MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "sse"],
        default="stdio",
        help="MCP transport type (default: stdio)",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging",
    )

    args = parser.parse_args()

    # Configure logging
    log_level = logging.DEBUG if args.debug else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    # Create and run server
    mcp = create_claude_flow_mcp_server()

    if mcp is None:
        logger.error("Failed to create MCP server. FastMCP not available.")
        sys.exit(1)

    logger.info(f"Starting Claude Flow MCP server with {args.transport} transport")

    try:
        mcp.run(transport=args.transport)
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.exception(f"Server error: {e}")
        sys.exit(1)
    finally:
        # Cleanup
        asyncio.get_event_loop().run_until_complete(cleanup_subprocess_manager())


if __name__ == "__main__":
    main()
