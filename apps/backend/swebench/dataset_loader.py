"""
Dataset Loader for SWE-bench Datasets
======================================

This module provides functionality for loading SWE-bench datasets from HuggingFace
and converting them to SWEBenchInstance models for processing.

Supported Datasets:
    - princeton-nlp/SWE-bench (full dataset, ~2,294 instances)
    - princeton-nlp/SWE-bench_Lite (curated subset, 300 instances)
    - princeton-nlp/SWE-bench_Verified (human-verified subset)
    - Any HuggingFace-hosted SWE-bench compatible dataset

Usage:
    from swebench.dataset_loader import load_swebench_dataset

    # Load all instances from SWE-bench_Lite
    instances = load_swebench_dataset("princeton-nlp/SWE-bench_Lite")

    # Load limited instances for testing
    instances = load_swebench_dataset(
        "princeton-nlp/SWE-bench_Lite",
        max_instances=10
    )

    # Get dataset info without loading all data
    info = get_dataset_info("princeton-nlp/SWE-bench_Lite")
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Iterator

from swebench.models import SWEBenchInstance

if TYPE_CHECKING:
    from datasets import Dataset, DatasetDict


logger = logging.getLogger(__name__)


class DatasetLoadError(Exception):
    """Raised when dataset loading fails."""

    pass


class DatasetNotFoundError(DatasetLoadError):
    """Raised when the specified dataset cannot be found."""

    pass


def load_swebench_dataset(
    dataset_name: str,
    *,
    split: str = "test",
    max_instances: int | None = None,
    streaming: bool = False,
) -> list[SWEBenchInstance]:
    """Load a SWE-bench dataset from HuggingFace and convert to SWEBenchInstance models.

    Args:
        dataset_name: HuggingFace dataset identifier (e.g., "princeton-nlp/SWE-bench_Lite")
        split: Dataset split to load (default: "test")
        max_instances: Maximum number of instances to load (None for all)
        streaming: Whether to use streaming mode for memory efficiency (default: False)

    Returns:
        List of SWEBenchInstance models ready for processing

    Raises:
        DatasetNotFoundError: If the dataset cannot be found on HuggingFace
        DatasetLoadError: If loading fails for another reason
    """
    try:
        from datasets import load_dataset
    except ImportError as e:
        raise DatasetLoadError(
            "The 'datasets' package is required. Install with: pip install datasets"
        ) from e

    logger.info(f"Loading dataset: {dataset_name} (split: {split})")

    try:
        # Load dataset from HuggingFace
        if streaming:
            dataset = load_dataset(
                dataset_name,
                split=split,
                streaming=True,
            )
            instances = _load_from_streaming_dataset(dataset, max_instances)
        else:
            dataset = load_dataset(
                dataset_name,
                split=split,
            )
            instances = _load_from_dataset(dataset, max_instances)

        logger.info(f"Successfully loaded {len(instances)} instances from {dataset_name}")
        return instances

    except FileNotFoundError as e:
        raise DatasetNotFoundError(
            f"Dataset not found: {dataset_name}. Please check the dataset name and try again."
        ) from e
    except Exception as e:
        error_msg = str(e).lower()
        if "not found" in error_msg or "does not exist" in error_msg:
            raise DatasetNotFoundError(
                f"Dataset not found: {dataset_name}. Please check the dataset name and try again."
            ) from e
        raise DatasetLoadError(f"Failed to load dataset {dataset_name}: {e}") from e


def _load_from_dataset(
    dataset: "Dataset",
    max_instances: int | None = None,
) -> list[SWEBenchInstance]:
    """Load instances from a non-streaming dataset.

    Args:
        dataset: HuggingFace Dataset object
        max_instances: Maximum number of instances to load

    Returns:
        List of SWEBenchInstance models
    """
    instances: list[SWEBenchInstance] = []
    total = len(dataset)
    limit = min(max_instances, total) if max_instances else total

    logger.debug(f"Loading {limit} of {total} instances from dataset")

    for i in range(limit):
        try:
            instance = _convert_to_instance(dataset[i])
            instances.append(instance)
        except Exception as e:
            logger.warning(f"Failed to parse instance at index {i}: {e}")
            continue

    return instances


def _load_from_streaming_dataset(
    dataset: Iterator,
    max_instances: int | None = None,
) -> list[SWEBenchInstance]:
    """Load instances from a streaming dataset.

    Args:
        dataset: HuggingFace streaming Dataset iterator
        max_instances: Maximum number of instances to load

    Returns:
        List of SWEBenchInstance models
    """
    instances: list[SWEBenchInstance] = []
    count = 0

    for item in dataset:
        if max_instances and count >= max_instances:
            break

        try:
            instance = _convert_to_instance(item)
            instances.append(instance)
            count += 1
        except Exception as e:
            logger.warning(f"Failed to parse instance at index {count}: {e}")
            continue

        if count % 100 == 0:
            logger.debug(f"Loaded {count} instances...")

    return instances


def _convert_to_instance(data: dict) -> SWEBenchInstance:
    """Convert a raw dataset item to a SWEBenchInstance model.

    Args:
        data: Raw dictionary from HuggingFace dataset

    Returns:
        Validated SWEBenchInstance model

    Raises:
        ValueError: If the data cannot be converted to a valid instance
    """
    # Handle different field name conventions in different dataset versions
    fail_to_pass = data.get("FAIL_TO_PASS") or data.get("fail_to_pass") or []
    pass_to_pass = data.get("PASS_TO_PASS") or data.get("pass_to_pass") or []

    # Parse string lists if needed (some datasets store as JSON strings)
    if isinstance(fail_to_pass, str):
        import json

        try:
            fail_to_pass = json.loads(fail_to_pass)
        except json.JSONDecodeError:
            fail_to_pass = [fail_to_pass] if fail_to_pass else []

    if isinstance(pass_to_pass, str):
        import json

        try:
            pass_to_pass = json.loads(pass_to_pass)
        except json.JSONDecodeError:
            pass_to_pass = [pass_to_pass] if pass_to_pass else []

    return SWEBenchInstance(
        instance_id=data["instance_id"],
        problem_statement=data.get("problem_statement", ""),
        base_commit=data.get("base_commit", ""),
        fail_to_pass=fail_to_pass,
        pass_to_pass=pass_to_pass,
        test_patch=data.get("test_patch", ""),
        repo=data.get("repo", ""),
        version=data.get("version", ""),
        hints_text=data.get("hints_text", ""),
        created_at=data.get("created_at", ""),
        patch=data.get("patch", ""),
        environment_setup_commit=data.get("environment_setup_commit", ""),
    )


def get_dataset_info(dataset_name: str) -> dict:
    """Get information about a SWE-bench dataset without loading all data.

    Args:
        dataset_name: HuggingFace dataset identifier

    Returns:
        Dictionary with dataset metadata including:
            - name: Dataset name
            - total_instances: Number of instances in test split
            - splits: Available dataset splits
            - features: Dataset feature names

    Raises:
        DatasetNotFoundError: If the dataset cannot be found
        DatasetLoadError: If fetching info fails
    """
    try:
        from datasets import load_dataset_builder
    except ImportError as e:
        raise DatasetLoadError(
            "The 'datasets' package is required. Install with: pip install datasets"
        ) from e

    try:
        builder = load_dataset_builder(dataset_name)
        info = builder.info

        # Get split sizes
        splits = {}
        if info.splits:
            for split_name, split_info in info.splits.items():
                splits[split_name] = split_info.num_examples

        return {
            "name": dataset_name,
            "description": info.description or "",
            "total_instances": splits.get("test", 0),
            "splits": splits,
            "features": list(info.features.keys()) if info.features else [],
        }

    except FileNotFoundError as e:
        raise DatasetNotFoundError(
            f"Dataset not found: {dataset_name}. Please check the dataset name."
        ) from e
    except Exception as e:
        error_msg = str(e).lower()
        if "not found" in error_msg or "does not exist" in error_msg:
            raise DatasetNotFoundError(
                f"Dataset not found: {dataset_name}. Please check the dataset name."
            ) from e
        raise DatasetLoadError(f"Failed to get dataset info for {dataset_name}: {e}") from e


def list_available_datasets() -> list[dict]:
    """List commonly used SWE-bench datasets.

    Returns:
        List of dictionaries with dataset information
    """
    return [
        {
            "name": "princeton-nlp/SWE-bench_Lite",
            "description": "Curated subset of 300 instances for faster evaluation",
            "instances": 300,
        },
        {
            "name": "princeton-nlp/SWE-bench",
            "description": "Full SWE-bench dataset with ~2,294 instances",
            "instances": 2294,
        },
        {
            "name": "princeton-nlp/SWE-bench_Verified",
            "description": "Human-verified subset with confirmed solvability",
            "instances": 500,
        },
    ]


def validate_dataset_instance(data: dict) -> tuple[bool, str | None]:
    """Validate that a raw dataset item has required fields.

    Args:
        data: Raw dictionary from HuggingFace dataset

    Returns:
        Tuple of (is_valid, error_message)
    """
    required_fields = ["instance_id", "problem_statement", "base_commit"]

    for field in required_fields:
        if field not in data or not data[field]:
            return False, f"Missing required field: {field}"

    # Validate instance_id format
    instance_id = data.get("instance_id", "")
    if "__" not in instance_id:
        return False, f"Invalid instance_id format (missing double underscore): {instance_id}"

    return True, None
