"""
Accuracy Metrics Reporter Module
=================================

Reports on time estimation accuracy based on historical completion data.
Displays accuracy percentages, trends, and insights to help users understand
how reliable the time estimates are.
"""

from pathlib import Path
from typing import Optional

from spec.complexity import Complexity
from .historical_tracker import HistoricalTracker


class AccuracyReporter:
    """
    Generates accuracy reports from historical estimation data.

    Calculates and formats accuracy metrics showing how well time estimates
    match actual completion times. Provides overall and complexity-specific
    accuracy percentages.
    """

    def __init__(self, tracker: Optional[HistoricalTracker] = None, data_file: Optional[Path] = None):
        """
        Initialize accuracy reporter.

        Args:
            tracker: Optional HistoricalTracker instance to use.
                    If not provided, creates a new one with the given data_file.
            data_file: Optional path to estimation data file.
                      Defaults to .auto-claude/estimation_data.json
        """
        if tracker is None:
            self.tracker = HistoricalTracker(data_file=data_file)
        else:
            self.tracker = tracker

    def get_accuracy_percentage(self, complexity: Optional[Complexity] = None) -> Optional[float]:
        """
        Calculate accuracy percentage for estimates.

        Accuracy is calculated as: 100 - average(abs(estimation_error))
        - 100% = perfect estimates
        - >85% = very accurate
        - 70-85% = reasonably accurate
        - <70% = needs improvement

        Args:
            complexity: Optional complexity level to filter by.
                       If None, calculates across all records.

        Returns:
            Accuracy percentage (0-100), or None if no data available
        """
        if complexity:
            records = self.tracker.get_records_by_complexity(complexity)
        else:
            records = self.tracker.records

        if not records:
            return None

        # Calculate average absolute estimation error
        total_error = sum(abs(r.estimation_error) for r in records)
        avg_error = total_error / len(records)

        # Convert to accuracy percentage (100% = perfect, 0% = completely wrong)
        # Cap at 0% to avoid negative percentages for very bad estimates
        accuracy = max(0.0, 100.0 - avg_error)

        return accuracy

    def get_accuracy_summary(self) -> dict:
        """
        Get comprehensive accuracy summary with metrics.

        Returns:
            Dictionary with accuracy metrics:
            - overall_accuracy: Overall accuracy percentage
            - sample_size: Total number of historical records
            - by_complexity: Accuracy breakdown by complexity level
            - reliability_level: Text description of reliability
        """
        summary = {
            "overall_accuracy": None,
            "sample_size": self.tracker.get_record_count(),
            "by_complexity": {},
            "reliability_level": "unknown",
        }

        # Calculate overall accuracy
        overall_accuracy = self.get_accuracy_percentage()
        if overall_accuracy is not None:
            summary["overall_accuracy"] = overall_accuracy
            summary["reliability_level"] = self._get_reliability_level(overall_accuracy)

        # Calculate accuracy by complexity
        for complexity in [Complexity.SIMPLE, Complexity.STANDARD, Complexity.COMPLEX]:
            accuracy = self.get_accuracy_percentage(complexity)
            if accuracy is not None:
                records = self.tracker.get_records_by_complexity(complexity)
                summary["by_complexity"][complexity.value] = {
                    "accuracy": accuracy,
                    "sample_size": len(records),
                }

        return summary

    def format_accuracy_display(self, complexity: Optional[Complexity] = None) -> str:
        """
        Format accuracy metrics for display.

        Args:
            complexity: Optional complexity level to display.
                       If None, shows overall accuracy.

        Returns:
            Formatted string with accuracy percentage and description
        """
        accuracy = self.get_accuracy_percentage(complexity)

        if accuracy is None:
            return "No historical data yet"

        # Get sample size for context
        if complexity:
            records = self.tracker.get_records_by_complexity(complexity)
            sample_size = len(records)
            complexity_str = f" ({complexity.value})"
        else:
            sample_size = self.tracker.get_record_count()
            complexity_str = ""

        # Format accuracy with appropriate precision
        accuracy_str = f"{accuracy:.0f}%"

        # Add reliability indicator
        reliability = self._get_reliability_level(accuracy)
        reliability_emoji = self._get_reliability_emoji(accuracy)

        return (
            f"{reliability_emoji} {accuracy_str} accurate{complexity_str} "
            f"({sample_size} task{'s' if sample_size != 1 else ''}) - {reliability}"
        )

    def _get_reliability_level(self, accuracy: float) -> str:
        """
        Get text description of reliability level based on accuracy.

        Args:
            accuracy: Accuracy percentage (0-100)

        Returns:
            Text description of reliability level
        """
        if accuracy >= 90:
            return "excellent"
        elif accuracy >= 80:
            return "very good"
        elif accuracy >= 70:
            return "good"
        elif accuracy >= 60:
            return "fair"
        else:
            return "needs improvement"

    def _get_reliability_emoji(self, accuracy: float) -> str:
        """
        Get emoji indicator for reliability level.

        Args:
            accuracy: Accuracy percentage (0-100)

        Returns:
            Emoji representing the reliability level
        """
        if accuracy >= 90:
            return "🎯"  # Bullseye - excellent
        elif accuracy >= 80:
            return "✨"  # Sparkles - very good
        elif accuracy >= 70:
            return "👍"  # Thumbs up - good
        elif accuracy >= 60:
            return "📊"  # Chart - fair
        else:
            return "📈"  # Trending up - needs improvement

    def get_velocity_summary(self, complexity: Optional[Complexity] = None) -> dict:
        """
        Get velocity metrics showing if tasks typically take longer/shorter than estimated.

        Args:
            complexity: Optional complexity level to filter by

        Returns:
            Dictionary with velocity metrics:
            - avg_velocity: Average velocity ratio (actual/estimated)
            - typically_faster: True if tasks typically complete faster
            - typically_slower: True if tasks typically complete slower
        """
        if complexity:
            records = self.tracker.get_records_by_complexity(complexity)
        else:
            records = self.tracker.records

        if not records:
            return {
                "avg_velocity": None,
                "typically_faster": False,
                "typically_slower": False,
            }

        # Calculate average velocity (actual / estimated)
        avg_velocity = sum(r.accuracy_ratio for r in records) / len(records)

        return {
            "avg_velocity": avg_velocity,
            "typically_faster": avg_velocity < 0.85,  # >15% faster
            "typically_slower": avg_velocity > 1.15,  # >15% slower
        }
