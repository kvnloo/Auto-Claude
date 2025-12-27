"""
GitHub Automation Runners
=========================

Standalone runner system for GitHub automation:
- PR Review: AI-powered code review with fix suggestions
- Issue Triage: Duplicate/spam/feature-creep detection
- Issue Auto-Fix: Automatic spec creation and execution from issues
- Issue Fetcher: Fetch issues for autonomous mode processing

This is SEPARATE from the main task execution pipeline (spec_runner, run.py, etc.)
to maintain modularity and avoid breaking existing features.
"""

from .issue_fetcher import (
    GitHubIssue,
    IssueFetcher,
    IssueFetchError,
    IssueLabelError,
    LABEL_COMPLETED,
    LABEL_FAILED,
    LABEL_IN_PROGRESS,
    LABEL_READY,
    fetch_ready_issues,
)
from .models import (
    AutoFixState,
    AutoFixStatus,
    GitHubRunnerConfig,
    PRReviewFinding,
    PRReviewResult,
    ReviewCategory,
    ReviewSeverity,
    TriageCategory,
    TriageResult,
)
from .orchestrator import GitHubOrchestrator

__all__ = [
    # Orchestrator
    "GitHubOrchestrator",
    # Issue Fetcher (Autonomous Mode)
    "IssueFetcher",
    "GitHubIssue",
    "IssueFetchError",
    "IssueLabelError",
    "fetch_ready_issues",
    "LABEL_READY",
    "LABEL_IN_PROGRESS",
    "LABEL_COMPLETED",
    "LABEL_FAILED",
    # Models
    "PRReviewResult",
    "PRReviewFinding",
    "TriageResult",
    "AutoFixState",
    "GitHubRunnerConfig",
    # Enums
    "ReviewSeverity",
    "ReviewCategory",
    "TriageCategory",
    "AutoFixStatus",
]
