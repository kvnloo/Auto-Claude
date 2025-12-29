"""
Pydantic Models for SWE-bench Data Schemas
===========================================

These models define the data structures for SWE-bench benchmark instances
and prediction outputs. Used for validation and transformation between
SWE-bench and autoclaude formats.

SWE-bench Instance Format (from HuggingFace dataset):
    {
        "instance_id": "owner__repo-pr_number",  # Double underscore separator
        "problem_statement": "GitHub issue description text",
        "base_commit": "abc123...",
        "FAIL_TO_PASS": ["test_module::test_name"],
        "PASS_TO_PASS": ["test_module::test_name"],
        "test_patch": "diff content..."  # DO NOT use when solving
    }

Prediction Output Format (JSONL):
    {"instance_id": "owner__repo-123", "model_patch": "diff content...", "model_name_or_path": "autoclaude"}

Usage:
    from swebench.models import SWEBenchInstance, SWEBenchPrediction

    # Parse instance from HuggingFace dataset
    instance = SWEBenchInstance.model_validate(dataset[0])

    # Create prediction output
    prediction = SWEBenchPrediction(
        instance_id=instance.instance_id,
        model_patch="...",
        model_name_or_path="autoclaude"
    )
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


# =============================================================================
# SWE-bench Instance Schema
# =============================================================================


class SWEBenchInstance(BaseModel):
    """A single SWE-bench benchmark instance from the HuggingFace dataset.

    The instance_id format is "owner__repo-issue_number" where the double
    underscore separates the owner from the repo name.

    IMPORTANT: The test_patch field exists in the dataset but should NOT be
    used when generating solutions - it's for evaluation only.
    """

    model_config = ConfigDict(populate_by_name=True)

    instance_id: str = Field(
        description="Unique instance identifier in format 'owner__repo-issue_number'"
    )
    problem_statement: str = Field(
        description="GitHub issue description text describing the problem to solve"
    )
    base_commit: str = Field(
        description="Git commit hash to check out before applying the patch"
    )
    fail_to_pass: list[str] = Field(
        alias="FAIL_TO_PASS",
        default_factory=list,
        description="Test cases that must pass after the fix is applied",
    )
    pass_to_pass: list[str] = Field(
        alias="PASS_TO_PASS",
        default_factory=list,
        description="Test cases that must remain passing (regression prevention)",
    )
    test_patch: str = Field(
        default="",
        description="Diff content for test changes - DO NOT use when solving",
    )
    repo: str = Field(
        default="",
        description="Repository name in format 'owner/repo' (extracted from instance_id)",
    )
    version: str = Field(
        default="",
        description="Version string if available",
    )
    hints_text: str = Field(
        default="",
        description="Optional hints about how to solve the issue",
    )
    created_at: str = Field(
        default="",
        description="Timestamp when the issue was created",
    )
    patch: str = Field(
        default="",
        description="Gold patch solution (only available in some dataset variants)",
    )
    environment_setup_commit: str = Field(
        default="",
        description="Commit hash for environment setup if different from base_commit",
    )

    @field_validator("instance_id")
    @classmethod
    def validate_instance_id_format(cls, v: str) -> str:
        """Validate that instance_id follows the expected format.

        Format: owner__repo-issue_number (double underscore between owner and repo)
        """
        if not v:
            raise ValueError("instance_id cannot be empty")

        # Pattern: owner__repo-number (double underscore is critical)
        pattern = r"^[\w\-\.]+__[\w\-\.]+-\d+$"
        if not re.match(pattern, v):
            # Some instances may have different formats, log warning but don't fail
            pass
        return v

    @model_validator(mode="after")
    def extract_repo_from_instance_id(self) -> "SWEBenchInstance":
        """Extract repository information from instance_id if repo field is empty."""
        if not self.repo and self.instance_id:
            # Parse owner__repo-issue format
            if "__" in self.instance_id:
                parts = self.instance_id.rsplit("-", 1)
                if len(parts) == 2:
                    owner_repo = parts[0]
                    self.repo = owner_repo.replace("__", "/")
        return self

    def get_owner(self) -> str:
        """Extract owner from instance_id."""
        if "__" in self.instance_id:
            return self.instance_id.split("__")[0]
        return ""

    def get_repo_name(self) -> str:
        """Extract repository name (without owner) from instance_id."""
        if "__" in self.instance_id:
            parts = self.instance_id.split("__")
            if len(parts) >= 2:
                # Remove issue number suffix
                repo_with_issue = parts[1]
                repo_parts = repo_with_issue.rsplit("-", 1)
                if len(repo_parts) >= 1:
                    return repo_parts[0]
        return ""

    def get_issue_number(self) -> int | None:
        """Extract issue/PR number from instance_id."""
        if "-" in self.instance_id:
            parts = self.instance_id.rsplit("-", 1)
            if len(parts) == 2:
                try:
                    return int(parts[1])
                except ValueError:
                    return None
        return None


# =============================================================================
# SWE-bench Prediction Schema
# =============================================================================


class SWEBenchPrediction(BaseModel):
    """A prediction output for SWE-bench evaluation.

    This is the format expected by the SWE-bench evaluation harness.
    Each prediction is written as a single JSON line in predictions.jsonl.
    """

    instance_id: str = Field(
        description="Instance identifier matching the input instance"
    )
    model_patch: str = Field(
        description="Git diff patch generated by the model to solve the issue"
    )
    model_name_or_path: str = Field(
        default="autoclaude",
        description="Name of the model that generated this prediction",
    )


# =============================================================================
# Evaluation Result Tracking
# =============================================================================


class InstanceResult(BaseModel):
    """Result for a single instance evaluation."""

    instance_id: str = Field(description="Instance identifier")
    status: Literal["pending", "running", "success", "failed", "error", "skipped"] = (
        Field(default="pending", description="Evaluation status")
    )
    model_patch: str | None = Field(
        default=None, description="Generated patch if successful"
    )
    error_message: str | None = Field(
        default=None, description="Error message if failed"
    )
    execution_time_seconds: float | None = Field(
        default=None, description="Time taken to process this instance"
    )
    tests_passed: int | None = Field(
        default=None, description="Number of FAIL_TO_PASS tests that now pass"
    )
    tests_total: int | None = Field(
        default=None, description="Total number of FAIL_TO_PASS tests"
    )
    regression_tests_passed: int | None = Field(
        default=None, description="Number of PASS_TO_PASS tests still passing"
    )
    regression_tests_total: int | None = Field(
        default=None, description="Total number of PASS_TO_PASS tests"
    )


class EvaluationMetrics(BaseModel):
    """Aggregated metrics for a benchmark evaluation run."""

    total_instances: int = Field(description="Total number of instances in the run")
    completed_instances: int = Field(
        default=0, description="Number of instances processed"
    )
    successful_instances: int = Field(
        default=0, description="Number of instances with successful patches"
    )
    failed_instances: int = Field(
        default=0, description="Number of instances that failed"
    )
    error_instances: int = Field(
        default=0, description="Number of instances with errors"
    )
    skipped_instances: int = Field(
        default=0, description="Number of instances skipped"
    )
    resolution_rate: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Percentage of instances successfully resolved (0.0-1.0)",
    )
    total_execution_time_seconds: float = Field(
        default=0.0, description="Total execution time across all instances"
    )
    average_execution_time_seconds: float = Field(
        default=0.0, description="Average execution time per instance"
    )

    @model_validator(mode="after")
    def calculate_resolution_rate(self) -> "EvaluationMetrics":
        """Calculate resolution rate from successful/total instances."""
        if self.completed_instances > 0:
            self.resolution_rate = self.successful_instances / self.completed_instances
        if self.completed_instances > 0 and self.total_execution_time_seconds > 0:
            self.average_execution_time_seconds = (
                self.total_execution_time_seconds / self.completed_instances
            )
        return self
