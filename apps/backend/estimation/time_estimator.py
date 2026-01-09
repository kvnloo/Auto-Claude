"""
Time Estimation Module
=======================

Provides estimated completion times based on complexity assessment
and historical data. Updates estimates as work progresses.
"""

from dataclasses import dataclass
from typing import Optional, List
import statistics

from spec.complexity import ComplexityAssessment, Complexity


@dataclass
class TimeEstimate:
    """Represents a time estimation with confidence range."""

    estimated_minutes: float  # Central estimate
    confidence_min: float  # Lower bound of confidence interval
    confidence_max: float  # Upper bound of confidence interval
    confidence_level: float = 0.8  # Confidence level (0.0-1.0)

    def to_dict(self) -> dict:
        """Convert to dictionary representation."""
        return {
            "estimated_minutes": self.estimated_minutes,
            "confidence_min": self.confidence_min,
            "confidence_max": self.confidence_max,
            "confidence_level": self.confidence_level,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TimeEstimate":
        """Create TimeEstimate from dictionary."""
        return cls(
            estimated_minutes=data["estimated_minutes"],
            confidence_min=data["confidence_min"],
            confidence_max=data["confidence_max"],
            confidence_level=data.get("confidence_level", 0.8),
        )


class TimeEstimator:
    """
    Estimates task completion time based on complexity and historical data.

    Provides time estimates with confidence ranges that improve over time
    as historical completion data is collected.
    """

    # Base time ranges for each complexity level (in minutes)
    BASE_ESTIMATES = {
        Complexity.SIMPLE: (10, 20),
        Complexity.STANDARD: (20, 45),
        Complexity.COMPLEX: (45, 90),
    }

    def __init__(self, historical_data: Optional[dict] = None):
        """
        Initialize time estimator.

        Args:
            historical_data: Optional historical completion data for improving estimates
        """
        self.historical_data = historical_data or {}

    def estimate(self, assessment: ComplexityAssessment) -> TimeEstimate:
        """
        Estimate completion time based on complexity assessment.

        Args:
            assessment: ComplexityAssessment with complexity level and characteristics

        Returns:
            TimeEstimate with estimated minutes and confidence range
        """
        # Get base estimate for complexity level, refined by historical data
        min_time, max_time = self._get_refined_base_estimate(assessment.complexity)

        # Calculate central estimate (midpoint of range)
        estimated_minutes = (min_time + max_time) / 2.0

        # Apply adjustments based on assessment characteristics
        estimated_minutes = self._apply_adjustments(estimated_minutes, assessment)

        # Calculate confidence range using historical data
        confidence_min, confidence_max = self._calculate_confidence_range(
            estimated_minutes, assessment.complexity
        )

        return TimeEstimate(
            estimated_minutes=estimated_minutes,
            confidence_min=confidence_min,
            confidence_max=confidence_max,
            confidence_level=assessment.confidence,
        )

    def _apply_adjustments(
        self,
        base_estimate: float,
        assessment: ComplexityAssessment
    ) -> float:
        """
        Apply adjustments to base estimate based on task characteristics.

        Args:
            base_estimate: Base time estimate in minutes
            assessment: ComplexityAssessment with task characteristics

        Returns:
            Adjusted estimate in minutes
        """
        adjusted = base_estimate

        # Adjust for number of services
        if assessment.estimated_services > 1:
            # Multi-service tasks take longer
            service_multiplier = 1 + (assessment.estimated_services - 1) * 0.15
            adjusted *= service_multiplier

        # Adjust for external integrations
        if assessment.external_integrations:
            # Each integration adds complexity
            integration_multiplier = 1 + len(assessment.external_integrations) * 0.1
            adjusted *= integration_multiplier

        # Adjust for infrastructure changes
        if assessment.infrastructure_changes:
            # Infrastructure changes add significant time
            adjusted *= 1.3

        # Don't let adjustments exceed max for next complexity level
        complexity_order = [Complexity.SIMPLE, Complexity.STANDARD, Complexity.COMPLEX]
        current_idx = complexity_order.index(assessment.complexity)

        if current_idx < len(complexity_order) - 1:
            next_complexity = complexity_order[current_idx + 1]
            _, next_max = self.BASE_ESTIMATES[next_complexity]
            adjusted = min(adjusted, next_max)

        return adjusted

    def _get_refined_base_estimate(self, complexity: Complexity) -> tuple[float, float]:
        """
        Get base time estimate, refined by historical data if available.

        Args:
            complexity: Task complexity level

        Returns:
            Tuple of (min_time, max_time) in minutes
        """
        # Start with base estimate
        base_min, base_max = self.BASE_ESTIMATES.get(
            complexity,
            self.BASE_ESTIMATES[Complexity.STANDARD]
        )

        # Refine with historical data if available
        complexity_key = complexity.value
        if "complexity" in self.historical_data and complexity_key in self.historical_data["complexity"]:
            historical_times = self.historical_data["complexity"][complexity_key]
            if len(historical_times) >= 3:  # Need minimum data points for reliability
                # Use historical mean and standard deviation
                mean_time = statistics.mean(historical_times)
                stdev_time = statistics.stdev(historical_times)

                # Refine estimate using weighted average (70% historical, 30% base)
                refined_center = 0.7 * mean_time + 0.3 * ((base_min + base_max) / 2)

                # Calculate range using historical variance
                refined_min = max(refined_center - stdev_time, base_min * 0.5)
                refined_max = refined_center + stdev_time

                return (refined_min, refined_max)

        return (base_min, base_max)

    def _calculate_confidence_range(
        self,
        estimated_minutes: float,
        complexity: Complexity
    ) -> tuple[float, float]:
        """
        Calculate confidence range for estimate using historical accuracy data.

        Args:
            estimated_minutes: Central estimate in minutes
            complexity: Task complexity level

        Returns:
            Tuple of (confidence_min, confidence_max) in minutes
        """
        # Default range is ±30% of estimate
        default_range = estimated_minutes * 0.3

        complexity_key = complexity.value
        if "complexity" in self.historical_data and complexity_key in self.historical_data["complexity"]:
            historical_times = self.historical_data["complexity"][complexity_key]
            if len(historical_times) >= 3:
                # Use historical standard deviation for more accurate range
                stdev_time = statistics.stdev(historical_times)
                confidence_min = max(estimated_minutes - stdev_time, estimated_minutes * 0.5)
                confidence_max = estimated_minutes + stdev_time
                return (confidence_min, confidence_max)

        # Fallback to default range
        return (
            max(estimated_minutes - default_range, estimated_minutes * 0.5),
            estimated_minutes + default_range
        )

    def estimate_subtask(
        self,
        description: str,
        files_count: int = 1,
        service: Optional[str] = None
    ) -> TimeEstimate:
        """
        Estimate time for an individual subtask.

        Args:
            description: Subtask description
            files_count: Number of files to modify/create
            service: Service name (backend, frontend, etc.)

        Returns:
            TimeEstimate for the subtask
        """
        # Base estimate: 5-10 minutes per file
        min_time = files_count * 5
        max_time = files_count * 10

        # Adjust based on keywords in description
        description_lower = description.lower()

        if any(kw in description_lower for kw in ["test", "unit test", "integration test"]):
            # Tests take less time
            min_time = max(min_time * 0.7, 3)
            max_time = max(max_time * 0.7, 8)
        elif any(kw in description_lower for kw in ["refactor", "architecture", "complex"]):
            # Complex changes take more time
            min_time *= 1.5
            max_time *= 1.5

        estimated_minutes = (min_time + max_time) / 2.0

        # Refine with service-specific historical data
        if service and "services" in self.historical_data:
            if service in self.historical_data["services"]:
                service_times = self.historical_data["services"][service]
                if len(service_times) >= 3:
                    # Use historical mean for this service
                    mean_time = statistics.mean(service_times)
                    stdev_time = statistics.stdev(service_times)

                    # Blend historical data with base estimate (60% historical, 40% base)
                    estimated_minutes = 0.6 * mean_time + 0.4 * estimated_minutes

                    # Refine confidence range
                    min_time = max(estimated_minutes - stdev_time, estimated_minutes * 0.5)
                    max_time = estimated_minutes + stdev_time

        return TimeEstimate(
            estimated_minutes=estimated_minutes,
            confidence_min=min_time,
            confidence_max=max_time,
            confidence_level=0.7,
        )

    def record_completion(
        self,
        actual_minutes: float,
        complexity: Optional[Complexity] = None,
        service: Optional[str] = None
    ) -> None:
        """
        Record actual completion time to improve future estimates.

        Args:
            actual_minutes: Actual time taken in minutes
            complexity: Task complexity level (if applicable)
            service: Service name (if applicable)
        """
        # Initialize structure if needed
        if "complexity" not in self.historical_data:
            self.historical_data["complexity"] = {}
        if "services" not in self.historical_data:
            self.historical_data["services"] = {}

        # Record by complexity
        if complexity:
            complexity_key = complexity.value
            if complexity_key not in self.historical_data["complexity"]:
                self.historical_data["complexity"][complexity_key] = []
            self.historical_data["complexity"][complexity_key].append(actual_minutes)

            # Keep only recent data (last 20 completions)
            if len(self.historical_data["complexity"][complexity_key]) > 20:
                self.historical_data["complexity"][complexity_key] = \
                    self.historical_data["complexity"][complexity_key][-20:]

        # Record by service
        if service:
            if service not in self.historical_data["services"]:
                self.historical_data["services"][service] = []
            self.historical_data["services"][service].append(actual_minutes)

            # Keep only recent data (last 20 completions)
            if len(self.historical_data["services"][service]) > 20:
                self.historical_data["services"][service] = \
                    self.historical_data["services"][service][-20:]

    def get_accuracy_metrics(self, complexity: Optional[Complexity] = None) -> dict:
        """
        Get metrics about estimation accuracy based on historical data.

        Args:
            complexity: Optional complexity level to filter metrics

        Returns:
            Dictionary with accuracy metrics (sample_size, mean_time, stdev, etc.)
        """
        metrics = {}

        if complexity:
            complexity_key = complexity.value
            if "complexity" in self.historical_data and complexity_key in self.historical_data["complexity"]:
                times = self.historical_data["complexity"][complexity_key]
                if len(times) >= 2:
                    metrics["sample_size"] = len(times)
                    metrics["mean_time"] = statistics.mean(times)
                    if len(times) >= 3:
                        metrics["stdev"] = statistics.stdev(times)
                        metrics["min_time"] = min(times)
                        metrics["max_time"] = max(times)
        else:
            # Overall metrics
            all_times = []
            if "complexity" in self.historical_data:
                for times in self.historical_data["complexity"].values():
                    all_times.extend(times)
            if len(all_times) >= 2:
                metrics["sample_size"] = len(all_times)
                metrics["mean_time"] = statistics.mean(all_times)
                if len(all_times) >= 3:
                    metrics["stdev"] = statistics.stdev(all_times)
                    metrics["min_time"] = min(all_times)
                    metrics["max_time"] = max(all_times)

        return metrics
