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

        # Test SIMPLE complexity (base range 10-20 minutes, midpoint 15)
        simple_assessment = ComplexityAssessment(
            complexity=Complexity.SIMPLE,
            confidence=0.9,
            estimated_files=1,
            estimated_services=1,
        )
        simple_estimate = estimator.estimate(simple_assessment)
        # Estimated minutes should be midpoint of base range
        assert simple_estimate.estimated_minutes == 15.0
        # Confidence range is ±30% by default (15 ± 4.5)
        assert simple_estimate.confidence_min == 10.5
        assert simple_estimate.confidence_max == 19.5
        assert simple_estimate.confidence_level == 0.9

        # Test STANDARD complexity (base range 20-45 minutes, midpoint 32.5)
        standard_assessment = ComplexityAssessment(
            complexity=Complexity.STANDARD,
            confidence=0.8,
            estimated_files=5,
            estimated_services=1,
        )
        standard_estimate = estimator.estimate(standard_assessment)
        # Estimated minutes should be midpoint of base range
        assert standard_estimate.estimated_minutes == 32.5
        # Confidence range is ±30% by default (32.5 ± 9.75)
        assert standard_estimate.confidence_min == 22.75
        assert standard_estimate.confidence_max == 42.25
        assert standard_estimate.confidence_level == 0.8

        # Test COMPLEX complexity (base range 45-90 minutes, midpoint 67.5)
        complex_assessment = ComplexityAssessment(
            complexity=Complexity.COMPLEX,
            confidence=0.75,
            estimated_files=15,
            estimated_services=3,
        )
        complex_estimate = estimator.estimate(complex_assessment)
        # With 3 services, estimate should be adjusted upward
        # Base midpoint: 67.5
        # Service multiplier: 1 + (3-1)*0.15 = 1.3
        # Adjusted: 67.5 * 1.3 = 87.75
        assert complex_estimate.estimated_minutes == 87.75
        # Confidence range is ±30% by default (87.75 ± 26.325)
        # But confidence_min has a floor of 50% of estimate
        assert complex_estimate.confidence_min == max(87.75 - 26.325, 87.75 * 0.5)
        assert complex_estimate.confidence_max == 87.75 + 26.325
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

    def test_record_completion_by_complexity(self):
        """Test recording completion time by complexity."""
        estimator = TimeEstimator()

        # Record completion for SIMPLE task
        estimator.record_completion(15.0, complexity=Complexity.SIMPLE)
        assert "complexity" in estimator.historical_data
        assert "simple" in estimator.historical_data["complexity"]
        assert 15.0 in estimator.historical_data["complexity"]["simple"]

        # Record another SIMPLE completion
        estimator.record_completion(18.0, complexity=Complexity.SIMPLE)
        assert len(estimator.historical_data["complexity"]["simple"]) == 2
        assert 18.0 in estimator.historical_data["complexity"]["simple"]

        # Record STANDARD completion
        estimator.record_completion(30.0, complexity=Complexity.STANDARD)
        assert "standard" in estimator.historical_data["complexity"]
        assert 30.0 in estimator.historical_data["complexity"]["standard"]

    def test_record_completion_by_service(self):
        """Test recording completion time by service."""
        estimator = TimeEstimator()

        # Record completion for backend service
        estimator.record_completion(20.0, service="backend")
        assert "services" in estimator.historical_data
        assert "backend" in estimator.historical_data["services"]
        assert 20.0 in estimator.historical_data["services"]["backend"]

        # Record completion for frontend service
        estimator.record_completion(25.0, service="frontend")
        assert "frontend" in estimator.historical_data["services"]
        assert 25.0 in estimator.historical_data["services"]["frontend"]

    def test_record_completion_both_complexity_and_service(self):
        """Test recording completion with both complexity and service."""
        estimator = TimeEstimator()

        estimator.record_completion(
            actual_minutes=20.0,
            complexity=Complexity.SIMPLE,
            service="backend"
        )

        # Should be recorded in both places
        assert 20.0 in estimator.historical_data["complexity"]["simple"]
        assert 20.0 in estimator.historical_data["services"]["backend"]

    def test_record_completion_limit(self):
        """Test that historical data is limited to last 20 entries."""
        estimator = TimeEstimator()

        # Record 25 completions
        for i in range(25):
            estimator.record_completion(
                actual_minutes=10.0 + i,
                complexity=Complexity.SIMPLE
            )

        # Should only keep last 20
        assert len(estimator.historical_data["complexity"]["simple"]) == 20
        # Should have most recent values
        assert 34.0 in estimator.historical_data["complexity"]["simple"]  # 10 + 24
        # Should NOT have oldest values
        assert 10.0 not in estimator.historical_data["complexity"]["simple"]
        assert 11.0 not in estimator.historical_data["complexity"]["simple"]

    def test_get_accuracy_metrics_no_data(self):
        """Test accuracy metrics with no historical data."""
        estimator = TimeEstimator()
        metrics = estimator.get_accuracy_metrics()
        assert metrics == {}

        metrics = estimator.get_accuracy_metrics(complexity=Complexity.SIMPLE)
        assert metrics == {}

    def test_get_accuracy_metrics_insufficient_data(self):
        """Test accuracy metrics with insufficient data (< 2 samples)."""
        estimator = TimeEstimator()
        estimator.record_completion(15.0, complexity=Complexity.SIMPLE)

        metrics = estimator.get_accuracy_metrics(complexity=Complexity.SIMPLE)
        assert metrics == {}

    def test_get_accuracy_metrics_by_complexity(self):
        """Test accuracy metrics for specific complexity level."""
        estimator = TimeEstimator()

        # Record 5 completions for SIMPLE
        times = [12.0, 15.0, 18.0, 14.0, 16.0]
        for time in times:
            estimator.record_completion(time, complexity=Complexity.SIMPLE)

        metrics = estimator.get_accuracy_metrics(complexity=Complexity.SIMPLE)

        assert metrics["sample_size"] == 5
        assert metrics["mean_time"] == 15.0
        assert "stdev" in metrics
        assert metrics["min_time"] == 12.0
        assert metrics["max_time"] == 18.0

    def test_get_accuracy_metrics_overall(self):
        """Test overall accuracy metrics across all complexities."""
        estimator = TimeEstimator()

        # Record completions for different complexities
        estimator.record_completion(15.0, complexity=Complexity.SIMPLE)
        estimator.record_completion(18.0, complexity=Complexity.SIMPLE)
        estimator.record_completion(30.0, complexity=Complexity.STANDARD)
        estimator.record_completion(35.0, complexity=Complexity.STANDARD)
        estimator.record_completion(60.0, complexity=Complexity.COMPLEX)

        metrics = estimator.get_accuracy_metrics()

        assert metrics["sample_size"] == 5
        assert metrics["mean_time"] == (15.0 + 18.0 + 30.0 + 35.0 + 60.0) / 5
        assert "stdev" in metrics
        assert metrics["min_time"] == 15.0
        assert metrics["max_time"] == 60.0

    def test_historical_data_improves_estimates(self):
        """Test that historical data refines base estimates."""
        # Estimator without historical data
        estimator_no_history = TimeEstimator()
        assessment = ComplexityAssessment(
            complexity=Complexity.SIMPLE,
            confidence=0.9,
            estimated_services=1,
        )
        base_estimate = estimator_no_history.estimate(assessment)

        # Estimator with historical data (showing tasks take longer than base)
        historical_data = {
            "complexity": {
                "simple": [18.0, 19.0, 17.5, 18.5, 19.0]  # avg ~18.4, higher than base midpoint of 15
            }
        }
        estimator_with_history = TimeEstimator(historical_data=historical_data)
        refined_estimate = estimator_with_history.estimate(assessment)

        # Refined estimate should be influenced by historical data
        assert refined_estimate.estimated_minutes != base_estimate.estimated_minutes

    def test_estimate_with_historical_confidence_range(self):
        """Test that historical data refines confidence range."""
        # Historical data with low variance
        historical_data = {
            "complexity": {
                "simple": [14.0, 15.0, 16.0, 15.0, 14.5]  # low stdev
            }
        }
        estimator = TimeEstimator(historical_data=historical_data)

        assessment = ComplexityAssessment(
            complexity=Complexity.SIMPLE,
            confidence=0.9,
            estimated_services=1,
        )
        estimate = estimator.estimate(assessment)

        # With historical data, confidence range should be tighter
        confidence_range = estimate.confidence_max - estimate.confidence_min
        # Default range would be ±30% of estimate, so total range would be 60%
        # Historical data should provide tighter range
        assert confidence_range < estimate.estimated_minutes * 0.6

    def test_subtask_estimate_with_service_history(self):
        """Test subtask estimation uses service-specific historical data."""
        # Historical data for backend service
        historical_data = {
            "services": {
                "backend": [12.0, 14.0, 13.0, 15.0, 13.5]
            }
        }
        estimator = TimeEstimator(historical_data=historical_data)

        # Estimate with service that has history
        estimate_with_history = estimator.estimate_subtask(
            description="Update user model",
            files_count=2,
            service="backend"
        )

        # Estimate without service history
        estimate_no_history = estimator.estimate_subtask(
            description="Update user model",
            files_count=2,
            service="frontend"
        )

        # Estimates should differ due to historical data
        assert estimate_with_history.estimated_minutes != estimate_no_history.estimated_minutes
