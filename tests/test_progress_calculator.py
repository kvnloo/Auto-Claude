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
