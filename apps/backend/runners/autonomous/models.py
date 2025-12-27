"""
Autonomous Mode Task Models
============================

Unified task models combining GitHub issues and roadmap features for autonomous task execution.
Includes priority scoring algorithm using complexity, impact, priority, and recency.

Usage:
    from runners.autonomous.models import (
        AutonomousTask,
        TaskSource,
        calculate_priority_score,
        create_task_from_github_issue,
        create_task_from_roadmap_feature,
    )

    # Create task from GitHub issue
    task = create_task_from_github_issue(github_issue, repository="owner/repo")

    # Create task from roadmap feature
    task = create_task_from_roadmap_feature(roadmap_feature)

    # Calculate priority score
    score = calculate_priority_score(
        complexity=3,
        impact=8,
        priority=7,
        created_at=datetime.now() - timedelta(days=5),
    )
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

# Configure logger
logger = logging.getLogger(__name__)


# ============================================
# Task Source Enum
# ============================================


class TaskSource(str, Enum):
    """
    Source type for autonomous tasks.
    Identifies where a task originated from.
    """

    GITHUB_ISSUE = "github_issue"
    ROADMAP_FEATURE = "roadmap_feature"


# ============================================
# Task Status Enum
# ============================================


class TaskStatus(str, Enum):
    """
    Status of an autonomous task in the queue.
    """

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


# ============================================
# Priority Level Enum
# ============================================


class PriorityLevel(str, Enum):
    """
    Priority level categories for quick classification.
    """

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# ============================================
# Priority Weights Configuration
# ============================================


@dataclass
class PriorityWeights:
    """
    Configurable weights for priority score calculation.

    The final score is calculated as:
        score = (complexity_weight * inverted_complexity)
               + (impact_weight * impact)
               + (priority_weight * priority)
               + (recency_weight * recency)

    Note: Complexity is inverted (10 - complexity) so simpler tasks
    can be prioritized for quick wins.
    """

    complexity_weight: float = 0.15
    impact_weight: float = 0.35
    priority_weight: float = 0.35
    recency_weight: float = 0.15

    def __post_init__(self):
        """Validate that weights sum to approximately 1.0."""
        total = (
            self.complexity_weight
            + self.impact_weight
            + self.priority_weight
            + self.recency_weight
        )
        if abs(total - 1.0) > 0.01:
            logger.warning(
                f"Priority weights sum to {total:.2f}, expected 1.0. "
                "Scores may be out of expected 0-10 range."
            )


# Default weights for priority calculation
DEFAULT_PRIORITY_WEIGHTS = PriorityWeights()


# ============================================
# Priority Score Calculation
# ============================================


def calculate_priority_score(
    complexity: int | float,
    impact: int | float,
    priority: int | float,
    created_at: datetime,
    weights: PriorityWeights | None = None,
    max_age_days: int = 90,
) -> float:
    """
    Calculate the priority score for a task using weighted formula.

    Score = (complexity_weight * inverted_complexity)
          + (impact_weight * impact)
          + (priority_weight * priority)
          + (recency_weight * recency)

    Where:
    - inverted_complexity = 10 - complexity (simpler tasks get higher score)
    - recency = age-based score where older items get boosted to prevent starvation

    Args:
        complexity: Task complexity score (1-10, lower = simpler)
        impact: Expected impact score (1-10, higher = more impactful)
        priority: Base priority level (1-10)
        created_at: When the task was created
        weights: Optional custom weights (defaults to DEFAULT_PRIORITY_WEIGHTS)
        max_age_days: Maximum age for recency scoring (items older than this get max score)

    Returns:
        Priority score (0-10, higher = higher priority)
    """
    if weights is None:
        weights = DEFAULT_PRIORITY_WEIGHTS

    # Clamp inputs to valid range
    complexity = max(1, min(10, complexity))
    impact = max(1, min(10, impact))
    priority = max(1, min(10, priority))

    # Invert complexity (simpler = higher score for quick wins)
    inverted_complexity = 10 - complexity + 1  # Range: 1-10

    # Calculate recency score (older items get higher score to prevent starvation)
    now = datetime.now(timezone.utc)
    created_at_utc = (
        created_at.replace(tzinfo=timezone.utc)
        if created_at.tzinfo is None
        else created_at
    )
    age_days = (now - created_at_utc).days
    age_ratio = min(1.0, age_days / max_age_days)
    recency = 1 + (age_ratio * 9)  # Range: 1-10

    # Calculate weighted score
    score = (
        weights.complexity_weight * inverted_complexity
        + weights.impact_weight * impact
        + weights.priority_weight * priority
        + weights.recency_weight * recency
    )

    # Round to 2 decimal places
    return round(score, 2)


def get_priority_level(score: float) -> PriorityLevel:
    """
    Convert numeric priority score to a priority level category.

    Args:
        score: Priority score (0-10)

    Returns:
        PriorityLevel enum value
    """
    if score >= 8.5:
        return PriorityLevel.CRITICAL
    elif score >= 6.5:
        return PriorityLevel.HIGH
    elif score >= 4.5:
        return PriorityLevel.MEDIUM
    else:
        return PriorityLevel.LOW


# ============================================
# Autonomous Task Dataclass
# ============================================


@dataclass
class AutonomousTask:
    """
    Unified task model combining GitHub issues and roadmap features.

    This dataclass provides a common format for tasks from different sources,
    enabling unified queue management and priority-based execution.

    Attributes:
        id: Unique task identifier (e.g., "github-123" or "feature-abc")
        source: Task source type (github_issue or roadmap_feature)
        title: Task title/summary
        description: Detailed task description
        priority_score: Calculated priority score (0-10)
        priority_level: Human-readable priority level
        dependencies: List of task IDs that must complete first
        status: Current execution status
        created_at: When the source was created
        updated_at: When the source was last updated
        external_id: External system ID (issue number or feature ID)
        external_url: URL back to external source
        metadata: Additional source-specific data
    """

    id: str
    source: TaskSource
    title: str
    description: str
    priority_score: float
    priority_level: PriorityLevel
    dependencies: list[str] = field(default_factory=list)
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    external_id: str | None = None
    external_url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    # Execution tracking fields
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    spec_id: str | None = None
    pull_request_url: str | None = None
    branch_name: str | None = None
    retry_count: int = 0
    max_retries: int = 2

    def calculate_priority(
        self,
        complexity: int | float = 5,
        impact: int | float = 5,
        priority: int | float = 5,
        weights: PriorityWeights | None = None,
    ) -> None:
        """
        Recalculate and update the priority score for this task.

        Args:
            complexity: Task complexity (1-10)
            impact: Expected impact (1-10)
            priority: Base priority level (1-10)
            weights: Optional custom weights
        """
        self.priority_score = calculate_priority_score(
            complexity=complexity,
            impact=impact,
            priority=priority,
            created_at=self.created_at,
            weights=weights,
        )
        self.priority_level = get_priority_level(self.priority_score)

    def mark_in_progress(self) -> None:
        """Mark this task as in-progress."""
        self.status = TaskStatus.IN_PROGRESS
        self.started_at = datetime.now(timezone.utc)

    def mark_completed(
        self,
        spec_id: str | None = None,
        pull_request_url: str | None = None,
    ) -> None:
        """
        Mark this task as completed.

        Args:
            spec_id: Generated spec ID (if any)
            pull_request_url: Created PR URL (if any)
        """
        self.status = TaskStatus.COMPLETED
        self.completed_at = datetime.now(timezone.utc)
        if spec_id:
            self.spec_id = spec_id
        if pull_request_url:
            self.pull_request_url = pull_request_url

    def mark_failed(self, error_message: str) -> None:
        """
        Mark this task as failed.

        Args:
            error_message: Error message describing the failure
        """
        self.status = TaskStatus.FAILED
        self.completed_at = datetime.now(timezone.utc)
        self.error_message = error_message
        self.retry_count += 1

    def can_retry(self) -> bool:
        """Check if this task can be retried."""
        return self.retry_count < self.max_retries

    def reset_for_retry(self) -> None:
        """Reset task status for retry attempt."""
        if not self.can_retry():
            raise ValueError(
                f"Task {self.id} has exceeded max retries ({self.max_retries})"
            )
        self.status = TaskStatus.PENDING
        self.started_at = None
        self.completed_at = None
        # Keep error_message and retry_count for tracking

    def has_unmet_dependencies(self, completed_task_ids: set[str]) -> bool:
        """
        Check if this task has unmet dependencies.

        Args:
            completed_task_ids: Set of completed task IDs

        Returns:
            True if task has dependencies that aren't completed
        """
        if not self.dependencies:
            return False
        return not all(dep in completed_task_ids for dep in self.dependencies)

    def get_duration_ms(self) -> int | None:
        """Get task execution duration in milliseconds."""
        if self.started_at is None:
            return None
        end_time = self.completed_at or datetime.now(timezone.utc)
        return int((end_time - self.started_at).total_seconds() * 1000)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "id": self.id,
            "source": self.source.value,
            "title": self.title,
            "description": self.description,
            "priority_score": self.priority_score,
            "priority_level": self.priority_level.value,
            "dependencies": self.dependencies,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "external_id": self.external_id,
            "external_url": self.external_url,
            "metadata": self.metadata,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error_message": self.error_message,
            "spec_id": self.spec_id,
            "pull_request_url": self.pull_request_url,
            "branch_name": self.branch_name,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AutonomousTask:
        """
        Create AutonomousTask from dictionary.

        Args:
            data: Dictionary representation of task

        Returns:
            AutonomousTask instance
        """

        def parse_datetime(value: str | None) -> datetime | None:
            if value is None:
                return None
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt

        return cls(
            id=data["id"],
            source=TaskSource(data["source"]),
            title=data["title"],
            description=data["description"],
            priority_score=data.get("priority_score", 5.0),
            priority_level=PriorityLevel(data.get("priority_level", "medium")),
            dependencies=data.get("dependencies", []),
            status=TaskStatus(data.get("status", "pending")),
            created_at=parse_datetime(data.get("created_at"))
            or datetime.now(timezone.utc),
            updated_at=parse_datetime(data.get("updated_at"))
            or datetime.now(timezone.utc),
            external_id=data.get("external_id"),
            external_url=data.get("external_url"),
            metadata=data.get("metadata", {}),
            started_at=parse_datetime(data.get("started_at")),
            completed_at=parse_datetime(data.get("completed_at")),
            error_message=data.get("error_message"),
            spec_id=data.get("spec_id"),
            pull_request_url=data.get("pull_request_url"),
            branch_name=data.get("branch_name"),
            retry_count=data.get("retry_count", 0),
            max_retries=data.get("max_retries", 2),
        )


# ============================================
# Factory Functions
# ============================================


def _get_complexity_score(complexity_str: str) -> int:
    """Convert complexity string to numeric score."""
    mapping = {
        "low": 3,
        "medium": 5,
        "high": 8,
    }
    return mapping.get(complexity_str.lower(), 5)


def _get_impact_score(impact_str: str) -> int:
    """Convert impact string to numeric score."""
    mapping = {
        "low": 3,
        "medium": 5,
        "high": 8,
    }
    return mapping.get(impact_str.lower(), 5)


def _get_priority_score_from_moscow(priority_str: str) -> int:
    """Convert MoSCoW priority to numeric score."""
    mapping = {
        "must": 10,
        "should": 7,
        "could": 4,
        "wont": 1,
    }
    return mapping.get(priority_str.lower(), 5)


def _get_priority_from_labels(labels: list[str]) -> int:
    """
    Derive priority score from GitHub issue labels.

    Looks for labels like 'priority:high', 'p1', 'critical', etc.
    """
    label_lower = [l.lower() for l in labels]

    # Check for priority labels
    for label in label_lower:
        if "critical" in label or "p0" in label or "urgent" in label:
            return 10
        if "priority:high" in label or "p1" in label or "high-priority" in label:
            return 8
        if "priority:medium" in label or "p2" in label:
            return 5
        if "priority:low" in label or "p3" in label or "low-priority" in label:
            return 3

    # Default to medium priority
    return 5


def create_task_from_github_issue(
    issue: Any,
    repository: str,
    weights: PriorityWeights | None = None,
) -> AutonomousTask:
    """
    Create an AutonomousTask from a GitHubIssue.

    Args:
        issue: GitHubIssue object from issue_fetcher
        repository: Repository in owner/repo format
        weights: Optional custom priority weights

    Returns:
        AutonomousTask instance
    """
    # Parse created_at timestamp
    created_at = datetime.now(timezone.utc)
    if hasattr(issue, "created_at") and issue.created_at:
        try:
            created_at = datetime.fromisoformat(
                issue.created_at.replace("Z", "+00:00")
            )
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            pass

    # Parse updated_at timestamp
    updated_at = datetime.now(timezone.utc)
    if hasattr(issue, "updated_at") and issue.updated_at:
        try:
            updated_at = datetime.fromisoformat(
                issue.updated_at.replace("Z", "+00:00")
            )
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)
        except (ValueError, AttributeError):
            pass

    # Extract priority from labels
    labels = getattr(issue, "labels", []) or []
    priority = _get_priority_from_labels(labels)

    # Default complexity and impact for GitHub issues (can be overridden by labels)
    complexity = 5
    impact = 5

    # Look for complexity/impact labels
    for label in labels:
        label_lower = label.lower()
        if "complexity:low" in label_lower or "size:small" in label_lower:
            complexity = 3
        elif "complexity:high" in label_lower or "size:large" in label_lower:
            complexity = 8
        if "impact:high" in label_lower:
            impact = 8
        elif "impact:low" in label_lower:
            impact = 3

    # Calculate priority score
    priority_score = calculate_priority_score(
        complexity=complexity,
        impact=impact,
        priority=priority,
        created_at=created_at,
        weights=weights,
    )

    issue_number = getattr(issue, "number", 0)
    issue_url = getattr(issue, "url", f"https://github.com/{repository}/issues/{issue_number}")

    return AutonomousTask(
        id=f"github-{issue_number}",
        source=TaskSource.GITHUB_ISSUE,
        title=getattr(issue, "title", "Untitled Issue"),
        description=getattr(issue, "body", "") or "",
        priority_score=priority_score,
        priority_level=get_priority_level(priority_score),
        dependencies=[],  # GitHub issues don't have explicit dependencies
        status=TaskStatus.PENDING,
        created_at=created_at,
        updated_at=updated_at,
        external_id=str(issue_number),
        external_url=issue_url,
        metadata={
            "repository": repository,
            "labels": labels,
            "author": getattr(issue, "author", ""),
            "state": getattr(issue, "state", "open"),
        },
    )


def create_task_from_roadmap_feature(
    feature: Any,
    roadmap_id: str = "default",
    weights: PriorityWeights | None = None,
) -> AutonomousTask:
    """
    Create an AutonomousTask from a RoadmapFeature.

    Args:
        feature: RoadmapFeature object from feature_fetcher
        roadmap_id: Roadmap identifier
        weights: Optional custom priority weights

    Returns:
        AutonomousTask instance
    """
    # Get scoring inputs from feature
    feature_id = getattr(feature, "id", "unknown")
    complexity_str = getattr(feature, "complexity", "medium")
    impact_str = getattr(feature, "impact", "medium")
    priority_str = getattr(feature, "priority", "should")

    # Convert string values to numeric scores
    complexity = _get_complexity_score(complexity_str)
    impact = _get_impact_score(impact_str)
    priority = _get_priority_score_from_moscow(priority_str)

    # Parse timestamps (use current time as fallback)
    now = datetime.now(timezone.utc)
    created_at = now
    updated_at = now

    # Calculate priority score
    priority_score = calculate_priority_score(
        complexity=complexity,
        impact=impact,
        priority=priority,
        created_at=created_at,
        weights=weights,
    )

    # Map feature dependencies to task IDs
    feature_deps = getattr(feature, "dependencies", []) or []
    task_dependencies = [f"feature-{dep}" for dep in feature_deps]

    return AutonomousTask(
        id=f"feature-{feature_id}",
        source=TaskSource.ROADMAP_FEATURE,
        title=getattr(feature, "title", "Untitled Feature"),
        description=getattr(feature, "description", "") or "",
        priority_score=priority_score,
        priority_level=get_priority_level(priority_score),
        dependencies=task_dependencies,
        status=TaskStatus.PENDING,
        created_at=created_at,
        updated_at=updated_at,
        external_id=feature_id,
        external_url=getattr(feature, "external_url", None),
        metadata={
            "roadmap_id": roadmap_id,
            "phase_id": getattr(feature, "phase_id", ""),
            "complexity": complexity_str,
            "impact": impact_str,
            "priority": priority_str,
            "rationale": getattr(feature, "rationale", ""),
            "acceptance_criteria": getattr(feature, "acceptance_criteria", []),
            "user_stories": getattr(feature, "user_stories", []),
            "linked_spec_id": getattr(feature, "linked_spec_id", None),
            "votes": getattr(feature, "votes", 0),
        },
    )


# ============================================
# Task Sorting Utilities
# ============================================


def sort_tasks_by_priority(
    tasks: list[AutonomousTask],
    completed_task_ids: set[str] | None = None,
) -> list[AutonomousTask]:
    """
    Sort tasks by priority, considering dependencies.

    Tasks with unmet dependencies are sorted to the end.

    Args:
        tasks: List of tasks to sort
        completed_task_ids: Set of completed task IDs for dependency checking

    Returns:
        Sorted list of tasks (highest priority first)
    """
    if completed_task_ids is None:
        completed_task_ids = set()

    def sort_key(task: AutonomousTask) -> tuple[int, float]:
        """
        Generate sort key.
        Returns (has_unmet_deps, -priority_score).
        Tasks with unmet deps get 1, ready tasks get 0.
        Within each group, higher priority (more negative) comes first.
        """
        has_unmet = 1 if task.has_unmet_dependencies(completed_task_ids) else 0
        return (has_unmet, -task.priority_score)

    return sorted(tasks, key=sort_key)


def get_ready_tasks(
    tasks: list[AutonomousTask],
    completed_task_ids: set[str] | None = None,
) -> list[AutonomousTask]:
    """
    Get tasks that are ready to execute (no unmet dependencies, pending status).

    Args:
        tasks: List of all tasks
        completed_task_ids: Set of completed task IDs

    Returns:
        List of tasks ready for execution, sorted by priority
    """
    if completed_task_ids is None:
        completed_task_ids = set()

    ready = [
        task
        for task in tasks
        if task.status == TaskStatus.PENDING
        and not task.has_unmet_dependencies(completed_task_ids)
    ]

    # Sort by priority (highest first)
    return sorted(ready, key=lambda t: -t.priority_score)


# ============================================
# CLI Testing
# ============================================


if __name__ == "__main__":
    # Test priority calculation
    print("Testing Priority Score Calculation")
    print("=" * 60)

    # Test cases
    test_cases = [
        {
            "name": "Simple high-impact task",
            "complexity": 2,
            "impact": 9,
            "priority": 8,
            "age_days": 1,
        },
        {
            "name": "Complex low-impact task",
            "complexity": 9,
            "impact": 3,
            "priority": 4,
            "age_days": 30,
        },
        {
            "name": "Medium balanced task",
            "complexity": 5,
            "impact": 5,
            "priority": 5,
            "age_days": 7,
        },
        {
            "name": "Old critical task",
            "complexity": 7,
            "impact": 10,
            "priority": 10,
            "age_days": 60,
        },
    ]

    for case in test_cases:
        created_at = datetime.now(timezone.utc) - timedelta(days=case["age_days"])
        score = calculate_priority_score(
            complexity=case["complexity"],
            impact=case["impact"],
            priority=case["priority"],
            created_at=created_at,
        )
        level = get_priority_level(score)
        print(f"\n{case['name']}:")
        print(f"  Complexity: {case['complexity']}, Impact: {case['impact']}, Priority: {case['priority']}")
        print(f"  Age: {case['age_days']} days")
        print(f"  Score: {score:.2f} ({level.value})")

    print("\n" + "=" * 60)
    print("Done!")
