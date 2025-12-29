# SWE-bench Integration Layer

A lightweight adapter layer for evaluating autoclaude against Princeton NLP's [SWE-bench](https://www.swebench.com/) benchmark suite.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Architecture](#architecture)
- [Data Formats](#data-formats)
- [Checkpointing](#checkpointing)
- [Frontend Dashboard](#frontend-dashboard)
- [Extension Guide](#extension-guide)
- [Troubleshooting](#troubleshooting)

---

## Overview

This integration layer converts SWE-bench dataset instances into autoclaude's specification format, orchestrates evaluations through the existing SpecOrchestrator pipeline, and exports results in SWE-bench-compatible format.

### Supported Datasets

| Dataset | Instances | Description |
|---------|-----------|-------------|
| `princeton-nlp/SWE-bench` | 2,294 | Full benchmark dataset |
| `princeton-nlp/SWE-bench_Lite` | 300 | Curated subset (recommended for testing) |
| `princeton-nlp/SWE-bench_Verified` | - | Human-verified subset |

### Key Features

- **Adapter Pattern**: Zero modifications to existing SpecOrchestrator
- **Checkpointing**: Resume interrupted evaluations without re-processing
- **Parallel Execution**: Configurable worker count for concurrent processing
- **Real-time Monitoring**: Frontend dashboard for progress tracking
- **SWE-bench Compatible Output**: JSONL predictions and metrics reports

---

## Installation

### Prerequisites

1. **Docker** (required for SWE-bench harness)
   ```bash
   # Verify Docker is running
   docker info
   ```

2. **Python 3.10+** with pip

3. **Sufficient disk space** (Docker images can be multi-GB)

### Install Dependencies

```bash
cd apps/backend

# Install required packages
pip install datasets docker typer pydantic

# Or install from requirements
pip install -r requirements.txt
```

### Verify Installation

```bash
# Test CLI is working
python -m cli.swebench_eval --help

# Test dataset loading
python -c "from swebench import load_swebench_dataset; print('OK')"

# Test Docker integration
python -c "from swebench import check_docker; check_docker(); print('Docker OK')"
```

---

## Quick Start

### Run a Small Evaluation

```bash
cd apps/backend

# Evaluate 10 instances from SWE-bench_Lite
python -m cli.swebench_eval \
    --dataset princeton-nlp/SWE-bench_Lite \
    --max-instances 10 \
    --run-id my-first-run
```

### View Results

After evaluation completes:

```bash
# Predictions in JSONL format
cat .auto-claude/swebench/predictions.jsonl

# Metrics report
cat .auto-claude/swebench/report.json

# Checkpoint file
cat .auto-claude/swebench/checkpoints/my-first-run.json
```

### Resume Interrupted Evaluation

```bash
python -m cli.swebench_eval --resume --run-id my-first-run
```

---

## CLI Reference

### Basic Usage

```bash
python -m cli.swebench_eval [OPTIONS]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--dataset` | `princeton-nlp/SWE-bench_Lite` | HuggingFace dataset to evaluate |
| `--max-instances` | All | Maximum number of instances to process |
| `--max-workers` | 1 | Number of parallel workers |
| `--run-id` | Auto-generated | Unique identifier for this run |
| `--resume` | False | Resume from checkpoint |
| `--output-dir` | `.auto-claude/swebench/` | Output directory |
| `--timeout` | 1800 | Timeout per instance (seconds) |
| `--model` | From environment | Model to use for evaluation |
| `--verbose` / `-v` | False | Enable verbose logging |
| `--dry-run` | False | Validate config without running |
| `--skip-docker-check` | False | Skip Docker check (testing only) |

### Examples

```bash
# Full SWE-bench_Lite evaluation with 4 workers
python -m cli.swebench_eval \
    --dataset princeton-nlp/SWE-bench_Lite \
    --max-workers 4 \
    --run-id production-run-001

# Quick test with custom timeout
python -m cli.swebench_eval \
    --dataset princeton-nlp/SWE-bench_Lite \
    --max-instances 5 \
    --timeout 900 \
    --verbose

# Resume a previous run
python -m cli.swebench_eval \
    --resume \
    --run-id production-run-001

# Dry run to validate configuration
python -m cli.swebench_eval \
    --dataset princeton-nlp/SWE-bench_Lite \
    --dry-run
```

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLI Entry Point                                  │
│                       (cli/swebench_eval.py)                            │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      SWEBenchOrchestrator                               │
│                      (swebench/orchestrator.py)                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  1. Load dataset from HuggingFace                                 │  │
│  │  2. Load/create checkpoint for resumable evaluations             │  │
│  │  3. For each instance:                                            │  │
│  │     a. Convert to autoclaude spec (Instance Adapter)             │  │
│  │     b. Invoke SpecOrchestrator (future integration)              │  │
│  │     c. Collect results                                            │  │
│  │     d. Save checkpoint                                            │  │
│  │  4. Export results (JSONL + Report)                              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Data Adapters   │  │  Checkpointing   │  │    Exporters     │
│                  │  │                  │  │                  │
│ • Instance       │  │ • Checkpoint     │  │ • JSONL          │
│   Adapter        │  │   Manager        │  │   Predictions    │
│ • Results        │  │ • Checkpoint     │  │ • Metrics        │
│   Adapter        │  │   Models         │  │   Report         │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

### Module Structure

```
apps/backend/swebench/
├── __init__.py              # Package exports
├── README.md                # This documentation
│
├── models.py                # Pydantic data models
│   ├── SWEBenchInstance     # HuggingFace dataset schema
│   ├── SWEBenchPrediction   # Output prediction schema
│   ├── InstanceResult       # Per-instance result tracking
│   └── EvaluationMetrics    # Aggregated metrics
│
├── orchestrator.py          # Main evaluation orchestrator
│   ├── SWEBenchOrchestrator # Core orchestration class
│   └── run_evaluation()     # Convenience function
│
├── dataset_loader.py        # HuggingFace dataset loading
│   ├── load_swebench_dataset()
│   ├── get_dataset_info()
│   └── validate_dataset_instance()
│
├── docker_checker.py        # Docker availability checks
│   ├── check_docker()
│   ├── is_docker_available()
│   └── get_docker_info()
│
├── checkpoint_models.py     # Checkpoint data schemas
│   ├── InstanceCheckpointState
│   └── Checkpoint
│
├── checkpoint_manager.py    # Checkpoint save/load logic
│   ├── CheckpointManager
│   └── save/load functions
│
├── adapters/
│   ├── __init__.py
│   ├── instance_adapter.py  # SWE-bench → autoclaude spec
│   │   ├── AutoClaudeSpec
│   │   ├── convert_to_autoclaude_spec()
│   │   └── save_spec_to_directory()
│   └── results_adapter.py   # Results → SWE-bench format
│       ├── convert_to_swebench_prediction()
│       └── export_predictions_to_jsonl()
│
└── exporters/
    ├── __init__.py
    ├── jsonl_exporter.py    # JSONL predictions export
    │   ├── export_predictions()
    │   └── validate_predictions_file()
    └── metrics_exporter.py  # Metrics report generation
        ├── generate_metrics_report()
        └── compare_reports()
```

### Data Flow

```
HuggingFace Dataset                     Output Files
       │                                      ▲
       ▼                                      │
┌──────────────┐                     ┌──────────────┐
│ SWEBench     │     Adapter         │ predictions  │
│ Instance     │ ──────────────────► │   .jsonl     │
│ (JSON)       │                     │              │
└──────────────┘                     └──────────────┘
       │                                      │
       │ convert_to_                          │ export_
       │ autoclaude_spec()                    │ predictions()
       ▼                                      │
┌──────────────┐                     ┌──────────────┐
│ AutoClaude   │     Evaluation      │   report     │
│ Spec         │ ──────────────────► │   .json      │
│ (JSON)       │                     │              │
└──────────────┘                     └──────────────┘
       │                                      │
       │ SpecOrchestrator                     │ generate_
       │ (future)                             │ metrics_report()
       ▼                                      │
┌──────────────┐                     ┌──────────────┐
│ Instance     │ ────────────────────│ checkpoint   │
│ Result       │                     │   .json      │
│              │                     │              │
└──────────────┘                     └──────────────┘
```

---

## Data Formats

### SWE-bench Instance (Input)

From HuggingFace dataset:

```json
{
    "instance_id": "django__django-12345",
    "problem_statement": "Fix the bug in the admin panel...",
    "base_commit": "abc123def456...",
    "FAIL_TO_PASS": ["test_admin::test_feature"],
    "PASS_TO_PASS": ["test_admin::test_existing"],
    "test_patch": "diff content..."
}
```

**Important**: The `instance_id` uses double underscores (`__`) between owner and repo.

### AutoClaude Spec (Internal)

Generated specification for SpecOrchestrator:

```json
{
    "task_description": "[django/django#12345]\n\nFix the bug...",
    "workflow_type": "bugfix",
    "repo": "django/django",
    "base_commit": "abc123def456...",
    "instance_id": "django__django-12345",
    "swebench_metadata": {
        "fail_to_pass_tests": ["test_admin::test_feature"],
        "pass_to_pass_tests": ["test_admin::test_existing"]
    }
}
```

**Note**: `test_patch` is intentionally excluded to prevent data leakage.

### Predictions JSONL (Output)

Each line is a valid JSON object:

```jsonl
{"instance_id": "django__django-12345", "model_patch": "diff --git...", "model_name_or_path": "autoclaude"}
{"instance_id": "django__django-12346", "model_patch": "diff --git...", "model_name_or_path": "autoclaude"}
```

### Metrics Report (Output)

```json
{
    "run_id": "swebench-20241229-001",
    "dataset_name": "princeton-nlp/SWE-bench_Lite",
    "model_name": "autoclaude",
    "resolution_rate": 0.35,
    "aggregated_stats": {
        "total_instances": 300,
        "completed_instances": 300,
        "successful_instances": 105,
        "failed_instances": 180,
        "error_instances": 15
    },
    "per_repo_stats": {
        "django/django": {"total": 50, "successful": 20},
        "astropy/astropy": {"total": 30, "successful": 12}
    },
    "timing_stats": {
        "total_execution_time_seconds": 54000,
        "average_execution_time_seconds": 180,
        "median_execution_time_seconds": 165
    },
    "timestamps": {
        "started_at": "2024-12-29T10:00:00Z",
        "finished_at": "2024-12-29T20:00:00Z"
    }
}
```

### Checkpoint (Internal)

```json
{
    "run_id": "my-evaluation-run",
    "dataset_name": "princeton-nlp/SWE-bench_Lite",
    "total_instances": 300,
    "completed_count": 150,
    "successful_count": 52,
    "failed_count": 90,
    "error_count": 8,
    "instance_states": [
        {
            "instance_id": "django__django-12345",
            "status": "completed",
            "model_patch": "diff --git...",
            "execution_time_seconds": 180.5
        }
    ],
    "checksum": "abc123..."
}
```

---

## Checkpointing

### How It Works

1. **Checkpoint Creation**: When a run starts, a checkpoint file is created
2. **After Each Instance**: The checkpoint is updated with the instance result
3. **Atomic Writes**: Uses temp file + rename to prevent corruption
4. **Resume**: On `--resume`, loads checkpoint and skips completed instances

### Checkpoint Location

```
.auto-claude/swebench/checkpoints/
├── my-run-001.json
├── swebench-20241229-abc123.json
└── ...
```

### Instance States

| Status | Description |
|--------|-------------|
| `pending` | Not yet processed |
| `running` | Currently being processed |
| `completed` | Successfully generated patch |
| `failed` | Evaluation ran but didn't produce valid patch |
| `error` | Unexpected exception occurred |
| `skipped` | Skipped by user or filter |

### Handling Corrupted Checkpoints

If a checkpoint file is corrupted, the system will:
1. Log a warning
2. Start fresh with a new checkpoint
3. Not re-use any data from the corrupted file

---

## Frontend Dashboard

### Accessing the Dashboard

1. Start the frontend server:
   ```bash
   cd apps/frontend
   npm run dev
   ```

2. Navigate to `http://localhost:3000/swebench`
   - Or press `B` key as keyboard shortcut

### Dashboard Components

| Component | Description |
|-----------|-------------|
| **Dashboard** | Overview with progress bar, statistics, status |
| **Progress** | Real-time current instance, elapsed time, ETA |
| **Results** | Filterable table of instance results |

### Features

- Real-time progress updates
- Status filtering (success, failed, error, pending)
- Sortable results table
- Historical run selection
- Keyboard navigation (B key)

---

## Extension Guide

### Adding a New Dataset

1. Load your dataset using the existing loader:

```python
from swebench import load_swebench_dataset

# Any HuggingFace dataset with SWE-bench schema
instances = load_swebench_dataset(
    "your-org/your-dataset",
    max_instances=100
)
```

2. The orchestrator will handle the rest automatically.

### Custom Adapter

To create a custom adapter for a different specification format:

```python
from swebench.adapters.instance_adapter import AutoClaudeSpec
from swebench.models import SWEBenchInstance

def custom_convert(instance: SWEBenchInstance) -> dict:
    """Convert to your custom format."""
    return {
        "my_task_field": instance.problem_statement,
        "my_repo_field": instance.repo,
        # ... your format
    }
```

### Custom Exporter

To export results in a different format:

```python
from swebench.models import InstanceResult
from pathlib import Path

def export_my_format(
    results: list[InstanceResult],
    output_file: Path
) -> None:
    """Export to custom format."""
    with open(output_file, 'w') as f:
        for result in results:
            # Write in your format
            f.write(f"{result.instance_id},{result.status}\n")
```

### Integrating with SpecOrchestrator

The current implementation uses a stub for SpecOrchestrator integration. To complete the integration:

```python
# In orchestrator.py, replace the stub in _process_instance():

async def _process_instance(self, instance: SWEBenchInstance) -> InstanceResult:
    # 1. Clone repository at base_commit
    repo_dir = clone_repo(instance.repo, instance.base_commit)

    # 2. Create spec directory
    spec = convert_to_autoclaude_spec(instance)
    spec_dir = self.specs_dir / instance.instance_id
    save_spec_to_directory(spec, spec_dir)

    # 3. Invoke SpecOrchestrator
    from spec.pipeline.orchestrator import SpecOrchestrator
    orchestrator = SpecOrchestrator(
        project_dir=repo_dir,
        spec_dir=spec_dir,
        model=self.model,
    )
    success = await orchestrator.run(auto_approve=True)

    # 4. Extract patch from modified files
    patch = extract_git_diff(repo_dir)

    return InstanceResult(
        instance_id=instance.instance_id,
        status="success" if success else "failed",
        model_patch=patch,
    )
```

### Adding Custom Metrics

Extend the metrics exporter:

```python
from swebench.exporters.metrics_exporter import generate_metrics_report

def generate_custom_metrics(results, output_file, **kwargs):
    # Generate standard report first
    generate_metrics_report(results, output_file, **kwargs)

    # Add custom metrics
    import json
    with open(output_file, 'r') as f:
        report = json.load(f)

    report['my_custom_metric'] = calculate_custom(results)

    with open(output_file, 'w') as f:
        json.dump(report, f, indent=2)
```

---

## Troubleshooting

### Common Issues

#### Docker Not Available

```
Error: Docker daemon not available. Please start Docker.
```

**Solution**: Start Docker Desktop or the Docker daemon:
```bash
# Linux
sudo systemctl start docker

# macOS
open -a Docker
```

#### Dataset Not Found

```
Error: Dataset 'invalid/dataset' not found on HuggingFace
```

**Solution**: Verify the dataset exists on HuggingFace Hub:
```python
from datasets import load_dataset
load_dataset('princeton-nlp/SWE-bench_Lite', split='test')
```

#### Out of Memory

For large datasets, use streaming or limit instances:

```bash
python -m cli.swebench_eval \
    --dataset princeton-nlp/SWE-bench \
    --max-instances 100  # Process in batches
```

#### Checkpoint Corrupted

```
Warning: Failed to load checkpoint, starting fresh
```

This is handled automatically - a new checkpoint is created.
To manually inspect/repair:

```python
from swebench.checkpoint_manager import CheckpointManager

manager = CheckpointManager()
checkpoint = manager.load("my-run-id")
# Inspect and repair if needed
manager.save(checkpoint)
```

### Debugging

Enable verbose logging:

```bash
python -m cli.swebench_eval \
    --dataset princeton-nlp/SWE-bench_Lite \
    --max-instances 5 \
    --verbose
```

Check individual instance status:

```python
from swebench import load_checkpoint

checkpoint = load_checkpoint("my-run-id")
for state in checkpoint.instance_states:
    print(f"{state.instance_id}: {state.status}")
    if state.error_message:
        print(f"  Error: {state.error_message}")
```

### Getting Help

1. Check the implementation plan: `.auto-claude/specs/023-add-swe-bench-pro-thin-integration-layer/implementation_plan.json`
2. Run unit tests: `cd apps/backend && python -m pytest tests/swebench/ -v`
3. Review the spec: `.auto-claude/specs/023-add-swe-bench-pro-thin-integration-layer/spec.md`

---

## API Reference

### Models

```python
from swebench import (
    # Core models
    SWEBenchInstance,      # HuggingFace dataset instance
    SWEBenchPrediction,    # Output prediction format
    InstanceResult,        # Per-instance result
    EvaluationMetrics,     # Aggregated metrics

    # Checkpoint models
    Checkpoint,
    InstanceCheckpointState,
)
```

### Functions

```python
from swebench import (
    # Dataset loading
    load_swebench_dataset,
    get_dataset_info,
    validate_dataset_instance,

    # Docker checking
    check_docker,
    is_docker_available,
    get_docker_info,
    check_docker_disk_space,

    # Checkpointing
    save_checkpoint,
    load_checkpoint,
    checkpoint_exists,

    # Orchestration
    SWEBenchOrchestrator,
    run_evaluation,
)

from swebench.adapters import (
    convert_to_autoclaude_spec,
    save_spec_to_directory,
    load_spec_from_directory,
    convert_to_swebench_prediction,
    convert_results_batch,
    export_predictions_to_jsonl,
)

from swebench.exporters import (
    export_predictions,
    generate_metrics_report,
    load_metrics_report,
    validate_metrics_report,
    compare_reports,
)
```

### Exceptions

```python
from swebench import (
    # Dataset errors
    DatasetLoadError,
    DatasetNotFoundError,

    # Docker errors
    DockerNotAvailableError,
    DockerVersionError,

    # Checkpoint errors
    CheckpointError,
    CheckpointNotFoundError,
    CheckpointCorruptedError,
    CheckpointSaveError,

    # Orchestration errors
    EvaluationError,
)
```

---

## License

This integration layer is part of the autoclaude project.

SWE-bench is developed by Princeton NLP. See [swe-bench.github.io](https://www.swebench.com/) for more information.
