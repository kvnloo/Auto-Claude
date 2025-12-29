"""
SWE-bench Dataset Loader
========================

HuggingFace dataset loader for all 5 SWE-bench benchmark variants.

This module provides functionality to load SWE-bench datasets from HuggingFace Hub
and convert them to validated Pydantic models for processing.

Supported variants:
- Lite: 300 curated instances for faster evaluation
- Verified: Human-verified subset with high-quality annotations
- Full: Complete SWE-bench dataset
- Multimodal: Instances requiring image/visual understanding
- Multilingual: Instances from non-English repositories
"""

from __future__ import annotations

import logging
from typing import Iterator, Union

from .models import (
    BenchmarkVariant,
    SWEBenchInstance,
    VARIANT_DATASET_NAMES,
)

logger = logging.getLogger(__name__)


class DatasetLoadError(Exception):
    """Raised when dataset loading fails."""

    pass


class DatasetValidationError(Exception):
    """Raised when dataset validation fails."""

    pass


def _normalize_variant(variant: Union[str, BenchmarkVariant]) -> BenchmarkVariant:
    """
    Normalize variant input to BenchmarkVariant enum.

    Args:
        variant: Either a string name or BenchmarkVariant enum value

    Returns:
        BenchmarkVariant enum value

    Raises:
        ValueError: If variant string is not recognized
    """
    if isinstance(variant, BenchmarkVariant):
        return variant

    # Normalize string input
    variant_lower = variant.lower().strip()

    # Handle common aliases
    aliases = {
        "swe-bench_lite": BenchmarkVariant.LITE,
        "swebench_lite": BenchmarkVariant.LITE,
        "swe-bench-lite": BenchmarkVariant.LITE,
        "swe-bench_verified": BenchmarkVariant.VERIFIED,
        "swebench_verified": BenchmarkVariant.VERIFIED,
        "swe-bench-verified": BenchmarkVariant.VERIFIED,
        "swe-bench_full": BenchmarkVariant.FULL,
        "swebench_full": BenchmarkVariant.FULL,
        "swe-bench-full": BenchmarkVariant.FULL,
        "swe-bench": BenchmarkVariant.FULL,
        "swebench": BenchmarkVariant.FULL,
        "swe-bench_multimodal": BenchmarkVariant.MULTIMODAL,
        "swebench_multimodal": BenchmarkVariant.MULTIMODAL,
        "swe-bench-multimodal": BenchmarkVariant.MULTIMODAL,
        "swe-bench_multilingual": BenchmarkVariant.MULTILINGUAL,
        "swebench_multilingual": BenchmarkVariant.MULTILINGUAL,
        "swe-bench-multilingual": BenchmarkVariant.MULTILINGUAL,
    }

    if variant_lower in aliases:
        return aliases[variant_lower]

    # Try direct enum matching
    try:
        return BenchmarkVariant(variant_lower)
    except ValueError:
        valid_options = [v.value for v in BenchmarkVariant]
        raise ValueError(
            f"Unknown benchmark variant: '{variant}'. "
            f"Valid options: {valid_options}"
        )


def _parse_test_list(value: Union[str, list, None]) -> list[str]:
    """
    Parse FAIL_TO_PASS or PASS_TO_PASS field from dataset.

    The SWE-bench dataset may store these as JSON strings or already-parsed lists.

    Args:
        value: Raw value from dataset (string, list, or None)

    Returns:
        Parsed list of test identifiers
    """
    import json

    if value is None:
        return []

    if isinstance(value, list):
        return [str(item) for item in value]

    if isinstance(value, str):
        if not value.strip():
            return []

        # Try parsing as JSON
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(item) for item in parsed]
            return [str(parsed)]
        except json.JSONDecodeError:
            # If not valid JSON, treat as single test identifier
            return [value.strip()]

    return []


def _row_to_instance(row: dict, row_index: int) -> SWEBenchInstance:
    """
    Convert a dataset row to SWEBenchInstance.

    Args:
        row: Raw dataset row dictionary
        row_index: Row index for error reporting

    Returns:
        Validated SWEBenchInstance

    Raises:
        DatasetValidationError: If row data is invalid
    """
    try:
        # Handle potential field name variations in different dataset versions
        instance_data = {
            "instance_id": row.get("instance_id", ""),
            "repo": row.get("repo", ""),
            "problem_statement": row.get("problem_statement", ""),
            "base_commit": row.get("base_commit", ""),
            "patch": row.get("patch", ""),
            "test_patch": row.get("test_patch", ""),
            "FAIL_TO_PASS": _parse_test_list(row.get("FAIL_TO_PASS")),
            "PASS_TO_PASS": _parse_test_list(row.get("PASS_TO_PASS")),
            "hints_text": row.get("hints_text"),
            "created_at": row.get("created_at"),
            "version": row.get("version"),
            "environment_setup_commit": row.get("environment_setup_commit"),
        }

        return SWEBenchInstance(**instance_data)

    except Exception as e:
        instance_id = row.get("instance_id", f"row_{row_index}")
        raise DatasetValidationError(
            f"Failed to validate instance '{instance_id}' at row {row_index}: {e}"
        ) from e


def load_benchmark(
    variant: Union[str, BenchmarkVariant] = BenchmarkVariant.LITE,
    split: str = "test",
    max_instances: int | None = None,
    skip_validation: bool = False,
    streaming: bool = False,
) -> list[SWEBenchInstance]:
    """
    Load a SWE-bench benchmark dataset from HuggingFace Hub.

    Args:
        variant: Benchmark variant to load. Can be a string (e.g., 'lite', 'verified')
                 or BenchmarkVariant enum. Defaults to Lite.
        split: Dataset split to load (e.g., 'test', 'dev', 'train').
               Defaults to 'test' as this is the standard evaluation split.
        max_instances: Maximum number of instances to load. None for all.
                      Useful for testing or development.
        skip_validation: If True, skip Pydantic validation. Returns raw dicts
                        wrapped in SWEBenchInstance. Not recommended for production.
        streaming: If True, uses streaming mode which doesn't download the full
                  dataset. More memory-efficient but may be slower.

    Returns:
        List of validated SWEBenchInstance objects

    Raises:
        DatasetLoadError: If dataset cannot be loaded from HuggingFace
        DatasetValidationError: If dataset validation fails
        ValueError: If variant is not recognized

    Example:
        >>> from apps.backend.services.swebench.loader import load_benchmark
        >>> # Load first 10 instances from SWE-bench Lite
        >>> instances = load_benchmark("lite", max_instances=10)
        >>> print(f"Loaded {len(instances)} instances")
        Loaded 10 instances
        >>> print(instances[0].instance_id)
        django__django-12345
    """
    try:
        from datasets import load_dataset
    except ImportError as e:
        raise DatasetLoadError(
            "HuggingFace datasets library not installed. "
            "Install with: pip install datasets"
        ) from e

    # Normalize variant to enum
    benchmark_variant = _normalize_variant(variant)
    dataset_name = VARIANT_DATASET_NAMES[benchmark_variant]

    logger.info(
        f"Loading SWE-bench variant '{benchmark_variant.value}' "
        f"from '{dataset_name}' (split: {split})"
    )

    try:
        # Load dataset from HuggingFace Hub
        dataset = load_dataset(
            dataset_name,
            split=split,
            streaming=streaming,
            trust_remote_code=True,  # Required for some SWE-bench datasets
        )
    except Exception as e:
        raise DatasetLoadError(
            f"Failed to load dataset '{dataset_name}' (split: {split}): {e}"
        ) from e

    # Convert to instances
    instances: list[SWEBenchInstance] = []
    validation_errors: list[str] = []

    # Handle streaming vs. non-streaming iteration
    if streaming:
        iterator: Iterator = iter(dataset)
    else:
        iterator = iter(dataset)

    for row_index, row in enumerate(iterator):
        # Check max instances limit
        if max_instances is not None and row_index >= max_instances:
            break

        try:
            if skip_validation:
                # Create instance without full validation
                instance = SWEBenchInstance.model_construct(**row)
            else:
                instance = _row_to_instance(dict(row), row_index)

            instances.append(instance)

        except DatasetValidationError as e:
            validation_errors.append(str(e))
            logger.warning(f"Validation error: {e}")

            # Continue processing other rows
            continue

    # Report validation summary
    if validation_errors:
        logger.warning(
            f"Encountered {len(validation_errors)} validation errors "
            f"while loading {len(instances)} instances"
        )

    if not instances:
        raise DatasetLoadError(
            f"No valid instances loaded from '{dataset_name}' (split: {split}). "
            f"Validation errors: {len(validation_errors)}"
        )

    logger.info(
        f"Successfully loaded {len(instances)} instances "
        f"from SWE-bench {benchmark_variant.value}"
    )

    return instances


def load_benchmark_iterator(
    variant: Union[str, BenchmarkVariant] = BenchmarkVariant.LITE,
    split: str = "test",
) -> Iterator[SWEBenchInstance]:
    """
    Load a SWE-bench benchmark dataset as a streaming iterator.

    This is more memory-efficient for large datasets as it doesn't load
    all instances into memory at once.

    Args:
        variant: Benchmark variant to load
        split: Dataset split to load

    Yields:
        Validated SWEBenchInstance objects one at a time

    Raises:
        DatasetLoadError: If dataset cannot be loaded
        DatasetValidationError: If instance validation fails

    Example:
        >>> from apps.backend.services.swebench.loader import load_benchmark_iterator
        >>> for instance in load_benchmark_iterator("lite"):
        ...     process(instance)
        ...     break  # Process just one for demo
    """
    try:
        from datasets import load_dataset
    except ImportError as e:
        raise DatasetLoadError(
            "HuggingFace datasets library not installed. "
            "Install with: pip install datasets"
        ) from e

    benchmark_variant = _normalize_variant(variant)
    dataset_name = VARIANT_DATASET_NAMES[benchmark_variant]

    logger.info(
        f"Streaming SWE-bench variant '{benchmark_variant.value}' "
        f"from '{dataset_name}' (split: {split})"
    )

    try:
        dataset = load_dataset(
            dataset_name,
            split=split,
            streaming=True,
            trust_remote_code=True,
        )
    except Exception as e:
        raise DatasetLoadError(
            f"Failed to load dataset '{dataset_name}' (split: {split}): {e}"
        ) from e

    for row_index, row in enumerate(dataset):
        yield _row_to_instance(dict(row), row_index)


def get_available_variants() -> list[dict]:
    """
    Get information about all available SWE-bench variants.

    Returns:
        List of dictionaries with variant information including:
        - name: Variant enum value
        - display_name: Human-readable name
        - dataset: HuggingFace dataset path
        - description: Brief description of the variant
    """
    variant_descriptions = {
        BenchmarkVariant.LITE: (
            "SWE-bench Lite",
            "300 curated instances for faster evaluation and testing"
        ),
        BenchmarkVariant.VERIFIED: (
            "SWE-bench Verified",
            "Human-verified subset with high-quality annotations"
        ),
        BenchmarkVariant.FULL: (
            "SWE-bench Full",
            "Complete SWE-bench dataset with 2,294 instances"
        ),
        BenchmarkVariant.MULTIMODAL: (
            "SWE-bench Multimodal",
            "Instances requiring image/visual understanding"
        ),
        BenchmarkVariant.MULTILINGUAL: (
            "SWE-bench Multilingual",
            "Instances from non-English repositories"
        ),
    }

    variants = []
    for variant in BenchmarkVariant:
        display_name, description = variant_descriptions.get(
            variant, (variant.value, "No description available")
        )
        variants.append({
            "name": variant.value,
            "display_name": display_name,
            "dataset": VARIANT_DATASET_NAMES[variant],
            "description": description,
        })

    return variants


def get_dataset_info(
    variant: Union[str, BenchmarkVariant] = BenchmarkVariant.LITE,
) -> dict:
    """
    Get metadata about a SWE-bench dataset without loading all instances.

    Args:
        variant: Benchmark variant to query

    Returns:
        Dictionary with dataset information including:
        - name: HuggingFace dataset name
        - variant: Variant enum value
        - splits: Available data splits
        - size: Approximate size information

    Raises:
        DatasetLoadError: If dataset info cannot be retrieved
    """
    try:
        from datasets import load_dataset_builder
    except ImportError as e:
        raise DatasetLoadError(
            "HuggingFace datasets library not installed. "
            "Install with: pip install datasets"
        ) from e

    benchmark_variant = _normalize_variant(variant)
    dataset_name = VARIANT_DATASET_NAMES[benchmark_variant]

    try:
        builder = load_dataset_builder(dataset_name, trust_remote_code=True)
        info = builder.info

        return {
            "name": dataset_name,
            "variant": benchmark_variant.value,
            "description": info.description or "No description available",
            "splits": (
                list(info.splits.keys()) if info.splits else ["test"]
            ),
            "features": (
                {k: str(v) for k, v in info.features.items()}
                if info.features else {}
            ),
            "size_in_bytes": info.size_in_bytes,
            "download_size": info.download_size,
        }
    except Exception as e:
        raise DatasetLoadError(
            f"Failed to get dataset info for '{dataset_name}': {e}"
        ) from e
