"""
SWE-bench Instance Adapter
==========================

Transforms SWE-bench dataset instances into autoclaude specification format.

This adapter takes a SWE-bench instance (containing problem_statement, base_commit,
repository info, etc.) and converts it into the format expected by autoclaude's
SpecOrchestrator for evaluation.

IMPORTANT: The test_patch field from SWE-bench instances is intentionally excluded
from the output spec, as it should NOT be used when generating solutions - it's
for evaluation only.

Usage:
    from swebench.adapters.instance_adapter import convert_to_autoclaude_spec
    from swebench.models import SWEBenchInstance

    instance = SWEBenchInstance.model_validate(dataset[0])
    spec = convert_to_autoclaude_spec(instance)
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from swebench.models import SWEBenchInstance


class AutoClaudeSpec(BaseModel):
    """Autoclaude specification format for a task.

    This represents the minimal specification that autoclaude's SpecOrchestrator
    needs to process a task. It mirrors the structure of requirements.json used
    in the spec creation pipeline.
    """

    # Core task information
    task_description: str = Field(
        description="The problem statement describing what needs to be fixed/implemented"
    )
    workflow_type: str = Field(
        default="bugfix",
        description="Type of work: bugfix, feature, refactor, etc.",
    )

    # Repository context
    repo: str = Field(
        default="",
        description="Repository in format 'owner/repo'",
    )
    base_commit: str = Field(
        default="",
        description="Git commit hash to check out before applying changes",
    )

    # SWE-bench specific metadata
    instance_id: str = Field(
        default="",
        description="Original SWE-bench instance identifier",
    )

    # Test context (for validation, not for solving)
    fail_to_pass_tests: list[str] = Field(
        default_factory=list,
        description="Tests that must pass after the fix (success criteria)",
    )
    pass_to_pass_tests: list[str] = Field(
        default_factory=list,
        description="Tests that must remain passing (regression prevention)",
    )

    # Additional context
    hints_text: str = Field(
        default="",
        description="Optional hints about how to solve the issue",
    )
    version: str = Field(
        default="",
        description="Version string if available",
    )

    # Metadata
    created_at: str = Field(
        default_factory=lambda: datetime.now().isoformat(),
        description="Timestamp when this spec was created",
    )
    source: str = Field(
        default="swebench",
        description="Source of this specification (swebench adapter)",
    )


def convert_to_autoclaude_spec(
    instance: SWEBenchInstance,
    *,
    include_hints: bool = True,
    include_test_info: bool = False,
) -> AutoClaudeSpec:
    """Convert a SWE-bench instance to autoclaude specification format.

    This function transforms the SWE-bench data format into the format expected
    by autoclaude's SpecOrchestrator. The problem_statement becomes the task
    description, and repository information is preserved for context.

    IMPORTANT: The test_patch field is intentionally NOT included in the output
    as it should not be available during solution generation.

    Args:
        instance: A validated SWEBenchInstance from the HuggingFace dataset
        include_hints: Whether to include hints_text in the spec (default: True)
        include_test_info: Whether to include test names for reference (default: False).
                          When True, test names are included but should only be used
                          for validation, not for generating solutions.

    Returns:
        AutoClaudeSpec containing the transformed data ready for SpecOrchestrator

    Example:
        >>> from swebench.models import SWEBenchInstance
        >>> instance = SWEBenchInstance(
        ...     instance_id="django__django-12345",
        ...     problem_statement="Fix the bug in the admin panel",
        ...     base_commit="abc123",
        ... )
        >>> spec = convert_to_autoclaude_spec(instance)
        >>> spec.task_description
        'Fix the bug in the admin panel'
        >>> spec.repo
        'django/django'
    """
    # Build the task description with context
    task_description = _build_task_description(instance)

    # Create the spec
    spec = AutoClaudeSpec(
        task_description=task_description,
        workflow_type="bugfix",  # SWE-bench tasks are primarily bug fixes
        repo=instance.repo,
        base_commit=instance.base_commit,
        instance_id=instance.instance_id,
        hints_text=instance.hints_text if include_hints else "",
        version=instance.version,
    )

    # Optionally include test information for reference
    if include_test_info:
        spec.fail_to_pass_tests = instance.fail_to_pass.copy()
        spec.pass_to_pass_tests = instance.pass_to_pass.copy()

    return spec


def _build_task_description(instance: SWEBenchInstance) -> str:
    """Build a comprehensive task description from the SWE-bench instance.

    Combines the problem statement with repository context to give the
    SpecOrchestrator sufficient information to understand the task.

    Args:
        instance: The SWE-bench instance

    Returns:
        Formatted task description string
    """
    parts = []

    # Add repository context header
    if instance.repo:
        issue_num = instance.get_issue_number()
        if issue_num:
            parts.append(f"[{instance.repo}#{issue_num}]")
        else:
            parts.append(f"[{instance.repo}]")
        parts.append("")

    # Add the main problem statement
    parts.append(instance.problem_statement.strip())

    return "\n".join(parts)


def save_spec_to_directory(
    spec: AutoClaudeSpec,
    spec_dir: Path,
    *,
    overwrite: bool = False,
) -> Path:
    """Save an AutoClaudeSpec to a spec directory as requirements.json.

    This creates the minimal file structure needed for the SpecOrchestrator
    to process the task. The requirements.json file is the primary input.

    Args:
        spec: The AutoClaudeSpec to save
        spec_dir: Directory to save the spec files to
        overwrite: Whether to overwrite existing files (default: False)

    Returns:
        Path to the created requirements.json file

    Raises:
        FileExistsError: If requirements.json exists and overwrite=False
    """
    spec_dir = Path(spec_dir)
    spec_dir.mkdir(parents=True, exist_ok=True)

    requirements_file = spec_dir / "requirements.json"

    if requirements_file.exists() and not overwrite:
        raise FileExistsError(
            f"Requirements file already exists: {requirements_file}. "
            "Use overwrite=True to replace."
        )

    # Create requirements.json in the format expected by autoclaude
    requirements_data = {
        "task_description": spec.task_description,
        "workflow_type": spec.workflow_type,
        "services_involved": [],  # Will be discovered by autoclaude
        "created_at": spec.created_at,
        # SWE-bench specific metadata
        "swebench_metadata": {
            "instance_id": spec.instance_id,
            "repo": spec.repo,
            "base_commit": spec.base_commit,
            "version": spec.version,
            "hints_text": spec.hints_text,
            "fail_to_pass_tests": spec.fail_to_pass_tests,
            "pass_to_pass_tests": spec.pass_to_pass_tests,
            "source": spec.source,
        },
    }

    with open(requirements_file, "w") as f:
        json.dump(requirements_data, f, indent=2)

    return requirements_file


def load_spec_from_directory(spec_dir: Path) -> AutoClaudeSpec | None:
    """Load an AutoClaudeSpec from a spec directory.

    Reads the requirements.json file and extracts the spec data,
    including any SWE-bench specific metadata.

    Args:
        spec_dir: Directory containing the spec files

    Returns:
        AutoClaudeSpec if requirements.json exists and is valid, None otherwise
    """
    requirements_file = Path(spec_dir) / "requirements.json"

    if not requirements_file.exists():
        return None

    with open(requirements_file) as f:
        data = json.load(f)

    # Extract SWE-bench metadata if present
    swebench_meta = data.get("swebench_metadata", {})

    return AutoClaudeSpec(
        task_description=data.get("task_description", ""),
        workflow_type=data.get("workflow_type", "bugfix"),
        repo=swebench_meta.get("repo", ""),
        base_commit=swebench_meta.get("base_commit", ""),
        instance_id=swebench_meta.get("instance_id", ""),
        hints_text=swebench_meta.get("hints_text", ""),
        version=swebench_meta.get("version", ""),
        fail_to_pass_tests=swebench_meta.get("fail_to_pass_tests", []),
        pass_to_pass_tests=swebench_meta.get("pass_to_pass_tests", []),
        created_at=data.get("created_at", datetime.now().isoformat()),
        source=swebench_meta.get("source", "swebench"),
    )
