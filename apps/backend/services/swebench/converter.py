"""
SWE-bench to Autoclaude Format Converter
=========================================

Converts SWE-bench benchmark instances to autoclaude task format.

This module provides functions to transform raw SWE-bench dataset instances
into the task format expected by the autoclaude execution pipeline.

Mapping:
    - instance_id → task_id
    - problem_statement → description
    - base_commit → git context
    - FAIL_TO_PASS/PASS_TO_PASS → test_criteria

Usage:
    from apps.backend.services.swebench.converter import convert_to_task

    instance = SWEBenchInstance(...)
    task = convert_to_task(instance)
"""

from typing import Optional, Union

from .models import (
    AutoclaudeTask,
    SWEBenchInstance,
    TestCriteria,
)


class ConversionError(Exception):
    """Raised when conversion from SWE-bench instance to autoclaude task fails."""

    pass


def convert_to_task(
    instance: Union[SWEBenchInstance, dict],
    repository_base_url: str = "https://github.com",
    include_hints: bool = True,
) -> AutoclaudeTask:
    """
    Convert a SWE-bench instance to autoclaude task format.

    Args:
        instance: A SWEBenchInstance or dict with SWE-bench instance data.
        repository_base_url: Base URL for repository (default: GitHub).
        include_hints: Whether to include hints_text in the task.

    Returns:
        AutoclaudeTask ready for execution by the autoclaude pipeline.

    Raises:
        ConversionError: If the instance cannot be converted.

    Example:
        >>> instance = SWEBenchInstance(
        ...     instance_id="django__django-12345",
        ...     repo="django/django",
        ...     problem_statement="Fix bug in QuerySet",
        ...     base_commit="abc123def456",
        ...     patch="...",
        ... )
        >>> task = convert_to_task(instance)
        >>> task.task_id
        'django__django-12345'
    """
    # Convert dict to SWEBenchInstance if needed
    if isinstance(instance, dict):
        try:
            instance = SWEBenchInstance(**instance)
        except Exception as e:
            raise ConversionError(f"Failed to parse instance data: {e}") from e

    try:
        # Build repository URL from repo path
        repository_url = _build_repository_url(instance.repo, repository_base_url)

        # Create test criteria from FAIL_TO_PASS and PASS_TO_PASS
        test_criteria = TestCriteria(
            fail_to_pass=instance.FAIL_TO_PASS,
            pass_to_pass=instance.PASS_TO_PASS,
        )

        # Build task description with context
        description = _build_task_description(instance)

        # Build metadata for tracking
        metadata = _build_metadata(instance)

        # Create the autoclaude task
        task = AutoclaudeTask(
            task_id=instance.instance_id,
            description=description,
            repository=repository_url,
            base_commit=instance.base_commit,
            test_criteria=test_criteria,
            hints=instance.hints_text if include_hints else None,
            metadata=metadata,
        )

        return task

    except Exception as e:
        raise ConversionError(
            f"Failed to convert instance '{instance.instance_id}': {e}"
        ) from e


def convert_batch(
    instances: list[Union[SWEBenchInstance, dict]],
    repository_base_url: str = "https://github.com",
    include_hints: bool = True,
    skip_errors: bool = False,
) -> tuple[list[AutoclaudeTask], list[tuple[str, Exception]]]:
    """
    Convert multiple SWE-bench instances to autoclaude tasks.

    Args:
        instances: List of SWEBenchInstance or dicts to convert.
        repository_base_url: Base URL for repositories.
        include_hints: Whether to include hints in tasks.
        skip_errors: If True, skip failed conversions instead of raising.

    Returns:
        Tuple of (converted tasks, list of (instance_id, error) for failures).

    Raises:
        ConversionError: If skip_errors is False and any conversion fails.

    Example:
        >>> instances = [instance1, instance2, instance3]
        >>> tasks, errors = convert_batch(instances, skip_errors=True)
        >>> len(tasks)
        3
    """
    tasks: list[AutoclaudeTask] = []
    errors: list[tuple[str, Exception]] = []

    for instance in instances:
        try:
            task = convert_to_task(
                instance,
                repository_base_url=repository_base_url,
                include_hints=include_hints,
            )
            tasks.append(task)
        except ConversionError as e:
            if skip_errors:
                # Extract instance_id for error tracking
                instance_id = _get_instance_id(instance)
                errors.append((instance_id, e))
            else:
                raise

    return tasks, errors


def _build_repository_url(repo: str, base_url: str) -> str:
    """
    Build full repository URL from repo path.

    Args:
        repo: Repository path (e.g., 'django/django')
        base_url: Base URL (e.g., 'https://github.com')

    Returns:
        Full repository URL.
    """
    # Clean up repo path
    repo = repo.strip("/")

    # Clean up base URL
    base_url = base_url.rstrip("/")

    return f"{base_url}/{repo}"


def _build_task_description(instance: SWEBenchInstance) -> str:
    """
    Build task description with context from SWE-bench instance.

    The description includes:
    - The original problem statement
    - Repository and version context
    - Test criteria summary

    Args:
        instance: The SWE-bench instance.

    Returns:
        Formatted task description.
    """
    parts = []

    # Add repository and version context
    version_info = f" (version: {instance.version})" if instance.version else ""
    parts.append(f"Repository: {instance.repo}{version_info}")
    parts.append("")

    # Add the problem statement
    parts.append("## Problem Statement")
    parts.append("")
    parts.append(instance.problem_statement)
    parts.append("")

    # Add test criteria summary
    num_fail_to_pass = len(instance.FAIL_TO_PASS)
    num_pass_to_pass = len(instance.PASS_TO_PASS)

    if num_fail_to_pass > 0 or num_pass_to_pass > 0:
        parts.append("## Test Criteria")
        parts.append("")
        if num_fail_to_pass > 0:
            parts.append(
                f"- {num_fail_to_pass} test(s) should change from FAIL to PASS"
            )
        if num_pass_to_pass > 0:
            parts.append(f"- {num_pass_to_pass} test(s) should remain PASS")
        parts.append("")

    return "\n".join(parts)


def _build_metadata(instance: SWEBenchInstance) -> dict:
    """
    Build metadata dictionary for tracking.

    Args:
        instance: The SWE-bench instance.

    Returns:
        Metadata dictionary with original instance fields.
    """
    metadata = {
        "source": "swebench",
        "original_repo": instance.repo,
        "original_instance_id": instance.instance_id,
    }

    # Include optional fields if present
    if instance.version:
        metadata["version"] = instance.version

    if instance.created_at:
        metadata["created_at"] = instance.created_at

    if instance.environment_setup_commit:
        metadata["environment_setup_commit"] = instance.environment_setup_commit

    return metadata


def _get_instance_id(instance: Union[SWEBenchInstance, dict]) -> str:
    """
    Extract instance_id from an instance or dict.

    Args:
        instance: SWEBenchInstance or dict.

    Returns:
        Instance ID or "unknown" if not found.
    """
    if isinstance(instance, SWEBenchInstance):
        return instance.instance_id
    elif isinstance(instance, dict):
        return instance.get("instance_id", "unknown")
    return "unknown"


def extract_repo_info(instance_id: str) -> Optional[tuple[str, str, str]]:
    """
    Extract repository information from instance_id.

    Args:
        instance_id: Instance ID in format 'owner__repo-pr_number'

    Returns:
        Tuple of (owner, repo, pr_number) or None if parsing fails.

    Example:
        >>> extract_repo_info("django__django-12345")
        ('django', 'django', '12345')
    """
    try:
        if "__" not in instance_id:
            return None

        owner, repo_pr = instance_id.split("__", 1)

        if "-" not in repo_pr:
            return None

        # Split from the right to handle repos with hyphens in their name
        parts = repo_pr.rsplit("-", 1)
        if len(parts) != 2:
            return None

        repo, pr_number = parts
        return (owner, repo, pr_number)

    except (ValueError, AttributeError):
        return None
