# SWE-bench Service API Reference

Complete API documentation for the SWE-bench benchmark integration service.

## Table of Contents

- [Quick Reference](#quick-reference)
- [Data Models (Pydantic)](#data-models-pydantic)
  - [Core Models](#core-models)
  - [Result Models](#result-models)
  - [Infrastructure Models](#infrastructure-models)
  - [Parser Models](#parser-models)
  - [Orchestrator Models](#orchestrator-models)
- [Enums](#enums)
- [Functions](#functions)
  - [Dataset Loading](#dataset-loading)
  - [Format Conversion](#format-conversion)
  - [Predictions Export](#predictions-export)
  - [Evaluation](#evaluation)
  - [Infrastructure Health](#infrastructure-health)
  - [Results Parsing](#results-parsing)
- [Classes](#classes)
  - [BenchmarkOrchestrator](#benchmarkorchestrator)
- [Exceptions](#exceptions)
- [Constants](#constants)

---

## Quick Reference

```python
from apps.backend.services.swebench import (
    # Core functions
    load_benchmark,
    convert_to_task,
    export_predictions,
    execute_evaluation,
    parse_report,

    # Orchestration
    BenchmarkOrchestrator,
    run_benchmark,

    # Models
    SWEBenchInstance,
    AutoclaudeTask,
    BenchmarkResult,
    EvaluationReport,
)

# Load and evaluate
instances = load_benchmark("lite", max_instances=10)
task = convert_to_task(instances[0])
# ... execute task ...
export_predictions(results, "predictions.jsonl")
execute_evaluation("predictions.jsonl", "run-001")
report = parse_report("logs/run_evaluation/run-001")
```

---

## Data Models (Pydantic)

### Core Models

#### `SWEBenchInstance`

A single SWE-bench benchmark instance loaded from the dataset.

```python
class SWEBenchInstance(BaseModel):
    instance_id: str           # Format: 'owner__repo-pr_number'
    repo: str                  # Repository path (e.g., 'django/django')
    problem_statement: str     # Issue description to solve
    base_commit: str           # Git commit hash to checkout
    patch: str                 # Gold solution patch (do not view during execution)
    test_patch: str = ""       # Patch containing test modifications
    FAIL_TO_PASS: list[str]    # Tests that should change from failing to passing
    PASS_TO_PASS: list[str]    # Tests that should remain passing
    hints_text: Optional[str]  # Optional hints for solving
    created_at: Optional[str]  # When the issue was created
    version: Optional[str]     # Repository version tag
    environment_setup_commit: Optional[str]
```

**Validators:**
- `instance_id`: Must contain `__` separator and `-` in repo-pr part
- `base_commit`: Must be valid hexadecimal git hash (7+ characters)

---

#### `AutoclaudeTask`

Task format for autoclaude execution.

```python
class AutoclaudeTask(BaseModel):
    task_id: str               # Unique task identifier (from instance_id)
    description: str           # Task description for autoclaude
    repository: str            # Repository URL or path
    base_commit: str           # Git commit to checkout
    test_criteria: TestCriteria
    hints: Optional[str]       # Optional hints for the task
    metadata: dict             # Additional metadata for tracking
```

---

#### `TestCriteria`

Test validation criteria for a task.

```python
class TestCriteria(BaseModel):
    fail_to_pass: list[str]    # Tests that should change from failing to passing
    pass_to_pass: list[str]    # Tests that should remain passing

    # Properties
    @property
    def total_tests(self) -> int
```

---

#### `PredictionEntry`

SWE-bench JSONL prediction format for the evaluation harness.

```python
class PredictionEntry(BaseModel):
    instance_id: str
    model_name_or_path: str = "autoclaude"
    model_patch: str           # Generated patch in git diff format
```

---

### Result Models

#### `InstanceResult`

Result of executing a single benchmark instance.

```python
class InstanceResult(BaseModel):
    instance_id: str
    status: ExecutionStatus = ExecutionStatus.PENDING
    model_patch: Optional[str]
    error_message: Optional[str]
    execution_time_seconds: Optional[float]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
```

---

#### `BenchmarkResult`

Complete results for a benchmark run.

```python
class BenchmarkResult(BaseModel):
    run_id: str
    variant: BenchmarkVariant
    total_instances: int
    completed_instances: int = 0
    resolve_rate: Optional[float]        # 0-100 percentage
    instance_results: list[InstanceResult]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    metadata: dict

    # Properties
    @property
    def is_complete(self) -> bool

    @property
    def success_count(self) -> int

    @property
    def failure_count(self) -> int
```

---

### Infrastructure Models

#### `HealthCheckResult`

Result of an infrastructure health check.

```python
class HealthCheckResult(BaseModel):
    check_name: str
    passed: bool
    message: str
    details: dict
```

---

#### `InfrastructureStatus`

Complete infrastructure status aggregating all health checks.

```python
class InfrastructureStatus(BaseModel):
    docker_available: HealthCheckResult
    disk_space: HealthCheckResult
    cpu_cores: HealthCheckResult
    architecture: HealthCheckResult

    # Properties
    @property
    def all_passed(self) -> bool

    @property
    def warnings(self) -> list[str]

    @property
    def errors(self) -> list[str]
```

---

### Parser Models

#### `EvaluationReport`

Complete evaluation report from SWE-bench harness.

```python
class EvaluationReport(BaseModel):
    run_id: str
    dataset_name: Optional[str]
    log_dir: str
    total_instances: int = 0
    resolved_count: int = 0
    unresolved_count: int = 0
    error_count: int = 0
    resolve_rate: float = 0.0           # 0-100 percentage

    # F2P/P2P aggregate metrics
    total_f2p_tests: int = 0
    passed_f2p_tests: int = 0
    total_p2p_tests: int = 0
    passed_p2p_tests: int = 0

    # Per-instance results
    instance_statuses: list[InstanceStatusResult]
    parsed_at: datetime
    raw_report: Optional[dict]

    # Properties
    @property
    def f2p_pass_rate(self) -> float

    @property
    def p2p_pass_rate(self) -> float

    @property
    def resolved_instance_ids(self) -> list[str]

    @property
    def unresolved_instance_ids(self) -> list[str]
```

---

#### `InstanceStatusResult`

Status result for a single evaluated instance.

```python
class InstanceStatusResult(BaseModel):
    instance_id: str
    status: InstanceStatus
    patch_applied: bool = True
    tests_run: bool = True
    error_message: Optional[str]
    test_results: Optional[InstanceTestResults]
```

---

#### `InstanceTestResults`

Test results for a single evaluated instance.

```python
class InstanceTestResults(BaseModel):
    instance_id: str
    fail_to_pass: list[TestResult]
    pass_to_pass: list[TestResult]

    # Properties
    @property
    def f2p_passed_count(self) -> int

    @property
    def f2p_total_count(self) -> int

    @property
    def p2p_passed_count(self) -> int

    @property
    def p2p_total_count(self) -> int

    @property
    def all_f2p_passed(self) -> bool

    @property
    def all_p2p_passed(self) -> bool

    @property
    def is_resolved(self) -> bool
```

---

#### `TestResult`

Result of a single test case.

```python
class TestResult(BaseModel):
    test_name: str
    passed: bool
    output: Optional[str]
    error: Optional[str]
```

---

#### `ParseOptions`

Options for parsing evaluation results.

```python
@dataclass
class ParseOptions:
    include_raw_report: bool = True
    include_test_details: bool = True
    parse_instance_logs: bool = True
```

---

### Orchestrator Models

#### `OrchestratorConfig`

Configuration for benchmark execution.

```python
@dataclass
class OrchestratorConfig:
    variant: BenchmarkVariant = BenchmarkVariant.LITE
    max_instances: Optional[int] = None
    max_workers: Optional[int] = None
    output_dir: Union[str, Path] = "./swebench_output"
    cache_level: str = "env"              # "none", "base", "env", "instance"
    timeout_per_instance: int = 1800      # 30 minutes
    include_hints: bool = True
    skip_evaluation: bool = False
    cleanup_after_run: bool = True
    resume_from_checkpoint: bool = True
```

---

#### `OrchestrationProgress`

Progress tracking for benchmark execution.

```python
@dataclass
class OrchestrationProgress:
    phase: str = "initializing"
    current_instance: Optional[str] = None
    completed_instances: int = 0
    total_instances: int = 0
    failed_instances: int = 0
    elapsed_seconds: float = 0.0
    estimated_remaining_seconds: Optional[float] = None

    @property
    def progress_percent(self) -> float
```

---

#### `OrchestrationResult`

Result of benchmark orchestration.

```python
@dataclass
class OrchestrationResult:
    success: bool = False
    run_id: str = ""
    benchmark_result: Optional[BenchmarkResult] = None
    predictions_path: Optional[Path] = None
    evaluation_result: Optional[dict] = None
    errors: list[str]
    warnings: list[str]
```

---

#### `Checkpoint`

Checkpoint for resumable execution.

```python
@dataclass
class Checkpoint:
    run_id: str
    variant: BenchmarkVariant
    completed_instance_ids: list[str]
    failed_instance_ids: list[str]
    results: list[dict]
    created_at: str
```

---

## Enums

### `BenchmarkVariant`

Available SWE-bench benchmark variants.

```python
class BenchmarkVariant(str, Enum):
    LITE = "lite"              # 300 instances
    VERIFIED = "verified"      # 500 instances
    FULL = "full"              # 2,294 instances
    MULTIMODAL = "multimodal"  # 617 instances
    MULTILINGUAL = "multilingual"  # 510 instances
```

---

### `ExecutionStatus`

Status of benchmark execution.

```python
class ExecutionStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
```

---

### `InstanceStatus`

Status of an evaluated instance.

```python
class InstanceStatus(str, Enum):
    RESOLVED = "resolved"
    NOT_RESOLVED = "not_resolved"
    ERROR = "error"
    TIMEOUT = "timeout"
    PATCH_APPLY_FAILED = "patch_apply_failed"
    TESTS_FAILED = "tests_failed"
    UNKNOWN = "unknown"

    @classmethod
    def from_string(cls, value: str) -> "InstanceStatus"
```

---

## Functions

### Dataset Loading

#### `load_benchmark()`

Load a SWE-bench benchmark dataset from HuggingFace Hub.

```python
def load_benchmark(
    variant: Union[str, BenchmarkVariant] = BenchmarkVariant.LITE,
    split: str = "test",
    max_instances: Optional[int] = None,
    skip_validation: bool = False,
    streaming: bool = False,
) -> list[SWEBenchInstance]
```

**Parameters:**
- `variant`: Benchmark variant (string or enum)
- `split`: Dataset split ("test", "dev", "train")
- `max_instances`: Maximum instances to load (None for all)
- `skip_validation`: Skip Pydantic validation
- `streaming`: Use streaming mode for large datasets

**Returns:** List of `SWEBenchInstance` objects

**Raises:** `DatasetLoadError`, `DatasetValidationError`, `ValueError`

**Example:**
```python
instances = load_benchmark("lite", max_instances=10)
print(f"Loaded {len(instances)} instances")
print(instances[0].instance_id)  # django__django-12345
```

---

#### `load_benchmark_iterator()`

Load a SWE-bench benchmark dataset as a streaming iterator.

```python
def load_benchmark_iterator(
    variant: Union[str, BenchmarkVariant] = BenchmarkVariant.LITE,
    split: str = "test",
) -> Iterator[SWEBenchInstance]
```

**Yields:** `SWEBenchInstance` objects one at a time

**Example:**
```python
for instance in load_benchmark_iterator("lite"):
    process(instance)
```

---

#### `get_available_variants()`

Get information about all available SWE-bench variants.

```python
def get_available_variants() -> list[dict]
```

**Returns:** List of dicts with keys: `name`, `display_name`, `dataset`, `description`

---

#### `get_dataset_info()`

Get metadata about a SWE-bench dataset without loading all instances.

```python
def get_dataset_info(
    variant: Union[str, BenchmarkVariant] = BenchmarkVariant.LITE,
) -> dict
```

**Returns:** Dict with keys: `name`, `variant`, `description`, `splits`, `features`, `size_in_bytes`, `download_size`

---

### Format Conversion

#### `convert_to_task()`

Convert a SWE-bench instance to autoclaude task format.

```python
def convert_to_task(
    instance: Union[SWEBenchInstance, dict],
    repository_base_url: str = "https://github.com",
    include_hints: bool = True,
) -> AutoclaudeTask
```

**Parameters:**
- `instance`: SWEBenchInstance or dict with instance data
- `repository_base_url`: Base URL for repository (default: GitHub)
- `include_hints`: Whether to include hints_text in the task

**Returns:** `AutoclaudeTask` ready for execution

**Raises:** `ConversionError`

**Example:**
```python
instance = SWEBenchInstance(...)
task = convert_to_task(instance)
print(task.task_id)  # django__django-12345
```

---

#### `convert_batch()`

Convert multiple SWE-bench instances to autoclaude tasks.

```python
def convert_batch(
    instances: list[Union[SWEBenchInstance, dict]],
    repository_base_url: str = "https://github.com",
    include_hints: bool = True,
    skip_errors: bool = False,
) -> tuple[list[AutoclaudeTask], list[tuple[str, Exception]]]
```

**Returns:** Tuple of (converted tasks, list of (instance_id, error) for failures)

---

#### `extract_repo_info()`

Extract repository information from instance_id.

```python
def extract_repo_info(instance_id: str) -> Optional[tuple[str, str, str]]
```

**Returns:** Tuple of (owner, repo, pr_number) or None if parsing fails

**Example:**
```python
extract_repo_info("django__django-12345")
# Returns: ('django', 'django', '12345')
```

---

### Predictions Export

#### `export_predictions()`

Export autoclaude results to SWE-bench JSONL predictions file.

```python
def export_predictions(
    results: Union[BenchmarkResult, list[InstanceResult]],
    output_path: Union[str, Path],
    model_name: str = "autoclaude",
    include_failed: bool = True,
    include_empty_patches: bool = True,
    default_patch: str = "",
) -> int
```

**Returns:** Number of predictions exported

**Raises:** `ExportError`

**Example:**
```python
count = export_predictions(results, "predictions.jsonl")
print(f"Exported {count} predictions")
```

---

#### `export_predictions_to_string()`

Export autoclaude results to JSONL string format.

```python
def export_predictions_to_string(
    results: Union[BenchmarkResult, list[InstanceResult]],
    model_name: str = "autoclaude",
    include_failed: bool = True,
    include_empty_patches: bool = True,
    default_patch: str = "",
) -> str
```

**Returns:** JSONL string with one prediction per line

---

#### `create_prediction_entry()`

Create a PredictionEntry from an InstanceResult.

```python
def create_prediction_entry(
    instance_result: InstanceResult,
    model_name: str = "autoclaude",
    default_patch: str = "",
) -> PredictionEntry
```

---

#### `append_prediction()`

Append a single prediction to an existing JSONL file.

```python
def append_prediction(
    output_path: Union[str, Path],
    instance_result: InstanceResult,
    model_name: str = "autoclaude",
    default_patch: str = "",
) -> None
```

---

#### `validate_predictions_file()`

Validate a predictions JSONL file for SWE-bench compatibility.

```python
def validate_predictions_file(
    file_path: Union[str, Path],
) -> tuple[bool, list[str]]
```

**Returns:** Tuple of (is_valid, list of error messages)

---

#### `count_predictions()`

Count the number of predictions in a JSONL file.

```python
def count_predictions(file_path: Union[str, Path]) -> int
```

---

### Evaluation

#### `execute_evaluation()`

Execute SWE-bench evaluation using the official evaluation harness.

```python
def execute_evaluation(
    predictions_path: Union[str, Path],
    run_id: str,
    dataset_name: Optional[str] = None,
    variant: Optional[BenchmarkVariant] = None,
    split: str = "test",
    max_workers: Optional[int] = None,
    cache_level: str = "env",
    timeout: int = 1800,
    log_dir: Union[str, Path] = "logs/run_evaluation",
    namespace: Optional[str] = None,
    force_rebuild: bool = False,
    cleanup_containers: bool = True,
    progress_callback: Optional[Callable[[dict], None]] = None,
) -> dict[str, Any]
```

**Parameters:**
- `predictions_path`: Path to JSONL predictions file
- `run_id`: Unique identifier for this evaluation run
- `variant`: BenchmarkVariant to evaluate
- `max_workers`: Maximum parallel workers (capped at 75% CPU cores)
- `cache_level`: Docker image caching ("none", "base", "env", "instance")
- `timeout`: Per-instance timeout in seconds (default: 1800)
- `namespace`: Docker namespace for images (set to '' for ARM)

**Returns:** Dict with keys: `run_id`, `predictions_path`, `dataset_name`, `log_dir`, `total_instances`, `resolved_instances`, `resolve_rate`, `started_at`, `completed_at`, `duration_seconds`, `status`

**Raises:** `EvaluationNotAvailableError`, `InfrastructureError`, `EvaluationError`

---

#### `execute_gold_evaluation()`

Run evaluation with gold (ground truth) patches for infrastructure validation.

```python
def execute_gold_evaluation(
    variant: BenchmarkVariant = BenchmarkVariant.LITE,
    run_id: Optional[str] = None,
    max_workers: Optional[int] = None,
    **kwargs,
) -> dict[str, Any]
```

---

#### `check_evaluation_prerequisites()`

Check all prerequisites for running evaluation.

```python
def check_evaluation_prerequisites(
    predictions_path: Optional[Union[str, Path]] = None,
) -> tuple[bool, list[str]]
```

**Returns:** Tuple of (all_passed, list of error messages)

---

#### `cleanup_docker_resources()`

Clean up Docker resources to free disk space.

```python
def cleanup_docker_resources(
    prune_containers: bool = True,
    prune_images: bool = False,
    prune_volumes: bool = False,
) -> dict[str, Any]
```

**Returns:** Dict with cleanup statistics

---

#### `get_evaluation_status()`

Get the status of an evaluation run.

```python
def get_evaluation_status(
    run_id: str,
    log_dir: Union[str, Path] = "logs/run_evaluation",
) -> dict[str, Any]
```

---

### Infrastructure Health

#### `check_infrastructure()`

Run all infrastructure health checks and return aggregated status.

```python
def check_infrastructure(
    disk_path: Optional[str] = None,
    minimum_disk_gb: float = 10.0,
    cpu_utilization_limit: float = 0.75,
) -> InfrastructureStatus
```

**Example:**
```python
status = check_infrastructure()
if status.all_passed:
    print("Ready to run SWE-bench evaluation!")
else:
    for error in status.errors:
        print(f"Error: {error}")
```

---

#### `check_docker_available()`

Check if Docker daemon is running and accessible.

```python
def check_docker_available() -> HealthCheckResult
```

---

#### `check_disk_space()`

Check if sufficient disk space is available.

```python
def check_disk_space(
    path: Optional[str] = None,
    minimum_gb: float = 10.0,
) -> HealthCheckResult
```

---

#### `check_cpu_cores()`

Check CPU core count and calculate recommended max_workers.

```python
def check_cpu_cores(
    utilization_limit: float = 0.75,
) -> HealthCheckResult
```

---

#### `check_architecture()`

Check system architecture for compatibility.

```python
def check_architecture() -> HealthCheckResult
```

**Note:** ARM architecture is a warning, not a blocking failure.

---

#### `get_recommended_max_workers()`

Get the recommended maximum number of workers.

```python
def get_recommended_max_workers() -> int
```

**Returns:** Recommended workers (capped at 75% of CPU cores)

---

#### `get_available_disk_space_gb()`

Get available disk space in gigabytes.

```python
def get_available_disk_space_gb(path: Optional[str] = None) -> float
```

---

### Results Parsing

#### `parse_report()`

Parse evaluation results from a run log directory.

```python
def parse_report(
    log_dir: Union[str, Path],
    run_id: Optional[str] = None,
    options: Optional[ParseOptions] = None,
) -> EvaluationReport
```

**Example:**
```python
report = parse_report("logs/run_evaluation/run-001")
print(f"Resolved: {report.resolved_count}/{report.total_instances}")
print(f"Resolve rate: {report.resolve_rate}%")
```

---

#### `parse_report_file()`

Parse a report.json file directly.

```python
def parse_report_file(
    report_path: Union[str, Path],
    options: Optional[ParseOptions] = None,
) -> EvaluationReport
```

---

#### `parse_report_from_dict()`

Parse a report from a dictionary.

```python
def parse_report_from_dict(
    raw_report: dict[str, Any],
    run_id: str = "unknown",
    log_dir: str = ".",
    options: Optional[ParseOptions] = None,
) -> EvaluationReport
```

---

#### `get_instance_status()`

Get the status of a specific instance.

```python
def get_instance_status(
    log_dir: Union[str, Path],
    instance_id: str,
) -> Optional[InstanceStatusResult]
```

---

#### `get_resolved_instances()`

Get list of resolved instance IDs.

```python
def get_resolved_instances(
    log_dir: Union[str, Path],
) -> list[str]
```

---

#### `get_evaluation_metrics()`

Get key evaluation metrics from results.

```python
def get_evaluation_metrics(
    log_dir: Union[str, Path],
) -> dict[str, Any]
```

---

#### `summarize_report()`

Generate a human-readable summary of an evaluation report.

```python
def summarize_report(report: EvaluationReport) -> str
```

---

## Classes

### BenchmarkOrchestrator

Orchestrates the full SWE-bench benchmark execution pipeline.

```python
class BenchmarkOrchestrator:
    def __init__(
        self,
        config: Optional[OrchestratorConfig] = None,
        progress_callback: Optional[Callable[[OrchestrationProgress], None]] = None,
    ) -> None
```

#### Methods

##### `run()`

Run the benchmark orchestration pipeline.

```python
def run(
    self,
    variant: Optional[Union[str, BenchmarkVariant]] = None,
    max_instances: Optional[int] = None,
    output_dir: Optional[Union[str, Path]] = None,
    run_id: Optional[str] = None,
    task_executor: Optional[Callable[[AutoclaudeTask], InstanceResult]] = None,
) -> OrchestrationResult
```

**Example:**
```python
orchestrator = BenchmarkOrchestrator()
result = orchestrator.run(variant="lite", max_instances=10)
if result.success:
    print(f"Resolve rate: {result.benchmark_result.resolve_rate}%")
```

##### `cancel()`

Cancel the current benchmark run.

```python
def cancel(self) -> None
```

##### `get_progress()`

Get current execution progress.

```python
def get_progress(self) -> OrchestrationProgress
```

##### `validate_config()`

Validate the current configuration.

```python
def validate_config(self) -> tuple[bool, list[str]]
```

##### `to_dict()`

Convert orchestrator state to dictionary.

```python
def to_dict(self) -> dict[str, Any]
```

#### Context Manager

```python
with BenchmarkOrchestrator() as orchestrator:
    result = orchestrator.run(variant="lite")
```

---

### Convenience Functions

#### `run_benchmark()`

Run a SWE-bench benchmark evaluation (convenience function).

```python
def run_benchmark(
    variant: Union[str, BenchmarkVariant] = BenchmarkVariant.LITE,
    max_instances: Optional[int] = None,
    output_dir: Union[str, Path] = "./swebench_output",
    progress_callback: Optional[Callable[[OrchestrationProgress], None]] = None,
) -> OrchestrationResult
```

---

#### `validate_benchmark_environment()`

Validate environment for benchmark execution.

```python
def validate_benchmark_environment() -> tuple[bool, list[str], list[str]]
```

**Returns:** Tuple of (is_ready, errors, warnings)

---

## Exceptions

### Dataset Exceptions

| Exception | Description |
|-----------|-------------|
| `DatasetLoadError` | Dataset loading failed |
| `DatasetValidationError` | Dataset validation failed |

### Conversion Exceptions

| Exception | Description |
|-----------|-------------|
| `ConversionError` | Instance to task conversion failed |

### Export Exceptions

| Exception | Description |
|-----------|-------------|
| `ExportError` | Export to JSONL failed |

### Evaluation Exceptions

| Exception | Description |
|-----------|-------------|
| `EvaluationError` | Evaluation failed |
| `EvaluationNotAvailableError` | SWE-bench harness not installed |
| `InfrastructureError` | Infrastructure requirements not met |

### Health Check Exceptions

| Exception | Description |
|-----------|-------------|
| `HealthCheckError` | Health check encountered an error |

### Parser Exceptions

| Exception | Description |
|-----------|-------------|
| `ResultsParseError` | Parsing evaluation results failed |
| `ReportNotFoundError` | report.json not found |

### Orchestration Exceptions

| Exception | Description |
|-----------|-------------|
| `OrchestrationError` | Orchestration failed |
| `ConfigurationError` | Configuration is invalid |
| `ExecutionInterruptedError` | Execution was interrupted |

---

## Constants

### Module-Level

| Constant | Value | Description |
|----------|-------|-------------|
| `VARIANT_DATASET_NAMES` | dict | Maps BenchmarkVariant to HuggingFace dataset IDs |

### Health Module

| Constant | Value | Description |
|----------|-------|-------------|
| `MINIMUM_DISK_SPACE_GB` | `10.0` | Minimum required disk space |
| `CPU_UTILIZATION_LIMIT` | `0.75` | Max fraction of CPU cores to use |
| `MINIMUM_CPU_CORES` | `1` | Minimum number of CPU cores |

### Evaluator Module

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_LOG_DIR` | `"logs/run_evaluation"` | Default log directory |
| `DEFAULT_CACHE_LEVEL` | `"env"` | Default Docker cache level |
| `VALID_CACHE_LEVELS` | `["none", "base", "env", "instance"]` | Valid cache levels |

---

## Dataset Variants Reference

| Variant | Dataset ID | Instance Count | Description |
|---------|-----------|----------------|-------------|
| `LITE` | `princeton-nlp/SWE-bench_Lite` | 300 | Curated instances for faster evaluation |
| `VERIFIED` | `princeton-nlp/SWE-bench_Verified` | 500 | Human-verified subset |
| `FULL` | `princeton-nlp/SWE-bench` | 2,294 | Complete dataset |
| `MULTIMODAL` | `princeton-nlp/SWE-bench_Multimodal` | 617 | Instances requiring visual understanding |
| `MULTILINGUAL` | `princeton-nlp/SWE-bench_Multilingual` | 510 | Non-English repositories |

---

## See Also

- [README.md](./README.md) - Getting started guide
- [SWE-bench GitHub](https://github.com/princeton-nlp/SWE-bench) - Official SWE-bench repository
- [HuggingFace Datasets](https://huggingface.co/princeton-nlp) - Dataset source
