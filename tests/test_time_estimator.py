#!/usr/bin/env python3
"""
Test suite for Time Estimator
==============================

Tests the time estimation algorithm and its integration with complexity assessment.
"""

import pytest
from estimation.time_estimator import TimeEstimate, TimeEstimator
from spec.complexity import ComplexityAssessment, Complexity


class TestTimeEstimate:
    """Test TimeEstimate dataclass."""

    def test_time_estimate_creation(self):
        """Test creating a TimeEstimate."""
        estimate = TimeEstimate(
            estimated_minutes=30.0,
            confidence_min=20.0,
            confidence_max=45.0,
            confidence_level=0.8
        )
        assert estimate.estimated_minutes == 30.0
        assert estimate.confidence_min == 20.0
        assert estimate.confidence_max == 45.0
        assert estimate.confidence_level == 0.8

    def test_time_estimate_to_dict(self):
        """Test converting TimeEstimate to dictionary."""
        estimate = TimeEstimate(
            estimated_minutes=30.0,
            confidence_min=20.0,
            confidence_max=45.0,
            confidence_level=0.8
        )
        result = estimate.to_dict()
        assert result == {
            "estimated_minutes": 30.0,
            "confidence_min": 20.0,
            "confidence_max": 45.0,
            "confidence_level": 0.8,
        }

    def test_time_estimate_from_dict(self):
        """Test creating TimeEstimate from dictionary."""
        data = {
            "estimated_minutes": 30.0,
            "confidence_min": 20.0,
            "confidence_max": 45.0,
            "confidence_level": 0.75,
        }
        estimate = TimeEstimate.from_dict(data)
        assert estimate.estimated_minutes == 30.0
        assert estimate.confidence_min == 20.0
        assert estimate.confidence_max == 45.0
        assert estimate.confidence_level == 0.75


class TestTimeEstimator:
    """Test TimeEstimator class."""

    def test_basic_estimation(self):
        """Test basic time estimation for each complexity level."""
        estimator = TimeEstimator()

        # Test SIMPLE complexity (10-20 minutes)
        simple_assessment = ComplexityAssessment(
            complexity=Complexity.SIMPLE,
            confidence=0.9,
            estimated_files=1,
            estimated_services=1,
        )
        simple_estimate = estimator.estimate(simple_assessment)
        assert simple_estimate.confidence_min == 10.0
        assert simple_estimate.confidence_max == 20.0
        assert 10.0 <= simple_estimate.estimated_minutes <= 20.0
        assert simple_estimate.confidence_level == 0.9

        # Test STANDARD complexity (20-45 minutes)
        standard_assessment = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
            estimated_files=5,
            estimated_services=1,
        )
        standard_estimate = estimator.estimate(standard_assessment)
        assert standard_estimate.confidence_min == 20.0
        assert standard_estimate.confidence_max == 45.0
        assert 20.0 <= standard_estimate.estimated_minutes <= 45.0
        assert standard_estimate.confidence_level == 0.8

        # Test COMPLEX complexity (45-90 minutes)
        complex_assessment = ComplexityAssessment(
            complexity=Complexity.COMPLEX,
            confidence=0.75,
            estimated_files=15,
            estimated_services=3,
        )
        complex_estimate = estimator.estimate(complex_assessment)
        assert complex_estimate.confidence_min == 45.0
        assert complex_estimate.confidence_max == 90.0
        assert 45.0 <= complex_estimate.estimated_minutes <= 90.0
        assert complex_estimate.confidence_level == 0.75

    def test_multi_service_adjustment(self):
        """Test that multi-service tasks get time adjustment."""
        estimator = TimeEstimator()

        # Single service (baseline)
        single_service = ComplexityAssessment(
            complexity=Complexity.SIMPLE,
            confidence=0.9,
            estimated_services=1,
        )
        single_estimate = estimator.estimate(single_service)

        # Multiple services (should take longer)
        multi_service = ComplexityAssessment(
            complexity=Complexity.SIMPLE,
            confidence=0.9,
            estimated_services=3,
        )
        multi_estimate = estimator.estimate(multi_service)

        # Multi-service should have higher estimate
        assert multi_estimate.estimated_minutes > single_estimate.estimated_minutes

    def test_integration_adjustment(self):
        """Test that external integrations increase time estimate."""
        estimator = TimeEstimator()

        # No integrations (baseline)
        no_integration = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
            external_integrations=[],
        )
        no_integration_estimate = estimator.estimate(no_integration)

        # With integrations (should take longer)
        with_integration = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
            external_integrations=["graphiti", "stripe"],
        )
        with_integration_estimate = estimator.estimate(with_integration)

        # Integration should increase estimate
        assert with_integration_estimate.estimated_minutes > no_integration_estimate.estimated_minutes

    def test_infrastructure_adjustment(self):
        """Test that infrastructure changes increase time estimate."""
        estimator = TimeEstimator()

        # No infrastructure changes (baseline)
        no_infra = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
            infrastructure_changes=False,
        )
        no_infra_estimate = estimator.estimate(no_infra)

        # With infrastructure changes (should take longer)
        with_infra = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
            infrastructure_changes=True,
        )
        with_infra_estimate = estimator.estimate(with_infra)

        # Infrastructure changes should increase estimate
        assert with_infra_estimate.estimated_minutes > no_infra_estimate.estimated_minutes

    def test_adjustment_cap(self):
        """Test that adjustments don't exceed max for next complexity level."""
        estimator = TimeEstimator()

        # SIMPLE with many adjustments should not exceed STANDARD max
        heavily_adjusted_simple = ComplexityAssessment(
            complexity=Complexity.SIMPLE,
            confidence=0.9,
            estimated_services=5,
            external_integrations=["stripe", "graphiti", "redis"],
            infrastructure_changes=True,
        )
        estimate = estimator.estimate(heavily_adjusted_simple)
        # Should not exceed STANDARD max (45)
        assert estimate.estimated_minutes <= 45.0

        # STANDARD with many adjustments should not exceed COMPLEX max
        heavily_adjusted_standard = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
            estimated_services=5,
            external_integrations=["stripe", "graphiti", "redis"],
            infrastructure_changes=True,
        )
        estimate = estimator.estimate(heavily_adjusted_standard)
        # Should not exceed COMPLEX max (90)
        assert estimate.estimated_minutes <= 90.0

    def test_estimate_subtask(self):
        """Test subtask estimation."""
        estimator = TimeEstimator()

        # Single file
        estimate = estimator.estimate_subtask(
            description="Update user model",
            files_count=1
        )
        assert 3.0 <= estimate.estimated_minutes <= 10.0

        # Multiple files
        estimate = estimator.estimate_subtask(
            description="Update authentication system",
            files_count=5
        )
        assert estimate.estimated_minutes > 20.0

        # Test keyword
        test_estimate = estimator.estimate_subtask(
            description="Add unit test for user service",
            files_count=2
        )
        # Tests should take less time
        assert test_estimate.estimated_minutes < 20.0

        # Complex/refactor keyword
        refactor_estimate = estimator.estimate_subtask(
            description="Refactor authentication architecture",
            files_count=2
        )
        # Refactors should take more time
        assert refactor_estimate.estimated_minutes > test_estimate.estimated_minutes

    def test_historical_data_initialization(self):
        """Test TimeEstimator initialization with historical data."""
        historical_data = {
            "simple": {"avg_time": 12, "count": 5},
            "standard": {"avg_time": 28, "count": 10},
            "complex": {"avg_time": 65, "count": 3},
        }
        estimator = TimeEstimator(historical_data=historical_data)
        assert estimator.historical_data == historical_data

    def test_base_estimates_constants(self):
        """Test that BASE_ESTIMATES has correct values."""
        assert TimeEstimator.BASE_ESTIMATES[Complexity.SIMPLE] == (10, 20)
        assert TimeEstimator.BASE_ESTIMATES[Complexity.STANDARD] == (20, 45)
        assert TimeEstimator.BASE_ESTIMATES[Complexity.COMPLEX] == (45, 90)
