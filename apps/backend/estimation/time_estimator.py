"""
Time Estimation Module
=======================

Provides estimated completion times based on complexity assessment
and historical data. Updates estimates as work progresses.
"""

from dataclasses import dataclass
from typing import Optional

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
        # Get base estimate for complexity level
        min_time, max_time = self.BASE_ESTIMATES.get(
            assessment.complexity,
            self.BASE_ESTIMATES[Complexity.STANDARD]
        )

        # Calculate central estimate (midpoint of range)
        estimated_minutes = (min_time + max_time) / 2.0

        # Apply adjustments based on assessment characteristics
        estimated_minutes = self._apply_adjustments(estimated_minutes, assessment)

        # Calculate confidence range (will be refined with historical data in future)
        confidence_min = min_time
        confidence_max = max_time

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

        return TimeEstimate(
            estimated_minutes=estimated_minutes,
            confidence_min=min_time,
            confidence_max=max_time,
            confidence_level=0.7,
        )
