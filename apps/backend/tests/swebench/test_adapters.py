"""
Tests for SWE-bench Adapters
============================

Tests for data transformation adapters between SWE-bench and autoclaude formats.

Tests cover:
    - Instance ID parsing (double underscore format)
    - Schema validation for SWE-bench models
    - SWE-bench instance -> autoclaude spec conversion
    - Autoclaude results -> SWE-bench prediction conversion
    - JSONL file operations
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from swebench.adapters.instance_adapter import (
    AutoClaudeSpec,
    convert_to_autoclaude_spec,
    load_spec_from_directory,
    save_spec_to_directory,
)
from swebench.adapters.results_adapter import (
    convert_results_batch,
    convert_to_swebench_prediction,
    create_prediction_summary,
    export_predictions_to_jsonl,
    load_predictions_from_jsonl,
    prediction_to_jsonl_line,
    validate_jsonl_file,
)
from swebench.models import (
    EvaluationMetrics,
    InstanceResult,
    SWEBenchInstance,
    SWEBenchPrediction,
)


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sample_swebench_instance() -> SWEBenchInstance:
    """Create a sample SWE-bench instance for testing."""
    return SWEBenchInstance(
        instance_id="django__django-12345",
        problem_statement="There is a bug in the admin panel.",
        base_commit="abc123def456",
        fail_to_pass=["tests/test_admin.py::test_create_user"],
        pass_to_pass=["tests/test_admin.py::test_list_users"],
        test_patch="--- a/test.py\n+++ b/test.py\n@@ -1 +1 @@\n-old\n+new",
        hints_text="Check the admin views.",
        version="3.2",
    )


@pytest.fixture
def sample_instance_result() -> InstanceResult:
    """Create a sample instance result for testing."""
    return InstanceResult(
        instance_id="django__django-12345",
        status="success",
        model_patch="--- a/file.py\n+++ b/file.py\n@@ -1 +1 @@\n-bug\n+fixed",
        execution_time_seconds=45.5,
        tests_passed=1,
        tests_total=1,
    )


@pytest.fixture
def sample_prediction() -> SWEBenchPrediction:
    """Create a sample prediction for testing."""
    return SWEBenchPrediction(
        instance_id="django__django-12345",
        model_patch="--- a/file.py\n+++ b/file.py",
        model_name_or_path="autoclaude",
    )


@pytest.fixture
def temp_spec_dir(tmp_path: Path) -> Path:
    """Create temporary directory for spec files."""
    spec_dir = tmp_path / "specs" / "test-spec"
    spec_dir.mkdir(parents=True)
    return spec_dir


@pytest.fixture
def temp_jsonl_file(tmp_path: Path) -> Path:
    """Create temporary JSONL file path."""
    return tmp_path / "predictions.jsonl"


# =============================================================================
# Instance ID Parsing Tests
# =============================================================================


class TestInstanceIdParsing:
    """Test instance_id parsing with double underscore format."""

    def test_standard_instance_id_format(self):
        """Test parsing standard format: owner__repo-issue."""
        instance = SWEBenchInstance(
            instance_id="django__django-12345",
            problem_statement="Bug report",
            base_commit="abc123",
        )
        assert instance.get_owner() == "django"
        assert instance.get_repo_name() == "django"
        assert instance.get_issue_number() == 12345
        assert instance.repo == "django/django"

    def test_hyphenated_repo_name(self):
        """Test parsing repo with hyphens: owner__repo-name-issue."""
        instance = SWEBenchInstance(
            instance_id="pallets__flask-1234",
            problem_statement="Bug report",
            base_commit="abc123",
        )
        assert instance.get_owner() == "pallets"
        assert instance.get_repo_name() == "flask"
        assert instance.get_issue_number() == 1234
        assert instance.repo == "pallets/flask"

    def test_complex_instance_id(self):
        """Test parsing complex instance_id with multiple hyphens."""
        instance = SWEBenchInstance(
            instance_id="scikit-learn__scikit-learn-9876",
            problem_statement="Bug report",
            base_commit="abc123",
        )
        assert instance.get_owner() == "scikit-learn"
        assert instance.get_issue_number() == 9876
        assert instance.repo == "scikit-learn/scikit-learn"

    def test_repo_extraction_on_creation(self):
        """Test that repo is automatically extracted from instance_id."""
        instance = SWEBenchInstance(
            instance_id="sympy__sympy-56789",
            problem_statement="Math issue",
            base_commit="def456",
        )
        # Repo should be auto-populated from instance_id
        assert instance.repo == "sympy/sympy"

    def test_single_underscore_not_valid(self):
        """Test that single underscore in instance_id doesn't extract repo."""
        instance = SWEBenchInstance(
            instance_id="invalid_format-123",
            problem_statement="Issue",
            base_commit="abc",
        )
        # No double underscore, so repo extraction fails
        assert instance.repo == ""
        assert instance.get_owner() == ""

    def test_empty_instance_id_raises_error(self):
        """Test that empty instance_id raises validation error."""
        with pytest.raises(ValidationError):
            SWEBenchInstance(
                instance_id="",
                problem_statement="Issue",
                base_commit="abc",
            )

    def test_issue_number_extraction_edge_cases(self):
        """Test issue number extraction edge cases."""
        # Valid case
        instance1 = SWEBenchInstance(
            instance_id="owner__repo-1",
            problem_statement="Issue",
            base_commit="abc",
        )
        assert instance1.get_issue_number() == 1

        # Very large issue number
        instance2 = SWEBenchInstance(
            instance_id="owner__repo-999999",
            problem_statement="Issue",
            base_commit="abc",
        )
        assert instance2.get_issue_number() == 999999

    def test_manual_repo_override(self):
        """Test that manually specified repo is preserved."""
        instance = SWEBenchInstance(
            instance_id="owner__repo-123",
            problem_statement="Issue",
            base_commit="abc",
            repo="different/repo",
        )
        # Manual repo takes precedence
        assert instance.repo == "different/repo"


# =============================================================================
# Schema Validation Tests
# =============================================================================


class TestSchemaValidation:
    """Test Pydantic schema validation for SWE-bench models."""

    def test_swebench_instance_minimal_fields(self):
        """Test creating instance with only required fields."""
        instance = SWEBenchInstance(
            instance_id="owner__repo-123",
            problem_statement="Bug",
            base_commit="abc123",
        )
        assert instance.instance_id == "owner__repo-123"
        assert instance.fail_to_pass == []
        assert instance.pass_to_pass == []
        assert instance.test_patch == ""

    def test_swebench_instance_all_fields(
        self, sample_swebench_instance: SWEBenchInstance
    ):
        """Test creating instance with all fields."""
        assert sample_swebench_instance.instance_id == "django__django-12345"
        assert sample_swebench_instance.problem_statement == (
            "There is a bug in the admin panel."
        )
        assert sample_swebench_instance.base_commit == "abc123def456"
        assert sample_swebench_instance.fail_to_pass == [
            "tests/test_admin.py::test_create_user"
        ]
        assert sample_swebench_instance.pass_to_pass == [
            "tests/test_admin.py::test_list_users"
        ]
        assert sample_swebench_instance.hints_text == "Check the admin views."
        assert sample_swebench_instance.version == "3.2"

    def test_swebench_instance_from_dict_with_aliases(self):
        """Test creating instance from dict with HuggingFace field names."""
        raw_data = {
            "instance_id": "owner__repo-456",
            "problem_statement": "Issue description",
            "base_commit": "xyz789",
            "FAIL_TO_PASS": ["test1", "test2"],  # Using alias
            "PASS_TO_PASS": ["test3"],  # Using alias
        }
        instance = SWEBenchInstance.model_validate(raw_data)
        assert instance.fail_to_pass == ["test1", "test2"]
        assert instance.pass_to_pass == ["test3"]

    def test_swebench_prediction_validation(self):
        """Test SWEBenchPrediction validation."""
        prediction = SWEBenchPrediction(
            instance_id="owner__repo-123",
            model_patch="diff content",
            model_name_or_path="test-model",
        )
        assert prediction.instance_id == "owner__repo-123"
        assert prediction.model_patch == "diff content"
        assert prediction.model_name_or_path == "test-model"

    def test_swebench_prediction_default_model_name(self):
        """Test that default model name is 'autoclaude'."""
        prediction = SWEBenchPrediction(
            instance_id="owner__repo-123",
            model_patch="patch",
        )
        assert prediction.model_name_or_path == "autoclaude"

    def test_instance_result_validation(self):
        """Test InstanceResult validation."""
        result = InstanceResult(
            instance_id="owner__repo-123",
            status="success",
            model_patch="patch",
            execution_time_seconds=10.5,
        )
        assert result.status == "success"
        assert result.execution_time_seconds == 10.5

    def test_instance_result_status_values(self):
        """Test InstanceResult accepts valid status values."""
        valid_statuses = ["pending", "running", "success", "failed", "error", "skipped"]
        for status in valid_statuses:
            result = InstanceResult(
                instance_id="owner__repo-123",
                status=status,
            )
            assert result.status == status

    def test_evaluation_metrics_validation(self):
        """Test EvaluationMetrics validation and calculations."""
        metrics = EvaluationMetrics(
            total_instances=100,
            completed_instances=80,
            successful_instances=60,
            failed_instances=15,
            error_instances=5,
            total_execution_time_seconds=3600.0,
        )
        assert metrics.resolution_rate == 0.75  # 60/80
        assert metrics.average_execution_time_seconds == 45.0  # 3600/80

    def test_evaluation_metrics_zero_completed(self):
        """Test EvaluationMetrics with zero completed instances."""
        metrics = EvaluationMetrics(
            total_instances=100,
            completed_instances=0,
        )
        assert metrics.resolution_rate == 0.0


# =============================================================================
# Instance Adapter Tests
# =============================================================================


class TestInstanceAdapter:
    """Test SWE-bench instance to autoclaude spec conversion."""

    def test_basic_conversion(self, sample_swebench_instance: SWEBenchInstance):
        """Test basic instance to spec conversion."""
        spec = convert_to_autoclaude_spec(sample_swebench_instance)

        assert spec.instance_id == "django__django-12345"
        assert spec.repo == "django/django"
        assert spec.base_commit == "abc123def456"
        assert spec.workflow_type == "bugfix"
        assert spec.source == "swebench"

    def test_task_description_includes_context(
        self, sample_swebench_instance: SWEBenchInstance
    ):
        """Test that task description includes repository context."""
        spec = convert_to_autoclaude_spec(sample_swebench_instance)

        assert "django/django" in spec.task_description
        assert "#12345" in spec.task_description
        assert "There is a bug in the admin panel." in spec.task_description

    def test_hints_included_by_default(
        self, sample_swebench_instance: SWEBenchInstance
    ):
        """Test that hints are included by default."""
        spec = convert_to_autoclaude_spec(sample_swebench_instance)
        assert spec.hints_text == "Check the admin views."

    def test_hints_excluded_when_disabled(
        self, sample_swebench_instance: SWEBenchInstance
    ):
        """Test that hints can be excluded."""
        spec = convert_to_autoclaude_spec(
            sample_swebench_instance,
            include_hints=False,
        )
        assert spec.hints_text == ""

    def test_test_info_excluded_by_default(
        self, sample_swebench_instance: SWEBenchInstance
    ):
        """Test that test info is excluded by default (to not leak solution info)."""
        spec = convert_to_autoclaude_spec(sample_swebench_instance)
        assert spec.fail_to_pass_tests == []
        assert spec.pass_to_pass_tests == []

    def test_test_info_included_when_enabled(
        self, sample_swebench_instance: SWEBenchInstance
    ):
        """Test that test info can be included for reference."""
        spec = convert_to_autoclaude_spec(
            sample_swebench_instance,
            include_test_info=True,
        )
        assert spec.fail_to_pass_tests == ["tests/test_admin.py::test_create_user"]
        assert spec.pass_to_pass_tests == ["tests/test_admin.py::test_list_users"]

    def test_version_preserved(self, sample_swebench_instance: SWEBenchInstance):
        """Test that version is preserved in conversion."""
        spec = convert_to_autoclaude_spec(sample_swebench_instance)
        assert spec.version == "3.2"

    def test_created_at_timestamp_set(
        self, sample_swebench_instance: SWEBenchInstance
    ):
        """Test that created_at timestamp is set."""
        spec = convert_to_autoclaude_spec(sample_swebench_instance)
        assert spec.created_at is not None
        assert len(spec.created_at) > 0


class TestSpecFileSaveLoad:
    """Test saving and loading spec files."""

    def test_save_spec_to_directory(
        self,
        sample_swebench_instance: SWEBenchInstance,
        temp_spec_dir: Path,
    ):
        """Test saving spec to directory."""
        spec = convert_to_autoclaude_spec(sample_swebench_instance)
        requirements_file = save_spec_to_directory(spec, temp_spec_dir)

        assert requirements_file.exists()
        assert requirements_file.name == "requirements.json"

        # Verify contents
        with open(requirements_file) as f:
            data = json.load(f)

        assert data["workflow_type"] == "bugfix"
        assert data["swebench_metadata"]["instance_id"] == "django__django-12345"
        assert data["swebench_metadata"]["repo"] == "django/django"

    def test_save_spec_overwrite_disabled_raises_error(
        self,
        sample_swebench_instance: SWEBenchInstance,
        temp_spec_dir: Path,
    ):
        """Test that saving to existing file raises error by default."""
        spec = convert_to_autoclaude_spec(sample_swebench_instance)
        save_spec_to_directory(spec, temp_spec_dir)

        # Second save should fail
        with pytest.raises(FileExistsError):
            save_spec_to_directory(spec, temp_spec_dir)

    def test_save_spec_overwrite_enabled(
        self,
        sample_swebench_instance: SWEBenchInstance,
        temp_spec_dir: Path,
    ):
        """Test that overwrite=True allows replacing file."""
        spec = convert_to_autoclaude_spec(sample_swebench_instance)
        save_spec_to_directory(spec, temp_spec_dir)
        save_spec_to_directory(spec, temp_spec_dir, overwrite=True)  # Should not raise

    def test_load_spec_from_directory(
        self,
        sample_swebench_instance: SWEBenchInstance,
        temp_spec_dir: Path,
    ):
        """Test loading spec from directory."""
        original_spec = convert_to_autoclaude_spec(sample_swebench_instance)
        save_spec_to_directory(original_spec, temp_spec_dir)

        loaded_spec = load_spec_from_directory(temp_spec_dir)

        assert loaded_spec is not None
        assert loaded_spec.instance_id == original_spec.instance_id
        assert loaded_spec.repo == original_spec.repo
        assert loaded_spec.base_commit == original_spec.base_commit

    def test_load_spec_nonexistent_returns_none(self, tmp_path: Path):
        """Test loading from nonexistent directory returns None."""
        result = load_spec_from_directory(tmp_path / "nonexistent")
        assert result is None


# =============================================================================
# Results Adapter Tests
# =============================================================================


class TestResultsAdapter:
    """Test autoclaude results to SWE-bench prediction conversion."""

    def test_basic_conversion(self, sample_instance_result: InstanceResult):
        """Test basic result to prediction conversion."""
        prediction = convert_to_swebench_prediction(sample_instance_result)

        assert prediction.instance_id == "django__django-12345"
        assert prediction.model_patch == (
            "--- a/file.py\n+++ b/file.py\n@@ -1 +1 @@\n-bug\n+fixed"
        )
        assert prediction.model_name_or_path == "autoclaude"

    def test_custom_model_name(self, sample_instance_result: InstanceResult):
        """Test conversion with custom model name."""
        prediction = convert_to_swebench_prediction(
            sample_instance_result,
            model_name_or_path="my-custom-model",
        )
        assert prediction.model_name_or_path == "my-custom-model"

    def test_empty_patch_for_failed_result(self):
        """Test that failed results produce empty patch."""
        result = InstanceResult(
            instance_id="owner__repo-123",
            status="failed",
            model_patch=None,
        )
        prediction = convert_to_swebench_prediction(result)
        assert prediction.model_patch == ""

    def test_batch_conversion(self):
        """Test batch conversion of results."""
        results = [
            InstanceResult(
                instance_id="owner__repo-1",
                status="success",
                model_patch="patch1",
            ),
            InstanceResult(
                instance_id="owner__repo-2",
                status="success",
                model_patch="patch2",
            ),
            InstanceResult(
                instance_id="owner__repo-3",
                status="failed",
                model_patch=None,
            ),
        ]
        predictions = convert_results_batch(results)
        assert len(predictions) == 3
        assert predictions[0].instance_id == "owner__repo-1"
        assert predictions[2].model_patch == ""

    def test_batch_conversion_exclude_failed(self):
        """Test batch conversion excluding failed results."""
        results = [
            InstanceResult(
                instance_id="owner__repo-1",
                status="success",
                model_patch="patch1",
            ),
            InstanceResult(
                instance_id="owner__repo-2",
                status="failed",
                model_patch=None,
            ),
            InstanceResult(
                instance_id="owner__repo-3",
                status="error",
                model_patch=None,
            ),
        ]
        predictions = convert_results_batch(results, include_failed=False)
        assert len(predictions) == 1
        assert predictions[0].instance_id == "owner__repo-1"


class TestPredictionSerialization:
    """Test prediction serialization to JSONL."""

    def test_prediction_to_jsonl_line(self, sample_prediction: SWEBenchPrediction):
        """Test serializing prediction to JSONL line."""
        line = prediction_to_jsonl_line(sample_prediction)
        data = json.loads(line)

        assert data["instance_id"] == "django__django-12345"
        assert data["model_patch"] == "--- a/file.py\n+++ b/file.py"
        assert data["model_name_or_path"] == "autoclaude"

    def test_export_predictions_to_jsonl(
        self,
        sample_prediction: SWEBenchPrediction,
        temp_jsonl_file: Path,
    ):
        """Test exporting predictions to JSONL file."""
        predictions = [sample_prediction]
        output_path = export_predictions_to_jsonl(predictions, temp_jsonl_file)

        assert output_path.exists()
        with open(output_path) as f:
            lines = f.readlines()

        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["instance_id"] == "django__django-12345"

    def test_export_multiple_predictions(self, temp_jsonl_file: Path):
        """Test exporting multiple predictions."""
        predictions = [
            SWEBenchPrediction(
                instance_id=f"owner__repo-{i}",
                model_patch=f"patch{i}",
            )
            for i in range(5)
        ]
        export_predictions_to_jsonl(predictions, temp_jsonl_file)

        with open(temp_jsonl_file) as f:
            lines = f.readlines()

        assert len(lines) == 5

    def test_export_overwrite_disabled_raises_error(
        self,
        sample_prediction: SWEBenchPrediction,
        temp_jsonl_file: Path,
    ):
        """Test that exporting to existing file raises error."""
        export_predictions_to_jsonl([sample_prediction], temp_jsonl_file)

        with pytest.raises(FileExistsError):
            export_predictions_to_jsonl([sample_prediction], temp_jsonl_file)

    def test_export_append_mode(
        self,
        sample_prediction: SWEBenchPrediction,
        temp_jsonl_file: Path,
    ):
        """Test appending to existing JSONL file."""
        export_predictions_to_jsonl([sample_prediction], temp_jsonl_file)
        export_predictions_to_jsonl([sample_prediction], temp_jsonl_file, append=True)

        with open(temp_jsonl_file) as f:
            lines = f.readlines()

        assert len(lines) == 2

    def test_export_overwrite_and_append_raises_error(
        self,
        sample_prediction: SWEBenchPrediction,
        temp_jsonl_file: Path,
    ):
        """Test that overwrite=True and append=True raises error."""
        with pytest.raises(ValueError):
            export_predictions_to_jsonl(
                [sample_prediction],
                temp_jsonl_file,
                overwrite=True,
                append=True,
            )

    def test_load_predictions_from_jsonl(self, temp_jsonl_file: Path):
        """Test loading predictions from JSONL file."""
        # Write test data
        predictions_data = [
            {"instance_id": "owner__repo-1", "model_patch": "p1", "model_name_or_path": "autoclaude"},
            {"instance_id": "owner__repo-2", "model_patch": "p2", "model_name_or_path": "autoclaude"},
        ]
        with open(temp_jsonl_file, "w") as f:
            for pred in predictions_data:
                f.write(json.dumps(pred) + "\n")

        # Load and verify
        loaded = load_predictions_from_jsonl(temp_jsonl_file)
        assert len(loaded) == 2
        assert loaded[0].instance_id == "owner__repo-1"
        assert loaded[1].instance_id == "owner__repo-2"

    def test_load_predictions_nonexistent_file(self, tmp_path: Path):
        """Test loading from nonexistent file raises error."""
        with pytest.raises(FileNotFoundError):
            load_predictions_from_jsonl(tmp_path / "nonexistent.jsonl")

    def test_load_predictions_invalid_json(self, temp_jsonl_file: Path):
        """Test loading invalid JSON raises error."""
        with open(temp_jsonl_file, "w") as f:
            f.write("not valid json\n")

        with pytest.raises(ValueError) as exc_info:
            load_predictions_from_jsonl(temp_jsonl_file)
        assert "Invalid JSON" in str(exc_info.value)


class TestJSONLValidation:
    """Test JSONL file validation."""

    def test_validate_valid_jsonl(self, temp_jsonl_file: Path):
        """Test validating a correct JSONL file."""
        predictions_data = [
            {"instance_id": "owner__repo-1", "model_patch": "p1", "model_name_or_path": "autoclaude"},
            {"instance_id": "owner__repo-2", "model_patch": "p2", "model_name_or_path": "autoclaude"},
        ]
        with open(temp_jsonl_file, "w") as f:
            for pred in predictions_data:
                f.write(json.dumps(pred) + "\n")

        is_valid, errors = validate_jsonl_file(temp_jsonl_file)
        assert is_valid is True
        assert errors == []

    def test_validate_missing_instance_id(self, temp_jsonl_file: Path):
        """Test validation catches missing instance_id."""
        with open(temp_jsonl_file, "w") as f:
            f.write(json.dumps({"model_patch": "p", "model_name_or_path": "x"}) + "\n")

        is_valid, errors = validate_jsonl_file(temp_jsonl_file)
        assert is_valid is False
        assert any("instance_id" in e for e in errors)

    def test_validate_missing_model_patch(self, temp_jsonl_file: Path):
        """Test validation catches missing model_patch."""
        with open(temp_jsonl_file, "w") as f:
            f.write(json.dumps({"instance_id": "owner__repo-1", "model_name_or_path": "x"}) + "\n")

        is_valid, errors = validate_jsonl_file(temp_jsonl_file)
        assert is_valid is False
        assert any("model_patch" in e for e in errors)

    def test_validate_missing_model_name(self, temp_jsonl_file: Path):
        """Test validation catches missing model_name_or_path."""
        with open(temp_jsonl_file, "w") as f:
            f.write(json.dumps({"instance_id": "owner__repo-1", "model_patch": "p"}) + "\n")

        is_valid, errors = validate_jsonl_file(temp_jsonl_file)
        assert is_valid is False
        assert any("model_name_or_path" in e for e in errors)

    def test_validate_invalid_instance_id_format(self, temp_jsonl_file: Path):
        """Test validation catches invalid instance_id format (missing __)."""
        with open(temp_jsonl_file, "w") as f:
            # Single underscore instead of double
            f.write(json.dumps({
                "instance_id": "owner_repo-1",  # Wrong format
                "model_patch": "p",
                "model_name_or_path": "x",
            }) + "\n")

        is_valid, errors = validate_jsonl_file(temp_jsonl_file)
        assert is_valid is False
        assert any("double underscore" in e for e in errors)

    def test_validate_invalid_json_line(self, temp_jsonl_file: Path):
        """Test validation catches invalid JSON."""
        with open(temp_jsonl_file, "w") as f:
            f.write("not valid json\n")

        is_valid, errors = validate_jsonl_file(temp_jsonl_file)
        assert is_valid is False
        assert any("Invalid JSON" in e for e in errors)

    def test_validate_nonexistent_file(self, tmp_path: Path):
        """Test validation of nonexistent file."""
        is_valid, errors = validate_jsonl_file(tmp_path / "nonexistent.jsonl")
        assert is_valid is False
        assert any("not found" in e.lower() for e in errors)

    def test_validate_skips_empty_lines(self, temp_jsonl_file: Path):
        """Test validation skips empty lines."""
        with open(temp_jsonl_file, "w") as f:
            f.write(json.dumps({"instance_id": "owner__repo-1", "model_patch": "p", "model_name_or_path": "x"}) + "\n")
            f.write("\n")  # Empty line
            f.write("   \n")  # Whitespace line
            f.write(json.dumps({"instance_id": "owner__repo-2", "model_patch": "p", "model_name_or_path": "x"}) + "\n")

        is_valid, errors = validate_jsonl_file(temp_jsonl_file)
        assert is_valid is True
        assert errors == []


class TestPredictionSummary:
    """Test prediction summary generation."""

    def test_create_prediction_summary(self):
        """Test creating summary of predictions."""
        predictions = [
            SWEBenchPrediction(instance_id="owner__repo-1", model_patch="patch1"),
            SWEBenchPrediction(instance_id="owner__repo-2", model_patch=""),
            SWEBenchPrediction(instance_id="owner__repo-3", model_patch="patch3"),
        ]
        summary = create_prediction_summary(predictions)

        assert summary["total_predictions"] == 3
        assert summary["predictions_with_patch"] == 2
        assert summary["predictions_empty_patch"] == 1
        assert "autoclaude" in summary["model_names"]
        assert "generated_at" in summary

    def test_summary_empty_predictions(self):
        """Test summary with no predictions."""
        summary = create_prediction_summary([])
        assert summary["total_predictions"] == 0
        assert summary["predictions_with_patch"] == 0
        assert summary["predictions_empty_patch"] == 0


# =============================================================================
# AutoClaudeSpec Model Tests
# =============================================================================


class TestAutoClaudeSpec:
    """Test AutoClaudeSpec model."""

    def test_default_values(self):
        """Test AutoClaudeSpec default values."""
        spec = AutoClaudeSpec(task_description="Task")
        assert spec.workflow_type == "bugfix"
        assert spec.repo == ""
        assert spec.source == "swebench"
        assert spec.fail_to_pass_tests == []
        assert spec.pass_to_pass_tests == []

    def test_created_at_auto_populated(self):
        """Test that created_at is auto-populated."""
        spec = AutoClaudeSpec(task_description="Task")
        assert spec.created_at is not None
        assert len(spec.created_at) > 10  # ISO format should be lengthy


# =============================================================================
# Edge Cases and Error Handling
# =============================================================================


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_empty_problem_statement(self):
        """Test instance with empty problem statement."""
        instance = SWEBenchInstance(
            instance_id="owner__repo-123",
            problem_statement="",
            base_commit="abc",
        )
        spec = convert_to_autoclaude_spec(instance)
        assert spec.task_description is not None

    def test_special_characters_in_patch(self):
        """Test handling special characters in patches."""
        result = InstanceResult(
            instance_id="owner__repo-123",
            status="success",
            model_patch='--- a/file.py\n+++ b/file.py\n@@ -1 +1 @@\n-x = "test"\n+x = "new"',
        )
        prediction = convert_to_swebench_prediction(result)

        # Serialize and deserialize
        line = prediction_to_jsonl_line(prediction)
        data = json.loads(line)
        assert '"test"' in data["model_patch"]

    def test_unicode_in_problem_statement(self):
        """Test handling unicode characters in problem statement."""
        instance = SWEBenchInstance(
            instance_id="owner__repo-123",
            problem_statement="Bug with unicode: \u2022 \u00e9 \u00fc \u4e2d\u6587",
            base_commit="abc",
        )
        spec = convert_to_autoclaude_spec(instance)
        assert "\u2022" in spec.task_description

    def test_very_long_patch(self):
        """Test handling very long patch content."""
        long_patch = "--- a/file.py\n+++ b/file.py\n" + "@@ -1 +1 @@\n" * 10000
        result = InstanceResult(
            instance_id="owner__repo-123",
            status="success",
            model_patch=long_patch,
        )
        prediction = convert_to_swebench_prediction(result)
        assert len(prediction.model_patch) == len(long_patch)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
