"""
Unit Tests for Autoclaude Results to SWE-bench JSONL Exporter
==============================================================

Tests cover:
- create_prediction_entry: Single result conversion
- export_predictions: Batch export to file
- export_predictions_to_string: Export to string
- append_prediction: Streaming export
- validate_predictions_file: JSONL validation
- count_predictions: File counting
- Filtering options (include_failed, include_empty_patches)
- ExportError handling
"""

import json
import tempfile
from pathlib import Path

import pytest

from apps.backend.services.swebench.exporter import (
    ExportError,
    append_prediction,
    count_predictions,
    create_prediction_entry,
    export_prediction_to_dict,
    export_predictions,
    export_predictions_to_string,
    validate_predictions_file,
)
from apps.backend.services.swebench.models import (
    BenchmarkResult,
    BenchmarkVariant,
    ExecutionStatus,
    InstanceResult,
)


class TestCreatePredictionEntry:
    """Tests for create_prediction_entry function."""

    def test_completed_result_with_patch(self):
        """Test creating entry from completed result with patch."""
        result = InstanceResult(
            instance_id="django__django-12345",
            status=ExecutionStatus.COMPLETED,
            model_patch="diff --git a/file.py...",
        )
        entry = create_prediction_entry(result)

        assert entry.instance_id == "django__django-12345"
        assert entry.model_name_or_path == "autoclaude"
        assert entry.model_patch == "diff --git a/file.py..."

    def test_custom_model_name(self):
        """Test creating entry with custom model name."""
        result = InstanceResult(
            instance_id="test-id",
            status=ExecutionStatus.COMPLETED,
            model_patch="patch",
        )
        entry = create_prediction_entry(result, model_name="custom-model")
        assert entry.model_name_or_path == "custom-model"

    def test_result_without_patch_uses_default(self):
        """Test that results without patch use default_patch."""
        result = InstanceResult(
            instance_id="test-id",
            status=ExecutionStatus.COMPLETED,
            model_patch=None,
        )
        entry = create_prediction_entry(result, default_patch="fallback patch")
        assert entry.model_patch == "fallback patch"

    def test_empty_string_patch_uses_default(self):
        """Test that empty string patch uses default_patch (empty is falsy)."""
        result = InstanceResult(
            instance_id="test-id",
            status=ExecutionStatus.COMPLETED,
            model_patch="",
        )
        entry = create_prediction_entry(result, default_patch="fallback")
        # Empty string is falsy, so default_patch is used
        assert entry.model_patch == "fallback"

    def test_missing_instance_id_raises_error(self):
        """Test that missing instance_id raises ExportError."""
        result = InstanceResult(
            instance_id="",
            status=ExecutionStatus.COMPLETED,
        )
        with pytest.raises(ExportError) as exc_info:
            create_prediction_entry(result)
        assert "valid instance_id" in str(exc_info.value)


class TestExportPredictionToDict:
    """Tests for export_prediction_to_dict function."""

    def test_dict_format(self):
        """Test that dict has required SWE-bench format."""
        result = InstanceResult(
            instance_id="django__django-12345",
            status=ExecutionStatus.COMPLETED,
            model_patch="patch content",
        )
        entry = create_prediction_entry(result)
        d = export_prediction_to_dict(entry)

        assert "instance_id" in d
        assert "model_name_or_path" in d
        assert "model_patch" in d
        assert d["instance_id"] == "django__django-12345"
        assert d["model_name_or_path"] == "autoclaude"
        assert d["model_patch"] == "patch content"


class TestExportPredictions:
    """Tests for export_predictions function."""

    @pytest.fixture
    def sample_results(self):
        """Create sample instance results."""
        return [
            InstanceResult(
                instance_id="django__django-12345",
                status=ExecutionStatus.COMPLETED,
                model_patch="patch 1",
            ),
            InstanceResult(
                instance_id="astropy__astropy-6789",
                status=ExecutionStatus.COMPLETED,
                model_patch="patch 2",
            ),
            InstanceResult(
                instance_id="flask__flask-111",
                status=ExecutionStatus.FAILED,
                error_message="Failed",
            ),
            InstanceResult(
                instance_id="numpy__numpy-222",
                status=ExecutionStatus.PENDING,
            ),
        ]

    @pytest.fixture
    def benchmark_result(self, sample_results):
        """Create a BenchmarkResult with sample results."""
        return BenchmarkResult(
            run_id="run-001",
            variant=BenchmarkVariant.LITE,
            total_instances=4,
            instance_results=sample_results,
        )

    def test_export_to_file(self, sample_results):
        """Test exporting results to JSONL file."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            output_path = f.name

        try:
            count = export_predictions(sample_results, output_path)

            # Should export COMPLETED and FAILED, not PENDING
            assert count == 3

            # Verify file content
            with open(output_path, "r") as f:
                lines = [line.strip() for line in f if line.strip()]

            assert len(lines) == 3

            # Verify JSON format
            for line in lines:
                data = json.loads(line)
                assert "instance_id" in data
                assert "model_name_or_path" in data
                assert "model_patch" in data
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_export_from_benchmark_result(self, benchmark_result):
        """Test exporting from BenchmarkResult object."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            output_path = f.name

        try:
            count = export_predictions(benchmark_result, output_path)
            assert count == 3  # COMPLETED + FAILED, not PENDING
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_exclude_failed_results(self, sample_results):
        """Test excluding failed results from export."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            output_path = f.name

        try:
            count = export_predictions(
                sample_results, output_path, include_failed=False
            )
            assert count == 2  # Only COMPLETED
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_exclude_empty_patches(self, sample_results):
        """Test excluding results with empty patches."""
        # Add a result with empty patch
        sample_results.append(
            InstanceResult(
                instance_id="empty__empty-333",
                status=ExecutionStatus.COMPLETED,
                model_patch="",  # Empty patch
            )
        )

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            output_path = f.name

        try:
            count = export_predictions(
                sample_results, output_path, include_empty_patches=False
            )
            # Should exclude: empty patch result AND failed result (no patch)
            # Only 2 COMPLETED with patches remain
            assert count == 2
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_creates_parent_directory(self, sample_results):
        """Test that parent directories are created."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "nested" / "dir" / "predictions.jsonl"

            count = export_predictions(sample_results, output_path)
            assert count > 0
            assert output_path.exists()


class TestExportPredictionsToString:
    """Tests for export_predictions_to_string function."""

    @pytest.fixture
    def sample_results(self):
        """Create sample instance results."""
        return [
            InstanceResult(
                instance_id="django__django-12345",
                status=ExecutionStatus.COMPLETED,
                model_patch="patch 1",
            ),
            InstanceResult(
                instance_id="astropy__astropy-6789",
                status=ExecutionStatus.COMPLETED,
                model_patch="patch 2",
            ),
        ]

    def test_string_output_format(self, sample_results):
        """Test that string output is valid JSONL."""
        output = export_predictions_to_string(sample_results)

        lines = output.strip().split("\n")
        assert len(lines) == 2

        for line in lines:
            data = json.loads(line)
            assert "instance_id" in data
            assert "model_name_or_path" in data
            assert "model_patch" in data

    def test_empty_results(self):
        """Test string output for empty results."""
        output = export_predictions_to_string([])
        assert output == ""


class TestAppendPrediction:
    """Tests for append_prediction function."""

    def test_append_to_new_file(self):
        """Test appending to a new file."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            output_path = f.name

        # Delete the file to test creation
        Path(output_path).unlink()

        try:
            result = InstanceResult(
                instance_id="django__django-12345",
                status=ExecutionStatus.COMPLETED,
                model_patch="patch 1",
            )
            append_prediction(output_path, result)

            with open(output_path, "r") as f:
                lines = f.readlines()

            assert len(lines) == 1
            data = json.loads(lines[0])
            assert data["instance_id"] == "django__django-12345"
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_append_multiple(self):
        """Test appending multiple predictions."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            output_path = f.name

        # Clear the file
        Path(output_path).write_text("")

        try:
            for i in range(3):
                result = InstanceResult(
                    instance_id=f"repo__repo-{i}",
                    status=ExecutionStatus.COMPLETED,
                    model_patch=f"patch {i}",
                )
                append_prediction(output_path, result)

            with open(output_path, "r") as f:
                lines = [line.strip() for line in f if line.strip()]

            assert len(lines) == 3
        finally:
            Path(output_path).unlink(missing_ok=True)


class TestValidatePredictionsFile:
    """Tests for validate_predictions_file function."""

    def test_valid_file(self):
        """Test validation of a valid JSONL file."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            f.write(
                json.dumps(
                    {
                        "instance_id": "django__django-12345",
                        "model_name_or_path": "autoclaude",
                        "model_patch": "patch content",
                    }
                )
                + "\n"
            )
            f.write(
                json.dumps(
                    {
                        "instance_id": "astropy__astropy-6789",
                        "model_name_or_path": "autoclaude",
                        "model_patch": "",
                    }
                )
                + "\n"
            )
            output_path = f.name

        try:
            is_valid, errors = validate_predictions_file(output_path)
            assert is_valid is True
            assert errors == []
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_file_not_found(self):
        """Test validation of non-existent file."""
        is_valid, errors = validate_predictions_file("/nonexistent/path.jsonl")
        assert is_valid is False
        assert len(errors) == 1
        assert "not found" in errors[0].lower()

    def test_invalid_json(self):
        """Test validation catches invalid JSON."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            f.write("not valid json\n")
            output_path = f.name

        try:
            is_valid, errors = validate_predictions_file(output_path)
            assert is_valid is False
            assert len(errors) == 1
            assert "Invalid JSON" in errors[0]
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_missing_required_field(self):
        """Test validation catches missing required fields."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            # Missing model_patch field
            f.write(
                json.dumps(
                    {
                        "instance_id": "django__django-12345",
                        "model_name_or_path": "autoclaude",
                    }
                )
                + "\n"
            )
            output_path = f.name

        try:
            is_valid, errors = validate_predictions_file(output_path)
            assert is_valid is False
            assert len(errors) == 1
            assert "model_patch" in errors[0]
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_empty_instance_id(self):
        """Test validation catches empty instance_id."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            f.write(
                json.dumps(
                    {
                        "instance_id": "",
                        "model_name_or_path": "autoclaude",
                        "model_patch": "patch",
                    }
                )
                + "\n"
            )
            output_path = f.name

        try:
            is_valid, errors = validate_predictions_file(output_path)
            assert is_valid is False
            assert len(errors) == 1
            assert "cannot be empty" in errors[0]
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_empty_file_is_valid(self):
        """Test that an empty file is considered valid."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            output_path = f.name

        try:
            is_valid, errors = validate_predictions_file(output_path)
            assert is_valid is True
            assert errors == []
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_blank_lines_ignored(self):
        """Test that blank lines are ignored during validation."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            f.write("\n")
            f.write(
                json.dumps(
                    {
                        "instance_id": "test-id",
                        "model_name_or_path": "autoclaude",
                        "model_patch": "patch",
                    }
                )
                + "\n"
            )
            f.write("\n")
            f.write("  \n")  # Whitespace only
            output_path = f.name

        try:
            is_valid, errors = validate_predictions_file(output_path)
            assert is_valid is True
            assert errors == []
        finally:
            Path(output_path).unlink(missing_ok=True)


class TestCountPredictions:
    """Tests for count_predictions function."""

    def test_count_predictions(self):
        """Test counting predictions in a file."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            for i in range(5):
                f.write(
                    json.dumps({"instance_id": f"test-{i}", "model_patch": "p"}) + "\n"
                )
            output_path = f.name

        try:
            count = count_predictions(output_path)
            assert count == 5
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_count_empty_file(self):
        """Test counting predictions in an empty file."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            output_path = f.name

        try:
            count = count_predictions(output_path)
            assert count == 0
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_count_skips_blank_lines(self):
        """Test that blank lines are not counted."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".jsonl", delete=False
        ) as f:
            f.write('{"instance_id": "test-1", "model_patch": "p"}\n')
            f.write("\n")
            f.write('{"instance_id": "test-2", "model_patch": "p"}\n')
            f.write("   \n")
            output_path = f.name

        try:
            count = count_predictions(output_path)
            assert count == 2
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_count_nonexistent_file_raises(self):
        """Test that counting non-existent file raises ExportError."""
        with pytest.raises(ExportError):
            count_predictions("/nonexistent/path.jsonl")
