# Claude Flow MCP Server

MCP server for Claude Flow parallel agent orchestration. This package exposes Claude Flow's
parallel agent capabilities through the Model Context Protocol (MCP), enabling 5-10x speedup
for research and codebase exploration tasks.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [MCP Tools](#mcp-tools)
- [Usage Examples](#usage-examples)
- [Architecture](#architecture)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Features

- **Parallel Execution**: Run up to 12 concurrent Claude agents for research tasks
- **MCP Integration**: Exposes Claude Flow via standard MCP protocol (stdio transport)
- **Progress Tracking**: Real-time progress updates for parallel operations
- **Result Aggregation**: Combines outputs from multiple agents into unified responses with deduplication
- **Subprocess Management**: Handles Claude Flow CLI lifecycle with proper cleanup and zombie process prevention
- **Configurable Topologies**: Support for distributed, hierarchical, mesh, and centralized agent orchestration
- **Performance Metrics**: Tracks execution time, speedup factor, and agent utilization

## Prerequisites

- **Python 3.10+**
- **Node.js 18+** (for Claude Flow CLI)
- **Claude Flow CLI** (npm package: `claude-flow@alpha`)
- **Anthropic API key**

## Installation

### 1. Install Claude Flow CLI

```bash
# Install Claude Flow globally
npm install -g claude-flow@alpha

# Initialize Claude Flow (creates .swarm/ directory)
npx claude-flow@alpha init --force
```

### 2. Install the Python Package

```bash
# Navigate to the package directory
cd claude-flow-server

# Install in development mode
pip install -e .

# Or install with dev dependencies
pip install -e ".[dev]"
```

### 3. Set Environment Variables

```bash
# Required: Anthropic API key for Claude Flow agent execution
export ANTHROPIC_API_KEY="your-api-key-here"

# Optional: Maximum concurrent agents (default: 12)
export CLAUDE_FLOW_MAX_AGENTS=12

# Optional: Default topology mode (default: distributed)
export CLAUDE_FLOW_TOPOLOGY=distributed

# Optional: Timeout in seconds (default: 300)
export CLAUDE_FLOW_TIMEOUT=300

# Optional: Alternative model provider
export OPENROUTER_API_KEY="your-openrouter-key"
```

## Quick Start

### Start the MCP Server

```bash
# Run as MCP server with stdio transport (default)
python -m claude_flow_server.server

# Run with debug logging
python -m claude_flow_server.server --debug

# Run with SSE transport (for HTTP clients)
python -m claude_flow_server.server --transport sse
```

### Use as a Library

```python
import asyncio
from claude_flow_server.server import (
    swarm_init,
    parallel_execute,
    health_check,
)

async def main():
    # Initialize swarm with 8 agents
    init_result = await swarm_init(max_agents=8, topology="distributed")
    print(f"Initialized: {init_result['success']}")

    # Execute parallel task
    result = await parallel_execute(
        task_description="Research the best practices for Python async programming",
        max_agents=8,
        topology="distributed",
    )

    print(f"Combined output: {result['combined_output']}")
    print(f"Speedup: {result['metrics']['speedup_factor']}x")

asyncio.run(main())
```

## Configuration

### Configuration Schema

The server uses Pydantic models for configuration validation:

```python
from claude_flow_server.config import ClaudeFlowConfig, TopologyMode

# Create custom configuration
config = ClaudeFlowConfig(
    max_agents=8,                          # 4, 8, or 12 agents
    topology=TopologyMode.HIERARCHICAL,    # Agent coordination mode
    timeout_seconds=600,                   # Task timeout (30-3600)
    enable_metrics=True,                   # Performance tracking
    enable_caching=True,                   # Result caching
)

# Load configuration from environment
config = ClaudeFlowConfig.from_env()
```

### Topology Modes

| Mode | Description | Best For |
|------|-------------|----------|
| `distributed` | Agents work independently on subtasks | Research, exploration |
| `hierarchical` | Lead agent coordinates worker agents | Complex multi-step tasks |
| `mesh` | Agents communicate peer-to-peer | Collaborative analysis |
| `centralized` | Single coordinator manages all agents | Coordinated workflows |

### Agent Count Options

| Agents | Use Case | Typical Speedup |
|--------|----------|-----------------|
| 4 | Light tasks, limited API budget | 3-4x |
| 8 | Standard research, balanced cost | 5-6x |
| 12 | Heavy codebase exploration | 7-10x |

## MCP Tools

The server exposes 6 MCP tools:

### `swarm_init`

Initialize the Claude Flow swarm configuration.

```json
{
  "max_agents": 8,
  "topology": "distributed",
  "timeout_seconds": 300,
  "working_dir": "/path/to/project"
}
```

### `parallel_execute`

Execute a task in parallel using multiple Claude agents.

```json
{
  "task_description": "Analyze the codebase architecture",
  "max_agents": 8,
  "topology": "distributed",
  "subtasks": [
    "Review the API layer",
    "Analyze database models",
    "Check authentication flow"
  ]
}
```

### `agent_spawn`

Spawn a single agent for a specific task.

```json
{
  "task": "Summarize the README files",
  "agent_id": "researcher-1",
  "role": "researcher"
}
```

Supported roles: `researcher`, `analyst`, `coder`, `reviewer`

### `memory_usage`

Get memory usage statistics for the swarm.

```json
// No parameters required
```

Returns:
```json
{
  "success": true,
  "system_memory_mb": 16384,
  "available_memory_mb": 8192,
  "swarm_memory_mb": 512,
  "active_processes": 3
}
```

### `health_check`

Check the health of the Claude Flow MCP server.

```json
// No parameters required
```

Returns:
```json
{
  "success": true,
  "status": "healthy",
  "components": {
    "initialized": {"status": "ok"},
    "claude_flow_cli": {"status": "ok"},
    "api_key": {"status": "ok"},
    "processes": {"active_count": 0}
  }
}
```

### `task_orchestrate`

Orchestrate a complex task with multiple subtasks.

```json
{
  "main_task": "Perform security audit of the application",
  "subtasks": [
    "Check for SQL injection vulnerabilities",
    "Review authentication mechanisms",
    "Analyze input validation",
    "Check for XSS vulnerabilities"
  ],
  "max_agents": 8,
  "topology": "hierarchical",
  "sequential": false
}
```

## Usage Examples

See [USAGE.md](./USAGE.md) for detailed usage examples including:

- Basic parallel execution
- Complex task orchestration
- Error handling patterns
- Result aggregation customization
- Performance optimization tips

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Client (Claude Code)                  │
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            │ stdio/MCP
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Claude Flow MCP Server (FastMCP)                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  MCP Tools                                           │   │
│  │  - swarm_init      - memory_usage                    │   │
│  │  - agent_spawn     - health_check                    │   │
│  │  - parallel_execute - task_orchestrate               │   │
│  └─────────────────────────┬────────────────────────────┘   │
│                            │                                 │
│  ┌─────────────────────────▼────────────────────────────┐   │
│  │  Subprocess Manager                                   │   │
│  │  - Async execution with timeouts                      │   │
│  │  - Process registry for cleanup                       │   │
│  │  - Zombie process prevention                          │   │
│  └─────────────────────────┬────────────────────────────┘   │
│                            │                                 │
│  ┌─────────────────────────▼────────────────────────────┐   │
│  │  Result Aggregator                                    │   │
│  │  - Output deduplication (Jaccard similarity)          │   │
│  │  - Metrics calculation                                │   │
│  │  - Multiple output formats (sections/list/merged)     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Claude Flow CLI (npm package)                   │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Agent 1    │  │   Agent 2    │  │   Agent N    │       │
│  │ (Claude API) │  │ (Claude API) │  │ (Claude API) │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                           │                                  │
│                  ┌────────▼─────────┐                        │
│                  │  ReasoningBank   │                        │
│                  │    (SQLite)      │                        │
│                  └──────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## Development

### Install Development Dependencies

```bash
pip install -e ".[dev]"
```

### Run Tests

```bash
# Run all tests
pytest tests/ -v

# Run with coverage
pytest tests/ -v --cov=claude_flow_server

# Run specific test file
pytest tests/test_server.py -v
```

### Code Quality

```bash
# Run linter
ruff check .

# Auto-fix issues
ruff check --fix .

# Format code
ruff format .
```

### Project Structure

```
claude-flow-server/
├── claude_flow_server/
│   ├── __init__.py           # Package initialization
│   ├── server.py             # MCP server with tool definitions
│   ├── config.py             # Configuration schema and validation
│   ├── subprocess_manager.py # Claude Flow CLI lifecycle management
│   └── result_aggregator.py  # Output aggregation and deduplication
├── tests/
│   ├── test_server.py        # Server and tool tests
│   ├── test_config.py        # Configuration tests
│   ├── test_subprocess_manager.py
│   └── test_result_aggregator.py
├── pyproject.toml            # Package metadata and dependencies
├── README.md                 # This file
└── USAGE.md                  # Detailed usage examples
```

## Troubleshooting

### Claude Flow CLI Not Found

```
Error: Claude Flow CLI not found. Install with: npm install -g claude-flow@alpha
```

**Solution**: Ensure Claude Flow is installed globally:
```bash
npm install -g claude-flow@alpha
npx claude-flow@alpha --version
```

### API Key Not Set

```
Warning: ANTHROPIC_API_KEY environment variable not set
```

**Solution**: Set the environment variable:
```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

### Swarm Not Initialized

```
Error: Swarm not initialized. Call swarm_init first.
```

**Solution**: Tools that require initialization will auto-initialize with defaults, but you can explicitly initialize:
```python
await swarm_init(max_agents=8, topology="distributed")
```

### Timeout Errors

```
Error: Process timed out after 300 seconds
```

**Solution**: Increase the timeout for long-running tasks:
```python
await swarm_init(timeout_seconds=600)  # 10 minutes
```

### Zombie Processes

The subprocess manager automatically cleans up zombie processes. If you encounter issues:

```python
from claude_flow_server.subprocess_manager import get_subprocess_manager

manager = get_subprocess_manager()
cleaned = await manager.cleanup_zombies()
print(f"Cleaned up {cleaned} zombie processes")
```

## License

AGPL-3.0

---

For more detailed usage examples, see [USAGE.md](./USAGE.md).

For API documentation, see [docs/API.md](./docs/API.md).
