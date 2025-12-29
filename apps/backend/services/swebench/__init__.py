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

# Imports will be added as submodules are implemented
# from .models import SWEBenchInstance
# from .loader import load_benchmark
# from .converter import convert_to_task
# from .exporter import export_predictions
# from .orchestrator import BenchmarkOrchestrator
# from .health import check_docker_available, check_disk_space

__all__ = [
    # Models (to be implemented in subtask-1-2)
    # "SWEBenchInstance",
    # Loader (to be implemented in subtask-1-4)
    # "load_benchmark",
    # Converter (to be implemented in subtask-2-1)
    # "convert_to_task",
    # Exporter (to be implemented in subtask-2-2)
    # "export_predictions",
    # Orchestrator (to be implemented in subtask-2-4)
    # "BenchmarkOrchestrator",
    # Health checks (to be implemented in subtask-1-5)
    # "check_docker_available",
    # "check_disk_space",
]
