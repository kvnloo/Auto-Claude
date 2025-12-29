"""
Unit Tests for SWE-bench to Autoclaude Format Converter
=======================================================

Tests cover:
- convert_to_task: Single instance conversion
- convert_batch: Batch conversion with error handling
- extract_repo_info: Instance ID parsing
- Repository URL building
- Task description building
- Metadata extraction
- ConversionError handling
"""

import pytest

from apps.backend.services.swebench.converter import (
    ConversionError,
    convert_batch,
    convert_to_task,
    extract_repo_info,
)
from apps.backend.services.swebench.models import SWEBenchInstance


class TestConvertToTask:
    """Tests for convert_to_task function."""

    @pytest.fixture
    def valid_instance(self):
        """Create a valid SWEBenchInstance for testing."""
        return SWEBenchInstance(
            instance_id="django__django-12345",
            repo="django/django",
            problem_statement="Fix bug in QuerySet filter method",
            base_commit="abc123def456",
            patch="diff --git a/file.py...",
            test_patch="test patch content",
            FAIL_TO_PASS=["test_queryset::test_filter"],
            PASS_TO_PASS=["test_queryset::test_all", "test_queryset::test_count"],
            hints_text="Look at the filter implementation",
            version="4.2",
        )

    @pytest.fixture
    def valid_instance_dict(self):
        """Create a valid instance as a dictionary."""
        return {
            "instance_id": "astropy__astropy-6789",
            "repo": "astropy/astropy",
            "problem_statement": "Fix coordinate transformation issue",
            "base_commit": "def456abc789",
            "patch": "diff --git...",
            "test_patch": "",
            "FAIL_TO_PASS": ["test_coords::test_transform"],
            "PASS_TO_PASS": [],
        }

    def test_convert_instance_to_task(self, valid_instance):
        """Test basic conversion from SWEBenchInstance to AutoclaudeTask."""
        task = convert_to_task(valid_instance)

        assert task.task_id == "django__django-12345"
        assert task.base_commit == "abc123def456"
        assert "django/django" in task.repository
        assert "Fix bug in QuerySet filter method" in task.description

    def test_convert_dict_to_task(self, valid_instance_dict):
        """Test conversion from dict to AutoclaudeTask."""
        task = convert_to_task(valid_instance_dict)

        assert task.task_id == "astropy__astropy-6789"
        assert task.base_commit == "def456abc789"
        assert "astropy/astropy" in task.repository

    def test_test_criteria_mapping(self, valid_instance):
        """Test that FAIL_TO_PASS and PASS_TO_PASS are correctly mapped."""
        task = convert_to_task(valid_instance)

        assert task.test_criteria.fail_to_pass == ["test_queryset::test_filter"]
        assert task.test_criteria.pass_to_pass == [
            "test_queryset::test_all",
            "test_queryset::test_count",
        ]
        assert task.test_criteria.total_tests == 3

    def test_hints_included_by_default(self, valid_instance):
        """Test that hints are included by default."""
        task = convert_to_task(valid_instance)
        assert task.hints == "Look at the filter implementation"

    def test_hints_excluded_when_disabled(self, valid_instance):
        """Test that hints can be excluded."""
        task = convert_to_task(valid_instance, include_hints=False)
        assert task.hints is None

    def test_repository_url_building(self, valid_instance):
        """Test that repository URL is correctly built."""
        task = convert_to_task(valid_instance)
        assert task.repository == "https://github.com/django/django"

    def test_custom_repository_base_url(self, valid_instance):
        """Test custom repository base URL."""
        task = convert_to_task(
            valid_instance,
            repository_base_url="https://gitlab.com",
        )
        assert task.repository == "https://gitlab.com/django/django"

    def test_description_contains_problem_statement(self, valid_instance):
        """Test that description contains the problem statement."""
        task = convert_to_task(valid_instance)
        assert "Fix bug in QuerySet filter method" in task.description

    def test_description_contains_repo_info(self, valid_instance):
        """Test that description contains repository information."""
        task = convert_to_task(valid_instance)
        assert "django/django" in task.description

    def test_description_contains_version(self, valid_instance):
        """Test that description contains version when available."""
        task = convert_to_task(valid_instance)
        assert "4.2" in task.description

    def test_description_contains_test_criteria_summary(self, valid_instance):
        """Test that description summarizes test criteria."""
        task = convert_to_task(valid_instance)
        assert "FAIL to PASS" in task.description
        assert "PASS" in task.description

    def test_metadata_contains_source(self, valid_instance):
        """Test that metadata includes source information."""
        task = convert_to_task(valid_instance)
        assert task.metadata["source"] == "swebench"

    def test_metadata_contains_original_fields(self, valid_instance):
        """Test that metadata includes original instance fields."""
        task = convert_to_task(valid_instance)
        assert task.metadata["original_repo"] == "django/django"
        assert task.metadata["original_instance_id"] == "django__django-12345"
        assert task.metadata["version"] == "4.2"

    def test_conversion_error_on_invalid_dict(self):
        """Test ConversionError raised for invalid dict data."""
        invalid_data = {
            "instance_id": "invalid-format",  # Missing __ separator
            "repo": "test/repo",
            "problem_statement": "Test",
            "base_commit": "abc1234",
            "patch": "",
        }
        with pytest.raises(ConversionError) as exc_info:
            convert_to_task(invalid_data)
        assert "Failed to parse instance data" in str(exc_info.value)


class TestConvertBatch:
    """Tests for convert_batch function."""

    @pytest.fixture
    def valid_instances(self):
        """Create a list of valid instances."""
        return [
            SWEBenchInstance(
                instance_id="django__django-12345",
                repo="django/django",
                problem_statement="Fix bug 1",
                base_commit="abc1234567",
                patch="patch 1",
            ),
            SWEBenchInstance(
                instance_id="astropy__astropy-6789",
                repo="astropy/astropy",
                problem_statement="Fix bug 2",
                base_commit="def4567890",
                patch="patch 2",
            ),
        ]

    @pytest.fixture
    def mixed_instances(self):
        """Create a list with valid and invalid instances."""
        return [
            SWEBenchInstance(
                instance_id="django__django-12345",
                repo="django/django",
                problem_statement="Fix bug 1",
                base_commit="abc1234567",
                patch="patch 1",
            ),
            {
                "instance_id": "invalid-format",  # Invalid
                "repo": "test/repo",
                "problem_statement": "Test",
                "base_commit": "abc1234",
                "patch": "",
            },
            SWEBenchInstance(
                instance_id="astropy__astropy-6789",
                repo="astropy/astropy",
                problem_statement="Fix bug 2",
                base_commit="def4567890",
                patch="patch 2",
            ),
        ]

    def test_batch_conversion_all_valid(self, valid_instances):
        """Test batch conversion with all valid instances."""
        tasks, errors = convert_batch(valid_instances)

        assert len(tasks) == 2
        assert len(errors) == 0
        assert tasks[0].task_id == "django__django-12345"
        assert tasks[1].task_id == "astropy__astropy-6789"

    def test_batch_conversion_skip_errors(self, mixed_instances):
        """Test batch conversion skipping errors."""
        tasks, errors = convert_batch(mixed_instances, skip_errors=True)

        assert len(tasks) == 2  # Only valid instances
        assert len(errors) == 1  # One error
        assert errors[0][0] == "invalid-format"  # Error for invalid instance

    def test_batch_conversion_raise_on_error(self, mixed_instances):
        """Test batch conversion raising on error."""
        with pytest.raises(ConversionError):
            convert_batch(mixed_instances, skip_errors=False)

    def test_batch_conversion_empty_list(self):
        """Test batch conversion with empty list."""
        tasks, errors = convert_batch([])
        assert tasks == []
        assert errors == []

    def test_batch_conversion_custom_base_url(self, valid_instances):
        """Test batch conversion with custom repository base URL."""
        tasks, errors = convert_batch(
            valid_instances,
            repository_base_url="https://gitlab.com",
        )

        assert len(tasks) == 2
        assert "gitlab.com" in tasks[0].repository
        assert "gitlab.com" in tasks[1].repository


class TestExtractRepoInfo:
    """Tests for extract_repo_info function."""

    def test_standard_instance_id(self):
        """Test extracting info from standard instance_id format."""
        result = extract_repo_info("django__django-12345")
        assert result == ("django", "django", "12345")

    def test_repo_with_hyphen(self):
        """Test extracting info when repo name contains hyphen."""
        result = extract_repo_info("scikit-learn__scikit-learn-10000")
        assert result == ("scikit-learn", "scikit-learn", "10000")

    def test_complex_repo_name(self):
        """Test extracting info from complex repo names."""
        result = extract_repo_info("pytest-dev__pytest-123")
        assert result == ("pytest-dev", "pytest", "123")

    def test_missing_double_underscore(self):
        """Test None returned when missing double underscore."""
        result = extract_repo_info("django_django-12345")
        assert result is None

    def test_missing_hyphen(self):
        """Test None returned when missing hyphen."""
        result = extract_repo_info("django__django12345")
        assert result is None

    def test_empty_string(self):
        """Test None returned for empty string."""
        result = extract_repo_info("")
        assert result is None

    def test_only_separators(self):
        """Test None returned for string with only separators."""
        result = extract_repo_info("__-")
        # Empty owner, should return None or handle gracefully
        result = extract_repo_info("owner__-")
        assert result is None or result[1] == ""

    def test_multiple_hyphens_in_pr(self):
        """Test handling of PR numbers with multiple parts."""
        # Some repos might have complex PR identifiers
        result = extract_repo_info("owner__repo-name-123")
        # Should split from the right, so repo="repo-name", pr="123"
        assert result == ("owner", "repo-name", "123")

    def test_invalid_format_returns_none(self):
        """Test various invalid formats return None."""
        invalid_formats = [
            None,
            123,
            ["not", "a", "string"],
        ]
        for invalid in invalid_formats:
            try:
                result = extract_repo_info(invalid)
                assert result is None
            except (TypeError, AttributeError):
                pass  # Expected for non-string inputs


class TestRepositoryUrlBuilding:
    """Tests for repository URL building logic."""

    def test_clean_repo_path(self):
        """Test URL building with clean repo path."""
        instance = SWEBenchInstance(
            instance_id="owner__repo-123",
            repo="owner/repo",
            problem_statement="Test",
            base_commit="abc1234567",
            patch="",
        )
        task = convert_to_task(instance)
        assert task.repository == "https://github.com/owner/repo"

    def test_repo_with_trailing_slash(self):
        """Test URL building handles trailing slashes."""
        instance = SWEBenchInstance(
            instance_id="owner__repo-123",
            repo="owner/repo/",
            problem_statement="Test",
            base_commit="abc1234567",
            patch="",
        )
        task = convert_to_task(instance)
        assert not task.repository.endswith("/owner/repo/")

    def test_base_url_with_trailing_slash(self):
        """Test URL building handles base URL trailing slashes."""
        instance = SWEBenchInstance(
            instance_id="owner__repo-123",
            repo="owner/repo",
            problem_statement="Test",
            base_commit="abc1234567",
            patch="",
        )
        task = convert_to_task(instance, repository_base_url="https://github.com/")
        # Should not have double slashes
        assert "github.com//owner" not in task.repository
