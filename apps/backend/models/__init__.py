"""
Data Models for AutoClaude Backend
==================================

Core data structures for representing parallel task results and metrics.
"""

from models.parallel_task import (
    ExecutionMetrics,
    ParallelTaskResult,
)

__all__ = [
    "ParallelTaskResult",
    "ExecutionMetrics",
]
