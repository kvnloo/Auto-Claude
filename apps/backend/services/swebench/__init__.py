"""
SWE-bench Service Module
========================

SWE-bench benchmark integration for autoclaude. This module provides:

- Dataset loading for all 5 SWE-bench variants (Lite, Verified, Full, Multimodal, Multilingual)
- Format conversion between SWE-bench instances and autoclaude tasks
- Result export to SWE-bench-compliant JSONL predictions format
- Docker-based evaluation harness integration
- Infrastructure health checks (Docker, disk space, CPU)

Usage:
    from apps.backend.services.swebench import (
        load_benchmark,
        convert_to_task,
        export_predictions,
        BenchmarkOrchestrator,
    )

    # Load a benchmark variant
    instances = load_benchmark("lite")

    # Convert to autoclaude task format
    task = convert_to_task(instances[0])

    # Export predictions after execution
    export_predictions(results, "predictions.jsonl")

    # Run full benchmark orchestration
    orchestrator = BenchmarkOrchestrator()
    results = orchestrator.run(variant="lite", max_instances=10)
"""

# Models - implemented in subtask-1-2
from .models import (
    BenchmarkVariant,
    VARIANT_DATASET_NAMES,
    SWEBenchInstance,
    AutoclaudeTask,
    TestCriteria,
    PredictionEntry,
    ExecutionStatus,
    InstanceResult,
    BenchmarkResult,
    HealthCheckResult,
    InfrastructureStatus,
)

# Loader - implemented in subtask-1-4
from .loader import (
    load_benchmark,
    load_benchmark_iterator,
    get_available_variants,
    get_dataset_info,
    DatasetLoadError,
    DatasetValidationError,
)

# Health checks - implemented in subtask-1-5
from .health import (
    check_docker_available,
    check_disk_space,
    check_cpu_cores,
    check_architecture,
    check_infrastructure,
    get_recommended_max_workers,
    get_available_disk_space_gb,
    HealthCheckError,
)

# Converter - implemented in subtask-2-1
from .converter import (
    convert_to_task,
    convert_batch,
    extract_repo_info,
    ConversionError,
)

# Exporter - implemented in subtask-2-2
from .exporter import (
    export_predictions,
    export_predictions_to_string,
    create_prediction_entry,
    append_prediction,
    validate_predictions_file,
    count_predictions,
    ExportError,
)

# Evaluator - implemented in subtask-2-3
from .evaluator import (
    execute_evaluation,
    execute_gold_evaluation,
    check_evaluation_prerequisites,
    cleanup_docker_resources,
    get_evaluation_status,
    EvaluationError,
    EvaluationNotAvailableError,
    InfrastructureError,
)

# Orchestrator - implemented in subtask-2-4
from .orchestrator import (
    BenchmarkOrchestrator,
    OrchestratorConfig,
    OrchestrationProgress,
    OrchestrationResult,
    Checkpoint,
    OrchestrationError,
    ConfigurationError,
    ExecutionInterruptedError,
    run_benchmark,
    validate_benchmark_environment,
)

# Results Parser - implemented in subtask-2-5
from .results_parser import (
    parse_report,
    parse_report_file,
    parse_report_from_dict,
    get_instance_status,
    get_resolved_instances,
    get_evaluation_metrics,
    summarize_report,
    EvaluationReport,
    InstanceStatusResult,
    InstanceTestResults,
    TestResult,
    InstanceStatus,
    ParseOptions,
    ResultsParseError,
    ReportNotFoundError,
)

__all__ = [
    # Models (implemented in subtask-1-2)
    "BenchmarkVariant",
    "VARIANT_DATASET_NAMES",
    "SWEBenchInstance",
    "AutoclaudeTask",
    "TestCriteria",
    "PredictionEntry",
    "ExecutionStatus",
    "InstanceResult",
    "BenchmarkResult",
    "HealthCheckResult",
    "InfrastructureStatus",
    # Loader (implemented in subtask-1-4)
    "load_benchmark",
    "load_benchmark_iterator",
    "get_available_variants",
    "get_dataset_info",
    "DatasetLoadError",
    "DatasetValidationError",
    # Health checks (implemented in subtask-1-5)
    "check_docker_available",
    "check_disk_space",
    "check_cpu_cores",
    "check_architecture",
    "check_infrastructure",
    "get_recommended_max_workers",
    "get_available_disk_space_gb",
    "HealthCheckError",
    # Converter (implemented in subtask-2-1)
    "convert_to_task",
    "convert_batch",
    "extract_repo_info",
    "ConversionError",
    # Exporter (implemented in subtask-2-2)
    "export_predictions",
    "export_predictions_to_string",
    "create_prediction_entry",
    "append_prediction",
    "validate_predictions_file",
    "count_predictions",
    "ExportError",
    # Evaluator (implemented in subtask-2-3)
    "execute_evaluation",
    "execute_gold_evaluation",
    "check_evaluation_prerequisites",
    "cleanup_docker_resources",
    "get_evaluation_status",
    "EvaluationError",
    "EvaluationNotAvailableError",
    "InfrastructureError",
    # Orchestrator (implemented in subtask-2-4)
    "BenchmarkOrchestrator",
    "OrchestratorConfig",
    "OrchestrationProgress",
    "OrchestrationResult",
    "Checkpoint",
    "OrchestrationError",
    "ConfigurationError",
    "ExecutionInterruptedError",
    "run_benchmark",
    "validate_benchmark_environment",
    # Results Parser (implemented in subtask-2-5)
    "parse_report",
    "parse_report_file",
    "parse_report_from_dict",
    "get_instance_status",
    "get_resolved_instances",
    "get_evaluation_metrics",
    "summarize_report",
    "EvaluationReport",
    "InstanceStatusResult",
    "InstanceTestResults",
    "TestResult",
    "InstanceStatus",
    "ParseOptions",
    "ResultsParseError",
    "ReportNotFoundError",
]
