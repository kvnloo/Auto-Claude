"""
Historical Completion Tracker Module
======================================

Tracks historical task completion data to improve time estimation accuracy
over time. Records actual completion times and calculates estimation accuracy.
"""

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from spec.complexity import Complexity


@dataclass
class CompletionRecord:
    """
    Represents a single historical task completion record.

    Tracks the estimated vs actual completion time, complexity level,
    and accuracy metrics for improving future estimates.
    """

    # Task identification
    task_id: str  # Unique identifier for the task/spec
    task_description: str  # Brief description of what was completed

    # Complexity information
    complexity: Complexity  # Task complexity level

    # Time tracking
    estimated_minutes: float  # Original time estimate
    actual_minutes: float  # Actual time taken to complete

    # Accuracy metrics
    accuracy_ratio: float  # actual / estimated (1.0 = perfect estimate)
    estimation_error: float  # Percentage error ((actual - estimated) / estimated)

    # Metadata
    completed_at: str  # ISO format timestamp
    services_involved: list[str] = field(default_factory=list)  # Services touched
    files_modified: int = 0  # Number of files changed
    external_integrations: list[str] = field(default_factory=list)  # Integrations used

    def to_dict(self) -> dict:
        """Convert completion record to dictionary representation."""
        return {
            "task_id": self.task_id,
            "task_description": self.task_description,
            "complexity": self.complexity.value,
            "estimated_minutes": self.estimated_minutes,
            "actual_minutes": self.actual_minutes,
            "accuracy_ratio": self.accuracy_ratio,
            "estimation_error": self.estimation_error,
            "completed_at": self.completed_at,
            "services_involved": self.services_involved,
            "files_modified": self.files_modified,
            "external_integrations": self.external_integrations,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "CompletionRecord":
        """Create CompletionRecord from dictionary."""
        return cls(
            task_id=data["task_id"],
            task_description=data["task_description"],
            complexity=Complexity(data["complexity"]),
            estimated_minutes=data["estimated_minutes"],
            actual_minutes=data["actual_minutes"],
            accuracy_ratio=data["accuracy_ratio"],
            estimation_error=data["estimation_error"],
            completed_at=data["completed_at"],
            services_involved=data.get("services_involved", []),
            files_modified=data.get("files_modified", 0),
            external_integrations=data.get("external_integrations", []),
        )


class HistoricalTracker:
    """
    Manages historical completion data for time estimation improvement.

    Stores completion records in a JSON file and provides methods to:
    - Record new task completions
    - Calculate estimation accuracy
    - Retrieve historical data for specific complexity levels
    - Generate accuracy metrics and insights
    """

    def __init__(self, data_file: Optional[Path] = None):
        """
        Initialize historical tracker.

        Args:
            data_file: Path to JSON file for storing historical data.
                      Defaults to .auto-claude/estimation_data.json
        """
        if data_file is None:
            # Default to project-level data file
            data_file = Path.cwd() / ".auto-claude" / "estimation_data.json"

        self.data_file = Path(data_file)
        self.records: list[CompletionRecord] = []

        # Ensure directory exists
        self.data_file.parent.mkdir(parents=True, exist_ok=True)

    def get_records_by_complexity(self, complexity: Complexity) -> list[CompletionRecord]:
        """
        Retrieve all completion records for a specific complexity level.

        Args:
            complexity: Complexity level to filter by

        Returns:
            List of CompletionRecord instances matching the complexity level
        """
        return [r for r in self.records if r.complexity == complexity]

    def get_average_accuracy(self, complexity: Optional[Complexity] = None) -> float:
        """
        Calculate average estimation accuracy.

        Args:
            complexity: Optional complexity level to filter by.
                       If None, calculates across all records.

        Returns:
            Average accuracy ratio (1.0 = perfect estimates on average)
        """
        if complexity:
            records = self.get_records_by_complexity(complexity)
        else:
            records = self.records

        if not records:
            return 1.0  # No data means perfect accuracy (neutral)

        total_ratio = sum(r.accuracy_ratio for r in records)
        return total_ratio / len(records)

    def get_record_count(self) -> int:
        """Get total number of completion records."""
        return len(self.records)

    def __repr__(self) -> str:
        """String representation of tracker."""
        return (
            f"HistoricalTracker("
            f"data_file={self.data_file}, "
            f"records={len(self.records)})"
        )
