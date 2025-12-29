"""
Unit Tests for SWE-bench Pydantic Models
=========================================

Tests cover:
- SWEBenchInstance validation (instance_id format, commit hash validation)
- AutoclaudeTask creation and field mapping
- TestCriteria properties
- PredictionEntry schema compliance
- ExecutionStatus enum values
- InstanceResult validation
- BenchmarkResult properties (is_complete, success_count, failure_count)
- HealthCheckResult validation
- InfrastructureStatus aggregation properties
- BenchmarkVariant enum and dataset name mapping
"""

from datetime import datetime

import pytest

from apps.backend.services.swebench.models import (
    AutoclaudeTask,
    BenchmarkResult,
    BenchmarkVariant,
    ExecutionStatus,
    HealthCheckResult,
    InfrastructureStatus,
    InstanceResult,
    PredictionEntry,
    SWEBenchInstance,
    TestCriteria,
    VARIANT_DATASET_NAMES,
)


class TestBenchmarkVariant:
    """Tests for BenchmarkVariant enum."""

    def test_all_variants_defined(self):
        """Test that all 5 benchmark variants are defined."""
        variants = list(BenchmarkVariant)
        assert len(variants) == 5
        assert BenchmarkVariant.LITE in variants
        assert BenchmarkVariant.VERIFIED in variants
        assert BenchmarkVariant.FULL in variants
        assert BenchmarkVariant.MULTIMODAL in variants
        assert BenchmarkVariant.MULTILINGUAL in variants

    def test_variant_values(self):
        """Test that variant values are lowercase strings."""
        assert BenchmarkVariant.LITE.value == "lite"
        assert BenchmarkVariant.VERIFIED.value == "verified"
        assert BenchmarkVariant.FULL.value == "full"
        assert BenchmarkVariant.MULTIMODAL.value == "multimodal"
        assert BenchmarkVariant.MULTILINGUAL.value == "multilingual"

    def test_variant_dataset_names_mapping(self):
        """Test that all variants have dataset names mapped."""
        for variant in BenchmarkVariant:
            assert variant in VARIANT_DATASET_NAMES
            assert VARIANT_DATASET_NAMES[variant].startswith("princeton-nlp/")


class TestSWEBenchInstance:
    """Tests for SWEBenchInstance model validation."""

    @pytest.fixture
    def valid_instance_data(self):
        """Return valid instance data for testing."""
        return {
            "instance_id": "django__django-12345",
            "repo": "django/django",
            "problem_statement": "Fix bug in QuerySet",
            "base_commit": "abc123def456",
            "patch": "diff --git a/file.py b/file.py...",
            "test_patch": "",
            "FAIL_TO_PASS": ["test_queryset::test_filter"],
            "PASS_TO_PASS": ["test_queryset::test_all"],
        }

    def test_valid_instance_creation(self, valid_instance_data):
        """Test creating a valid SWEBenchInstance."""
        instance = SWEBenchInstance(**valid_instance_data)
        assert instance.instance_id == "django__django-12345"
        assert instance.repo == "django/django"
        assert instance.problem_statement == "Fix bug in QuerySet"
        assert instance.base_commit == "abc123def456"

    def test_instance_id_format_valid(self, valid_instance_data):
        """Test valid instance_id format patterns."""
        valid_ids = [
            "django__django-12345",
            "astropy__astropy-6789",
            "scikit-learn__scikit-learn-10000",
            "pytest-dev__pytest-123",
            "owner__repo-name-with-hyphens-1",
        ]
        for instance_id in valid_ids:
            valid_instance_data["instance_id"] = instance_id
            instance = SWEBenchInstance(**valid_instance_data)
            assert instance.instance_id == instance_id

    def test_instance_id_missing_double_underscore(self, valid_instance_data):
        """Test that instance_id without '__' separator fails validation."""
        valid_instance_data["instance_id"] = "django_django-12345"  # single underscore
        with pytest.raises(ValueError) as exc_info:
            SWEBenchInstance(**valid_instance_data)
        assert "must contain '__' separator" in str(exc_info.value)

    def test_instance_id_missing_hyphen(self, valid_instance_data):
        """Test that instance_id without hyphen separator fails validation."""
        valid_instance_data["instance_id"] = "django__django12345"  # no hyphen
        with pytest.raises(ValueError) as exc_info:
            SWEBenchInstance(**valid_instance_data)
        assert "must contain '-' separator" in str(exc_info.value)

    def test_instance_id_empty(self, valid_instance_data):
        """Test that empty instance_id fails validation."""
        valid_instance_data["instance_id"] = ""
        with pytest.raises(ValueError) as exc_info:
            SWEBenchInstance(**valid_instance_data)
        assert "cannot be empty" in str(exc_info.value)

    def test_instance_id_empty_owner(self, valid_instance_data):
        """Test that instance_id with empty owner fails validation."""
        valid_instance_data["instance_id"] = "__django-12345"
        with pytest.raises(ValueError) as exc_info:
            SWEBenchInstance(**valid_instance_data)
        assert "owner part cannot be empty" in str(exc_info.value)

    def test_base_commit_valid_hash(self, valid_instance_data):
        """Test valid git commit hash formats."""
        valid_hashes = [
            "abc123def456",  # 12 char
            "0123456789abcdef",  # 16 char
            "abc123def456789abcdef123456789abcdef1234",  # 40 char (full hash)
            "ABCDEF1234567",  # uppercase
        ]
        for commit in valid_hashes:
            valid_instance_data["base_commit"] = commit
            instance = SWEBenchInstance(**valid_instance_data)
            assert instance.base_commit == commit

    def test_base_commit_too_short(self, valid_instance_data):
        """Test that commit hash too short fails validation."""
        valid_instance_data["base_commit"] = "abc12"  # only 5 chars
        with pytest.raises(ValueError) as exc_info:
            SWEBenchInstance(**valid_instance_data)
        assert "too short" in str(exc_info.value)

    def test_base_commit_invalid_characters(self, valid_instance_data):
        """Test that commit hash with invalid characters fails validation."""
        valid_instance_data["base_commit"] = "abc123xyz456"  # 'x', 'y', 'z' are invalid
        with pytest.raises(ValueError) as exc_info:
            SWEBenchInstance(**valid_instance_data)
        assert "hexadecimal" in str(exc_info.value)

    def test_base_commit_empty(self, valid_instance_data):
        """Test that empty commit hash fails validation."""
        valid_instance_data["base_commit"] = ""
        with pytest.raises(ValueError) as exc_info:
            SWEBenchInstance(**valid_instance_data)
        assert "cannot be empty" in str(exc_info.value)

    def test_optional_fields_default(self, valid_instance_data):
        """Test that optional fields have correct defaults."""
        instance = SWEBenchInstance(**valid_instance_data)
        assert instance.hints_text is None
        assert instance.created_at is None
        assert instance.version is None
        assert instance.environment_setup_commit is None

    def test_optional_fields_populated(self, valid_instance_data):
        """Test that optional fields can be populated."""
        valid_instance_data["hints_text"] = "Try looking at the filter method"
        valid_instance_data["created_at"] = "2024-01-15"
        valid_instance_data["version"] = "4.2"
        valid_instance_data["environment_setup_commit"] = "def456abc789"

        instance = SWEBenchInstance(**valid_instance_data)
        assert instance.hints_text == "Try looking at the filter method"
        assert instance.created_at == "2024-01-15"
        assert instance.version == "4.2"
        assert instance.environment_setup_commit == "def456abc789"


class TestTestCriteria:
    """Tests for TestCriteria model."""

    def test_default_empty_lists(self):
        """Test that test criteria defaults to empty lists."""
        criteria = TestCriteria()
        assert criteria.fail_to_pass == []
        assert criteria.pass_to_pass == []

    def test_total_tests_property(self):
        """Test total_tests property calculation."""
        criteria = TestCriteria(
            fail_to_pass=["test1", "test2"],
            pass_to_pass=["test3", "test4", "test5"],
        )
        assert criteria.total_tests == 5

    def test_total_tests_empty(self):
        """Test total_tests when both lists are empty."""
        criteria = TestCriteria()
        assert criteria.total_tests == 0


class TestAutoclaudeTask:
    """Tests for AutoclaudeTask model."""

    def test_valid_task_creation(self):
        """Test creating a valid AutoclaudeTask."""
        task = AutoclaudeTask(
            task_id="django__django-12345",
            description="Fix the bug",
            repository="https://github.com/django/django",
            base_commit="abc123def456",
            test_criteria=TestCriteria(
                fail_to_pass=["test_filter"],
                pass_to_pass=["test_all"],
            ),
        )
        assert task.task_id == "django__django-12345"
        assert task.description == "Fix the bug"
        assert task.repository == "https://github.com/django/django"
        assert task.base_commit == "abc123def456"
        assert task.test_criteria.total_tests == 2

    def test_optional_hints(self):
        """Test that hints field is optional."""
        task = AutoclaudeTask(
            task_id="test",
            description="desc",
            repository="repo",
            base_commit="abc1234",
            test_criteria=TestCriteria(),
        )
        assert task.hints is None

    def test_metadata_default(self):
        """Test that metadata defaults to empty dict."""
        task = AutoclaudeTask(
            task_id="test",
            description="desc",
            repository="repo",
            base_commit="abc1234",
            test_criteria=TestCriteria(),
        )
        assert task.metadata == {}


class TestPredictionEntry:
    """Tests for PredictionEntry model."""

    def test_valid_prediction(self):
        """Test creating a valid prediction entry."""
        entry = PredictionEntry(
            instance_id="django__django-12345",
            model_patch="diff --git a/file.py...",
        )
        assert entry.instance_id == "django__django-12345"
        assert entry.model_name_or_path == "autoclaude"
        assert entry.model_patch == "diff --git a/file.py..."

    def test_custom_model_name(self):
        """Test prediction with custom model name."""
        entry = PredictionEntry(
            instance_id="test-id",
            model_name_or_path="custom-model",
            model_patch="patch content",
        )
        assert entry.model_name_or_path == "custom-model"

    def test_empty_patch_allowed(self):
        """Test that empty patch is allowed."""
        entry = PredictionEntry(
            instance_id="test-id",
            model_patch="",
        )
        assert entry.model_patch == ""


class TestExecutionStatus:
    """Tests for ExecutionStatus enum."""

    def test_all_statuses_defined(self):
        """Test that all execution statuses are defined."""
        statuses = list(ExecutionStatus)
        assert len(statuses) == 5
        assert ExecutionStatus.PENDING in statuses
        assert ExecutionStatus.RUNNING in statuses
        assert ExecutionStatus.COMPLETED in statuses
        assert ExecutionStatus.FAILED in statuses
        assert ExecutionStatus.CANCELLED in statuses

    def test_status_values(self):
        """Test status string values."""
        assert ExecutionStatus.PENDING.value == "pending"
        assert ExecutionStatus.RUNNING.value == "running"
        assert ExecutionStatus.COMPLETED.value == "completed"
        assert ExecutionStatus.FAILED.value == "failed"
        assert ExecutionStatus.CANCELLED.value == "cancelled"


class TestInstanceResult:
    """Tests for InstanceResult model."""

    def test_default_status(self):
        """Test that default status is PENDING."""
        result = InstanceResult(instance_id="test-id")
        assert result.status == ExecutionStatus.PENDING

    def test_completed_result(self):
        """Test a completed instance result."""
        result = InstanceResult(
            instance_id="django__django-12345",
            status=ExecutionStatus.COMPLETED,
            model_patch="diff --git...",
            execution_time_seconds=45.5,
            started_at=datetime(2024, 1, 15, 10, 0, 0),
            completed_at=datetime(2024, 1, 15, 10, 0, 45),
        )
        assert result.status == ExecutionStatus.COMPLETED
        assert result.model_patch == "diff --git..."
        assert result.execution_time_seconds == 45.5

    def test_failed_result_with_error(self):
        """Test a failed instance result with error message."""
        result = InstanceResult(
            instance_id="test-id",
            status=ExecutionStatus.FAILED,
            error_message="Timeout exceeded",
        )
        assert result.status == ExecutionStatus.FAILED
        assert result.error_message == "Timeout exceeded"
        assert result.model_patch is None


class TestBenchmarkResult:
    """Tests for BenchmarkResult model."""

    @pytest.fixture
    def sample_instance_results(self):
        """Create sample instance results for testing."""
        return [
            InstanceResult(
                instance_id="test-1",
                status=ExecutionStatus.COMPLETED,
                model_patch="patch1",
            ),
            InstanceResult(
                instance_id="test-2",
                status=ExecutionStatus.COMPLETED,
                model_patch="patch2",
            ),
            InstanceResult(
                instance_id="test-3",
                status=ExecutionStatus.FAILED,
                error_message="Failed",
            ),
            InstanceResult(
                instance_id="test-4",
                status=ExecutionStatus.PENDING,
            ),
        ]

    def test_basic_benchmark_result(self, sample_instance_results):
        """Test creating a basic benchmark result."""
        result = BenchmarkResult(
            run_id="run-001",
            variant=BenchmarkVariant.LITE,
            total_instances=4,
            completed_instances=3,
            instance_results=sample_instance_results,
        )
        assert result.run_id == "run-001"
        assert result.variant == BenchmarkVariant.LITE
        assert result.total_instances == 4
        assert result.completed_instances == 3

    def test_is_complete_property_false(self, sample_instance_results):
        """Test is_complete property when not all instances completed."""
        result = BenchmarkResult(
            run_id="run-001",
            variant=BenchmarkVariant.LITE,
            total_instances=4,
            completed_instances=3,
            instance_results=sample_instance_results,
        )
        assert result.is_complete is False

    def test_is_complete_property_true(self, sample_instance_results):
        """Test is_complete property when all instances completed."""
        result = BenchmarkResult(
            run_id="run-001",
            variant=BenchmarkVariant.LITE,
            total_instances=4,
            completed_instances=4,
            instance_results=sample_instance_results,
        )
        assert result.is_complete is True

    def test_success_count_property(self, sample_instance_results):
        """Test success_count property calculation."""
        result = BenchmarkResult(
            run_id="run-001",
            variant=BenchmarkVariant.LITE,
            total_instances=4,
            instance_results=sample_instance_results,
        )
        # 2 COMPLETED with patches
        assert result.success_count == 2

    def test_failure_count_property(self, sample_instance_results):
        """Test failure_count property calculation."""
        result = BenchmarkResult(
            run_id="run-001",
            variant=BenchmarkVariant.LITE,
            total_instances=4,
            instance_results=sample_instance_results,
        )
        # 1 FAILED
        assert result.failure_count == 1

    def test_resolve_rate_validation(self):
        """Test resolve_rate is between 0 and 100."""
        # Valid resolve rates
        result = BenchmarkResult(
            run_id="run-001",
            variant=BenchmarkVariant.LITE,
            total_instances=10,
            resolve_rate=75.5,
        )
        assert result.resolve_rate == 75.5

        # Invalid resolve rates should raise
        with pytest.raises(ValueError):
            BenchmarkResult(
                run_id="run-001",
                variant=BenchmarkVariant.LITE,
                total_instances=10,
                resolve_rate=101.0,  # > 100
            )

        with pytest.raises(ValueError):
            BenchmarkResult(
                run_id="run-001",
                variant=BenchmarkVariant.LITE,
                total_instances=10,
                resolve_rate=-1.0,  # < 0
            )


class TestHealthCheckResult:
    """Tests for HealthCheckResult model."""

    def test_passed_check(self):
        """Test a passed health check."""
        result = HealthCheckResult(
            check_name="docker",
            passed=True,
            message="Docker is running",
            details={"version": "24.0.0"},
        )
        assert result.check_name == "docker"
        assert result.passed is True
        assert result.message == "Docker is running"
        assert result.details["version"] == "24.0.0"

    def test_failed_check(self):
        """Test a failed health check."""
        result = HealthCheckResult(
            check_name="disk_space",
            passed=False,
            message="Insufficient disk space: 5GB available, 10GB required",
        )
        assert result.passed is False
        assert "Insufficient" in result.message


class TestInfrastructureStatus:
    """Tests for InfrastructureStatus model."""

    @pytest.fixture
    def all_passed_checks(self):
        """Create infrastructure status with all checks passed."""
        return InfrastructureStatus(
            docker_available=HealthCheckResult(
                check_name="docker", passed=True, message="Docker running"
            ),
            disk_space=HealthCheckResult(
                check_name="disk_space", passed=True, message="Sufficient space"
            ),
            cpu_cores=HealthCheckResult(
                check_name="cpu_cores", passed=True, message="8 cores available"
            ),
            architecture=HealthCheckResult(
                check_name="architecture", passed=True, message="x86_64"
            ),
        )

    @pytest.fixture
    def failed_docker_check(self):
        """Create infrastructure status with Docker check failed."""
        return InfrastructureStatus(
            docker_available=HealthCheckResult(
                check_name="docker",
                passed=False,
                message="Docker is not running",
            ),
            disk_space=HealthCheckResult(
                check_name="disk_space", passed=True, message="Sufficient space"
            ),
            cpu_cores=HealthCheckResult(
                check_name="cpu_cores", passed=True, message="8 cores available"
            ),
            architecture=HealthCheckResult(
                check_name="architecture", passed=True, message="x86_64"
            ),
        )

    @pytest.fixture
    def arm_architecture(self):
        """Create infrastructure status with ARM architecture warning."""
        return InfrastructureStatus(
            docker_available=HealthCheckResult(
                check_name="docker", passed=True, message="Docker running"
            ),
            disk_space=HealthCheckResult(
                check_name="disk_space", passed=True, message="Sufficient space"
            ),
            cpu_cores=HealthCheckResult(
                check_name="cpu_cores", passed=True, message="8 cores available"
            ),
            architecture=HealthCheckResult(
                check_name="architecture",
                passed=False,  # Warning for ARM
                message="ARM architecture detected (Apple Silicon)",
            ),
        )

    def test_all_passed_property(self, all_passed_checks):
        """Test all_passed returns True when all critical checks pass."""
        assert all_passed_checks.all_passed is True

    def test_all_passed_false_with_docker_failure(self, failed_docker_check):
        """Test all_passed returns False when Docker fails."""
        assert failed_docker_check.all_passed is False

    def test_all_passed_with_arm_warning(self, arm_architecture):
        """Test all_passed returns True even with ARM warning."""
        # Architecture is a warning, not a blocker
        assert arm_architecture.all_passed is True

    def test_warnings_property(self, arm_architecture):
        """Test warnings property includes architecture warning."""
        warnings = arm_architecture.warnings
        assert len(warnings) == 1
        assert "ARM" in warnings[0]

    def test_warnings_empty(self, all_passed_checks):
        """Test warnings property is empty when all checks pass."""
        assert all_passed_checks.warnings == []

    def test_errors_property(self, failed_docker_check):
        """Test errors property includes failed checks."""
        errors = failed_docker_check.errors
        assert len(errors) == 1
        assert "Docker is not running" in errors[0]

    def test_errors_empty(self, all_passed_checks):
        """Test errors property is empty when all checks pass."""
        assert all_passed_checks.errors == []
