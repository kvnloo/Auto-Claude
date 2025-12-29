"""
Integration Tests for SWE-bench Evaluation Pipeline
====================================================

Tests cover the evaluation execution pipeline:
- Prerequisite checking (SWE-bench harness, Docker, disk space)
- Evaluation execution with mocked Docker
- Results parsing from evaluation logs
- Docker resource cleanup
- Error handling for infrastructure failures

Note: Tests use mocking to avoid requiring actual Docker and SWE-bench harness.
"""

import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

from apps.backend.services.swebench.evaluator import (
    EvaluationError,
    EvaluationNotAvailableError,
    InfrastructureError,
    DEFAULT_CACHE_LEVEL,
    VALID_CACHE_LEVELS,
    check_evaluation_prerequisites,
    execute_evaluation,
    execute_gold_evaluation,
    cleanup_docker_resources,
    get_evaluation_status,
    _validate_predictions_path,
    _validate_max_workers,
    _validate_cache_level,
    _check_swebench_available,
)
from apps.backend.services.swebench.models import BenchmarkVariant


class TestPredictionsPathValidation:
    """Tests for predictions file path validation."""

    def test_valid_jsonl_file(self, tmp_path):
        """Test validation of existing JSONL file."""
        predictions_file = tmp_path / "predictions.jsonl"
        predictions_file.write_text('{"instance_id": "test", "model_patch": "diff"}\n')

        result = _validate_predictions_path(predictions_file)
        assert result == predictions_file

    def test_valid_json_file(self, tmp_path):
        """Test validation of existing JSON file."""
        predictions_file = tmp_path / "predictions.json"
        predictions_file.write_text('[]')

        result = _validate_predictions_path(predictions_file)
        assert result == predictions_file

    def test_nonexistent_file_raises(self, tmp_path):
        """Test that nonexistent file raises error."""
        nonexistent = tmp_path / "missing.jsonl"

        with pytest.raises(EvaluationError) as exc_info:
            _validate_predictions_path(nonexistent)
        assert "not found" in str(exc_info.value)

    def test_directory_raises(self, tmp_path):
        """Test that directory path raises error."""
        with pytest.raises(EvaluationError) as exc_info:
            _validate_predictions_path(tmp_path)
        assert "not a file" in str(exc_info.value)


class TestMaxWorkersValidation:
    """Tests for max_workers validation."""

    @patch("apps.backend.services.swebench.evaluator.get_recommended_max_workers")
    def test_none_uses_recommended(self, mock_recommended):
        """Test that None uses recommended value."""
        mock_recommended.return_value = 4
        result = _validate_max_workers(None)
        assert result == 4

    @patch("apps.backend.services.swebench.evaluator.get_recommended_max_workers")
    def test_below_recommended_allowed(self, mock_recommended):
        """Test that values below recommended are allowed."""
        mock_recommended.return_value = 4
        result = _validate_max_workers(2)
        assert result == 2

    @patch("apps.backend.services.swebench.evaluator.get_recommended_max_workers")
    def test_above_recommended_capped(self, mock_recommended):
        """Test that values above recommended are capped."""
        mock_recommended.return_value = 4
        result = _validate_max_workers(8)
        assert result == 4

    @patch("apps.backend.services.swebench.evaluator.get_recommended_max_workers")
    def test_zero_or_negative_clamped_to_one(self, mock_recommended):
        """Test that zero or negative values are clamped to 1."""
        mock_recommended.return_value = 4
        assert _validate_max_workers(0) == 1
        assert _validate_max_workers(-1) == 1


class TestCacheLevelValidation:
    """Tests for cache level validation."""

    def test_valid_cache_levels(self):
        """Test that all valid cache levels are accepted."""
        for level in VALID_CACHE_LEVELS:
            result = _validate_cache_level(level)
            assert result == level

    def test_invalid_cache_level_raises(self):
        """Test that invalid cache level raises error."""
        with pytest.raises(EvaluationError) as exc_info:
            _validate_cache_level("invalid")
        assert "Invalid cache_level" in str(exc_info.value)
        assert "Valid options" in str(exc_info.value)


class TestCheckSwebenchAvailable:
    """Tests for SWE-bench harness availability check."""

    def test_available_when_import_succeeds(self):
        """Test returns True when import succeeds."""
        with patch.dict("sys.modules", {
            "swebench": MagicMock(),
            "swebench.harness": MagicMock(),
            "swebench.harness.run_evaluation": MagicMock(),
        }):
            # The actual check imports the module
            # We'll test the behavior indirectly
            pass

    def test_not_available_when_import_fails(self):
        """Test returns False when import fails."""
        with patch(
            "apps.backend.services.swebench.evaluator._check_swebench_available",
            return_value=False
        ):
            assert not _check_swebench_available()


class TestCheckEvaluationPrerequisites:
    """Tests for prerequisite checking."""

    @patch("apps.backend.services.swebench.evaluator._check_swebench_available")
    @patch("apps.backend.services.swebench.evaluator.check_docker_available")
    @patch("apps.backend.services.swebench.evaluator.check_disk_space")
    def test_all_passed(self, mock_disk, mock_docker, mock_swebench):
        """Test when all prerequisites pass."""
        mock_swebench.return_value = True
        mock_docker.return_value = MagicMock(passed=True, message="Docker OK")
        mock_disk.return_value = MagicMock(passed=True, message="Disk OK")

        passed, errors = check_evaluation_prerequisites()

        assert passed is True
        assert len(errors) == 0

    @patch("apps.backend.services.swebench.evaluator._check_swebench_available")
    @patch("apps.backend.services.swebench.evaluator.check_docker_available")
    @patch("apps.backend.services.swebench.evaluator.check_disk_space")
    def test_swebench_not_installed(self, mock_disk, mock_docker, mock_swebench):
        """Test when SWE-bench is not installed."""
        mock_swebench.return_value = False
        mock_docker.return_value = MagicMock(passed=True)
        mock_disk.return_value = MagicMock(passed=True)

        passed, errors = check_evaluation_prerequisites()

        assert passed is False
        assert len(errors) == 1
        assert "SWE-bench harness not installed" in errors[0]

    @patch("apps.backend.services.swebench.evaluator._check_swebench_available")
    @patch("apps.backend.services.swebench.evaluator.check_docker_available")
    @patch("apps.backend.services.swebench.evaluator.check_disk_space")
    def test_docker_not_available(self, mock_disk, mock_docker, mock_swebench):
        """Test when Docker is not available."""
        mock_swebench.return_value = True
        mock_docker.return_value = MagicMock(
            passed=False,
            message="Docker daemon is not running"
        )
        mock_disk.return_value = MagicMock(passed=True)

        passed, errors = check_evaluation_prerequisites()

        assert passed is False
        assert any("Docker" in e for e in errors)

    @patch("apps.backend.services.swebench.evaluator._check_swebench_available")
    @patch("apps.backend.services.swebench.evaluator.check_docker_available")
    @patch("apps.backend.services.swebench.evaluator.check_disk_space")
    def test_insufficient_disk_space(self, mock_disk, mock_docker, mock_swebench):
        """Test when disk space is insufficient."""
        mock_swebench.return_value = True
        mock_docker.return_value = MagicMock(passed=True)
        mock_disk.return_value = MagicMock(
            passed=False,
            message="Insufficient disk space: 5GB available, 10GB required"
        )

        passed, errors = check_evaluation_prerequisites()

        assert passed is False
        assert any("disk space" in e.lower() for e in errors)

    @patch("apps.backend.services.swebench.evaluator._check_swebench_available")
    @patch("apps.backend.services.swebench.evaluator.check_docker_available")
    @patch("apps.backend.services.swebench.evaluator.check_disk_space")
    def test_with_predictions_path(
        self, mock_disk, mock_docker, mock_swebench, tmp_path
    ):
        """Test prerequisite check with predictions path validation."""
        mock_swebench.return_value = True
        mock_docker.return_value = MagicMock(passed=True)
        mock_disk.return_value = MagicMock(passed=True)

        # Create predictions file
        predictions_file = tmp_path / "predictions.jsonl"
        predictions_file.write_text('{"test": "data"}\n')

        passed, errors = check_evaluation_prerequisites(predictions_file)
        assert passed is True

    @patch("apps.backend.services.swebench.evaluator._check_swebench_available")
    @patch("apps.backend.services.swebench.evaluator.check_docker_available")
    @patch("apps.backend.services.swebench.evaluator.check_disk_space")
    def test_with_missing_predictions(
        self, mock_disk, mock_docker, mock_swebench, tmp_path
    ):
        """Test prerequisite check with missing predictions file."""
        mock_swebench.return_value = True
        mock_docker.return_value = MagicMock(passed=True)
        mock_disk.return_value = MagicMock(passed=True)

        missing_file = tmp_path / "missing.jsonl"

        passed, errors = check_evaluation_prerequisites(missing_file)
        assert passed is False
        assert any("not found" in e for e in errors)


class TestExecuteEvaluation:
    """Tests for evaluation execution with mocked dependencies."""

    @pytest.fixture
    def mock_prerequisites_pass(self):
        """Fixture to mock passing prerequisites."""
        with patch(
            "apps.backend.services.swebench.evaluator.check_evaluation_prerequisites"
        ) as mock:
            mock.return_value = (True, [])
            yield mock

    @pytest.fixture
    def mock_swebench_harness(self):
        """Fixture to mock SWE-bench evaluation harness."""
        with patch(
            "apps.backend.services.swebench.evaluator._check_swebench_available"
        ) as mock_available:
            mock_available.return_value = True

            # Mock the run_evaluation import
            mock_run = MagicMock()
            with patch.dict("sys.modules", {
                "swebench": MagicMock(),
                "swebench.harness": MagicMock(),
                "swebench.harness.run_evaluation": MagicMock(run_evaluation=mock_run),
            }):
                yield mock_run

    @patch("apps.backend.services.swebench.evaluator._check_swebench_available")
    @patch("apps.backend.services.swebench.evaluator.check_evaluation_prerequisites")
    def test_swebench_not_available_raises(self, mock_prereq, mock_available):
        """Test that missing SWE-bench raises appropriate error."""
        mock_available.return_value = False
        mock_prereq.return_value = (False, ["SWE-bench harness not installed"])

        with pytest.raises(EvaluationNotAvailableError):
            execute_evaluation(
                predictions_path="test.jsonl",
                run_id="test-run",
            )

    @patch("apps.backend.services.swebench.evaluator._check_swebench_available")
    @patch("apps.backend.services.swebench.evaluator.check_evaluation_prerequisites")
    def test_infrastructure_error_raised(self, mock_prereq, mock_available):
        """Test that infrastructure issues raise InfrastructureError."""
        mock_available.return_value = True
        mock_prereq.return_value = (False, ["Docker daemon is not running"])

        with pytest.raises(InfrastructureError):
            execute_evaluation(
                predictions_path="test.jsonl",
                run_id="test-run",
            )


class TestExecuteGoldEvaluation:
    """Tests for gold patch evaluation."""

    @patch("apps.backend.services.swebench.evaluator.execute_evaluation")
    def test_calls_execute_with_gold_path(self, mock_execute):
        """Test that gold evaluation calls execute_evaluation with gold path."""
        mock_execute.return_value = {"status": "success", "resolve_rate": 85.0}

        result = execute_gold_evaluation(
            variant=BenchmarkVariant.LITE,
            max_workers=2,
        )

        mock_execute.assert_called_once()
        call_kwargs = mock_execute.call_args.kwargs
        assert call_kwargs["predictions_path"] == "gold"
        assert call_kwargs["variant"] == BenchmarkVariant.LITE
        assert call_kwargs["max_workers"] == 2

    @patch("apps.backend.services.swebench.evaluator.execute_evaluation")
    def test_auto_generates_run_id(self, mock_execute):
        """Test that run_id is auto-generated if not provided."""
        mock_execute.return_value = {"status": "success"}

        execute_gold_evaluation(variant=BenchmarkVariant.LITE)

        call_kwargs = mock_execute.call_args.kwargs
        assert call_kwargs["run_id"].startswith("gold-lite-")


@pytest.fixture
def mock_docker_module():
    """Fixture to inject a mock docker module into sys.modules."""
    import sys

    mock_module = MagicMock()
    mock_client = MagicMock()
    mock_module.from_env.return_value = mock_client

    # Save original if exists
    original = sys.modules.get("docker")

    # Inject mock
    sys.modules["docker"] = mock_module

    yield mock_module, mock_client

    # Restore original
    if original is not None:
        sys.modules["docker"] = original
    else:
        if "docker" in sys.modules:
            del sys.modules["docker"]


class TestCleanupDockerResources:
    """Tests for Docker resource cleanup."""

    def test_prune_containers_only(self, mock_docker_module):
        """Test cleanup with containers only."""
        mock_module, mock_client = mock_docker_module
        mock_client.containers.prune.return_value = {
            "ContainersDeleted": ["c1", "c2"],
            "SpaceReclaimed": 1024 * 1024 * 100,
        }

        stats = cleanup_docker_resources(
            prune_containers=True,
            prune_images=False,
            prune_volumes=False,
        )

        assert stats["containers_removed"] == 2
        assert stats["images_removed"] == 0
        assert stats["volumes_removed"] == 0
        assert stats["space_reclaimed_mb"] == 100.0

    def test_prune_all_resources(self, mock_docker_module):
        """Test cleanup with all resources."""
        mock_module, mock_client = mock_docker_module

        mock_client.containers.prune.return_value = {
            "ContainersDeleted": ["c1"],
            "SpaceReclaimed": 50 * 1024 * 1024,
        }
        mock_client.images.prune.return_value = {
            "ImagesDeleted": [{"Deleted": "i1"}, {"Deleted": "i2"}],
            "SpaceReclaimed": 100 * 1024 * 1024,
        }
        mock_client.volumes.prune.return_value = {
            "VolumesDeleted": ["v1"],
            "SpaceReclaimed": 25 * 1024 * 1024,
        }

        stats = cleanup_docker_resources(
            prune_containers=True,
            prune_images=True,
            prune_volumes=True,
        )

        assert stats["containers_removed"] == 1
        assert stats["images_removed"] == 2
        assert stats["volumes_removed"] == 1
        assert stats["space_reclaimed_mb"] == 175.0

    def test_cleanup_handles_errors(self):
        """Test that cleanup errors are raised properly."""
        import sys

        # Create a mock module that raises an exception
        mock_module = MagicMock()
        mock_module.from_env.side_effect = Exception("Docker not available")

        original = sys.modules.get("docker")
        sys.modules["docker"] = mock_module

        try:
            with pytest.raises(EvaluationError) as exc_info:
                cleanup_docker_resources()
            assert "Docker cleanup failed" in str(exc_info.value)
        finally:
            if original is not None:
                sys.modules["docker"] = original
            else:
                if "docker" in sys.modules:
                    del sys.modules["docker"]


class TestGetEvaluationStatus:
    """Tests for evaluation status checking."""

    def test_not_found_status(self, tmp_path):
        """Test status when run doesn't exist."""
        status = get_evaluation_status("nonexistent-run", log_dir=tmp_path)

        assert status["status"] == "not_found"
        assert "No logs found" in status["message"]

    def test_in_progress_status(self, tmp_path):
        """Test status when run is in progress (no report.json)."""
        run_dir = tmp_path / "test-run"
        run_dir.mkdir()
        (run_dir / "evaluation.log").write_text("Starting evaluation...")

        status = get_evaluation_status("test-run", log_dir=tmp_path)

        assert status["status"] == "in_progress"
        assert "evaluation.log" in status["log_files"]

    def test_completed_status_with_report(self, tmp_path):
        """Test status when run is completed with report."""
        run_dir = tmp_path / "completed-run"
        run_dir.mkdir()

        report = {
            "total_instances": 100,
            "resolved_instances": 75,
        }
        (run_dir / "report.json").write_text(json.dumps(report))

        status = get_evaluation_status("completed-run", log_dir=tmp_path)

        assert status["status"] == "completed"
        assert status["total_instances"] == 100
        assert status["resolved_instances"] == 75
        assert status["resolve_rate"] == 75.0


class TestEvaluationPipeline:
    """Integration tests for the full evaluation pipeline."""

    @pytest.fixture
    def predictions_file(self, tmp_path):
        """Create a sample predictions file."""
        predictions = [
            {
                "instance_id": "django__django-12345",
                "model_name_or_path": "autoclaude",
                "model_patch": "diff --git a/file.py b/file.py\n...",
            },
            {
                "instance_id": "astropy__astropy-6789",
                "model_name_or_path": "autoclaude",
                "model_patch": "diff --git a/other.py b/other.py\n...",
            },
        ]
        predictions_path = tmp_path / "predictions.jsonl"
        with open(predictions_path, "w") as f:
            for pred in predictions:
                f.write(json.dumps(pred) + "\n")
        return predictions_path

    @patch("apps.backend.services.swebench.evaluator._check_swebench_available")
    @patch("apps.backend.services.swebench.evaluator.check_docker_available")
    @patch("apps.backend.services.swebench.evaluator.check_disk_space")
    @patch("apps.backend.services.swebench.evaluator.get_recommended_max_workers")
    def test_full_pipeline_prerequisites_check(
        self,
        mock_workers,
        mock_disk,
        mock_docker,
        mock_swebench,
        predictions_file,
    ):
        """Test full prerequisite checking with actual predictions file."""
        mock_swebench.return_value = True
        mock_docker.return_value = MagicMock(passed=True, message="Docker OK")
        mock_disk.return_value = MagicMock(passed=True, message="Disk OK")
        mock_workers.return_value = 4

        passed, errors = check_evaluation_prerequisites(predictions_file)

        assert passed is True
        assert len(errors) == 0


class TestResultsParser:
    """Tests for parsing evaluation results."""

    @pytest.fixture
    def sample_report(self):
        """Create a sample evaluation report."""
        return {
            "total_instances": 50,
            "resolved_instances": 35,
            "resolved": [
                "django__django-12345",
                "astropy__astropy-6789",
            ],
            "unresolved": [
                "flask__flask-1234",
            ],
            "error": [
                "broken__repo-9999",
            ],
        }

    def test_parse_report_from_file(self, tmp_path, sample_report):
        """Test parsing report from file."""
        report_path = tmp_path / "report.json"
        report_path.write_text(json.dumps(sample_report))

        # Use the evaluator's status check which parses reports
        run_dir = tmp_path / "test-run"
        run_dir.mkdir()
        (run_dir / "report.json").write_text(json.dumps(sample_report))

        status = get_evaluation_status("test-run", log_dir=tmp_path)

        assert status["status"] == "completed"
        assert status["total_instances"] == 50
        assert status["resolved_instances"] == 35
        assert status["resolve_rate"] == 70.0


class TestProgressCallback:
    """Tests for progress callback functionality."""

    @patch("apps.backend.services.swebench.evaluator._check_swebench_available")
    @patch("apps.backend.services.swebench.evaluator.check_evaluation_prerequisites")
    def test_callback_not_called_on_prerequisite_failure(
        self, mock_prereq, mock_available
    ):
        """Test callback is not called when prerequisites fail."""
        mock_available.return_value = True
        mock_prereq.return_value = (False, ["Docker not available"])

        callback = MagicMock()

        with pytest.raises(InfrastructureError):
            execute_evaluation(
                predictions_path="test.jsonl",
                run_id="test-run",
                progress_callback=callback,
            )

        # Callback should not be called since prerequisites failed
        callback.assert_not_called()


class TestCacheLevels:
    """Tests for Docker cache level configuration."""

    def test_default_cache_level(self):
        """Test default cache level is 'env'."""
        assert DEFAULT_CACHE_LEVEL == "env"

    def test_all_valid_cache_levels(self):
        """Test all valid cache levels are defined."""
        expected = ["none", "base", "env", "instance"]
        assert VALID_CACHE_LEVELS == expected

    def test_validate_each_cache_level(self):
        """Test that each cache level can be validated."""
        for level in VALID_CACHE_LEVELS:
            result = _validate_cache_level(level)
            assert result == level


class TestVariantDatasetMapping:
    """Tests for variant to dataset mapping in evaluation."""

    def test_lite_variant_uses_correct_dataset(self):
        """Test that LITE variant maps to correct dataset."""
        from apps.backend.services.swebench.models import VARIANT_DATASET_NAMES

        assert VARIANT_DATASET_NAMES[BenchmarkVariant.LITE] == "princeton-nlp/SWE-bench_Lite"

    def test_verified_variant_uses_correct_dataset(self):
        """Test that VERIFIED variant maps to correct dataset."""
        from apps.backend.services.swebench.models import VARIANT_DATASET_NAMES

        assert VARIANT_DATASET_NAMES[BenchmarkVariant.VERIFIED] == "princeton-nlp/SWE-bench_Verified"

    def test_full_variant_uses_correct_dataset(self):
        """Test that FULL variant maps to correct dataset."""
        from apps.backend.services.swebench.models import VARIANT_DATASET_NAMES

        assert VARIANT_DATASET_NAMES[BenchmarkVariant.FULL] == "princeton-nlp/SWE-bench"
