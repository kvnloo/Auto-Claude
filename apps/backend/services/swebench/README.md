# SWE-bench Service Module

This module provides SWE-bench benchmark integration for autoclaude, enabling systematic evaluation against industry-standard software engineering benchmarks.

## Overview

SWE-bench is a benchmark suite for evaluating large language models on real-world software engineering tasks. This service module implements a thin adapter layer to:

1. **Load Datasets**: Fetch SWE-bench instances from HuggingFace Hub
2. **Convert Formats**: Transform SWE-bench instances to autoclaude task format
3. **Export Results**: Generate SWE-bench-compliant JSONL predictions
4. **Run Evaluation**: Execute Docker-based evaluation via official SWE-bench harness
5. **Health Checks**: Validate infrastructure requirements before execution

## Supported Benchmark Variants

| Variant | Dataset ID | Instances | Description |
|---------|------------|-----------|-------------|
| Lite | `princeton-nlp/SWE-bench_Lite` | 300 | Curated subset for faster evaluation |
| Verified | `princeton-nlp/SWE-bench_Verified` | 500 | Human-verified instances |
| Full | `princeton-nlp/SWE-bench` | 2,294 | Complete benchmark suite |
| Multimodal | `princeton-nlp/SWE-bench_Multimodal` | Varies | Includes image/visual context |
| Multilingual | `princeton-nlp/SWE-bench_Multilingual` | Varies | Non-English repositories |

## Installation

### Prerequisites

1. **Python 3.10+** with pip
2. **Docker** installed and running
3. **10GB+ free disk space** for Docker images
4. **x86_64 architecture** recommended (ARM has compatibility caveats)

### Dependencies

```bash
# Install Python dependencies
pip install datasets>=2.0.0 docker>=6.0.0

# Install SWE-bench (not on PyPI - clone from GitHub)
git clone https://github.com/princeton-nlp/SWE-bench.git
pip install -e ./SWE-bench
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
└── tests/               # Unit and integration tests
```

## Usage

### Loading a Benchmark Dataset

```python
from apps.backend.services.swebench.loader import load_benchmark

# Load SWE-bench Lite (recommended for testing)
instances = load_benchmark("lite")

# Load with specific split
instances = load_benchmark("verified", split="test")
```

### Converting to Autoclaude Tasks

```python
from apps.backend.services.swebench.converter import convert_to_task

# Convert single instance
task = convert_to_task(instance)

# Convert multiple instances
tasks = [convert_to_task(inst) for inst in instances]
```

### Exporting Predictions

```python
from apps.backend.services.swebench.exporter import export_predictions

# Export results to JSONL format
export_predictions(
    results=execution_results,
    output_path="predictions.jsonl",
    model_name="autoclaude"
)
```

### Running Evaluation

```python
from apps.backend.services.swebench.evaluator import execute_evaluation

# Run SWE-bench evaluation harness
report = execute_evaluation(
    predictions_path="predictions.jsonl",
    dataset="lite",
    max_workers=4
)
```

### Infrastructure Health Checks

```python
from apps.backend.services.swebench.health import (
    check_docker_available,
    check_disk_space,
    check_cpu_cores,
    run_all_checks
)

# Run all health checks before evaluation
health_status = run_all_checks()
if not health_status.all_passed:
    print(f"Health check failed: {health_status.issues}")
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SWEBENCH_CACHE_DIR` | `~/.cache/swebench` | Directory for caching Docker images |
| `DOCKER_HOST` | (system default) | Docker daemon socket |

### Resource Limits

- **max_workers**: Capped at <75% of available CPU cores
- **Disk space**: Minimum 10GB required
- **Memory**: 8GB+ recommended

## Known Limitations

1. **Architecture**: Best performance on x86_64; ARM systems (M-series Mac) may encounter compatibility issues
2. **Local Only**: Cloud execution (Modal/AWS) not supported in v1
3. **Sequential**: Single instance execution (no parallel processing in v1)
4. **Multimodal Assets**: Test split image assets are private (dev split available for development)

## Troubleshooting

### Docker Not Available

```
Error: Docker is not running. Please start Docker and try again.
```

**Solution**: Ensure Docker Desktop or Docker Engine is running.

### Disk Space Insufficient

```
Error: Insufficient disk space. Required: 10GB, Available: 5GB
```

**Solution**: Free up disk space or run `docker system prune` to clean up unused images.

### ARM Architecture Warning

```
Warning: ARM architecture detected. Some evaluation containers may have compatibility issues.
```

**Solution**: Use `namespace=''` flag or run on x86_64 machine for best results.

## Development

### Running Tests

```bash
cd apps/backend
python -m pytest services/swebench/tests/ -v
```

### Validating with Gold Patches

```bash
# Use gold patches to validate infrastructure
python -c "
from apps.backend.services.swebench.evaluator import execute_evaluation
report = execute_evaluation(predictions_path='gold', dataset='lite')
print(f'Resolve rate: {report.resolve_rate}%')
"
```

## References

- [SWE-bench Paper](https://arxiv.org/abs/2310.06770)
- [SWE-bench GitHub](https://github.com/princeton-nlp/SWE-bench)
- [HuggingFace Datasets](https://huggingface.co/princeton-nlp)
