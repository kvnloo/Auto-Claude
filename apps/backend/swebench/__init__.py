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
from swebench.docker_checker import (
    DockerNotAvailableError,
    DockerVersionError,
    check_docker,
    check_docker_disk_space,
    get_docker_info,
    is_docker_available,
)
from swebench.models import (
    EvaluationMetrics,
    InstanceResult,
    SWEBenchInstance,
    SWEBenchPrediction,
)
from swebench.checkpoint_manager import (
    CheckpointCorruptedError,
    CheckpointError,
    CheckpointManager,
    CheckpointNotFoundError,
    CheckpointSaveError,
    checkpoint_exists,
    load_checkpoint,
    save_checkpoint,
)
from swebench.checkpoint_models import (
    Checkpoint,
    InstanceCheckpointState,
)
from swebench.orchestrator import (
    EvaluationError,
    SWEBenchOrchestrator,
    run_evaluation,
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
    # Docker checking
    "DockerNotAvailableError",
    "DockerVersionError",
    "check_docker",
    "check_docker_disk_space",
    "get_docker_info",
    "is_docker_available",
    # Orchestrator
    "EvaluationError",
    "SWEBenchOrchestrator",
    "run_evaluation",
    # Checkpointing
    "Checkpoint",
    "CheckpointCorruptedError",
    "CheckpointError",
    "CheckpointManager",
    "CheckpointNotFoundError",
    "CheckpointSaveError",
    "InstanceCheckpointState",
    "checkpoint_exists",
    "load_checkpoint",
    "save_checkpoint",
]
