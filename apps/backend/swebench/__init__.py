"""
SWE-bench Integration Layer
============================

This package provides adapters and tools for evaluating autoclaude against
the SWE-bench benchmark suite from Princeton NLP.
"""

from swebench.models import (
    EvaluationMetrics,
    InstanceResult,
    SWEBenchInstance,
    SWEBenchPrediction,
)

__all__ = [
    "EvaluationMetrics",
    "InstanceResult",
    "SWEBenchInstance",
    "SWEBenchPrediction",
]
