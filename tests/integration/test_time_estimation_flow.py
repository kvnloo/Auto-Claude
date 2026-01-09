"""
End-to-End Tests for Time Estimation System
============================================

Tests the full time estimation flow from complexity assessment through
historical tracking and progress calculation. Validates integration
between TimeEstimator, HistoricalTracker, and ProgressCalculator.
"""

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest

# Add the backend directory to path
_backend_dir = Path(__file__).parent.parent.parent / "apps" / "backend"
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from spec.complexity import ComplexityAssessment, Complexity
from estimation.time_estimator import TimeEstimator, TimeEstimate
from estimation.historical_tracker import HistoricalTracker, CompletionRecord
from estimation.progress_calculator import ProgressCalculator, ProgressSnapshot
from implementation_plan import ImplementationPlan, Phase, Subtask
from implementation_plan.enums import SubtaskStatus, WorkflowType, PhaseType


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def temp_estimation_dir(tmp_path):
    """Create a temporary directory for estimation data."""
    estimation_dir = tmp_path / ".auto-claude"
    estimation_dir.mkdir(parents=True)
    return estimation_dir


@pytest.fixture
def historical_tracker(temp_estimation_dir):
    """Create a HistoricalTracker with temporary storage."""
    data_file = temp_estimation_dir / "estimation_data.json"
    return HistoricalTracker(data_file=data_file)


@pytest.fixture
def time_estimator():
    """Create a TimeEstimator with no historical data."""
    return TimeEstimator()


@pytest.fixture
def sample_complexity_assessment():
    """Create a sample complexity assessment."""
    return ComplexityAssessment(
        complexity=Complexity.STANDARD,
        confidence=0.85,
        estimated_files=5,
        estimated_services=1,
        external_integrations=[],
        infrastructure_changes=False,
    )


@pytest.fixture
def sample_implementation_plan():
    """Create a sample implementation plan with subtasks."""
    phase = Phase(
        phase=1,
        name="Core Implementation",
        type=PhaseType.IMPLEMENTATION,
        subtasks=[
            Subtask(
                id="1.1",
                description="Create base module",
                service="backend",
                estimated_duration_minutes=15,
                status=SubtaskStatus.COMPLETED,
                completed_at=datetime.now().isoformat(),
            ),
            Subtask(
                id="1.2",
                description="Add unit tests",
                service="backend",
                estimated_duration_minutes=10,
                status=SubtaskStatus.COMPLETED,
                completed_at=datetime.now().isoformat(),
            ),
            Subtask(
                id="1.3",
                description="Create integration",
                service="backend",
                estimated_duration_minutes=20,
                status=SubtaskStatus.IN_PROGRESS,
            ),
            Subtask(
                id="1.4",
                description="Add documentation",
                service="backend",
                estimated_duration_minutes=8,
                status=SubtaskStatus.PENDING,
            ),
        ]
    )

    plan = ImplementationPlan(
        feature="Test Feature",
        workflow_type=WorkflowType.FEATURE,
        services_involved=["backend"],
        phases=[phase],
    )

    return plan


# ============================================================================
# End-to-End Flow Tests
# ============================================================================

class TestTimeEstimationEndToEndFlow:
    """Test the complete time estimation workflow."""

    def test_basic_estimation_flow(self, time_estimator, sample_complexity_assessment):
        """Test basic flow: assessment -> estimation."""
        # Get time estimate from complexity assessment
        estimate = time_estimator.estimate(sample_complexity_assessment)

        # Verify estimate structure
        assert isinstance(estimate, TimeEstimate)
        assert estimate.estimated_minutes > 0
        assert estimate.confidence_min > 0
        assert estimate.confidence_max > estimate.estimated_minutes
        assert estimate.confidence_level == sample_complexity_assessment.confidence

        # Verify estimate is in expected range for STANDARD complexity
        assert 20 <= estimate.estimated_minutes <= 45

    def test_historical_tracking_integration(
        self,
        historical_tracker,
        time_estimator,
        sample_complexity_assessment
    ):
        """Test integration with historical tracking."""
        # Get initial estimate
        initial_estimate = time_estimator.estimate(sample_complexity_assessment)

        # Record completion (task took longer than estimated)
        actual_minutes = 35.0
        historical_tracker.record_completion(
            task_id="test-001",
            task_description="Test feature implementation",
            complexity=sample_complexity_assessment.complexity,
            estimated_minutes=initial_estimate.estimated_minutes,
            actual_minutes=actual_minutes,
        )

        # Verify record was saved
        records = historical_tracker.records
        assert len(records) == 1
        assert records[0].actual_minutes == actual_minutes
        assert records[0].complexity == Complexity.STANDARD

        # Get accuracy metrics
        accuracy = historical_tracker.get_average_accuracy()
        assert accuracy is not None
        assert 0.0 <= accuracy <= 100.0

    def test_historical_data_improves_estimates(
        self,
        historical_tracker,
        sample_complexity_assessment
    ):
        """Test that historical data improves future estimates."""
        # Record multiple completions for STANDARD complexity
        for i in range(5):
            historical_tracker.record_completion(
                task_id=f"test-{i:03d}",
                task_description=f"Test task {i}",
                complexity=Complexity.STANDARD,
                estimated_minutes=30.0,
                actual_minutes=35.0 + (i * 2),  # Gradually increasing
            )

        # Build historical data manually for estimator
        historical_data = {
            "complexity": {
                "standard": [r.actual_minutes for r in historical_tracker.records
                           if r.complexity == Complexity.STANDARD]
            }
        }
        estimator_with_history = TimeEstimator(historical_data=historical_data)

        # Get estimate with historical data
        estimate_with_history = estimator_with_history.estimate(sample_complexity_assessment)

        # Create estimator without historical data
        estimator_without_history = TimeEstimator()
        estimate_without_history = estimator_without_history.estimate(sample_complexity_assessment)

        # Historical estimate should be different (refined by data)
        assert estimate_with_history.estimated_minutes != estimate_without_history.estimated_minutes

        # Historical estimate should be closer to actual average (39.0 minutes)
        historical_avg = 39.0  # (35 + 37 + 39 + 41 + 43) / 5
        assert abs(estimate_with_history.estimated_minutes - historical_avg) < \
               abs(estimate_without_history.estimated_minutes - historical_avg)

    def test_progress_calculation_integration(
        self,
        sample_implementation_plan,
        temp_estimation_dir
    ):
        """Test integration with progress calculator."""
        # Create progress calculator
        plan_file = temp_estimation_dir / "implementation_plan.json"
        plan_file.write_text(json.dumps(sample_implementation_plan.to_dict()))

        calculator = ProgressCalculator(sample_implementation_plan)

        # Get progress snapshot
        snapshot = calculator.calculate_progress()

        # Verify snapshot structure
        assert isinstance(snapshot, ProgressSnapshot)
        assert snapshot.total_subtasks == 4
        assert snapshot.completed_subtasks == 2
        assert snapshot.in_progress_subtasks == 1
        assert snapshot.pending_subtasks == 1

        # Verify time calculations
        assert snapshot.total_estimated_minutes == 53  # 15 + 10 + 20 + 8
        assert snapshot.elapsed_estimated_minutes == 25  # 15 + 10
        assert snapshot.remaining_estimated_minutes == 28  # 20 + 8

        # Verify progress percentage
        assert snapshot.percent_complete == 50.0  # 2 out of 4 subtasks

    def test_full_workflow_with_updates(
        self,
        time_estimator,
        historical_tracker,
        sample_implementation_plan,
        temp_estimation_dir
    ):
        """Test complete workflow: estimate -> execute -> track -> update."""
        # Step 1: Create initial time estimates for subtasks
        for phase in sample_implementation_plan.phases:
            for subtask in phase.subtasks:
                if subtask.estimated_duration_minutes is None:
                    # Estimate based on description
                    estimate = time_estimator.estimate_subtask(
                        description=subtask.description,
                        files_count=1,
                        service=subtask.service
                    )
                    subtask.estimated_duration_minutes = int(estimate.estimated_minutes)

        # Step 2: Create progress calculator
        calculator = ProgressCalculator(sample_implementation_plan)
        initial_snapshot = calculator.calculate_progress()

        # Verify initial state
        assert initial_snapshot.completed_subtasks == 2
        assert initial_snapshot.remaining_estimated_minutes > 0

        # Step 3: Complete an in-progress subtask
        in_progress_subtask = None
        for phase in sample_implementation_plan.phases:
            for subtask in phase.subtasks:
                if subtask.status == SubtaskStatus.IN_PROGRESS:
                    in_progress_subtask = subtask
                    break

        assert in_progress_subtask is not None

        # Mark as completed
        in_progress_subtask.status = SubtaskStatus.COMPLETED
        in_progress_subtask.completed_at = datetime.now().isoformat()

        # Notify calculator of completion (invalidates cache)
        calculator.on_subtask_complete(in_progress_subtask)

        # Step 4: Get updated progress
        updated_snapshot = calculator.calculate_progress(force_refresh=True)

        # Verify progress updated
        assert updated_snapshot.completed_subtasks == 3
        assert updated_snapshot.completed_subtasks > initial_snapshot.completed_subtasks
        assert updated_snapshot.remaining_estimated_minutes < initial_snapshot.remaining_estimated_minutes

        # Step 5: Record completion in historical tracker
        historical_tracker.record_completion(
            task_id="test-full-workflow",
            task_description="Full workflow test",
            complexity=Complexity.STANDARD,
            estimated_minutes=initial_snapshot.total_estimated_minutes,
            actual_minutes=initial_snapshot.total_estimated_minutes * 1.1,  # 10% over
        )

        # Verify historical record
        records = historical_tracker.records
        assert len(records) == 1
        assert records[0].task_id == "test-full-workflow"

    def test_velocity_based_remaining_time(
        self,
        sample_implementation_plan
    ):
        """Test velocity-based remaining time calculation."""
        # Add timing data to completed subtasks
        start_time = datetime.now() - timedelta(minutes=30)

        for i, subtask in enumerate(sample_implementation_plan.phases[0].subtasks):
            if subtask.status == SubtaskStatus.COMPLETED:
                # Tasks took 20% longer than estimated
                actual_duration = subtask.estimated_duration_minutes * 1.2
                subtask.started_at = (start_time + timedelta(minutes=i * 20)).isoformat()
                subtask.completed_at = (
                    start_time + timedelta(minutes=i * 20 + actual_duration)
                ).isoformat()

        # Create calculator with timing data
        calculator = ProgressCalculator(sample_implementation_plan)
        snapshot = calculator.calculate_progress()

        # Verify velocity calculation
        assert snapshot.velocity_ratio is not None
        assert snapshot.velocity_ratio > 1.0  # Tasks taking longer than estimated

        # Adjusted remaining time should be higher than base estimate
        assert snapshot.adjusted_remaining_minutes is not None
        assert snapshot.adjusted_remaining_minutes > snapshot.remaining_estimated_minutes

    def test_accuracy_metrics_flow(
        self,
        historical_tracker
    ):
        """Test accuracy metrics calculation across multiple completions."""
        # Record various completions with different accuracy levels
        test_cases = [
            # (estimated, actual, complexity)
            (20.0, 22.0, Complexity.SIMPLE),    # 10% over
            (20.0, 18.0, Complexity.SIMPLE),    # 10% under
            (30.0, 35.0, Complexity.STANDARD),  # 17% over
            (30.0, 28.0, Complexity.STANDARD),  # 7% under
            (60.0, 75.0, Complexity.COMPLEX),   # 25% over
        ]

        for i, (estimated, actual, complexity) in enumerate(test_cases):
            historical_tracker.record_completion(
                task_id=f"accuracy-test-{i:03d}",
                task_description=f"Accuracy test {i}",
                complexity=complexity,
                estimated_minutes=estimated,
                actual_minutes=actual,
            )

        # Get overall accuracy
        overall_accuracy = historical_tracker.get_average_accuracy()
        assert overall_accuracy is not None
        assert 0.0 <= overall_accuracy <= 100.0

        # Get complexity-specific accuracy
        simple_accuracy = historical_tracker.get_average_accuracy(
            complexity=Complexity.SIMPLE
        )
        assert simple_accuracy is not None

        # SIMPLE tasks have accuracy ratio closer to 1.0 (avg of 1.1 and 0.9 = 1.0)
        # compared to other tasks (ratio 1.17, 0.93, 1.25)
        assert abs(simple_accuracy - 1.0) <= abs(overall_accuracy - 1.0)

    def test_subtask_estimation_with_keywords(
        self,
        time_estimator
    ):
        """Test subtask estimation with keyword detection."""
        # Test estimation
        test_estimate = time_estimator.estimate_subtask(
            description="Add unit tests for authentication",
            files_count=2,
            service="backend"
        )

        # Refactor estimation
        refactor_estimate = time_estimator.estimate_subtask(
            description="Refactor complex authentication logic",
            files_count=2,
            service="backend"
        )

        # Tests should take less time than refactoring
        assert test_estimate.estimated_minutes < refactor_estimate.estimated_minutes

    def test_data_persistence_across_sessions(
        self,
        temp_estimation_dir
    ):
        """Test that historical data persists across sessions."""
        data_file = temp_estimation_dir / "estimation_data.json"

        # Session 1: Create tracker and record data
        tracker1 = HistoricalTracker(data_file=data_file)
        tracker1.record_completion(
            task_id="persist-test-001",
            task_description="Persistence test",
            complexity=Complexity.STANDARD,
            estimated_minutes=30.0,
            actual_minutes=32.0,
        )

        # Verify file was created
        assert data_file.exists()

        # Session 2: Load tracker and verify data
        tracker2 = HistoricalTracker(data_file=data_file)
        records = tracker2.records

        assert len(records) == 1
        assert records[0].task_id == "persist-test-001"
        assert records[0].actual_minutes == 32.0

    def test_empty_plan_edge_case(self):
        """Test progress calculation with empty plan."""
        empty_plan = ImplementationPlan(
            feature="Empty Test",
            workflow_type=WorkflowType.FEATURE,
            services_involved=["backend"],
            phases=[],
        )

        calculator = ProgressCalculator(empty_plan)
        snapshot = calculator.calculate_progress()

        # Should handle empty plan gracefully
        assert snapshot.total_subtasks == 0
        assert snapshot.completed_subtasks == 0
        assert snapshot.total_estimated_minutes == 0.0
        assert snapshot.percent_complete == 0.0

    def test_all_components_integration(
        self,
        time_estimator,
        historical_tracker,
        sample_complexity_assessment,
        sample_implementation_plan,
        temp_estimation_dir
    ):
        """Test all components working together in realistic scenario."""
        # 1. Initial estimation from complexity assessment
        initial_estimate = time_estimator.estimate(sample_complexity_assessment)
        assert initial_estimate.estimated_minutes > 0

        # 2. Create progress calculator for tracking
        calculator = ProgressCalculator(sample_implementation_plan)
        initial_progress = calculator.calculate_progress()

        # 3. Simulate work completion
        completed_count = 0
        for phase in sample_implementation_plan.phases:
            for subtask in phase.subtasks:
                if subtask.status == SubtaskStatus.COMPLETED:
                    completed_count += 1

        assert completed_count > 0

        # 4. Record historical completion
        historical_tracker.record_completion(
            task_id="integration-test",
            task_description=sample_implementation_plan.feature,
            complexity=sample_complexity_assessment.complexity,
            estimated_minutes=initial_estimate.estimated_minutes,
            actual_minutes=initial_progress.elapsed_estimated_minutes,
        )

        # 5. Verify all data flows correctly
        records = historical_tracker.records
        assert len(records) == 1

        accuracy = historical_tracker.get_average_accuracy()
        assert accuracy is not None

        # 6. Create new estimator with historical data
        historical_data = {
            "complexity": {
                r.complexity.value: [r.actual_minutes]
                for r in historical_tracker.records
            }
        }
        improved_estimator = TimeEstimator(historical_data=historical_data)

        # 7. Get improved estimate
        improved_estimate = improved_estimator.estimate(sample_complexity_assessment)
        assert improved_estimate.estimated_minutes > 0

        # System is now learning and improving estimates


# ============================================================================
# Component Integration Tests
# ============================================================================

class TestComponentInteractions:
    """Test specific interactions between components."""

    def test_estimator_to_tracker_data_flow(
        self,
        time_estimator,
        historical_tracker,
        sample_complexity_assessment
    ):
        """Test data flow from estimator to tracker."""
        estimate = time_estimator.estimate(sample_complexity_assessment)

        # Record using estimate data
        historical_tracker.record_completion(
            task_id="flow-test",
            task_description="Data flow test",
            complexity=sample_complexity_assessment.complexity,
            estimated_minutes=estimate.estimated_minutes,
            actual_minutes=estimate.estimated_minutes * 0.9,  # 10% faster
        )

        records = historical_tracker.records
        assert len(records) == 1
        assert records[0].estimated_minutes == estimate.estimated_minutes

    def test_tracker_to_estimator_feedback_loop(
        self,
        historical_tracker
    ):
        """Test feedback loop from tracker back to estimator."""
        # Record completions
        for i in range(3):
            historical_tracker.record_completion(
                task_id=f"feedback-{i:03d}",
                task_description=f"Feedback test {i}",
                complexity=Complexity.SIMPLE,
                estimated_minutes=15.0,
                actual_minutes=18.0,  # Consistently 20% over
            )

        # Build data for estimator
        historical_data = {
            "complexity": {
                "simple": [r.actual_minutes for r in historical_tracker.records]
            }
        }

        # Verify data structure
        assert "complexity" in historical_data
        assert "simple" in historical_data["complexity"]
        assert len(historical_data["complexity"]["simple"]) == 3

        # Create estimator with feedback
        estimator = TimeEstimator(historical_data=historical_data)

        # Get estimate
        assessment = ComplexityAssessment(
            complexity=Complexity.SIMPLE,
            confidence=0.8,
        )
        estimate = estimator.estimate(assessment)

        # Estimate should be influenced by historical 18-minute actuals
        assert estimate.estimated_minutes > 15.0  # Higher than base

    def test_plan_to_calculator_synchronization(
        self,
        sample_implementation_plan
    ):
        """Test synchronization between plan and calculator."""
        calculator = ProgressCalculator(sample_implementation_plan)

        # Get initial snapshot
        snapshot1 = calculator.calculate_progress()

        # Modify plan
        modified_subtask = sample_implementation_plan.phases[0].subtasks[2]
        modified_subtask.status = SubtaskStatus.COMPLETED
        modified_subtask.completed_at = datetime.now().isoformat()

        # Notify calculator
        calculator.on_subtask_complete(modified_subtask)

        # Get updated snapshot
        snapshot2 = calculator.calculate_progress(force_refresh=True)

        # Verify synchronization
        assert snapshot2.completed_subtasks > snapshot1.completed_subtasks
