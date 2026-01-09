#!/usr/bin/env python3
"""
Test suite for Historical Tracker
==================================

Tests historical completion tracking and data storage functionality.
"""

import json
import tempfile
from pathlib import Path

import pytest
from estimation.historical_tracker import CompletionRecord, HistoricalTracker
from spec.complexity import Complexity


class TestCompletionRecord:
    """Test CompletionRecord dataclass."""

    def test_completion_record_creation(self):
        """Test creating a CompletionRecord."""
        record = CompletionRecord(
            task_id="001-test-feature",
            task_description="Add user authentication",
            complexity=Complexity.STANDARD,
            estimated_minutes=30.0,
            actual_minutes=35.0,
            accuracy_ratio=35.0 / 30.0,
            estimation_error=((35.0 - 30.0) / 30.0) * 100,
            completed_at="2026-01-09T10:00:00",
            services_involved=["backend"],
            files_modified=5,
            external_integrations=["auth0"],
        )
        assert record.task_id == "001-test-feature"
        assert record.complexity == Complexity.STANDARD
        assert record.estimated_minutes == 30.0
        assert record.actual_minutes == 35.0

    def test_completion_record_to_dict(self):
        """Test converting CompletionRecord to dictionary."""
        record = CompletionRecord(
            task_id="001-test-feature",
            task_description="Add user authentication",
            complexity=Complexity.SIMPLE,
            estimated_minutes=15.0,
            actual_minutes=18.0,
            accuracy_ratio=1.2,
            estimation_error=20.0,
            completed_at="2026-01-09T10:00:00",
        )
        result = record.to_dict()
        assert result["task_id"] == "001-test-feature"
        assert result["complexity"] == "simple"
        assert result["estimated_minutes"] == 15.0
        assert result["actual_minutes"] == 18.0

    def test_completion_record_from_dict(self):
        """Test creating CompletionRecord from dictionary."""
        data = {
            "task_id": "002-test-feature",
            "task_description": "Add payment processing",
            "complexity": "complex",
            "estimated_minutes": 60.0,
            "actual_minutes": 75.0,
            "accuracy_ratio": 1.25,
            "estimation_error": 25.0,
            "completed_at": "2026-01-09T11:00:00",
            "services_involved": ["backend", "frontend"],
            "files_modified": 10,
            "external_integrations": ["stripe"],
        }
        record = CompletionRecord.from_dict(data)
        assert record.task_id == "002-test-feature"
        assert record.complexity == Complexity.COMPLEX
        assert record.estimated_minutes == 60.0
        assert record.actual_minutes == 75.0
        assert record.services_involved == ["backend", "frontend"]


class TestHistoricalTracker:
    """Test HistoricalTracker class."""

    def test_tracker_initialization(self):
        """Test creating a HistoricalTracker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "test_data.json"
            tracker = HistoricalTracker(data_file=data_file)
            assert tracker.data_file == data_file
            assert tracker.records == []
            assert data_file.parent.exists()

    def test_data_storage(self):
        """Test saving and loading historical data."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"

            # Create tracker and add records
            tracker = HistoricalTracker(data_file=data_file)

            # Record first completion
            record1 = tracker.record_completion(
                task_id="001-auth",
                task_description="Add authentication",
                complexity=Complexity.SIMPLE,
                estimated_minutes=15.0,
                actual_minutes=18.0,
                services_involved=["backend"],
                files_modified=3,
            )

            # Record second completion
            record2 = tracker.record_completion(
                task_id="002-payment",
                task_description="Add payment processing",
                complexity=Complexity.COMPLEX,
                estimated_minutes=60.0,
                actual_minutes=75.0,
                services_involved=["backend", "frontend"],
                files_modified=10,
                external_integrations=["stripe"],
            )

            # Verify records are in memory
            assert len(tracker.records) == 2
            assert tracker.records[0].task_id == "001-auth"
            assert tracker.records[1].task_id == "002-payment"

            # Verify file was created and saved
            assert data_file.exists()

            # Load data in a new tracker instance
            new_tracker = HistoricalTracker(data_file=data_file)

            # Verify loaded records match original
            assert len(new_tracker.records) == 2
            assert new_tracker.records[0].task_id == "001-auth"
            assert new_tracker.records[0].complexity == Complexity.SIMPLE
            assert new_tracker.records[0].estimated_minutes == 15.0
            assert new_tracker.records[0].actual_minutes == 18.0

            assert new_tracker.records[1].task_id == "002-payment"
            assert new_tracker.records[1].complexity == Complexity.COMPLEX
            assert new_tracker.records[1].services_involved == ["backend", "frontend"]
            assert new_tracker.records[1].external_integrations == ["stripe"]

    def test_record_completion(self):
        """Test recording a task completion."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"
            tracker = HistoricalTracker(data_file=data_file)

            record = tracker.record_completion(
                task_id="003-search",
                task_description="Add search feature",
                complexity=Complexity.STANDARD,
                estimated_minutes=30.0,
                actual_minutes=25.0,
                services_involved=["backend"],
                files_modified=5,
            )

            # Verify record properties
            assert record.task_id == "003-search"
            assert record.complexity == Complexity.STANDARD
            assert record.estimated_minutes == 30.0
            assert record.actual_minutes == 25.0

            # Verify accuracy calculations
            assert record.accuracy_ratio == 25.0 / 30.0  # ~0.833
            expected_error = ((25.0 - 30.0) / 30.0) * 100  # ~-16.67
            assert abs(record.estimation_error - expected_error) < 0.01

            # Verify record was added to tracker
            assert len(tracker.records) == 1
            assert tracker.records[0] == record

    def test_get_records_by_complexity(self):
        """Test filtering records by complexity level."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"
            tracker = HistoricalTracker(data_file=data_file)

            # Add records of different complexity
            tracker.record_completion(
                task_id="001",
                task_description="Simple task",
                complexity=Complexity.SIMPLE,
                estimated_minutes=15.0,
                actual_minutes=18.0,
            )
            tracker.record_completion(
                task_id="002",
                task_description="Standard task",
                complexity=Complexity.STANDARD,
                estimated_minutes=30.0,
                actual_minutes=28.0,
            )
            tracker.record_completion(
                task_id="003",
                task_description="Another simple task",
                complexity=Complexity.SIMPLE,
                estimated_minutes=12.0,
                actual_minutes=15.0,
            )

            # Filter by SIMPLE
            simple_records = tracker.get_records_by_complexity(Complexity.SIMPLE)
            assert len(simple_records) == 2
            assert all(r.complexity == Complexity.SIMPLE for r in simple_records)

            # Filter by STANDARD
            standard_records = tracker.get_records_by_complexity(Complexity.STANDARD)
            assert len(standard_records) == 1
            assert standard_records[0].task_id == "002"

            # Filter by COMPLEX (none exist)
            complex_records = tracker.get_records_by_complexity(Complexity.COMPLEX)
            assert len(complex_records) == 0

    def test_get_average_accuracy(self):
        """Test calculating average estimation accuracy."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"
            tracker = HistoricalTracker(data_file=data_file)

            # Add records with different accuracy
            tracker.record_completion(
                task_id="001",
                task_description="Task 1",
                complexity=Complexity.SIMPLE,
                estimated_minutes=10.0,
                actual_minutes=10.0,  # accuracy_ratio = 1.0
            )
            tracker.record_completion(
                task_id="002",
                task_description="Task 2",
                complexity=Complexity.SIMPLE,
                estimated_minutes=10.0,
                actual_minutes=12.0,  # accuracy_ratio = 1.2
            )
            tracker.record_completion(
                task_id="003",
                task_description="Task 3",
                complexity=Complexity.STANDARD,
                estimated_minutes=30.0,
                actual_minutes=36.0,  # accuracy_ratio = 1.2
            )

            # Test overall accuracy
            overall_accuracy = tracker.get_average_accuracy()
            expected = (1.0 + 1.2 + 1.2) / 3
            assert abs(overall_accuracy - expected) < 0.01

            # Test accuracy by complexity
            simple_accuracy = tracker.get_average_accuracy(Complexity.SIMPLE)
            expected_simple = (1.0 + 1.2) / 2
            assert abs(simple_accuracy - expected_simple) < 0.01

            standard_accuracy = tracker.get_average_accuracy(Complexity.STANDARD)
            assert standard_accuracy == 1.2

    def test_empty_tracker_accuracy(self):
        """Test that empty tracker returns neutral accuracy."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"
            tracker = HistoricalTracker(data_file=data_file)

            # Empty tracker should return 1.0 (perfect/neutral)
            assert tracker.get_average_accuracy() == 1.0
            assert tracker.get_average_accuracy(Complexity.SIMPLE) == 1.0

    def test_corrupted_data_file(self):
        """Test handling of corrupted JSON file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"

            # Write corrupted JSON
            with open(data_file, "w") as f:
                f.write("{invalid json content")

            # Should handle gracefully
            tracker = HistoricalTracker(data_file=data_file)
            assert tracker.records == []

    def test_legacy_format_support(self):
        """Test loading legacy format (direct list)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"

            # Write legacy format (direct array)
            legacy_data = [
                {
                    "task_id": "001",
                    "task_description": "Legacy task",
                    "complexity": "simple",
                    "estimated_minutes": 15.0,
                    "actual_minutes": 18.0,
                    "accuracy_ratio": 1.2,
                    "estimation_error": 20.0,
                    "completed_at": "2026-01-09T10:00:00",
                }
            ]
            with open(data_file, "w") as f:
                json.dump(legacy_data, f)

            # Should load successfully
            tracker = HistoricalTracker(data_file=data_file)
            assert len(tracker.records) == 1
            assert tracker.records[0].task_id == "001"

    def test_json_file_format(self):
        """Test that saved JSON has correct format with metadata."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"
            tracker = HistoricalTracker(data_file=data_file)

            tracker.record_completion(
                task_id="001",
                task_description="Test task",
                complexity=Complexity.SIMPLE,
                estimated_minutes=15.0,
                actual_minutes=18.0,
            )

            # Read and verify JSON structure
            with open(data_file, "r") as f:
                data = json.load(f)

            assert "version" in data
            assert "updated_at" in data
            assert "total_records" in data
            assert "records" in data
            assert data["version"] == "1.0"
            assert data["total_records"] == 1
            assert isinstance(data["records"], list)

    def test_get_record_count(self):
        """Test getting the total number of completion records."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"
            tracker = HistoricalTracker(data_file=data_file)

            # Initially empty
            assert tracker.get_record_count() == 0

            # Add one record
            tracker.record_completion(
                task_id="001",
                task_description="Task 1",
                complexity=Complexity.SIMPLE,
                estimated_minutes=15.0,
                actual_minutes=18.0,
            )
            assert tracker.get_record_count() == 1

            # Add more records
            tracker.record_completion(
                task_id="002",
                task_description="Task 2",
                complexity=Complexity.STANDARD,
                estimated_minutes=30.0,
                actual_minutes=28.0,
            )
            tracker.record_completion(
                task_id="003",
                task_description="Task 3",
                complexity=Complexity.COMPLEX,
                estimated_minutes=60.0,
                actual_minutes=75.0,
            )
            assert tracker.get_record_count() == 3

    def test_repr(self):
        """Test string representation of tracker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"
            tracker = HistoricalTracker(data_file=data_file)

            # Empty tracker
            repr_str = repr(tracker)
            assert "HistoricalTracker" in repr_str
            assert str(data_file) in repr_str
            assert "records=0" in repr_str

            # Add some records
            tracker.record_completion(
                task_id="001",
                task_description="Task 1",
                complexity=Complexity.SIMPLE,
                estimated_minutes=15.0,
                actual_minutes=18.0,
            )
            tracker.record_completion(
                task_id="002",
                task_description="Task 2",
                complexity=Complexity.SIMPLE,
                estimated_minutes=12.0,
                actual_minutes=15.0,
            )

            # Verify repr with records
            repr_str = repr(tracker)
            assert "HistoricalTracker" in repr_str
            assert "records=2" in repr_str

    def test_zero_estimated_minutes(self):
        """Test handling of zero estimated minutes in record_completion."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"
            tracker = HistoricalTracker(data_file=data_file)

            # Record completion with zero estimated minutes
            record = tracker.record_completion(
                task_id="001",
                task_description="Task with zero estimate",
                complexity=Complexity.SIMPLE,
                estimated_minutes=0.0,
                actual_minutes=18.0,
            )

            # Should handle gracefully with neutral accuracy
            assert record.estimated_minutes == 0.0
            assert record.actual_minutes == 18.0
            assert record.accuracy_ratio == 1.0
            assert record.estimation_error == 0.0

    def test_record_completion_with_all_optional_fields(self):
        """Test record_completion with all optional fields populated."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"
            tracker = HistoricalTracker(data_file=data_file)

            record = tracker.record_completion(
                task_id="001-full-record",
                task_description="Complex task with all metadata",
                complexity=Complexity.COMPLEX,
                estimated_minutes=60.0,
                actual_minutes=75.0,
                services_involved=["backend", "frontend", "database"],
                files_modified=25,
                external_integrations=["stripe", "graphiti", "redis"],
            )

            # Verify all fields are properly stored
            assert record.task_id == "001-full-record"
            assert record.services_involved == ["backend", "frontend", "database"]
            assert record.files_modified == 25
            assert record.external_integrations == ["stripe", "graphiti", "redis"]
            assert record.accuracy_ratio == 75.0 / 60.0
            assert record.estimation_error == ((75.0 - 60.0) / 60.0) * 100

            # Verify persistence
            assert len(tracker.records) == 1
            assert tracker.records[0] == record

    def test_multiple_complexity_levels_accuracy(self):
        """Test average accuracy calculation with multiple complexity levels."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_file = Path(tmpdir) / "estimation_data.json"
            tracker = HistoricalTracker(data_file=data_file)

            # Add records for SIMPLE complexity
            for i in range(3):
                tracker.record_completion(
                    task_id=f"simple-{i}",
                    task_description=f"Simple task {i}",
                    complexity=Complexity.SIMPLE,
                    estimated_minutes=15.0,
                    actual_minutes=15.0 + i,  # accuracy_ratio: 1.0, 1.067, 1.133
                )

            # Add records for STANDARD complexity
            for i in range(2):
                tracker.record_completion(
                    task_id=f"standard-{i}",
                    task_description=f"Standard task {i}",
                    complexity=Complexity.STANDARD,
                    estimated_minutes=30.0,
                    actual_minutes=30.0 + i * 3,  # accuracy_ratio: 1.0, 1.1
                )

            # Test overall accuracy
            overall = tracker.get_average_accuracy()
            expected_overall = (1.0 + 1.067 + 1.133 + 1.0 + 1.1) / 5
            assert abs(overall - expected_overall) < 0.01

            # Test per-complexity accuracy
            simple_accuracy = tracker.get_average_accuracy(Complexity.SIMPLE)
            expected_simple = (1.0 + 1.067 + 1.133) / 3
            assert abs(simple_accuracy - expected_simple) < 0.01

            standard_accuracy = tracker.get_average_accuracy(Complexity.STANDARD)
            expected_standard = (1.0 + 1.1) / 2
            assert abs(standard_accuracy - expected_standard) < 0.01

            # Complex should return neutral (no records)
            complex_accuracy = tracker.get_average_accuracy(Complexity.COMPLEX)
            assert complex_accuracy == 1.0
