# Claude Flow MCP Server

MCP server for Claude Flow parallel agent orchestration. This package exposes Claude Flow's
parallel agent capabilities through the Model Context Protocol (MCP), enabling 5-10x speedup
for research and codebase exploration tasks.

## Features

- **Parallel Execution**: Run up to 12 concurrent Claude agents for research tasks
- **MCP Integration**: Exposes Claude Flow via standard MCP protocol
- **Progress Tracking**: Real-time progress updates for parallel operations
- **Result Aggregation**: Combines outputs from multiple agents into unified responses
- **Subprocess Management**: Handles Claude Flow CLI lifecycle with proper cleanup

## Prerequisites

- Python 3.10+
- Claude Flow CLI (npm package)
- Anthropic API key

## Installation

```bash
# Install Claude Flow globally
npm install -g claude-flow@alpha

# Initialize Claude Flow
npx claude-flow@alpha init --force

# Install this package
cd claude-flow-server
pip install -e .
```

## Usage

### Starting the Server

```bash
# Run as MCP server (stdio transport)
python -m claude_flow_server.server
```

### MCP Tools Available

- `swarm_init` - Initialize a Claude Flow swarm
- `parallel_execute` - Execute tasks with parallel agents
- `agent_spawn` - Spawn individual agents
- `memory_usage` - Query ReasoningBank memory usage
- `health_check` - Check Claude Flow health status
- `task_orchestrate` - Orchestrate complex multi-step tasks

## Configuration

Set these environment variables:

- `ANTHROPIC_API_KEY` - Required for Claude Flow agent execution
- `CLAUDE_FLOW_MAX_AGENTS` - Maximum concurrent agents (default: 12)
- `OPENROUTER_API_KEY` - Optional for alternative model providers

## Development

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests/ -v

# Run linter
ruff check .
ruff format .
```

## License

AGPL-3.0
