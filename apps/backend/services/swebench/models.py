"""
SWE-bench Data Models
=====================

Pydantic models for SWE-bench benchmark data validation and conversion.

This module defines the core data structures used throughout the SWE-bench
integration layer, including:

- SWEBenchInstance: Raw instance from SWE-bench dataset
- AutoclaudeTask: Converted task format for autoclaude execution
- PredictionEntry: JSONL prediction output format
- BenchmarkResult: Evaluation results and metrics
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class BenchmarkVariant(str, Enum):
    """Available SWE-bench benchmark variants."""

    LITE = "lite"
    VERIFIED = "verified"
    FULL = "full"
    MULTIMODAL = "multimodal"
    MULTILINGUAL = "multilingual"


# Dataset names mapping for HuggingFace Hub
VARIANT_DATASET_NAMES: dict[BenchmarkVariant, str] = {
    BenchmarkVariant.LITE: "princeton-nlp/SWE-bench_Lite",
    BenchmarkVariant.VERIFIED: "princeton-nlp/SWE-bench_Verified",
    BenchmarkVariant.FULL: "princeton-nlp/SWE-bench",
    BenchmarkVariant.MULTIMODAL: "princeton-nlp/SWE-bench_Multimodal",
    BenchmarkVariant.MULTILINGUAL: "princeton-nlp/SWE-bench_Multilingual",
}


class SWEBenchInstance(BaseModel):
    """
    A single SWE-bench benchmark instance.

    This model represents an instance loaded from the SWE-bench dataset.
    The instance_id format should follow: owner__repo-pr_number (e.g., 'django__django-12345').

    Attributes:
        instance_id: Unique identifier in format 'owner__repo-pr_number'
        repo: Repository path (e.g., 'django/django')
        problem_statement: Issue description to solve
        base_commit: Git commit hash to checkout before applying patch
        patch: Gold solution patch (should not be viewed during task execution)
        test_patch: Patch containing test modifications
        FAIL_TO_PASS: List of test identifiers that should change from failing to passing
        PASS_TO_PASS: List of test identifiers that should remain passing
        hints_text: Optional hints for solving the issue
        created_at: When the issue was created
        version: Repository version tag if applicable
        environment_setup_commit: Optional commit for environment setup
    """

    instance_id: str = Field(
        ...,
        description="Unique identifier in format 'owner__repo-pr_number'",
        examples=["django__django-12345", "astropy__astropy-6789"],
    )
    repo: str = Field(
        ...,
        description="Repository path (e.g., 'django/django')",
        examples=["django/django", "astropy/astropy"],
    )
    problem_statement: str = Field(
        ...,
        description="Issue description to solve",
    )
    base_commit: str = Field(
        ...,
        description="Git commit hash to checkout before applying patch",
    )
    patch: str = Field(
        ...,
        description="Gold solution patch - do not view during task execution",
    )
    test_patch: str = Field(
        default="",
        description="Patch containing test modifications",
    )
    FAIL_TO_PASS: list[str] = Field(
        default_factory=list,
        description="Test identifiers that should change from failing to passing",
    )
    PASS_TO_PASS: list[str] = Field(
        default_factory=list,
        description="Test identifiers that should remain passing",
    )
    hints_text: Optional[str] = Field(
        default=None,
        description="Optional hints for solving the issue",
    )
    created_at: Optional[str] = Field(
        default=None,
        description="When the issue was created",
    )
    version: Optional[str] = Field(
        default=None,
        description="Repository version tag if applicable",
    )
    environment_setup_commit: Optional[str] = Field(
        default=None,
        description="Optional commit for environment setup",
    )

    @field_validator("instance_id")
    @classmethod
    def validate_instance_id_format(cls, v: str) -> str:
        """Validate instance_id follows owner__repo-pr_number pattern."""
        if not v:
            raise ValueError("instance_id cannot be empty")

        # Check for double underscore separator
        if "__" not in v:
            raise ValueError(
                f"instance_id must contain '__' separator: got '{v}'. "
                "Expected format: 'owner__repo-pr_number'"
            )

        parts = v.split("__")
        if len(parts) != 2:
            raise ValueError(
                f"instance_id must have exactly one '__' separator: got '{v}'"
            )

        owner, repo_pr = parts
        if not owner:
            raise ValueError("instance_id owner part cannot be empty")

        # Check for hyphen separator between repo and pr number
        if "-" not in repo_pr:
            raise ValueError(
                f"instance_id repo-pr part must contain '-' separator: got '{repo_pr}'. "
                "Expected format: 'owner__repo-pr_number'"
            )

        return v

    @field_validator("base_commit")
    @classmethod
    def validate_commit_hash(cls, v: str) -> str:
        """Validate base_commit looks like a git commit hash."""
        if not v:
            raise ValueError("base_commit cannot be empty")

        # Git hashes are hexadecimal, typically 40 chars (full) or 7+ chars (short)
        if len(v) < 7:
            raise ValueError(
                f"base_commit appears too short for a git hash: got '{v}'"
            )

        # Allow alphanumeric for abbreviated hashes
        if not all(c in "0123456789abcdefABCDEF" for c in v):
            raise ValueError(
                f"base_commit must be a valid git hash (hexadecimal): got '{v}'"
            )

        return v


class AutoclaudeTask(BaseModel):
    """
    Task format for autoclaude execution.

    This model represents a converted SWE-bench instance ready for
    execution by the autoclaude pipeline.

    Attributes:
        task_id: Unique task identifier (from instance_id)
        description: Task description (from problem_statement)
        repository: Repository URL or path to clone
        base_commit: Git commit to checkout
        test_criteria: Tests to validate the solution
        hints: Optional hints for the task
        metadata: Additional metadata for tracking
    """

    task_id: str = Field(
        ...,
        description="Unique task identifier (derived from instance_id)",
    )
    description: str = Field(
        ...,
        description="Task description for autoclaude",
    )
    repository: str = Field(
        ...,
        description="Repository URL or path",
    )
    base_commit: str = Field(
        ...,
        description="Git commit to checkout",
    )
    test_criteria: "TestCriteria" = Field(
        ...,
        description="Tests to validate the solution",
    )
    hints: Optional[str] = Field(
        default=None,
        description="Optional hints for the task",
    )
    metadata: dict = Field(
        default_factory=dict,
        description="Additional metadata for tracking",
    )


class TestCriteria(BaseModel):
    """
    Test validation criteria for a task.

    Defines which tests should pass or fail after applying the solution.
    """

    fail_to_pass: list[str] = Field(
        default_factory=list,
        description="Tests that should change from failing to passing",
    )
    pass_to_pass: list[str] = Field(
        default_factory=list,
        description="Tests that should remain passing",
    )

    @property
    def total_tests(self) -> int:
        """Total number of tests to validate."""
        return len(self.fail_to_pass) + len(self.pass_to_pass)


class PredictionEntry(BaseModel):
    """
    SWE-bench JSONL prediction format.

    This is the output format required by the SWE-bench evaluation harness.
    Each entry represents a model's prediction for a single instance.

    Attributes:
        instance_id: The instance this prediction is for
        model_name_or_path: Model identifier (always 'autoclaude' for our predictions)
        model_patch: The generated patch/solution
    """

    instance_id: str = Field(
        ...,
        description="The instance this prediction is for",
    )
    model_name_or_path: str = Field(
        default="autoclaude",
        description="Model identifier",
    )
    model_patch: str = Field(
        ...,
        description="The generated patch/solution in git diff format",
    )


class ExecutionStatus(str, Enum):
    """Status of benchmark execution."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class InstanceResult(BaseModel):
    """
    Result of executing a single benchmark instance.

    Tracks the outcome of running autoclaude on a single SWE-bench instance.
    """

    instance_id: str = Field(
        ...,
        description="The instance this result is for",
    )
    status: ExecutionStatus = Field(
        default=ExecutionStatus.PENDING,
        description="Current execution status",
    )
    model_patch: Optional[str] = Field(
        default=None,
        description="Generated patch (if successful)",
    )
    error_message: Optional[str] = Field(
        default=None,
        description="Error message (if failed)",
    )
    execution_time_seconds: Optional[float] = Field(
        default=None,
        description="Time taken to execute in seconds",
    )
    started_at: Optional[datetime] = Field(
        default=None,
        description="When execution started",
    )
    completed_at: Optional[datetime] = Field(
        default=None,
        description="When execution completed",
    )


class BenchmarkResult(BaseModel):
    """
    Complete results for a benchmark run.

    Contains aggregated metrics and individual instance results.

    Attributes:
        run_id: Unique identifier for this benchmark run
        variant: Which benchmark variant was run
        total_instances: Total number of instances attempted
        completed_instances: Number of instances completed
        resolve_rate: Percentage of instances successfully resolved
        instance_results: Individual results per instance
        started_at: When the benchmark run started
        completed_at: When the benchmark run completed
        metadata: Additional metadata about the run
    """

    run_id: str = Field(
        ...,
        description="Unique identifier for this benchmark run",
    )
    variant: BenchmarkVariant = Field(
        ...,
        description="Which benchmark variant was run",
    )
    total_instances: int = Field(
        ...,
        ge=0,
        description="Total number of instances attempted",
    )
    completed_instances: int = Field(
        default=0,
        ge=0,
        description="Number of instances completed",
    )
    resolve_rate: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=100.0,
        description="Percentage of instances successfully resolved (0-100)",
    )
    instance_results: list[InstanceResult] = Field(
        default_factory=list,
        description="Individual results per instance",
    )
    started_at: Optional[datetime] = Field(
        default=None,
        description="When the benchmark run started",
    )
    completed_at: Optional[datetime] = Field(
        default=None,
        description="When the benchmark run completed",
    )
    metadata: dict = Field(
        default_factory=dict,
        description="Additional metadata about the run",
    )

    @property
    def is_complete(self) -> bool:
        """Check if the benchmark run is complete."""
        return self.completed_instances == self.total_instances

    @property
    def success_count(self) -> int:
        """Count of successfully completed instances."""
        return sum(
            1 for r in self.instance_results
            if r.status == ExecutionStatus.COMPLETED and r.model_patch
        )

    @property
    def failure_count(self) -> int:
        """Count of failed instances."""
        return sum(
            1 for r in self.instance_results
            if r.status == ExecutionStatus.FAILED
        )


class HealthCheckResult(BaseModel):
    """
    Result of an infrastructure health check.

    Used to validate system requirements before running benchmarks.
    """

    check_name: str = Field(
        ...,
        description="Name of the health check",
    )
    passed: bool = Field(
        ...,
        description="Whether the check passed",
    )
    message: str = Field(
        ...,
        description="Human-readable result message",
    )
    details: dict = Field(
        default_factory=dict,
        description="Additional details about the check",
    )


class InfrastructureStatus(BaseModel):
    """
    Complete infrastructure status for benchmark execution.

    Aggregates all health checks into a single status report.
    """

    docker_available: HealthCheckResult = Field(
        ...,
        description="Docker daemon availability check",
    )
    disk_space: HealthCheckResult = Field(
        ...,
        description="Disk space availability check",
    )
    cpu_cores: HealthCheckResult = Field(
        ...,
        description="CPU core count check",
    )
    architecture: HealthCheckResult = Field(
        ...,
        description="System architecture check (x86_64 vs ARM)",
    )

    @property
    def all_passed(self) -> bool:
        """Check if all infrastructure requirements are met."""
        return all([
            self.docker_available.passed,
            self.disk_space.passed,
            self.cpu_cores.passed,
            # Architecture is a warning, not a blocker
        ])

    @property
    def warnings(self) -> list[str]:
        """Get list of warning messages."""
        warnings = []
        if not self.architecture.passed:
            warnings.append(self.architecture.message)
        return warnings

    @property
    def errors(self) -> list[str]:
        """Get list of error messages for failed checks."""
        errors = []
        if not self.docker_available.passed:
            errors.append(self.docker_available.message)
        if not self.disk_space.passed:
            errors.append(self.disk_space.message)
        if not self.cpu_cores.passed:
            errors.append(self.cpu_cores.message)
        return errors
