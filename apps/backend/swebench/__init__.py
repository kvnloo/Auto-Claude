"""
SWE-bench Integration Layer
============================

This package provides adapters and tools for evaluating autoclaude against
the SWE-bench benchmark suite from Princeton NLP.
"""

from swebench.dataset_loader import (
    DatasetLoadError,
    DatasetNotFoundError,
    get_dataset_info,
    list_available_datasets,
    load_swebench_dataset,
    validate_dataset_instance,
)
from swebench.models import (
    EvaluationMetrics,
    InstanceResult,
    SWEBenchInstance,
    SWEBenchPrediction,
)

__all__ = [
    # Models
    "EvaluationMetrics",
    "InstanceResult",
    "SWEBenchInstance",
    "SWEBenchPrediction",
    # Dataset loading
    "DatasetLoadError",
    "DatasetNotFoundError",
    "get_dataset_info",
    "list_available_datasets",
    "load_swebench_dataset",
    "validate_dataset_instance",
]
