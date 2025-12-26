# Claude Flow MCP Server API Reference

This document provides comprehensive API documentation for all 6 MCP tools exposed by the Claude Flow MCP Server. Each tool is designed for parallel agent orchestration and integrates with the Model Context Protocol (MCP).

## Table of Contents

- [Overview](#overview)
- [Tool Naming Convention](#tool-naming-convention)
- [Data Types](#data-types)
- [Tools](#tools)
  - [swarm_init](#swarm_init)
  - [agent_spawn](#agent_spawn)
  - [parallel_execute](#parallel_execute)
  - [memory_usage](#memory_usage)
  - [health_check](#health_check)
  - [task_orchestrate](#task_orchestrate)
- [Response Types](#response-types)
- [Error Handling](#error-handling)
- [Configuration Types](#configuration-types)

---

## Overview

The Claude Flow MCP Server exposes 6 tools for parallel agent orchestration:

| Tool | Purpose | Requires Init |
|------|---------|---------------|
| `swarm_init` | Initialize swarm configuration | No |
| `agent_spawn` | Spawn a single agent | Yes |
| `parallel_execute` | Execute task with multiple agents | Auto-init |
| `memory_usage` | Get memory statistics | No |
| `health_check` | Check system health | No |
| `task_orchestrate` | Orchestrate complex multi-subtask workflows | Auto-init |

---

## Tool Naming Convention

When accessed via MCP, tools are prefixed with the server namespace:

```
mcp__claude-flow__<tool_name>
```

Examples:
- `mcp__claude-flow__swarm_init`
- `mcp__claude-flow__parallel_execute`
- `mcp__claude-flow__health_check`

---

## Data Types

### TopologyMode

Agent orchestration topology mode.

```typescript
type TopologyMode = "distributed" | "hierarchical" | "mesh" | "centralized"
```

| Value | Description |
|-------|-------------|
| `distributed` | Agents work independently on subtasks, results merged at the end |
| `hierarchical` | Lead agent coordinates and delegates to worker agents |
| `mesh` | Agents communicate peer-to-peer for collaborative tasks |
| `centralized` | Single coordinator manages all agent task assignments |

### AgentRole

Available roles for spawned agents.

```typescript
type AgentRole = "researcher" | "analyst" | "coder" | "reviewer"
```

| Role | Description |
|------|-------------|
| `researcher` | Information gathering and exploration |
| `analyst` | Data analysis and pattern identification |
| `coder` | Code generation and modification |
| `reviewer` | Code review and quality assessment |

### ValidAgentCount

Valid agent count values.

```typescript
type ValidAgentCount = 4 | 8 | 12
```

---

## Tools

### swarm_init

Initialize the Claude Flow swarm configuration. This sets up the execution environment for parallel agent tasks.

#### Signature

```python
async def swarm_init(
    max_agents: int = 4,
    topology: str = "distributed",
    timeout_seconds: int = 300,
    working_dir: str | None = None,
) -> dict[str, Any]
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `max_agents` | `int` | No | `4` | Maximum number of parallel agents. Must be 4, 8, or 12. |
| `topology` | `str` | No | `"distributed"` | Agent orchestration topology mode. |
| `timeout_seconds` | `int` | No | `300` | Timeout for task execution in seconds. Range: 30-3600. |
| `working_dir` | `str \| None` | No | `None` | Working directory for swarm operations. Defaults to current directory. |

#### Return Type

```typescript
interface SwarmInitResult {
  success: boolean;
  initialized?: boolean;
  config?: {
    max_agents: number;
    topology: string;
    timeout_seconds: number;
    enable_metrics: boolean;
    enable_caching: boolean;
    swarm_dir: string;
    model: {
      provider: string;
      model_name: string;
    };
    resource_limits: {
      max_memory_mb: number;
      max_api_calls: number;
      max_retries: number;
    };
  };
  working_dir?: string;
  swarm_dir?: string;
  claude_flow_available?: boolean;
  message?: string;
  error?: string;
}
```

#### Examples

**Basic initialization:**

```python
result = await swarm_init(max_agents=8, topology="distributed")

# Returns:
{
    "success": True,
    "initialized": True,
    "config": {
        "max_agents": 8,
        "topology": "distributed",
        "timeout_seconds": 300,
        ...
    },
    "working_dir": "/home/user/project",
    "swarm_dir": "/home/user/project/.swarm",
    "claude_flow_available": True,
    "message": "Swarm initialized successfully"
}
```

**With custom timeout:**

```python
result = await swarm_init(
    max_agents=12,
    topology="hierarchical",
    timeout_seconds=600,
    working_dir="/path/to/project"
)
```

**Error response:**

```python
result = await swarm_init(max_agents=5)  # Invalid agent count

# Returns:
{
    "success": False,
    "error": "Invalid agent count: 5. Must be one of: [4, 8, 12]"
}
```

---

### agent_spawn

Spawn a new agent for a specific task. Creates a single agent instance to work on a designated subtask.

#### Signature

```python
async def agent_spawn(
    task: str,
    agent_id: str | None = None,
    role: str = "researcher",
) -> dict[str, Any]
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task` | `str` | **Yes** | - | Task description for the agent to execute. |
| `agent_id` | `str \| None` | No | `None` | Unique identifier for the agent. Auto-generated if not provided. |
| `role` | `str` | No | `"researcher"` | Agent role: researcher, analyst, coder, or reviewer. |

#### Return Type

```typescript
interface AgentSpawnResult {
  success: boolean;
  agent_id: string;
  role?: string;
  task?: string;
  output?: string;
  error?: string;
  duration_seconds?: number;
}
```

#### Examples

**Basic agent spawn:**

```python
result = await agent_spawn(
    task="Analyze the authentication flow in the codebase",
    role="analyst"
)

# Returns:
{
    "success": True,
    "agent_id": "agent-20251226120000123456",
    "role": "analyst",
    "task": "Analyze the authentication flow in the codebase",
    "output": "The authentication flow consists of...",
    "duration_seconds": 45.2
}
```

**With custom agent ID:**

```python
result = await agent_spawn(
    task="Review the database models",
    agent_id="db-reviewer-1",
    role="reviewer"
)
```

**Error: Swarm not initialized:**

```python
# Without calling swarm_init first
result = await agent_spawn(task="Some task")

# Returns:
{
    "success": False,
    "error": "Swarm not initialized. Call swarm_init first."
}
```

**Error: Invalid role:**

```python
result = await agent_spawn(task="Task", role="invalid")

# Returns:
{
    "success": False,
    "error": "Invalid role: invalid. Must be one of: ['analyst', 'coder', 'researcher', 'reviewer']"
}
```

---

### parallel_execute

Execute a task in parallel using multiple Claude agents. This is the primary tool for parallel task execution.

**IMPORTANT**: For optimal parallelism, submit all subtasks in a single call. Breaking the batch into multiple calls destroys parallel execution benefits.

#### Signature

```python
async def parallel_execute(
    task_description: str,
    max_agents: int = 4,
    topology: str = "distributed",
    subtasks: list[str] | None = None,
) -> dict[str, Any]
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task_description` | `str` | **Yes** | - | Main task description for agents. |
| `max_agents` | `int` | No | `4` | Number of parallel agents (4, 8, or 12). |
| `topology` | `str` | No | `"distributed"` | Agent orchestration topology mode. |
| `subtasks` | `list[str] \| None` | No | `None` | Optional list of specific subtasks to distribute across agents. |

#### Return Type

```typescript
interface ParallelExecuteResult {
  success: boolean;
  combined_output?: string;
  agent_count?: number;
  metrics?: ExecutionMetrics;
  errors?: string[];
  deduplicated_count?: number;
  error?: string;
  stderr?: string;
  duration_seconds?: number;
  timed_out?: boolean;
}

interface ExecutionMetrics {
  execution_time_seconds: number;
  agent_count: number;
  speedup_factor: number;
  sequential_baseline_seconds: number;
  agents_successful: number;
  agents_failed: number;
  api_calls_total: number;
  started_at: string | null;  // ISO 8601 datetime
  completed_at: string | null;  // ISO 8601 datetime
}
```

#### Examples

**Basic parallel execution:**

```python
result = await parallel_execute(
    task_description="Research best practices for Python async programming",
    max_agents=8,
    topology="distributed"
)

# Returns:
{
    "success": True,
    "combined_output": "## Agent 1 Findings\n\nAsync/await patterns...\n\n## Agent 2 Findings\n\n...",
    "agent_count": 8,
    "metrics": {
        "execution_time_seconds": 45.2,
        "agent_count": 8,
        "speedup_factor": 6.8,
        "sequential_baseline_seconds": 307.4,
        "agents_successful": 8,
        "agents_failed": 0,
        "api_calls_total": 96,
        "started_at": "2025-12-26T12:00:00Z",
        "completed_at": "2025-12-26T12:00:45Z"
    },
    "errors": [],
    "deduplicated_count": 2
}
```

**With subtasks (BatchTool pattern):**

```python
result = await parallel_execute(
    task_description="Perform comprehensive security audit",
    max_agents=12,
    topology="distributed",
    subtasks=[
        "Check for SQL injection vulnerabilities",
        "Review authentication mechanisms",
        "Analyze input validation patterns",
        "Audit session management",
        "Check for XSS vulnerabilities",
        "Review API security headers"
    ]
)
```

**Auto-initialization:**

```python
# parallel_execute auto-initializes if swarm_init not called
result = await parallel_execute(
    task_description="Analyze codebase",
    max_agents=4
)
# Swarm is automatically initialized with provided max_agents
```

**Timeout error:**

```python
{
    "success": False,
    "error": "Process timed out after 300 seconds",
    "duration_seconds": 300.0,
    "timed_out": True
}
```

---

### memory_usage

Get memory usage statistics for the Claude Flow swarm.

#### Signature

```python
async def memory_usage() -> dict[str, Any]
```

#### Parameters

None.

#### Return Type

```typescript
interface MemoryUsageResult {
  success: boolean;
  system_memory_mb: number | null;
  available_memory_mb: number | null;
  used_memory_mb: number | null;
  swarm_memory_mb: number;
  active_processes: number;
  initialized: boolean;
}
```

#### Examples

**Get memory usage:**

```python
result = await memory_usage()

# Returns:
{
    "success": True,
    "system_memory_mb": 16384.0,
    "available_memory_mb": 8192.0,
    "used_memory_mb": 8192.0,
    "swarm_memory_mb": 512.5,
    "active_processes": 3,
    "initialized": True
}
```

**Before initialization:**

```python
result = await memory_usage()

# Returns:
{
    "success": True,
    "system_memory_mb": 16384.0,
    "available_memory_mb": 10240.0,
    "used_memory_mb": 6144.0,
    "swarm_memory_mb": 0.0,
    "active_processes": 0,
    "initialized": False
}
```

---

### health_check

Check the health of the Claude Flow MCP server and its dependencies.

#### Signature

```python
async def health_check() -> dict[str, Any]
```

#### Parameters

None.

#### Return Type

```typescript
interface HealthCheckResult {
  success: boolean;
  status: "healthy" | "degraded";
  components: {
    initialized: {
      status: "ok" | "not_initialized";
      message: string;
    };
    claude_flow_cli: {
      status: "ok" | "unavailable";
      message: string;
    };
    api_key: {
      status: "ok" | "missing";
      message: string;
    };
    processes: {
      status: "ok";
      active_count: number;
      processes: string[];
    };
  };
  timestamp: string;  // ISO 8601 datetime
  issues?: string[];  // Present if status is "degraded"
}
```

#### Examples

**Healthy system:**

```python
result = await health_check()

# Returns:
{
    "success": True,
    "status": "healthy",
    "components": {
        "initialized": {
            "status": "ok",
            "message": "Swarm is initialized"
        },
        "claude_flow_cli": {
            "status": "ok",
            "message": "Claude Flow CLI is available"
        },
        "api_key": {
            "status": "ok",
            "message": "ANTHROPIC_API_KEY is set"
        },
        "processes": {
            "status": "ok",
            "active_count": 0,
            "processes": []
        }
    },
    "timestamp": "2025-12-26T12:00:00Z"
}
```

**Degraded system:**

```python
# When Claude Flow CLI or API key is missing
result = await health_check()

# Returns:
{
    "success": True,
    "status": "degraded",
    "components": {
        "initialized": {
            "status": "not_initialized",
            "message": "Call swarm_init to initialize"
        },
        "claude_flow_cli": {
            "status": "unavailable",
            "message": "Install with: npm install -g claude-flow@alpha"
        },
        "api_key": {
            "status": "missing",
            "message": "ANTHROPIC_API_KEY environment variable not set"
        },
        "processes": {
            "status": "ok",
            "active_count": 0,
            "processes": []
        }
    },
    "timestamp": "2025-12-26T12:00:00Z",
    "issues": [
        "Claude Flow CLI not available",
        "API key not configured"
    ]
}
```

---

### task_orchestrate

Orchestrate a complex task with multiple subtasks. Provides higher-level orchestration for complex workflows with sequential or parallel execution modes.

#### Signature

```python
async def task_orchestrate(
    main_task: str,
    subtasks: list[str],
    max_agents: int = 8,
    topology: str = "hierarchical",
    sequential: bool = False,
) -> dict[str, Any]
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `main_task` | `str` | **Yes** | - | Main task description providing context for all subtasks. |
| `subtasks` | `list[str]` | **Yes** | - | List of subtasks to execute. Must not be empty. |
| `max_agents` | `int` | No | `8` | Maximum agents across all subtasks (4, 8, or 12). |
| `topology` | `str` | No | `"hierarchical"` | Orchestration topology. Hierarchical recommended for complex tasks. |
| `sequential` | `bool` | No | `False` | If True, execute subtasks one at a time; if False, execute in parallel. |

#### Return Type

```typescript
interface TaskOrchestrateResult {
  success: boolean;
  main_task?: string;
  subtask_count?: number;
  successful_subtasks?: number;
  failed_subtasks?: number;
  subtask_results?: SubtaskResult[];
  total_duration_seconds?: number;
  execution_mode?: "sequential" | "parallel";
  started_at?: string;  // ISO 8601 datetime
  completed_at?: string;  // ISO 8601 datetime
  error?: string;
}

interface SubtaskResult {
  index: number;
  subtask: string;
  result: ParallelExecuteResult;
}
```

#### Examples

**Parallel orchestration (default):**

```python
result = await task_orchestrate(
    main_task="Perform comprehensive code review",
    subtasks=[
        "Review code style and formatting",
        "Check for security vulnerabilities",
        "Analyze performance bottlenecks",
        "Verify test coverage"
    ],
    max_agents=8,
    topology="hierarchical"
)

# Returns:
{
    "success": True,
    "main_task": "Perform comprehensive code review",
    "subtask_count": 4,
    "successful_subtasks": 4,
    "failed_subtasks": 0,
    "subtask_results": [
        {
            "index": 0,
            "subtask": "All subtasks (parallel)",
            "result": {
                "success": True,
                "combined_output": "...",
                "metrics": {...}
            }
        }
    ],
    "total_duration_seconds": 62.5,
    "execution_mode": "parallel",
    "started_at": "2025-12-26T12:00:00Z",
    "completed_at": "2025-12-26T12:01:02Z"
}
```

**Sequential orchestration:**

```python
result = await task_orchestrate(
    main_task="Build a feature step by step",
    subtasks=[
        "Design the API schema",
        "Implement the backend endpoints",
        "Create the frontend components",
        "Write integration tests"
    ],
    max_agents=4,
    sequential=True  # Execute one at a time
)

# Returns:
{
    "success": True,
    "subtask_count": 4,
    "successful_subtasks": 4,
    "failed_subtasks": 0,
    "subtask_results": [
        {
            "index": 0,
            "subtask": "Design the API schema",
            "result": {"success": True, ...}
        },
        {
            "index": 1,
            "subtask": "Implement the backend endpoints",
            "result": {"success": True, ...}
        },
        ...
    ],
    "execution_mode": "sequential",
    ...
}
```

**Error: No subtasks:**

```python
result = await task_orchestrate(
    main_task="Some task",
    subtasks=[]
)

# Returns:
{
    "success": False,
    "error": "No subtasks provided"
}
```

---

## Response Types

### ExecutionMetrics

Performance metrics returned by `parallel_execute` and included in orchestration results.

```typescript
interface ExecutionMetrics {
  // Time taken for parallel execution
  execution_time_seconds: number;

  // Number of agents used
  agent_count: number;

  // Speedup vs estimated sequential execution (e.g., 6.5 = 6.5x faster)
  speedup_factor: number;

  // Estimated time if run sequentially
  sequential_baseline_seconds: number;

  // Agents that completed successfully
  agents_successful: number;

  // Agents that failed
  agents_failed: number;

  // Total API calls across all agents
  api_calls_total: number;

  // ISO 8601 timestamps
  started_at: string | null;
  completed_at: string | null;
}
```

### AggregatedResult

Internal result structure from the ResultAggregator.

```typescript
interface AggregatedResult {
  success: boolean;
  combined_output: string;
  outputs: AgentOutput[];
  metrics: ExecutionMetrics;
  errors: string[];
  deduplicated_count: number;
}

interface AgentOutput {
  agent_id: string;
  output: string;
  success: boolean;
  error: string | null;
  execution_time: number;
  api_calls: number;
  metadata: Record<string, any>;
}
```

---

## Error Handling

All tools return a consistent error structure when failures occur:

```typescript
interface ErrorResult {
  success: false;
  error: string;  // Human-readable error message
}
```

### Common Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `Invalid agent count: X. Must be one of: [4, 8, 12]` | Invalid `max_agents` value | Use 4, 8, or 12 |
| `Invalid topology: X. Must be one of: distributed, hierarchical, mesh, centralized` | Invalid topology mode | Use valid topology string |
| `Invalid role: X. Must be one of: ['analyst', 'coder', 'researcher', 'reviewer']` | Invalid agent role | Use valid role string |
| `Swarm not initialized. Call swarm_init first.` | `agent_spawn` called before init | Call `swarm_init` first or use auto-init tools |
| `No subtasks provided` | Empty subtasks list in `task_orchestrate` | Provide at least one subtask |
| `Process timed out after X seconds` | Task exceeded timeout | Increase `timeout_seconds` |
| `Claude Flow CLI not found` | CLI not installed | Run `npm install -g claude-flow@alpha` |
| `ANTHROPIC_API_KEY environment variable not set` | Missing API key | Set the environment variable |

### Error Handling Best Practices

```python
# Always check success before using results
result = await parallel_execute(task_description="...", max_agents=8)

if result["success"]:
    output = result["combined_output"]
    metrics = result["metrics"]
    print(f"Speedup: {metrics['speedup_factor']}x")
else:
    error = result.get("error", "Unknown error")
    print(f"Task failed: {error}")

    # Check for timeout
    if result.get("timed_out"):
        print("Consider increasing timeout_seconds")
```

---

## Configuration Types

### ClaudeFlowConfig

Full configuration model used internally.

```python
from pydantic import BaseModel, Field

class ClaudeFlowConfig(BaseModel):
    max_agents: int = 4  # Must be 4, 8, or 12
    topology: TopologyMode = TopologyMode.DISTRIBUTED
    model: ModelConfig = ModelConfig()
    timeout_seconds: int = 300  # Range: 30-3600
    resource_limits: ResourceLimits = ResourceLimits()
    enable_metrics: bool = True
    enable_caching: bool = True
    swarm_dir: str = ".swarm"

class ModelConfig(BaseModel):
    provider: ModelProvider = ModelProvider.ANTHROPIC
    model_name: str = "claude-sonnet-4-20250514"
    api_key_env: str = "ANTHROPIC_API_KEY"

class ResourceLimits(BaseModel):
    max_memory_mb: int = 512  # Range: 128-4096
    max_api_calls: int = 100  # Range: 1-1000
    max_retries: int = 3      # Range: 0-10
```

### Environment Variables

Configuration can be loaded from environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key (required) | - |
| `CLAUDE_FLOW_MAX_AGENTS` | Default max agents | `4` |
| `CLAUDE_FLOW_TOPOLOGY` | Default topology mode | `distributed` |
| `CLAUDE_FLOW_MODEL` | Model name to use | `claude-sonnet-4-20250514` |
| `CLAUDE_FLOW_TIMEOUT` | Default timeout in seconds | `300` |
| `OPENROUTER_API_KEY` | OpenRouter API key (optional) | - |

---

## See Also

- [README.md](../README.md) - Overview and quick start guide
- [USAGE.md](../USAGE.md) - Detailed usage examples and patterns
