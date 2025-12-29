# SWE-bench Service Module

This module provides SWE-bench benchmark integration for autoclaude, enabling systematic evaluation against industry-standard software engineering benchmarks.

## Overview

SWE-bench is a benchmark suite for evaluating large language models on real-world software engineering tasks. This service module implements a thin adapter layer to:

1. **Load Datasets**: Fetch SWE-bench instances from HuggingFace Hub
2. **Convert Formats**: Transform SWE-bench instances to autoclaude task format
3. **Export Results**: Generate SWE-bench-compliant JSONL predictions
4. **Run Evaluation**: Execute Docker-based evaluation via official SWE-bench harness
5. **Health Checks**: Validate infrastructure requirements before execution
6. **Parse Results**: Extract metrics from evaluation reports

## Supported Benchmark Variants

| Variant | Dataset ID | Instances | Description |
|---------|------------|-----------|-------------|
| Lite | `princeton-nlp/SWE-bench_Lite` | 300 | Curated subset for faster evaluation. Best for testing and development. |
| Verified | `princeton-nlp/SWE-bench_Verified` | 500 | Human-verified instances with confirmed quality. |
| Full | `princeton-nlp/SWE-bench` | 2,294 | Complete benchmark suite for comprehensive evaluation. |
| Multimodal | `princeton-nlp/SWE-bench_Multimodal` | ~617 | Includes image/visual context (test split assets are private). |
| Multilingual | `princeton-nlp/SWE-bench_Multilingual` | ~510 | Non-English repositories for multilingual evaluation. |

### Choosing a Variant

- **Development/Testing**: Start with `lite` - it's fast and representative
- **Research Evaluation**: Use `verified` for human-curated quality
- **Comprehensive Assessment**: Use `full` for complete coverage
- **Specialized Evaluation**: Use `multimodal` or `multilingual` for specific capabilities

## Installation

### Prerequisites

1. **Python 3.10+** with pip
2. **Docker** installed and running (required for evaluation)
3. **10GB+ free disk space** for Docker images
4. **8GB+ RAM** recommended for container execution
5. **x86_64 architecture** recommended (ARM has compatibility caveats)

### Step-by-Step Installation

```bash
# 1. Navigate to backend directory
cd apps/backend

# 2. Create and activate virtual environment (optional but recommended)
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# or: .venv\Scripts\activate  # Windows

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Install SWE-bench (not on PyPI - must clone from GitHub)
git clone https://github.com/princeton-nlp/SWE-bench.git
pip install -e ./SWE-bench

# 5. Verify installation
python -c "from apps.backend.services.swebench import load_benchmark; print('OK')"
```

### Docker Setup

Docker is required for running the SWE-bench evaluation harness.

```bash
# Verify Docker is installed and running
docker info

# Check available disk space
docker system df

# (Optional) Pre-pull base images to speed up first run
docker pull python:3.10-slim
docker pull ubuntu:22.04
```

### Verifying Installation

```bash
# Run infrastructure health checks
PYTHONPATH=. python -c "
from apps.backend.services.swebench import check_infrastructure
status = check_infrastructure()
print(f'All checks passed: {status.all_passed}')
if status.errors:
    print(f'Errors: {status.errors}')
if status.warnings:
    print(f'Warnings: {status.warnings}')
"
```

## Module Structure

```
swebench/
├── __init__.py          # Module exports and version
├── models.py            # Pydantic models for data validation
├── loader.py            # HuggingFace dataset loader
├── converter.py         # SWE-bench → autoclaude format converter
├── exporter.py          # Results → JSONL predictions exporter
├── evaluator.py         # Docker-based evaluation orchestrator
├── orchestrator.py      # Benchmark execution coordinator
├── results_parser.py    # Evaluation results parser
├── health.py            # Infrastructure health checks
├── README.md            # This documentation
└── tests/               # Unit and integration tests
    ├── __init__.py
    ├── test_models.py
    ├── test_converter.py
    ├── test_exporter.py
    ├── test_loader_integration.py
    └── test_evaluation_integration.py
```

## Quick Start

### Complete Benchmark Run

```python
from apps.backend.services.swebench import (
    BenchmarkOrchestrator,
    OrchestratorConfig,
)

# Configure and run benchmark
config = OrchestratorConfig(
    variant="lite",
    max_instances=10,  # Limit for testing
    output_dir="./benchmark_output",
)

orchestrator = BenchmarkOrchestrator(config=config)
result = orchestrator.run()

if result.success:
    print(f"Completed: {result.benchmark_result.completed_instances} instances")
    print(f"Predictions saved to: {result.predictions_path}")
else:
    print(f"Errors: {result.errors}")
```

### Using the Convenience Function

```python
from apps.backend.services.swebench import run_benchmark

# Simple one-liner for quick runs
result = run_benchmark("lite", max_instances=10)
print(f"Resolve rate: {result.benchmark_result.resolve_rate}%")
```

## Detailed Usage

### Loading a Benchmark Dataset

```python
from apps.backend.services.swebench import (
    load_benchmark,
    load_benchmark_iterator,
    get_available_variants,
    get_dataset_info,
)

# Load all instances from a variant
instances = load_benchmark("lite")
print(f"Loaded {len(instances)} instances")

# Load with instance limit
instances = load_benchmark("verified", max_instances=50)

# Stream instances for large datasets (memory-efficient)
for instance in load_benchmark_iterator("full"):
    print(f"Processing: {instance.instance_id}")
    break  # Just showing first one

# Get available variants
variants = get_available_variants()
for variant in variants:
    print(f"{variant['name']}: {variant['description']}")

# Get dataset metadata
info = get_dataset_info("lite")
print(f"Dataset: {info['dataset_id']}, Splits: {info['splits']}")
```

### Converting to Autoclaude Tasks

```python
from apps.backend.services.swebench import (
    convert_to_task,
    convert_batch,
    extract_repo_info,
    SWEBenchInstance,
)

# Convert single instance
task = convert_to_task(instance)
print(f"Task ID: {task.task_id}")
print(f"Repository: {task.repository_url}")
print(f"Base commit: {task.base_commit}")

# Convert multiple instances with error handling
tasks, errors = convert_batch(
    instances=instances,
    include_hints=True,
    skip_errors=True,  # Continue on conversion errors
)
print(f"Converted {len(tasks)} tasks, {len(errors)} errors")

# Extract repo info from instance ID
owner, repo, pr_number = extract_repo_info("django__django-16139")
print(f"Owner: {owner}, Repo: {repo}, PR: {pr_number}")
```

### Exporting Predictions

```python
from apps.backend.services.swebench import (
    export_predictions,
    export_predictions_to_string,
    create_prediction_entry,
    validate_predictions_file,
    count_predictions,
)

# Export results to JSONL file
count = export_predictions(
    results=execution_results,
    output_path="predictions.jsonl",
    model_name="autoclaude",
    include_only_successful=True,  # Only export completed tasks
)
print(f"Exported {count} predictions")

# Export to string (for API responses)
jsonl_content = export_predictions_to_string(
    results=execution_results,
    model_name="autoclaude",
)

# Validate predictions file format
is_valid, errors = validate_predictions_file("predictions.jsonl")
if not is_valid:
    print(f"Validation errors: {errors}")

# Count predictions in file
count = count_predictions("predictions.jsonl")
print(f"File contains {count} predictions")
```

### Running Evaluation

```python
from apps.backend.services.swebench import (
    execute_evaluation,
    execute_gold_evaluation,
    check_evaluation_prerequisites,
    cleanup_docker_resources,
)

# Check prerequisites before running
passed, errors = check_evaluation_prerequisites("predictions.jsonl")
if not passed:
    print(f"Prerequisites not met: {errors}")
else:
    # Run SWE-bench evaluation harness
    result = execute_evaluation(
        predictions_path="predictions.jsonl",
        run_id="my-eval-run",
        variant="lite",
        max_workers=4,
        cache_level="env",  # none, base, env, or instance
        timeout=1800,  # per instance
    )
    print(f"Resolve rate: {result['resolve_rate']}%")

# Validate infrastructure with gold patches
gold_result = execute_gold_evaluation(
    variant="lite",
    max_instances=5,  # Quick validation
)
print(f"Gold patch resolve rate: {gold_result['resolve_rate']}%")

# Clean up Docker resources after evaluation
cleanup_docker_resources(
    prune_containers=True,
    prune_images=False,  # Keep images for next run
    prune_volumes=True,
)
```

### Parsing Evaluation Results

```python
from apps.backend.services.swebench import (
    parse_report,
    parse_report_file,
    summarize_report,
    get_resolved_instances,
    get_evaluation_metrics,
)

# Parse from evaluation log directory
report = parse_report("logs/run_evaluation/my-eval-run/")
print(f"Resolve rate: {report.resolve_rate}%")
print(f"Total instances: {report.total_instances}")

# Parse from report.json directly
report = parse_report_file("report.json")

# Get human-readable summary
summary = summarize_report(report)
print(summary)

# Get specific metrics
metrics = get_evaluation_metrics(report)
print(f"F2P success: {metrics['f2p_success_rate']}%")
print(f"P2P success: {metrics['p2p_success_rate']}%")

# Get list of resolved instances
resolved = get_resolved_instances(report)
for instance_id in resolved:
    print(f"Resolved: {instance_id}")
```

### Infrastructure Health Checks

```python
from apps.backend.services.swebench import (
    check_docker_available,
    check_disk_space,
    check_cpu_cores,
    check_architecture,
    check_infrastructure,
    get_recommended_max_workers,
    get_available_disk_space_gb,
)

# Run all health checks
status = check_infrastructure()
print(f"All passed: {status.all_passed}")
print(f"Docker: {status.docker_available}")
print(f"Disk space: {status.disk_space_gb} GB")
print(f"CPU cores: {status.cpu_cores}")

if not status.all_passed:
    for error in status.errors:
        print(f"ERROR: {error}")

for warning in status.warnings:
    print(f"WARNING: {warning}")

# Individual checks
docker_ok = check_docker_available()
disk_ok = check_disk_space(min_gb=10)
cpu_ok = check_cpu_cores(min_cores=2)
arch_ok, arch_warning = check_architecture()

# Get recommendations
max_workers = get_recommended_max_workers()
print(f"Recommended max workers: {max_workers}")

disk_gb = get_available_disk_space_gb()
print(f"Available disk space: {disk_gb} GB")
```

### Using the Orchestrator with Progress Tracking

```python
from apps.backend.services.swebench import (
    BenchmarkOrchestrator,
    OrchestratorConfig,
    OrchestrationProgress,
)

def progress_callback(progress: OrchestrationProgress):
    print(f"Phase: {progress.phase}")
    print(f"Progress: {progress.progress_percent}%")
    print(f"Current: {progress.current_instance}")
    print(f"Completed: {progress.completed_instances}/{progress.total_instances}")
    print(f"Elapsed: {progress.elapsed_seconds:.1f}s")
    if progress.estimated_remaining_seconds:
        print(f"ETA: {progress.estimated_remaining_seconds:.1f}s")

config = OrchestratorConfig(
    variant="lite",
    max_instances=20,
    max_workers=4,
    output_dir="./output",
    cache_level="env",
    timeout_per_instance=1800,
    skip_evaluation=False,
    cleanup_after_run=True,
    resume_from_checkpoint=True,
)

# Create orchestrator with progress tracking
orchestrator = BenchmarkOrchestrator(
    config=config,
    progress_callback=progress_callback,
)

# Run with context manager for automatic cleanup
with orchestrator:
    result = orchestrator.run()

# Or cancel mid-run
# orchestrator.cancel()  # Saves checkpoint for resume
```

### CLI Usage

```bash
# Validate environment
PYTHONPATH=. python -m apps.backend.services.swebench.orchestrator --validate-only

# Run benchmark
PYTHONPATH=. python -m apps.backend.services.swebench.orchestrator \
    --variant lite \
    --max-instances 10 \
    --output-dir ./output

# Skip Docker evaluation (export only)
PYTHONPATH=. python -m apps.backend.services.swebench.orchestrator \
    --variant lite \
    --max-instances 10 \
    --skip-evaluation

# Output as JSON
PYTHONPATH=. python -m apps.backend.services.swebench.orchestrator \
    --variant lite \
    --max-instances 10 \
    --json
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SWEBENCH_CACHE_DIR` | `~/.cache/swebench` | Directory for caching Docker images |
| `DOCKER_HOST` | (system default) | Docker daemon socket |
| `HF_TOKEN` | (none) | HuggingFace token for private datasets |

### Orchestrator Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `variant` | `"lite"` | Benchmark variant to run |
| `max_instances` | `None` (all) | Maximum instances to process |
| `max_workers` | Auto (~75% CPU) | Parallel workers for evaluation |
| `output_dir` | `"./swebench_output"` | Directory for output files |
| `cache_level` | `"env"` | Docker caching: none, base, env, instance |
| `timeout_per_instance` | `1800` | Timeout per instance in seconds |
| `include_hints` | `True` | Include hints in converted tasks |
| `skip_evaluation` | `False` | Skip Docker evaluation (export only) |
| `cleanup_after_run` | `True` | Clean up Docker resources after run |
| `resume_from_checkpoint` | `True` | Resume from previous checkpoint |

### Resource Limits

- **max_workers**: Automatically capped at ~75% of available CPU cores
- **Disk space**: Minimum 10GB required
- **Memory**: 8GB+ recommended for Docker containers

## Known Limitations

1. **Architecture**: Best performance on x86_64; ARM systems (M-series Mac) may encounter compatibility issues with Docker containers
2. **Local Only**: Cloud execution (Modal/AWS) not supported in v1
3. **Sequential Execution**: Single instance execution in v1 (parallel execution planned)
4. **Multimodal Assets**: Test split image assets are private (dev split available for development)
5. **Network Required**: HuggingFace Hub access required for dataset loading

## Troubleshooting

### Docker Not Available

```
Error: Docker is not running. Please start Docker and try again.
```

**Solution**: Ensure Docker Desktop or Docker Engine is running:
```bash
# Check Docker status
docker info

# Start Docker (Linux)
sudo systemctl start docker

# Or launch Docker Desktop (macOS/Windows)
```

### Disk Space Insufficient

```
Error: Insufficient disk space. Required: 10GB, Available: 5GB
```

**Solution**: Free up disk space or clean Docker images:
```bash
# Clean unused Docker resources
docker system prune -a

# Check disk usage
df -h
```

### ARM Architecture Warning

```
Warning: ARM architecture detected. Some evaluation containers may have compatibility issues.
```

**Solution**:
1. Run on x86_64 machine for best results
2. Use `cache_level="none"` flag if encountering issues
3. Some containers may work with Rosetta 2 on Apple Silicon

### HuggingFace Rate Limiting

```
Error: 429 Too Many Requests
```

**Solution**: Set HuggingFace token for higher rate limits:
```bash
export HF_TOKEN=your_token_here
# or
huggingface-cli login
```

### Evaluation Container Failures

```
Error: Container exited with non-zero status
```

**Solution**:
1. Check Docker logs: `docker logs <container_id>`
2. Ensure sufficient memory (8GB+)
3. Clean up and retry: `docker system prune`
4. Check for conflicting containers

### Checkpoint Recovery

If a run is interrupted, it can be resumed automatically:
```python
orchestrator = BenchmarkOrchestrator(
    config=OrchestratorConfig(resume_from_checkpoint=True)
)
result = orchestrator.run()  # Will resume from last checkpoint
```

## Development

### Running Tests

```bash
# Navigate to backend
cd apps/backend

# Run all SWE-bench tests
python -m pytest services/swebench/tests/ -v

# Run specific test files
python -m pytest services/swebench/tests/test_models.py -v
python -m pytest services/swebench/tests/test_converter.py -v
python -m pytest services/swebench/tests/test_exporter.py -v

# Run integration tests (require Docker)
python -m pytest services/swebench/tests/test_loader_integration.py -v
python -m pytest services/swebench/tests/test_evaluation_integration.py -v

# Run with coverage
python -m pytest services/swebench/tests/ --cov=services/swebench --cov-report=html
```

### Validating with Gold Patches

Use gold patches to validate your infrastructure setup:

```bash
PYTHONPATH=. python -c "
from apps.backend.services.swebench import execute_gold_evaluation

result = execute_gold_evaluation(variant='lite', max_instances=5)
print(f'Gold patch resolve rate: {result[\"resolve_rate\"]}%')

# A high resolve rate (>90%) confirms infrastructure is working correctly
if result['resolve_rate'] >= 90:
    print('Infrastructure validation: PASSED')
else:
    print('Infrastructure validation: CHECK YOUR SETUP')
"
```

### Adding New Benchmark Variants

To add support for a new SWE-bench variant:

1. Add the variant to `BenchmarkVariant` enum in `models.py`
2. Add the dataset ID to `VARIANT_DATASET_NAMES` mapping
3. Update `loader.py` if variant has special loading requirements
4. Add tests in `tests/test_loader_integration.py`

## API Reference

See [API.md](./API.md) for complete API documentation including:
- All public functions and their signatures
- Pydantic model schemas
- Error types and handling
- Type definitions

## References

- [SWE-bench Paper](https://arxiv.org/abs/2310.06770) - Original research paper
- [SWE-bench GitHub](https://github.com/princeton-nlp/SWE-bench) - Official repository
- [HuggingFace Datasets](https://huggingface.co/princeton-nlp) - Dataset hub
- [Docker Documentation](https://docs.docker.com/) - Container runtime

## License

This module is part of autoclaude and follows its licensing terms.
