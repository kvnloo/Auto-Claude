"""
Tests for ProgressCalculator Module
====================================

Tests real-time remaining time calculation that updates as subtasks complete.
"""

import pytest
from datetime import datetime, timedelta

from apps.backend.implementation_plan import ImplementationPlan, Phase, Subtask
from apps.backend.implementation_plan.enums import SubtaskStatus
from apps.backend.estimation.progress_calculator import ProgressCalculator, ProgressSnapshot


def create_test_plan() -> ImplementationPlan:
    """Create a test implementation plan with subtasks."""
    subtasks = [
        Subtask(
            id="1.1",
            description="Task 1",
            status=SubtaskStatus.PENDING,
            estimated_duration_minutes=10,
        ),
        Subtask(
            id="1.2",
            description="Task 2",
            status=SubtaskStatus.PENDING,
            estimated_duration_minutes=20,
        ),
        Subtask(
            id="1.3",
            description="Task 3",
            status=SubtaskStatus.PENDING,
            estimated_duration_minutes=30,
        ),
    ]

    phase = Phase(phase=1, name="Test Phase", subtasks=subtasks)

    plan = ImplementationPlan(
        feature="Test Feature",
        phases=[phase],
    )

    return plan


def test_remaining_time():
    """Test real-time remaining time calculation as subtasks complete."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Initial state - all tasks pending
    snapshot = calculator.calculate_progress()
    assert snapshot.total_subtasks == 3
    assert snapshot.completed_subtasks == 0
    assert snapshot.pending_subtasks == 3
    assert snapshot.total_estimated_minutes == 60.0  # 10 + 20 + 30
    assert snapshot.remaining_estimated_minutes == 60.0
    assert snapshot.elapsed_estimated_minutes == 0.0

    # Complete first subtask (10 minutes estimated, took 8 minutes actual)
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.start(session_id=1)
    start_time = datetime.now() - timedelta(minutes=8)
    subtask1.started_at = start_time.isoformat()
    subtask1.complete()

    # Update calculator - should show remaining time with velocity adjustment
    calculator.invalidate_cache()
    snapshot = calculator.calculate_progress()

    assert snapshot.completed_subtasks == 1
    assert snapshot.pending_subtasks == 2
    assert snapshot.elapsed_estimated_minutes == 10.0  # Estimated time of completed task
    assert snapshot.remaining_estimated_minutes == 50.0  # 20 + 30
    assert snapshot.actual_elapsed_minutes == pytest.approx(8.0, abs=0.1)

    # Velocity = 8/10 = 0.8 (going 20% faster)
    assert snapshot.velocity_ratio == pytest.approx(0.8, abs=0.01)
    # Adjusted remaining = 50 * 0.8 = 40 minutes
    assert snapshot.adjusted_remaining_minutes == pytest.approx(40.0, abs=0.1)

    # Complete second subtask (20 minutes estimated, took 25 minutes actual)
    subtask2 = plan.phases[0].subtasks[1]
    subtask2.start(session_id=1)
    start_time = datetime.now() - timedelta(minutes=25)
    subtask2.started_at = start_time.isoformat()
    subtask2.complete()

    # Update calculator again
    calculator.invalidate_cache()
    snapshot = calculator.calculate_progress()

    assert snapshot.completed_subtasks == 2
    assert snapshot.pending_subtasks == 1
    assert snapshot.elapsed_estimated_minutes == 30.0  # 10 + 20
    assert snapshot.remaining_estimated_minutes == 30.0  # Only last task
    assert snapshot.actual_elapsed_minutes == pytest.approx(33.0, abs=0.1)  # 8 + 25

    # Velocity = 33/30 = 1.1 (going 10% slower)
    assert snapshot.velocity_ratio == pytest.approx(1.1, abs=0.01)
    # Adjusted remaining = 30 * 1.1 = 33 minutes
    assert snapshot.adjusted_remaining_minutes == pytest.approx(33.0, abs=0.1)

    # get_remaining_time() should return adjusted estimate
    remaining = calculator.get_remaining_time()
    assert remaining == pytest.approx(33.0, abs=0.1)


def test_remaining_time_without_actual_data():
    """Test remaining time calculation when no actual timing data is available."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Mark first subtask as completed but without timestamp data
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.status = SubtaskStatus.COMPLETED
    # Don't set started_at or completed_at

    snapshot = calculator.calculate_progress()

    assert snapshot.completed_subtasks == 1
    assert snapshot.remaining_estimated_minutes == 50.0  # 20 + 30
    assert snapshot.actual_elapsed_minutes is None  # No timing data
    assert snapshot.velocity_ratio is None  # Can't calculate without actual data
    assert snapshot.adjusted_remaining_minutes is None

    # get_remaining_time() should fall back to raw estimate
    remaining = calculator.get_remaining_time()
    assert remaining == 50.0


def test_on_subtask_complete_hook():
    """Test automatic cache invalidation when subtask completes."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Get initial snapshot (caches result)
    snapshot1 = calculator.calculate_progress()
    assert snapshot1.completed_subtasks == 0

    # Complete a subtask and call the hook
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.start(session_id=1)
    subtask1.complete()

    # Call the hook to invalidate cache
    calculator.on_subtask_complete(subtask1)

    # Get fresh snapshot - should reflect the completed subtask
    snapshot2 = calculator.calculate_progress()
    assert snapshot2.completed_subtasks == 1
    assert snapshot2.remaining_estimated_minutes == 50.0


def test_get_remaining_time_formatted():
    """Test human-readable remaining time format."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete one subtask with timing data
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.start(session_id=1)
    start_time = datetime.now() - timedelta(minutes=8)
    subtask1.started_at = start_time.isoformat()
    subtask1.complete()

    calculator.invalidate_cache()

    # Get formatted remaining time
    formatted = calculator.get_remaining_time_formatted()

    # Should show adjusted remaining time (~40 minutes)
    assert "40" in formatted or "minutes" in formatted.lower()


def test_update_plan_time_fields():
    """Test that plan time fields are updated with real-time data."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete one subtask with timing data
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.start(session_id=1)
    start_time = datetime.now() - timedelta(minutes=8)
    subtask1.started_at = start_time.isoformat()
    subtask1.complete()

    calculator.invalidate_cache()

    # Update plan time fields
    calculator.update_plan_time_fields()

    assert plan.total_estimated_minutes == 60
    assert plan.elapsed_minutes == 8  # Actual elapsed time
    assert plan.remaining_minutes == 40  # Adjusted remaining (50 * 0.8)


def test_progress_snapshot_to_dict():
    """Test converting ProgressSnapshot to dictionary."""
    snapshot = ProgressSnapshot(
        total_subtasks=10,
        completed_subtasks=5,
        in_progress_subtasks=1,
        pending_subtasks=4,
        failed_subtasks=0,
        total_estimated_minutes=100.0,
        elapsed_estimated_minutes=50.0,
        remaining_estimated_minutes=50.0,
        actual_elapsed_minutes=45.0,
        adjusted_remaining_minutes=45.0,
        velocity_ratio=0.9,
        percent_complete=50.0,
        snapshot_time="2024-01-01T12:00:00",
    )

    result = snapshot.to_dict()

    assert result["total_subtasks"] == 10
    assert result["completed_subtasks"] == 5
    assert result["in_progress_subtasks"] == 1
    assert result["pending_subtasks"] == 4
    assert result["failed_subtasks"] == 0
    assert result["total_estimated_minutes"] == 100.0
    assert result["elapsed_estimated_minutes"] == 50.0
    assert result["remaining_estimated_minutes"] == 50.0
    assert result["actual_elapsed_minutes"] == 45.0
    assert result["adjusted_remaining_minutes"] == 45.0
    assert result["velocity_ratio"] == 0.9
    assert result["percent_complete"] == 50.0
    assert result["snapshot_time"] == "2024-01-01T12:00:00"


def test_progress_snapshot_from_dict():
    """Test creating ProgressSnapshot from dictionary."""
    data = {
        "total_subtasks": 10,
        "completed_subtasks": 5,
        "in_progress_subtasks": 1,
        "pending_subtasks": 4,
        "failed_subtasks": 0,
        "total_estimated_minutes": 100.0,
        "elapsed_estimated_minutes": 50.0,
        "remaining_estimated_minutes": 50.0,
        "actual_elapsed_minutes": 45.0,
        "adjusted_remaining_minutes": 45.0,
        "velocity_ratio": 0.9,
        "percent_complete": 50.0,
        "snapshot_time": "2024-01-01T12:00:00",
    }

    snapshot = ProgressSnapshot.from_dict(data)

    assert snapshot.total_subtasks == 10
    assert snapshot.completed_subtasks == 5
    assert snapshot.in_progress_subtasks == 1
    assert snapshot.pending_subtasks == 4
    assert snapshot.failed_subtasks == 0
    assert snapshot.total_estimated_minutes == 100.0
    assert snapshot.elapsed_estimated_minutes == 50.0
    assert snapshot.remaining_estimated_minutes == 50.0
    assert snapshot.actual_elapsed_minutes == 45.0
    assert snapshot.adjusted_remaining_minutes == 45.0
    assert snapshot.velocity_ratio == 0.9
    assert snapshot.percent_complete == 50.0
    assert snapshot.snapshot_time == "2024-01-01T12:00:00"


def test_progress_snapshot_optional_fields():
    """Test ProgressSnapshot with optional fields omitted."""
    snapshot = ProgressSnapshot(
        total_subtasks=5,
        completed_subtasks=2,
        in_progress_subtasks=0,
        pending_subtasks=3,
        failed_subtasks=0,
        total_estimated_minutes=50.0,
        elapsed_estimated_minutes=20.0,
        remaining_estimated_minutes=30.0,
    )

    result = snapshot.to_dict()

    # Required fields present
    assert "total_subtasks" in result
    assert "completed_subtasks" in result

    # Optional fields not present when None
    assert "actual_elapsed_minutes" not in result
    assert "adjusted_remaining_minutes" not in result
    assert "velocity_ratio" not in result


def test_get_estimated_completion_time():
    """Test getting estimated completion time as ISO timestamp."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete one subtask with timing data
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.start(session_id=1)
    start_time = datetime.now() - timedelta(minutes=8)
    subtask1.started_at = start_time.isoformat()
    subtask1.complete()

    calculator.invalidate_cache()

    # Get estimated completion time
    completion_time = calculator.get_estimated_completion_time()

    # Should be a valid ISO timestamp
    assert completion_time is not None
    parsed_time = datetime.fromisoformat(completion_time)

    # Should be in the future (roughly 40 minutes from now based on velocity)
    now = datetime.now()
    assert parsed_time > now

    # Should be roughly 40 minutes from now (with some tolerance for test execution time)
    time_diff = (parsed_time - now).total_seconds() / 60.0
    assert 35.0 <= time_diff <= 45.0


def test_get_estimated_completion_time_all_complete():
    """Test completion time when all tasks are complete."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete all subtasks
    for subtask in plan.phases[0].subtasks:
        subtask.start(session_id=1)
        subtask.complete()

    calculator.invalidate_cache()

    # Should return None when everything is complete
    completion_time = calculator.get_estimated_completion_time()
    assert completion_time is None


def test_get_velocity_summary_insufficient_data():
    """Test velocity summary when no actual timing data is available."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete a subtask without timing data
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.status = SubtaskStatus.COMPLETED

    calculator.invalidate_cache()

    # Get velocity summary
    summary = calculator.get_velocity_summary()

    assert summary["status"] == "insufficient_data"
    assert "not enough" in summary["message"].lower()


def test_get_velocity_summary_ahead_of_schedule():
    """Test velocity summary when work is ahead of schedule."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete first subtask faster than estimated (10 min estimated, 6 min actual)
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.start(session_id=1)
    start_time = datetime.now() - timedelta(minutes=6)
    subtask1.started_at = start_time.isoformat()
    subtask1.complete()

    calculator.invalidate_cache()

    # Get velocity summary
    summary = calculator.get_velocity_summary()

    assert summary["status"] == "ahead_of_schedule"
    assert summary["velocity_ratio"] == pytest.approx(0.6, abs=0.01)
    assert "faster" in summary["message"].lower()
    assert summary["completed_subtasks"] == 1
    assert summary["total_subtasks"] == 3


def test_get_velocity_summary_behind_schedule():
    """Test velocity summary when work is behind schedule."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete first subtask slower than estimated (10 min estimated, 15 min actual)
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.start(session_id=1)
    start_time = datetime.now() - timedelta(minutes=15)
    subtask1.started_at = start_time.isoformat()
    subtask1.complete()

    calculator.invalidate_cache()

    # Get velocity summary
    summary = calculator.get_velocity_summary()

    assert summary["status"] == "behind_schedule"
    assert summary["velocity_ratio"] == pytest.approx(1.5, abs=0.01)
    assert "slower" in summary["message"].lower()
    assert summary["completed_subtasks"] == 1
    assert summary["total_subtasks"] == 3


def test_get_velocity_summary_on_track():
    """Test velocity summary when work is on track."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete first subtask close to estimate (10 min estimated, 10 min actual)
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.start(session_id=1)
    start_time = datetime.now() - timedelta(minutes=10)
    subtask1.started_at = start_time.isoformat()
    subtask1.complete()

    calculator.invalidate_cache()

    # Get velocity summary
    summary = calculator.get_velocity_summary()

    assert summary["status"] == "on_track"
    assert summary["velocity_ratio"] == pytest.approx(1.0, abs=0.01)
    assert "on schedule" in summary["message"].lower()


def test_cache_behavior():
    """Test that caching works correctly."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # First call - calculates and caches
    snapshot1 = calculator.calculate_progress()
    assert snapshot1.completed_subtasks == 0

    # Complete a subtask but don't invalidate cache
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.status = SubtaskStatus.COMPLETED

    # Second call without force_refresh - should return cached value
    snapshot2 = calculator.calculate_progress(force_refresh=False)
    assert snapshot2.completed_subtasks == 0  # Still cached value

    # Third call with force_refresh - should recalculate
    snapshot3 = calculator.calculate_progress(force_refresh=True)
    assert snapshot3.completed_subtasks == 1  # Fresh calculation


def test_empty_plan():
    """Test progress calculation with empty plan."""
    plan = ImplementationPlan(feature="Empty", phases=[])
    calculator = ProgressCalculator(plan)

    snapshot = calculator.calculate_progress()

    assert snapshot.total_subtasks == 0
    assert snapshot.completed_subtasks == 0
    assert snapshot.pending_subtasks == 0
    assert snapshot.total_estimated_minutes == 0.0
    assert snapshot.remaining_estimated_minutes == 0.0
    assert snapshot.percent_complete == 0.0


def test_all_failed_subtasks():
    """Test progress calculation with failed subtasks."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Mark all subtasks as failed
    for subtask in plan.phases[0].subtasks:
        subtask.start(session_id=1)
        subtask.fail()

    calculator.invalidate_cache()
    snapshot = calculator.calculate_progress()

    assert snapshot.completed_subtasks == 0
    assert snapshot.failed_subtasks == 3
    assert snapshot.pending_subtasks == 0
    assert snapshot.percent_complete == 0.0


def test_in_progress_subtasks():
    """Test counting of in-progress subtasks."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Mark one as in progress
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.start(session_id=1)

    # Mark one as complete
    subtask2 = plan.phases[0].subtasks[1]
    subtask2.start(session_id=1)
    subtask2.complete()

    calculator.invalidate_cache()
    snapshot = calculator.calculate_progress()

    assert snapshot.completed_subtasks == 1
    assert snapshot.in_progress_subtasks == 1
    assert snapshot.pending_subtasks == 1


def test_subtask_without_duration_estimate():
    """Test handling subtasks with no estimated duration."""
    subtasks = [
        Subtask(
            id="1.1",
            description="Task without estimate",
            status=SubtaskStatus.PENDING,
            estimated_duration_minutes=None,  # No estimate
        ),
        Subtask(
            id="1.2",
            description="Task with estimate",
            status=SubtaskStatus.PENDING,
            estimated_duration_minutes=20,
        ),
    ]

    phase = Phase(phase=1, name="Test Phase", subtasks=subtasks)
    plan = ImplementationPlan(feature="Test Feature", phases=[phase])
    calculator = ProgressCalculator(plan)

    snapshot = calculator.calculate_progress()

    # Should treat None as 0.0
    assert snapshot.total_estimated_minutes == 20.0


def test_remaining_time_formatted_edge_cases():
    """Test formatted remaining time edge cases."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete all subtasks
    for subtask in plan.phases[0].subtasks:
        subtask.start(session_id=1)
        subtask.complete()

    calculator.invalidate_cache()

    # Should return "Complete"
    formatted = calculator.get_remaining_time_formatted()
    assert formatted == "Complete"


def test_remaining_time_formatted_hours_only():
    """Test formatted time with exact hours."""
    subtasks = [
        Subtask(
            id="1.1",
            description="Long task",
            status=SubtaskStatus.PENDING,
            estimated_duration_minutes=120,  # Exactly 2 hours
        ),
    ]

    phase = Phase(phase=1, name="Test Phase", subtasks=subtasks)
    plan = ImplementationPlan(feature="Test Feature", phases=[phase])
    calculator = ProgressCalculator(plan)

    formatted = calculator.get_remaining_time_formatted()
    assert "2 hours" in formatted
    assert "minute" not in formatted


def test_remaining_time_formatted_singular():
    """Test formatted time with singular hour/minute."""
    subtasks = [
        Subtask(
            id="1.1",
            description="Medium task",
            status=SubtaskStatus.PENDING,
            estimated_duration_minutes=61,  # 1 hour 1 minute
        ),
    ]

    phase = Phase(phase=1, name="Test Phase", subtasks=subtasks)
    plan = ImplementationPlan(feature="Test Feature", phases=[phase])
    calculator = ProgressCalculator(plan)

    formatted = calculator.get_remaining_time_formatted()
    assert "1 hour" in formatted
    assert "1 minute" in formatted
    # Should not have plural forms
    assert "hours" not in formatted
    assert "minutes" not in formatted


def test_invalid_timestamp_handling():
    """Test handling of invalid timestamps in subtasks."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete subtask with invalid timestamp
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.status = SubtaskStatus.COMPLETED
    subtask1.started_at = "invalid-timestamp"
    subtask1.completed_at = "also-invalid"

    calculator.invalidate_cache()
    snapshot = calculator.calculate_progress()

    # Should handle gracefully - no actual elapsed time calculated
    assert snapshot.actual_elapsed_minutes is None
    assert snapshot.velocity_ratio is None


def test_mixed_complete_and_incomplete_with_timestamps():
    """Test calculation with mix of complete and incomplete subtasks."""
    plan = create_test_plan()
    calculator = ProgressCalculator(plan)

    # Complete first subtask with timestamp
    subtask1 = plan.phases[0].subtasks[0]
    subtask1.start(session_id=1)
    start_time = datetime.now() - timedelta(minutes=8)
    subtask1.started_at = start_time.isoformat()
    subtask1.complete()

    # Mark second as in progress (no completed_at)
    subtask2 = plan.phases[0].subtasks[1]
    subtask2.start(session_id=1)

    calculator.invalidate_cache()
    snapshot = calculator.calculate_progress()

    # Should only count completed subtask in elapsed time
    assert snapshot.actual_elapsed_minutes == pytest.approx(8.0, abs=0.1)
    assert snapshot.completed_subtasks == 1
    assert snapshot.in_progress_subtasks == 1


def test_multiple_phases():
    """Test progress calculation across multiple phases."""
    phase1_subtasks = [
        Subtask(id="1.1", description="Task 1.1", status=SubtaskStatus.COMPLETED, estimated_duration_minutes=10),
        Subtask(id="1.2", description="Task 1.2", status=SubtaskStatus.COMPLETED, estimated_duration_minutes=10),
    ]
    phase2_subtasks = [
        Subtask(id="2.1", description="Task 2.1", status=SubtaskStatus.IN_PROGRESS, estimated_duration_minutes=15),
        Subtask(id="2.2", description="Task 2.2", status=SubtaskStatus.PENDING, estimated_duration_minutes=20),
    ]

    phase1 = Phase(phase=1, name="Phase 1", subtasks=phase1_subtasks)
    phase2 = Phase(phase=2, name="Phase 2", subtasks=phase2_subtasks)

    plan = ImplementationPlan(feature="Multi-phase Feature", phases=[phase1, phase2])
    calculator = ProgressCalculator(plan)

    snapshot = calculator.calculate_progress()

    assert snapshot.total_subtasks == 4
    assert snapshot.completed_subtasks == 2
    assert snapshot.in_progress_subtasks == 1
    assert snapshot.pending_subtasks == 1
    assert snapshot.total_estimated_minutes == 55.0
    assert snapshot.elapsed_estimated_minutes == 20.0
    assert snapshot.remaining_estimated_minutes == 35.0
    assert snapshot.percent_complete == 50.0
