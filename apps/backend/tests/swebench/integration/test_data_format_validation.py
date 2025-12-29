"""
Integration tests for validating SWE-bench data formats.

Tests validate:
- JSONL predictions format (instance_id, model_patch, model_name_or_path)
- Checkpoint schema (run_id, instance_states, checksum)
- Metrics report schema (resolution_rate, aggregated_stats, timestamps)

These tests ensure the exported data conforms to SWE-bench requirements.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from swebench.checkpoint_manager import CheckpointManager
from swebench.checkpoint_models import Checkpoint
from swebench.exporters.jsonl_exporter import (
    export_predictions,
    load_predictions,
    validate_predictions_file,
)
from swebench.exporters.metrics_exporter import (
    generate_metrics_report,
    load_metrics_report,
    validate_metrics_report,
)
from swebench.models import InstanceResult, SWEBenchPrediction


# =============================================================================
# JSONL Predictions Format Validation
# =============================================================================


class TestJSONLFormat:
    """Tests for JSONL predictions file format validation."""

    def test_jsonl_each_line_is_valid_json(self, tmp_path: Path) -> None:
        """Each line in predictions.jsonl must be valid JSON."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success", model_patch="test patch 1"),
            InstanceResult(instance_id="flask__flask-567", status="success", model_patch="test patch 2"),
            InstanceResult(instance_id="astropy__astropy-890", status="failed", model_patch=""),
        ]

        output_path = tmp_path / "predictions.jsonl"
        export_predictions(results, output_path, overwrite=True)

        # Read and validate each line is valid JSON
        with open(output_path) as f:
            lines = f.readlines()

        assert len(lines) == 3
        for i, line in enumerate(lines):
            try:
                data = json.loads(line)
                assert isinstance(data, dict), f"Line {i+1}: Not a JSON object"
            except json.JSONDecodeError as e:
                pytest.fail(f"Line {i+1}: Invalid JSON - {e}")

    def test_jsonl_required_fields_present(self, tmp_path: Path) -> None:
        """Each prediction must have instance_id, model_patch, model_name_or_path."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success", model_patch="patch"),
        ]

        output_path = tmp_path / "predictions.jsonl"
        export_predictions(results, output_path, overwrite=True)

        with open(output_path) as f:
            data = json.loads(f.readline())

        required_fields = ["instance_id", "model_patch", "model_name_or_path"]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"

    def test_jsonl_field_types_are_strings(self, tmp_path: Path) -> None:
        """All prediction fields must be strings."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success", model_patch="patch"),
        ]

        output_path = tmp_path / "predictions.jsonl"
        export_predictions(results, output_path, overwrite=True)

        with open(output_path) as f:
            data = json.loads(f.readline())

        assert isinstance(data["instance_id"], str)
        assert isinstance(data["model_patch"], str)
        assert isinstance(data["model_name_or_path"], str)

    def test_jsonl_instance_id_double_underscore_format(self, tmp_path: Path) -> None:
        """Instance IDs must use double underscore format (owner__repo-issue)."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
            InstanceResult(instance_id="astropy__astropy-6938", status="success"),
            InstanceResult(instance_id="flask__flask-567", status="success"),
        ]

        output_path = tmp_path / "predictions.jsonl"
        export_predictions(results, output_path, overwrite=True)

        with open(output_path) as f:
            for line in f:
                data = json.loads(line)
                instance_id = data["instance_id"]
                assert "__" in instance_id, f"Instance ID missing double underscore: {instance_id}"

    def test_jsonl_no_trailing_newlines_in_values(self, tmp_path: Path) -> None:
        """Field values should not contain trailing newlines."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success", model_patch="patch content"),
        ]

        output_path = tmp_path / "predictions.jsonl"
        export_predictions(results, output_path, overwrite=True)

        with open(output_path) as f:
            data = json.loads(f.readline())

        for key, value in data.items():
            if isinstance(value, str):
                # Check for trailing newlines at end of value
                assert not value.endswith("\n") or key == "model_patch", f"Field {key} has trailing newline"

    def test_jsonl_validation_function(self, tmp_path: Path) -> None:
        """Test the built-in JSONL validation function."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
            InstanceResult(instance_id="flask__flask-567", status="success"),
        ]

        output_path = tmp_path / "predictions.jsonl"
        export_predictions(results, output_path, overwrite=True)

        is_valid, errors = validate_predictions_file(output_path)
        assert is_valid, f"Validation failed: {errors}"
        assert len(errors) == 0

    def test_jsonl_validation_detects_invalid_format(self, tmp_path: Path) -> None:
        """Validation should detect invalid JSONL format."""
        output_path = tmp_path / "invalid.jsonl"

        # Write invalid JSONL (missing required field)
        with open(output_path, "w") as f:
            f.write('{"instance_id": "test__repo-123"}\n')  # Missing model_patch and model_name_or_path

        is_valid, errors = validate_predictions_file(output_path)
        assert not is_valid
        assert len(errors) > 0

    def test_jsonl_can_be_loaded_back(self, tmp_path: Path) -> None:
        """Exported JSONL should be loadable back into SWEBenchPrediction objects."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success", model_patch="patch1"),
            InstanceResult(instance_id="flask__flask-567", status="success", model_patch="patch2"),
        ]

        output_path = tmp_path / "predictions.jsonl"
        export_predictions(results, output_path, overwrite=True)

        loaded = load_predictions(output_path)
        assert len(loaded) == 2
        assert all(isinstance(p, SWEBenchPrediction) for p in loaded)
        assert loaded[0].instance_id == "django__django-12345"
        assert loaded[1].instance_id == "flask__flask-567"


# =============================================================================
# Checkpoint Schema Validation
# =============================================================================


class TestCheckpointSchema:
    """Tests for checkpoint file schema validation."""

    def test_checkpoint_has_required_fields(self, tmp_path: Path) -> None:
        """Checkpoint must have run_id, dataset_name, instance_states, etc."""
        manager = CheckpointManager(tmp_path)
        checkpoint = manager.create_checkpoint(
            run_id="test-run-001",
            dataset_name="princeton-nlp/SWE-bench_Lite",
            instance_ids=["django__django-12345", "flask__flask-567"],
        )
        manager.save(checkpoint)

        # Load raw JSON to verify structure
        checkpoint_path = manager.get_checkpoint_path("test-run-001")
        with open(checkpoint_path) as f:
            data = json.load(f)

        required_fields = [
            "run_id",
            "dataset_name",
            "total_instances",
            "instance_states",
            "checksum",
        ]
        for field in required_fields:
            assert field in data, f"Missing required field: {field}"

    def test_checkpoint_instance_states_have_required_fields(self, tmp_path: Path) -> None:
        """Each instance state must have instance_id and status."""
        manager = CheckpointManager(tmp_path)
        checkpoint = manager.create_checkpoint(
            run_id="test-run-002",
            dataset_name="test-dataset",
            instance_ids=["test__repo-123"],
        )
        manager.save(checkpoint)

        checkpoint_path = manager.get_checkpoint_path("test-run-002")
        with open(checkpoint_path) as f:
            data = json.load(f)

        assert len(data["instance_states"]) == 1
        instance_state = data["instance_states"][0]

        assert "instance_id" in instance_state
        assert "status" in instance_state
        assert instance_state["instance_id"] == "test__repo-123"

    def test_checkpoint_checksum_is_generated(self, tmp_path: Path) -> None:
        """Checkpoint should have a checksum after saving."""
        manager = CheckpointManager(tmp_path)
        checkpoint = manager.create_checkpoint(
            run_id="test-run-003",
            dataset_name="test-dataset",
            instance_ids=["test__repo-123", "test__repo-456"],
        )
        # Save with checksum
        manager.save(checkpoint, update_checksum=True)

        # Load raw JSON and verify checksum field exists
        checkpoint_path = manager.get_checkpoint_path("test-run-003")
        with open(checkpoint_path) as f:
            data = json.load(f)
        assert "checksum" in data
        assert data["checksum"] is not None
        assert len(data["checksum"]) == 32  # MD5 hex digest length

    def test_checkpoint_status_values_are_valid(self, tmp_path: Path) -> None:
        """Instance status must be one of: pending, running, completed, failed, error, skipped."""
        valid_statuses = {"pending", "running", "completed", "failed", "error", "skipped"}

        manager = CheckpointManager(tmp_path)
        checkpoint = manager.create_checkpoint(
            run_id="test-run-004",
            dataset_name="test-dataset",
            instance_ids=["test__repo-123"],
        )

        # Get instance state and test status transitions
        state = checkpoint.get_instance_state("test__repo-123")
        assert state is not None
        assert state.status in valid_statuses  # Initial status

        # Mark as started
        state.mark_started()
        checkpoint.update_instance(state)
        assert checkpoint.get_instance_state("test__repo-123").status in valid_statuses

        # Mark as completed
        state.mark_completed(model_patch="patch")
        checkpoint.update_instance(state)
        assert checkpoint.get_instance_state("test__repo-123").status in valid_statuses

    def test_checkpoint_json_serializable(self, tmp_path: Path) -> None:
        """Checkpoint must be fully JSON serializable."""
        manager = CheckpointManager(tmp_path)
        checkpoint = manager.create_checkpoint(
            run_id="test-run-005",
            dataset_name="test-dataset",
            instance_ids=["test__repo-123"],
        )

        # Get instance state and update it
        state = checkpoint.get_instance_state("test__repo-123")
        assert state is not None
        state.mark_started()
        checkpoint.update_instance(state)
        state.mark_completed(model_patch="test patch")
        checkpoint.update_instance(state)

        manager.save(checkpoint)

        # Load raw JSON - should work
        checkpoint_path = manager.get_checkpoint_path("test-run-005")
        with open(checkpoint_path) as f:
            data = json.load(f)

        # Re-serialize should also work
        json_str = json.dumps(data)
        assert len(json_str) > 0

    def test_checkpoint_timestamps_are_iso_format(self, tmp_path: Path) -> None:
        """Timestamps should be in ISO format."""
        manager = CheckpointManager(tmp_path)
        checkpoint = manager.create_checkpoint(
            run_id="test-run-006",
            dataset_name="test-dataset",
            instance_ids=["test__repo-123"],
        )
        manager.save(checkpoint)

        checkpoint_path = manager.get_checkpoint_path("test-run-006")
        with open(checkpoint_path) as f:
            data = json.load(f)

        # Check created_at timestamp format (ISO 8601)
        created_at = data.get("created_at")
        if created_at:
            # Should be parseable as ISO format (contains T and Z or timezone)
            assert "T" in created_at or created_at.replace("-", "").replace(":", "").isdigit()


# =============================================================================
# Metrics Report Schema Validation
# =============================================================================


class TestMetricsReportSchema:
    """Tests for metrics report JSON schema validation."""

    def test_report_has_required_fields(self, tmp_path: Path) -> None:
        """Report must have resolution_rate, aggregated_stats, timestamps."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
            InstanceResult(instance_id="flask__flask-567", status="failed"),
        ]

        output_path = tmp_path / "report.json"
        report = generate_metrics_report(results, output_path, overwrite=True)

        assert "resolution_rate" in report
        assert "aggregated_stats" in report
        assert "timestamps" in report

    def test_report_resolution_rate_is_valid(self, tmp_path: Path) -> None:
        """Resolution rate must be between 0.0 and 1.0."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
            InstanceResult(instance_id="flask__flask-567", status="failed"),
        ]

        output_path = tmp_path / "report.json"
        report = generate_metrics_report(results, output_path, overwrite=True)

        rate = report["resolution_rate"]
        assert isinstance(rate, (int, float))
        assert 0.0 <= rate <= 1.0

    def test_report_aggregated_stats_has_required_fields(self, tmp_path: Path) -> None:
        """aggregated_stats must have total/completed/successful/failed instance counts."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
        ]

        output_path = tmp_path / "report.json"
        report = generate_metrics_report(results, output_path, overwrite=True)

        stats = report["aggregated_stats"]
        required_stat_fields = [
            "total_instances",
            "completed_instances",
            "successful_instances",
            "failed_instances",
        ]
        for field in required_stat_fields:
            assert field in stats, f"Missing required stat field: {field}"
            assert isinstance(stats[field], int), f"Field {field} must be an integer"

    def test_report_instance_results_format(self, tmp_path: Path) -> None:
        """instance_results must be a list with instance_id and status per entry."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
            InstanceResult(instance_id="flask__flask-567", status="failed", error_message="Test error"),
        ]

        output_path = tmp_path / "report.json"
        report = generate_metrics_report(results, output_path, overwrite=True)

        assert "instance_results" in report
        assert isinstance(report["instance_results"], list)
        assert len(report["instance_results"]) == 2

        for result in report["instance_results"]:
            assert "instance_id" in result
            assert "status" in result

    def test_report_validation_function(self, tmp_path: Path) -> None:
        """Test the built-in report validation function."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
        ]

        output_path = tmp_path / "report.json"
        report = generate_metrics_report(results, output_path, overwrite=True)

        is_valid, errors = validate_metrics_report(report)
        assert is_valid, f"Validation failed: {errors}"
        assert len(errors) == 0

    def test_report_validation_detects_missing_fields(self) -> None:
        """Validation should detect missing required fields."""
        invalid_report: dict[str, Any] = {
            "resolution_rate": 0.5,
            # Missing aggregated_stats and timestamps
        }

        is_valid, errors = validate_metrics_report(invalid_report)
        assert not is_valid
        assert len(errors) > 0
        assert any("aggregated_stats" in err for err in errors)

    def test_report_can_be_saved_and_loaded(self, tmp_path: Path) -> None:
        """Report should be saveable to JSON and loadable back."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
        ]

        output_path = tmp_path / "report.json"
        original_report = generate_metrics_report(results, output_path, overwrite=True)

        loaded_report = load_metrics_report(output_path)

        assert loaded_report["resolution_rate"] == original_report["resolution_rate"]
        assert loaded_report["aggregated_stats"] == original_report["aggregated_stats"]

    def test_report_per_repo_stats_format(self, tmp_path: Path) -> None:
        """per_repo_stats should have correct structure."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
            InstanceResult(instance_id="django__django-67890", status="failed"),
            InstanceResult(instance_id="flask__flask-567", status="success"),
        ]

        output_path = tmp_path / "report.json"
        report = generate_metrics_report(results, output_path, overwrite=True)

        assert "per_repo_stats" in report
        per_repo = report["per_repo_stats"]

        # Should have stats for django and flask
        assert "django/django" in per_repo
        assert "flask/flask" in per_repo

        # Each repo stats should have required fields
        django_stats = per_repo["django/django"]
        assert "total_instances" in django_stats
        assert "successful_instances" in django_stats
        assert "resolution_rate" in django_stats

    def test_report_timing_stats_format(self, tmp_path: Path) -> None:
        """timing_stats should have timing metrics."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success", execution_time_seconds=10.5),
            InstanceResult(instance_id="flask__flask-567", status="success", execution_time_seconds=20.3),
        ]

        output_path = tmp_path / "report.json"
        report = generate_metrics_report(results, output_path, overwrite=True)

        assert "timing_stats" in report
        timing = report["timing_stats"]

        assert "total_time_seconds" in timing
        assert "average_time_seconds" in timing
        assert timing["total_time_seconds"] == pytest.approx(30.8, rel=0.01)


# =============================================================================
# Cross-Format Consistency Tests
# =============================================================================


class TestCrossFormatConsistency:
    """Tests for consistency between different data formats."""

    def test_jsonl_and_report_instance_count_match(self, tmp_path: Path) -> None:
        """JSONL line count should match report total_instances."""
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
            InstanceResult(instance_id="flask__flask-567", status="success"),
            InstanceResult(instance_id="astropy__astropy-890", status="failed"),
        ]

        jsonl_path = tmp_path / "predictions.jsonl"
        report_path = tmp_path / "report.json"

        export_predictions(results, jsonl_path, overwrite=True)
        report = generate_metrics_report(results, report_path, overwrite=True)

        with open(jsonl_path) as f:
            jsonl_count = sum(1 for line in f if line.strip())

        assert jsonl_count == report["aggregated_stats"]["total_instances"]

    def test_checkpoint_and_report_counts_consistent(self, tmp_path: Path) -> None:
        """Checkpoint counts should be consistent with report counts."""
        instance_ids = ["django__django-12345", "flask__flask-567"]

        manager = CheckpointManager(tmp_path)
        checkpoint = manager.create_checkpoint(
            run_id="consistency-test",
            dataset_name="test-dataset",
            instance_ids=instance_ids,
        )

        # Mark all as completed using the correct API
        for iid in instance_ids:
            state = checkpoint.get_instance_state(iid)
            assert state is not None
            state.mark_started()
            checkpoint.update_instance(state)
            state.mark_completed(model_patch="patch")
            checkpoint.update_instance(state)

        manager.save(checkpoint)

        # Create results matching checkpoint
        results = [
            InstanceResult(instance_id="django__django-12345", status="success"),
            InstanceResult(instance_id="flask__flask-567", status="success"),
        ]

        report = generate_metrics_report(results)

        assert checkpoint.total_instances == report["aggregated_stats"]["total_instances"]
        assert checkpoint.completed_count == report["aggregated_stats"]["completed_instances"]


# =============================================================================
# Existing Data Files Validation (if present)
# =============================================================================


class TestExistingDataFiles:
    """Tests for validating existing data files in the repository."""

    @pytest.fixture
    def swebench_data_dir(self) -> Path:
        """Get the SWE-bench data directory."""
        return Path(".auto-claude/swebench")

    def test_existing_predictions_jsonl_valid(self, swebench_data_dir: Path) -> None:
        """Validate the existing predictions.jsonl file if present."""
        predictions_path = swebench_data_dir / "predictions.jsonl"

        if not predictions_path.exists():
            pytest.skip("predictions.jsonl not found")

        is_valid, errors = validate_predictions_file(predictions_path)
        assert is_valid, f"predictions.jsonl validation failed: {errors}"

    def test_existing_report_json_valid(self, swebench_data_dir: Path) -> None:
        """Validate the existing report.json file if present."""
        report_path = swebench_data_dir / "report.json"

        if not report_path.exists():
            pytest.skip("report.json not found")

        report = load_metrics_report(report_path)
        is_valid, errors = validate_metrics_report(report)
        assert is_valid, f"report.json validation failed: {errors}"

    def test_existing_checkpoints_valid(self, swebench_data_dir: Path) -> None:
        """Validate existing checkpoint files if present."""
        checkpoints_dir = swebench_data_dir / "checkpoints"

        if not checkpoints_dir.exists():
            pytest.skip("checkpoints directory not found")

        checkpoint_files = list(checkpoints_dir.glob("*.json"))
        if not checkpoint_files:
            pytest.skip("No checkpoint files found")

        manager = CheckpointManager(checkpoints_dir)

        for checkpoint_file in checkpoint_files:
            run_id = checkpoint_file.stem
            try:
                checkpoint = manager.load(run_id, validate_integrity=False)
                assert checkpoint.run_id == run_id
            except Exception as e:
                pytest.fail(f"Checkpoint {run_id} validation failed: {e}")
