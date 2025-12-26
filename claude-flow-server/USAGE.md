# Claude Flow MCP Server Usage Guide

This guide provides detailed usage examples and patterns for the Claude Flow MCP Server.

## Table of Contents

1. [Basic Usage](#basic-usage)
2. [Parallel Execution](#parallel-execution)
3. [Task Orchestration](#task-orchestration)
4. [Configuration Patterns](#configuration-patterns)
5. [Result Aggregation](#result-aggregation)
6. [Error Handling](#error-handling)
7. [Performance Optimization](#performance-optimization)
8. [Integration Patterns](#integration-patterns)

---

## Basic Usage

### Initializing the Swarm

Before executing parallel tasks, initialize the swarm with your desired configuration:

```python
import asyncio
from claude_flow_server.server import swarm_init

async def initialize():
    result = await swarm_init(
        max_agents=8,              # Use 8 parallel agents
        topology="distributed",    # Independent task execution
        timeout_seconds=300,       # 5 minute timeout
        working_dir="/path/to/project"
    )

    if result["success"]:
        print(f"Swarm initialized in: {result['swarm_dir']}")
        print(f"Claude Flow available: {result['claude_flow_available']}")
    else:
        print(f"Initialization failed: {result['error']}")

    return result

asyncio.run(initialize())
```

### Health Checking

Always check health before running critical tasks:

```python
from claude_flow_server.server import health_check

async def check_system():
    health = await health_check()

    print(f"Status: {health['status']}")

    for component, info in health["components"].items():
        print(f"  {component}: {info['status']}")
        if "message" in info:
            print(f"    {info['message']}")

    if health["status"] == "degraded":
        print("Issues found:", health.get("issues", []))

    return health["status"] == "healthy"
```

---

## Parallel Execution

### Simple Parallel Task

Execute a single task across multiple agents:

```python
from claude_flow_server.server import parallel_execute

async def research_topic():
    result = await parallel_execute(
        task_description="Research best practices for microservices architecture",
        max_agents=8,
        topology="distributed"
    )

    if result["success"]:
        print(f"Research completed!")
        print(f"Agents used: {result['agent_count']}")
        print(f"Execution time: {result['metrics']['execution_time_seconds']}s")
        print(f"Speedup: {result['metrics']['speedup_factor']}x")
        print("\nFindings:")
        print(result["combined_output"])
    else:
        print(f"Research failed: {result['error']}")
```

### Parallel Task with Subtasks

Distribute specific subtasks across agents:

```python
async def analyze_codebase():
    result = await parallel_execute(
        task_description="Analyze the application codebase for improvements",
        max_agents=12,
        topology="distributed",
        subtasks=[
            "Review the API layer structure and suggest improvements",
            "Analyze database query patterns for optimization",
            "Check error handling coverage",
            "Review authentication and authorization flow",
            "Analyze test coverage gaps",
            "Check for code duplication",
            "Review dependency usage and updates",
            "Analyze logging and monitoring patterns"
        ]
    )

    if result["success"]:
        metrics = result["metrics"]
        print(f"Analysis complete in {metrics['execution_time_seconds']:.1f}s")
        print(f"Sequential baseline: {metrics['sequential_baseline_seconds']:.1f}s")
        print(f"Speedup achieved: {metrics['speedup_factor']:.1f}x")

        if result["errors"]:
            print(f"\nPartial failures: {len(result['errors'])}")
            for err in result["errors"]:
                print(f"  - {err}")
```

### BatchTool Pattern (Critical for Performance)

**Important**: For maximum parallelism, submit all subtasks in a single call:

```python
# CORRECT: Single batch call - agents run in parallel
async def batch_research():
    return await parallel_execute(
        task_description="Research the following topics",
        max_agents=8,
        subtasks=[
            "Topic 1: Python async programming",
            "Topic 2: FastAPI best practices",
            "Topic 3: PostgreSQL optimization",
            "Topic 4: Docker containerization"
        ]
    )

# INCORRECT: Multiple sequential calls - destroys parallelism
async def sequential_research():  # Don't do this!
    results = []
    for topic in topics:
        result = await parallel_execute(
            task_description=topic,
            max_agents=2
        )
        results.append(result)
    return results
```

---

## Task Orchestration

### Basic Orchestration

For complex multi-step tasks, use the orchestrator:

```python
from claude_flow_server.server import task_orchestrate

async def security_audit():
    result = await task_orchestrate(
        main_task="Perform comprehensive security audit of the application",
        subtasks=[
            "Analyze authentication mechanisms for vulnerabilities",
            "Check for SQL injection and XSS vulnerabilities",
            "Review authorization and access control",
            "Analyze API security and rate limiting",
            "Check for sensitive data exposure",
            "Review dependency vulnerabilities"
        ],
        max_agents=8,
        topology="hierarchical",  # Coordinator pattern for complex tasks
        sequential=False          # Parallel execution
    )

    print(f"Audit complete!")
    print(f"Successful subtasks: {result['successful_subtasks']}/{result['subtask_count']}")
    print(f"Duration: {result['total_duration_seconds']:.1f}s")

    for subtask_result in result["subtask_results"]:
        print(f"\n{subtask_result['subtask']}:")
        print(subtask_result["result"]["combined_output"][:500])
```

### Sequential Orchestration

For tasks that must run in order:

```python
async def deploy_pipeline():
    result = await task_orchestrate(
        main_task="Execute deployment pipeline",
        subtasks=[
            "Run linting and static analysis",
            "Execute unit tests",
            "Run integration tests",
            "Build Docker images",
            "Deploy to staging",
            "Run smoke tests"
        ],
        max_agents=4,  # Fewer agents for sequential work
        topology="centralized",
        sequential=True  # Each step waits for previous
    )

    if result["success"]:
        print("Deployment pipeline completed successfully!")
    else:
        print(f"Pipeline failed at step: {result['failed_subtasks']}")
```

---

## Configuration Patterns

### Environment-Based Configuration

Load configuration from environment variables:

```python
from claude_flow_server.config import ClaudeFlowConfig

# Load from environment
config = ClaudeFlowConfig.from_env()

print(f"Max agents: {config.max_agents}")
print(f"Topology: {config.topology.value}")
print(f"Timeout: {config.timeout_seconds}s")
print(f"API key available: {config.model.has_api_key()}")
```

### Custom Configuration

Create specific configurations for different use cases:

```python
from claude_flow_server.config import (
    ClaudeFlowConfig,
    TopologyMode,
    ModelConfig,
    ResourceLimits,
)

# Heavy research configuration
research_config = ClaudeFlowConfig(
    max_agents=12,
    topology=TopologyMode.DISTRIBUTED,
    timeout_seconds=600,  # 10 minutes
    resource_limits=ResourceLimits(
        max_memory_mb=1024,
        max_api_calls=200,
        max_retries=5
    )
)

# Light analysis configuration
light_config = ClaudeFlowConfig(
    max_agents=4,
    topology=TopologyMode.CENTRALIZED,
    timeout_seconds=120,
    resource_limits=ResourceLimits(
        max_memory_mb=256,
        max_api_calls=50,
        max_retries=2
    )
)

# Convert to CLI arguments for subprocess
cli_args = research_config.to_cli_args()
# ['--mode', 'distributed', '--max-agents', '12', '--parallel', '--executor']
```

### Topology Selection Guide

Choose the right topology for your task:

```python
# Distributed: Independent research, file analysis
# Best when each subtask is self-contained
distributed_result = await parallel_execute(
    task_description="Analyze each file in the codebase",
    topology="distributed",
    subtasks=file_list
)

# Hierarchical: Complex analysis requiring coordination
# Best when results need to be synthesized
hierarchical_result = await task_orchestrate(
    main_task="Design new API architecture",
    subtasks=design_tasks,
    topology="hierarchical"
)

# Mesh: Collaborative problem-solving
# Best when agents need to share discoveries
mesh_result = await parallel_execute(
    task_description="Debug the intermittent test failure",
    topology="mesh"
)

# Centralized: Strict coordination needed
# Best for sequential dependencies
centralized_result = await task_orchestrate(
    main_task="Database migration",
    subtasks=migration_steps,
    topology="centralized",
    sequential=True
)
```

---

## Result Aggregation

### Understanding Aggregated Results

The result aggregator combines multiple agent outputs:

```python
from claude_flow_server.result_aggregator import ResultAggregator, AgentOutput

# Create aggregator with custom settings
aggregator = ResultAggregator(
    enable_deduplication=True,    # Remove similar outputs
    similarity_threshold=0.85     # Jaccard similarity threshold
)

# Aggregate raw outputs
result = aggregator.aggregate(
    agent_outputs=[
        {"output": "Finding 1 from agent", "agent_id": "agent-1"},
        {"output": "Finding 2 from agent", "agent_id": "agent-2"},
        {"output": "Finding 1 from agent", "agent_id": "agent-3"},  # Duplicate
    ],
    execution_time=45.0
)

print(f"Unique findings: {len(result.outputs)}")
print(f"Duplicates removed: {result.deduplicated_count}")
print(f"Combined output:\n{result.combined_output}")
```

### Structured Output Formats

Get results in different formats:

```python
# Sections format (default)
sections_result = aggregator.aggregate_with_structure(
    agent_outputs=outputs,
    structure="sections"
)
# Output:
# ## Agent 1 Findings
# Finding 1...
#
# ## Agent 2 Findings
# Finding 2...

# List format
list_result = aggregator.aggregate_with_structure(
    agent_outputs=outputs,
    structure="list"
)
# Output:
# - Finding 1
# - Finding 2
# - Finding 3

# Merged format
merged_result = aggregator.aggregate_with_structure(
    agent_outputs=outputs,
    structure="merged"
)
# Output:
# Finding 1
#
# Finding 2
```

### Working with Metrics

Extract and use execution metrics:

```python
async def analyze_performance():
    result = await parallel_execute(
        task_description="Large codebase analysis",
        max_agents=12
    )

    if result["success"]:
        metrics = result["metrics"]

        # Core metrics
        print(f"Execution time: {metrics['execution_time_seconds']:.1f}s")
        print(f"Agents used: {metrics['agent_count']}")
        print(f"Speedup factor: {metrics['speedup_factor']:.1f}x")

        # Success rate
        success_rate = metrics['agents_successful'] / metrics['agent_count'] * 100
        print(f"Success rate: {success_rate:.0f}%")

        # API usage
        print(f"Total API calls: {metrics['api_calls_total']}")

        # Timeline
        print(f"Started: {metrics['started_at']}")
        print(f"Completed: {metrics['completed_at']}")
```

---

## Error Handling

### Graceful Error Recovery

Handle partial failures gracefully:

```python
async def robust_analysis():
    result = await parallel_execute(
        task_description="Analyze project",
        max_agents=8
    )

    if result["success"]:
        # Some agents may have failed, but we got results
        if result["errors"]:
            print(f"Completed with {len(result['errors'])} partial failures")
            for error in result["errors"]:
                print(f"  Warning: {error}")

        # Process available results
        return result["combined_output"]

    else:
        # Complete failure
        if result.get("timed_out"):
            print("Task timed out - consider increasing timeout")
        else:
            print(f"Task failed: {result['error']}")

        return None
```

### Retry Logic

Implement retry with exponential backoff:

```python
import asyncio

async def retry_with_backoff(task_fn, max_retries=3):
    for attempt in range(max_retries):
        result = await task_fn()

        if result["success"]:
            return result

        # Check if retryable
        if result.get("timed_out"):
            wait_time = 2 ** attempt  # 1, 2, 4 seconds
            print(f"Attempt {attempt + 1} failed, retrying in {wait_time}s...")
            await asyncio.sleep(wait_time)
        else:
            # Non-retryable error
            raise Exception(result["error"])

    raise Exception("Max retries exceeded")

# Usage
async def main():
    async def my_task():
        return await parallel_execute(
            task_description="Important analysis",
            max_agents=8,
            timeout_seconds=60
        )

    try:
        result = await retry_with_backoff(my_task)
        print("Success:", result["combined_output"])
    except Exception as e:
        print(f"Failed after retries: {e}")
```

### Cleanup on Failure

Always cleanup resources:

```python
from claude_flow_server.subprocess_manager import (
    get_subprocess_manager,
    cleanup_subprocess_manager
)

async def safe_execution():
    manager = get_subprocess_manager()

    try:
        result = await parallel_execute(
            task_description="Critical task",
            max_agents=8
        )
        return result

    except Exception as e:
        print(f"Error: {e}")

        # Cleanup any hanging processes
        active = await manager.get_active_processes()
        print(f"Cleaning up {len(active)} active processes")

        for proc in active:
            await manager.kill_process(proc["pid"])

        raise

    finally:
        # Cleanup zombies
        cleaned = await manager.cleanup_zombies()
        if cleaned:
            print(f"Cleaned {cleaned} zombie processes")
```

---

## Performance Optimization

### Choosing Agent Count

Select optimal agent count based on task complexity:

```python
def choose_agent_count(task_type: str, estimated_complexity: str) -> int:
    """
    Choose optimal agent count.

    Args:
        task_type: "research", "analysis", "generation"
        estimated_complexity: "light", "medium", "heavy"

    Returns:
        Recommended agent count (4, 8, or 12)
    """
    matrix = {
        ("research", "light"): 4,
        ("research", "medium"): 8,
        ("research", "heavy"): 12,
        ("analysis", "light"): 4,
        ("analysis", "medium"): 8,
        ("analysis", "heavy"): 8,
        ("generation", "light"): 4,
        ("generation", "medium"): 4,
        ("generation", "heavy"): 8,
    }
    return matrix.get((task_type, estimated_complexity), 8)
```

### Optimizing Subtask Distribution

Distribute subtasks effectively:

```python
async def optimized_codebase_analysis(files: list[str]):
    # Group files by type for better parallelism
    file_groups = {
        "python": [f for f in files if f.endswith(".py")],
        "typescript": [f for f in files if f.endswith((".ts", ".tsx"))],
        "config": [f for f in files if f.endswith((".json", ".yaml", ".toml"))],
    }

    subtasks = []
    for file_type, file_list in file_groups.items():
        if file_list:
            # Batch similar files together
            batch_size = max(1, len(file_list) // 3)
            for i in range(0, len(file_list), batch_size):
                batch = file_list[i:i + batch_size]
                subtasks.append(
                    f"Analyze {file_type} files: {', '.join(batch[:5])}{'...' if len(batch) > 5 else ''}"
                )

    return await parallel_execute(
        task_description="Comprehensive codebase analysis",
        max_agents=min(12, len(subtasks)),  # Match agents to subtask count
        subtasks=subtasks
    )
```

### Memory-Efficient Processing

Handle large outputs efficiently:

```python
from claude_flow_server.server import memory_usage

async def memory_aware_execution(task: str):
    # Check available memory
    mem = await memory_usage()

    available_mb = mem.get("available_memory_mb", 0)

    # Adjust agent count based on memory
    if available_mb < 2048:
        max_agents = 4
    elif available_mb < 4096:
        max_agents = 8
    else:
        max_agents = 12

    print(f"Using {max_agents} agents (available memory: {available_mb}MB)")

    return await parallel_execute(
        task_description=task,
        max_agents=max_agents
    )
```

---

## Integration Patterns

### FastAPI Integration

Expose Claude Flow as an API:

```python
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from claude_flow_server.server import parallel_execute, swarm_init

app = FastAPI()

class TaskRequest(BaseModel):
    description: str
    max_agents: int = 8
    topology: str = "distributed"
    subtasks: list[str] | None = None

class TaskResult(BaseModel):
    success: bool
    output: str | None
    metrics: dict | None
    error: str | None

@app.on_event("startup")
async def startup():
    await swarm_init(max_agents=12)

@app.post("/execute", response_model=TaskResult)
async def execute_task(request: TaskRequest):
    result = await parallel_execute(
        task_description=request.description,
        max_agents=request.max_agents,
        topology=request.topology,
        subtasks=request.subtasks
    )

    return TaskResult(
        success=result["success"],
        output=result.get("combined_output"),
        metrics=result.get("metrics"),
        error=result.get("error")
    )
```

### Async Queue Processing

Process tasks from a queue:

```python
import asyncio
from asyncio import Queue

class TaskProcessor:
    def __init__(self, max_concurrent: int = 3):
        self.queue: Queue = Queue()
        self.max_concurrent = max_concurrent
        self.results = {}

    async def add_task(self, task_id: str, description: str):
        await self.queue.put((task_id, description))

    async def worker(self):
        while True:
            task_id, description = await self.queue.get()

            try:
                result = await parallel_execute(
                    task_description=description,
                    max_agents=8
                )
                self.results[task_id] = result
            except Exception as e:
                self.results[task_id] = {"success": False, "error": str(e)}
            finally:
                self.queue.task_done()

    async def start(self):
        workers = [
            asyncio.create_task(self.worker())
            for _ in range(self.max_concurrent)
        ]
        return workers

# Usage
processor = TaskProcessor(max_concurrent=3)
await processor.start()

# Add tasks
await processor.add_task("task-1", "Research Python async")
await processor.add_task("task-2", "Analyze codebase")

# Wait for completion
await processor.queue.join()

# Get results
print(processor.results)
```

### Callback-Based Execution

Execute with progress callbacks:

```python
from typing import Callable

async def execute_with_callback(
    task: str,
    on_progress: Callable[[str], None],
    on_complete: Callable[[dict], None]
):
    on_progress("Initializing swarm...")
    await swarm_init(max_agents=8)

    on_progress("Starting parallel execution...")
    result = await parallel_execute(
        task_description=task,
        max_agents=8
    )

    if result["success"]:
        on_progress(f"Completed with {result['metrics']['speedup_factor']:.1f}x speedup")
        on_complete(result)
    else:
        on_progress(f"Failed: {result['error']}")
        on_complete(result)

# Usage
def log_progress(msg: str):
    print(f"[Progress] {msg}")

def handle_result(result: dict):
    print(f"[Complete] Success: {result['success']}")

await execute_with_callback(
    task="Analyze the application",
    on_progress=log_progress,
    on_complete=handle_result
)
```

---

## Best Practices Summary

1. **Always initialize with `swarm_init`** for explicit configuration
2. **Use BatchTool pattern** - submit all subtasks in one call
3. **Choose topology wisely** - distributed for independent tasks, hierarchical for coordination
4. **Handle partial failures** - some agents may fail while others succeed
5. **Monitor memory** - adjust agent count based on available resources
6. **Cleanup resources** - use proper cleanup in finally blocks
7. **Set appropriate timeouts** - longer for complex tasks
8. **Use deduplication** - reduce noise in aggregated results

For API reference, see [docs/API.md](./docs/API.md).
