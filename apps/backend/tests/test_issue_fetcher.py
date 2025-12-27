"""
Tests for GitHub Issue Fetcher for Autonomous Mode
===================================================

Tests the IssueFetcher class with mocked gh CLI subprocess execution.
Covers:
- Fetching issues with 'auto-claude-ready' label
- Pagination handling
- Label management (add/remove)
- Error handling (timeout, command errors, rate limiting)
- Auth status checking

Uses unittest.mock to mock the GHClient subprocess calls.
Uses asyncio.run() wrapper for async test compatibility without pytest-asyncio.
"""

from __future__ import annotations

import asyncio
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

# Import the modules to test
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "runners" / "github"))

from issue_fetcher import (
    IssueFetcher,
    GitHubIssue,
    IssueFetchError,
    IssueLabelError,
    LABEL_READY,
    LABEL_IN_PROGRESS,
    LABEL_COMPLETED,
    LABEL_FAILED,
    fetch_ready_issues,
)
from gh_client import GHCommandResult, GHCommandError, GHTimeoutError
from rate_limiter import RateLimitExceeded


# =============================================================================
# Helper for running async tests
# =============================================================================

def run_async(coro):
    """Run an async coroutine synchronously."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# =============================================================================
# Test Fixtures
# =============================================================================

@pytest.fixture
def tmp_project_dir(tmp_path: Path) -> Path:
    """Create a temporary project directory."""
    return tmp_path


@pytest.fixture
def mock_gh_result_factory():
    """Factory to create mock GHCommandResult objects."""
    def create_result(
        stdout: str = "",
        stderr: str = "",
        returncode: int = 0,
        command: list[str] | None = None,
        attempts: int = 1,
        total_time: float = 0.1,
    ) -> GHCommandResult:
        return GHCommandResult(
            stdout=stdout,
            stderr=stderr,
            returncode=returncode,
            command=command or ["gh"],
            attempts=attempts,
            total_time=total_time,
        )
    return create_result


@pytest.fixture
def sample_issue_data() -> list[dict]:
    """Sample issue data as returned by gh CLI."""
    return [
        {
            "number": 1,
            "title": "Implement feature X",
            "body": "Description of feature X",
            "labels": [{"name": "auto-claude-ready"}, {"name": "enhancement"}],
            "author": {"login": "testuser"},
            "createdAt": "2025-12-25T10:00:00Z",
            "updatedAt": "2025-12-26T12:00:00Z",
            "url": "https://github.com/owner/repo/issues/1",
            "state": "open",
        },
        {
            "number": 2,
            "title": "Fix bug Y",
            "body": "Description of bug Y",
            "labels": [{"name": "auto-claude-ready"}, {"name": "bug"}],
            "author": {"login": "anotheruser"},
            "createdAt": "2025-12-24T08:00:00Z",
            "updatedAt": "2025-12-26T09:00:00Z",
            "url": "https://github.com/owner/repo/issues/2",
            "state": "open",
        },
    ]


# =============================================================================
# GitHubIssue Dataclass Tests
# =============================================================================

class TestGitHubIssue:
    """Tests for the GitHubIssue dataclass."""

    def test_from_dict_basic(self, sample_issue_data):
        """Test creating GitHubIssue from dict with basic fields."""
        issue = GitHubIssue.from_dict(sample_issue_data[0])

        assert issue.number == 1
        assert issue.title == "Implement feature X"
        assert issue.body == "Description of feature X"
        assert issue.labels == ["auto-claude-ready", "enhancement"]
        assert issue.author == "testuser"
        assert issue.created_at == "2025-12-25T10:00:00Z"
        assert issue.updated_at == "2025-12-26T12:00:00Z"
        assert issue.url == "https://github.com/owner/repo/issues/1"
        assert issue.state == "open"

    def test_from_dict_with_string_labels(self):
        """Test creating GitHubIssue when labels are strings."""
        data = {
            "number": 3,
            "title": "Test issue",
            "body": "Test body",
            "labels": ["label1", "label2"],  # String labels
            "author": {"login": "user"},
            "createdAt": "2025-12-25T10:00:00Z",
            "updatedAt": "2025-12-25T10:00:00Z",
            "url": "https://example.com",
            "state": "open",
        }
        issue = GitHubIssue.from_dict(data)

        assert issue.labels == ["label1", "label2"]

    def test_from_dict_with_string_author(self):
        """Test creating GitHubIssue when author is a string."""
        data = {
            "number": 4,
            "title": "Test issue",
            "body": "Test body",
            "labels": [],
            "author": "directuser",  # String author
            "createdAt": "2025-12-25T10:00:00Z",
            "updatedAt": "2025-12-25T10:00:00Z",
            "url": "https://example.com",
            "state": "open",
        }
        issue = GitHubIssue.from_dict(data)

        assert issue.author == "directuser"

    def test_from_dict_with_missing_fields(self):
        """Test creating GitHubIssue with missing optional fields."""
        data = {"number": 5, "title": "Minimal issue"}
        issue = GitHubIssue.from_dict(data)

        assert issue.number == 5
        assert issue.title == "Minimal issue"
        assert issue.body == ""
        assert issue.labels == []
        assert issue.author == ""
        assert issue.created_at == ""
        assert issue.updated_at == ""
        assert issue.url == ""
        assert issue.state == "open"

    def test_to_dict(self, sample_issue_data):
        """Test converting GitHubIssue to dict."""
        issue = GitHubIssue.from_dict(sample_issue_data[0])
        result = issue.to_dict()

        assert result["number"] == 1
        assert result["title"] == "Implement feature X"
        assert result["labels"] == ["auto-claude-ready", "enhancement"]
        assert "created_at" in result  # Uses snake_case
        assert "author" in result


# =============================================================================
# IssueFetcher Tests - Fetch Operations
# =============================================================================

class TestIssueFetcherFetch:
    """Tests for IssueFetcher fetch operations."""

    def test_fetch_ready_issues_success(
        self, tmp_project_dir, sample_issue_data, mock_gh_result_factory
    ):
        """Test successful fetching of issues with ready label."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            mock_result = mock_gh_result_factory(
                stdout=json.dumps(sample_issue_data),
                returncode=0,
            )

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.return_value = mock_result
                issues = await fetcher.fetch_ready_issues()

            assert len(issues) == 2
            assert issues[0].number == 1
            assert issues[1].number == 2
            assert LABEL_READY in issues[0].labels

            # Verify the correct command was called
            mock_run.assert_called_once()
            call_args = mock_run.call_args[0][0]
            assert "issue" in call_args
            assert "list" in call_args
            assert "--label" in call_args
            assert LABEL_READY in call_args

        run_async(run_test())

    def test_fetch_ready_issues_empty(
        self, tmp_project_dir, mock_gh_result_factory
    ):
        """Test fetching when no issues match the label."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            mock_result = mock_gh_result_factory(stdout="[]", returncode=0)

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.return_value = mock_result
                issues = await fetcher.fetch_ready_issues()

            assert len(issues) == 0

        run_async(run_test())

    def test_fetch_ready_issues_empty_output(
        self, tmp_project_dir, mock_gh_result_factory
    ):
        """Test fetching when gh CLI returns empty output."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            mock_result = mock_gh_result_factory(stdout="", returncode=0)

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.return_value = mock_result
                issues = await fetcher.fetch_ready_issues()

            assert len(issues) == 0

        run_async(run_test())

    def test_fetch_ready_issues_with_state_filter(
        self, tmp_project_dir, sample_issue_data, mock_gh_result_factory
    ):
        """Test fetching with specific state filter."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            mock_result = mock_gh_result_factory(
                stdout=json.dumps(sample_issue_data),
                returncode=0,
            )

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.return_value = mock_result
                await fetcher.fetch_ready_issues(state="closed")

            call_args = mock_run.call_args[0][0]
            assert "--state" in call_args
            state_idx = call_args.index("--state")
            assert call_args[state_idx + 1] == "closed"

        run_async(run_test())

    def test_fetch_ready_issues_with_limit(
        self, tmp_project_dir, sample_issue_data, mock_gh_result_factory
    ):
        """Test fetching with custom limit."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            mock_result = mock_gh_result_factory(
                stdout=json.dumps(sample_issue_data),
                returncode=0,
            )

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.return_value = mock_result
                await fetcher.fetch_ready_issues(limit=50)

            call_args = mock_run.call_args[0][0]
            assert "--limit" in call_args
            limit_idx = call_args.index("--limit")
            assert call_args[limit_idx + 1] == "50"

        run_async(run_test())

    def test_fetch_issue_by_number(
        self, tmp_project_dir, sample_issue_data
    ):
        """Test fetching a specific issue by number."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_get", new_callable=AsyncMock
            ) as mock_get:
                mock_get.return_value = sample_issue_data[0]
                issue = await fetcher.fetch_issue(1)

            assert issue.number == 1
            assert issue.title == "Implement feature X"
            mock_get.assert_called_once_with(
                issue_number=1,
                json_fields=[
                    "number",
                    "title",
                    "body",
                    "labels",
                    "author",
                    "createdAt",
                    "updatedAt",
                    "url",
                    "state",
                ],
            )

        run_async(run_test())

    def test_fetch_issues_paginated(
        self, tmp_project_dir, sample_issue_data, mock_gh_result_factory
    ):
        """Test paginated issue fetching."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            mock_result = mock_gh_result_factory(
                stdout=json.dumps(sample_issue_data),
                returncode=0,
            )

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.return_value = mock_result
                issues = await fetcher.fetch_issues_paginated(
                    state="all", page_size=100, max_pages=5
                )

            assert len(issues) == 2
            call_args = mock_run.call_args[0][0]
            limit_idx = call_args.index("--limit")
            assert call_args[limit_idx + 1] == "500"  # page_size * max_pages

        run_async(run_test())


# =============================================================================
# IssueFetcher Tests - Error Handling
# =============================================================================

class TestIssueFetcherErrors:
    """Tests for IssueFetcher error handling."""

    def test_fetch_issues_timeout_error(self, tmp_project_dir):
        """Test handling of timeout errors."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.side_effect = GHTimeoutError("Command timed out after 30s")

                with pytest.raises(IssueFetchError) as exc_info:
                    await fetcher.fetch_ready_issues()

            assert "Timeout" in str(exc_info.value)

        run_async(run_test())

    def test_fetch_issues_command_error(self, tmp_project_dir):
        """Test handling of command errors."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.side_effect = GHCommandError("gh issue list failed: Not found")

                with pytest.raises(IssueFetchError) as exc_info:
                    await fetcher.fetch_ready_issues()

            assert "Failed to fetch issues" in str(exc_info.value)

        run_async(run_test())

    def test_fetch_issues_rate_limit_exceeded(self, tmp_project_dir):
        """Test that rate limit exceptions are re-raised."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.side_effect = RateLimitExceeded("Rate limit exceeded")

                with pytest.raises(RateLimitExceeded):
                    await fetcher.fetch_ready_issues()

        run_async(run_test())

    def test_fetch_issue_not_found(self, tmp_project_dir):
        """Test fetching a non-existent issue."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_get", new_callable=AsyncMock
            ) as mock_get:
                mock_get.side_effect = GHCommandError("Issue #999 not found")

                with pytest.raises(IssueFetchError) as exc_info:
                    await fetcher.fetch_issue(999)

            assert "#999" in str(exc_info.value)

        run_async(run_test())

    def test_fetch_issues_unexpected_error(self, tmp_project_dir):
        """Test handling of unexpected errors."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.side_effect = RuntimeError("Unexpected error")

                with pytest.raises(IssueFetchError) as exc_info:
                    await fetcher.fetch_ready_issues()

            assert "Unexpected error" in str(exc_info.value)

        run_async(run_test())


# =============================================================================
# IssueFetcher Tests - Label Operations
# =============================================================================

class TestIssueFetcherLabels:
    """Tests for IssueFetcher label operations."""

    def test_add_label_success(self, tmp_project_dir):
        """Test adding a label to an issue."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_add_labels", new_callable=AsyncMock
            ) as mock_add:
                await fetcher.add_label(1, LABEL_IN_PROGRESS)

            mock_add.assert_called_once_with(1, [LABEL_IN_PROGRESS])

        run_async(run_test())

    def test_add_label_error(self, tmp_project_dir):
        """Test error handling when adding a label fails."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_add_labels", new_callable=AsyncMock
            ) as mock_add:
                mock_add.side_effect = GHCommandError("Failed to add label")

                with pytest.raises(IssueLabelError):
                    await fetcher.add_label(1, "some-label")

        run_async(run_test())

    def test_remove_label_success(self, tmp_project_dir):
        """Test removing a label from an issue."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_remove_labels", new_callable=AsyncMock
            ) as mock_remove:
                await fetcher.remove_label(1, LABEL_READY)

            mock_remove.assert_called_once_with(1, [LABEL_READY])

        run_async(run_test())

    def test_remove_label_not_exists(self, tmp_project_dir):
        """Test removing a label that doesn't exist (should not raise error)."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_remove_labels", new_callable=AsyncMock
            ) as mock_remove:
                mock_remove.side_effect = Exception("Label not found")

                # Should not raise - remove_label is lenient
                await fetcher.remove_label(1, "nonexistent-label")

        run_async(run_test())

    def test_mark_in_progress(self, tmp_project_dir):
        """Test marking an issue as in-progress."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_remove_labels", new_callable=AsyncMock
            ) as mock_remove, patch.object(
                fetcher.client, "issue_add_labels", new_callable=AsyncMock
            ) as mock_add:
                await fetcher.mark_in_progress(1)

            mock_remove.assert_called_once_with(1, [LABEL_READY])
            mock_add.assert_called_once_with(1, [LABEL_IN_PROGRESS])

        run_async(run_test())

    def test_mark_completed(self, tmp_project_dir):
        """Test marking an issue as completed."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_remove_labels", new_callable=AsyncMock
            ) as mock_remove, patch.object(
                fetcher.client, "issue_add_labels", new_callable=AsyncMock
            ) as mock_add:
                await fetcher.mark_completed(1)

            mock_remove.assert_called_once_with(1, [LABEL_IN_PROGRESS])
            mock_add.assert_called_once_with(1, [LABEL_COMPLETED])

        run_async(run_test())

    def test_mark_failed(self, tmp_project_dir):
        """Test marking an issue as failed."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_remove_labels", new_callable=AsyncMock
            ) as mock_remove, patch.object(
                fetcher.client, "issue_add_labels", new_callable=AsyncMock
            ) as mock_add:
                await fetcher.mark_failed(1)

            mock_remove.assert_called_once_with(1, [LABEL_IN_PROGRESS])
            mock_add.assert_called_once_with(1, [LABEL_FAILED])

        run_async(run_test())


# =============================================================================
# IssueFetcher Tests - Comments
# =============================================================================

class TestIssueFetcherComments:
    """Tests for IssueFetcher comment operations."""

    def test_add_comment_success(self, tmp_project_dir):
        """Test adding a comment to an issue."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_comment", new_callable=AsyncMock
            ) as mock_comment:
                await fetcher.add_comment(1, "This is a test comment")

            mock_comment.assert_called_once_with(1, "This is a test comment")

        run_async(run_test())

    def test_add_comment_error(self, tmp_project_dir):
        """Test error handling when adding a comment fails."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_comment", new_callable=AsyncMock
            ) as mock_comment:
                mock_comment.side_effect = GHCommandError("Failed to add comment")

                with pytest.raises(IssueLabelError):  # Note: uses IssueLabelError
                    await fetcher.add_comment(1, "Test comment")

        run_async(run_test())

    def test_add_comment_rate_limited(self, tmp_project_dir):
        """Test rate limit handling when adding comments."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(
                fetcher.client, "issue_comment", new_callable=AsyncMock
            ) as mock_comment:
                mock_comment.side_effect = RateLimitExceeded("Rate limit exceeded")

                with pytest.raises(RateLimitExceeded):
                    await fetcher.add_comment(1, "Test comment")

        run_async(run_test())


# =============================================================================
# IssueFetcher Tests - Auth Status
# =============================================================================

class TestIssueFetcherAuth:
    """Tests for IssueFetcher authentication status checking."""

    def test_check_auth_status_authenticated(
        self, tmp_project_dir, mock_gh_result_factory
    ):
        """Test checking auth status when authenticated."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            mock_result = mock_gh_result_factory(
                stdout="Logged in to github.com as testuser",
                returncode=0,
            )

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.return_value = mock_result
                is_auth, message = await fetcher.check_auth_status()

            assert is_auth is True
            assert "testuser" in message

        run_async(run_test())

    def test_check_auth_status_not_authenticated(
        self, tmp_project_dir, mock_gh_result_factory
    ):
        """Test checking auth status when not authenticated."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            mock_result = mock_gh_result_factory(
                stdout="",
                stderr="You are not logged in",
                returncode=1,
            )

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.return_value = mock_result
                is_auth, message = await fetcher.check_auth_status()

            assert is_auth is False
            assert "not logged in" in message.lower()

        run_async(run_test())

    def test_check_auth_status_error(self, tmp_project_dir):
        """Test auth status check when gh CLI errors."""
        async def run_test():
            fetcher = IssueFetcher(project_dir=tmp_project_dir)

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.side_effect = Exception("gh not found")
                is_auth, message = await fetcher.check_auth_status()

            assert is_auth is False
            assert "failed" in message.lower()

        run_async(run_test())


# =============================================================================
# IssueFetcher Tests - Custom Label
# =============================================================================

class TestIssueFetcherCustomLabel:
    """Tests for IssueFetcher with custom ready label."""

    def test_custom_ready_label(
        self, tmp_project_dir, sample_issue_data, mock_gh_result_factory
    ):
        """Test using a custom ready label."""
        async def run_test():
            custom_label = "ready-for-automation"
            fetcher = IssueFetcher(
                project_dir=tmp_project_dir,
                ready_label=custom_label,
            )

            mock_result = mock_gh_result_factory(
                stdout=json.dumps(sample_issue_data),
                returncode=0,
            )

            with patch.object(fetcher.client, "run", new_callable=AsyncMock) as mock_run:
                mock_run.return_value = mock_result
                await fetcher.fetch_ready_issues()

            call_args = mock_run.call_args[0][0]
            assert custom_label in call_args

        run_async(run_test())


# =============================================================================
# Convenience Function Tests
# =============================================================================

class TestConvenienceFunctions:
    """Tests for module-level convenience functions."""

    def test_fetch_ready_issues_function(
        self, tmp_project_dir, sample_issue_data, mock_gh_result_factory
    ):
        """Test the fetch_ready_issues convenience function."""
        async def run_test():
            with patch(
                "issue_fetcher.IssueFetcher.fetch_ready_issues",
                new_callable=AsyncMock,
            ) as mock_fetch:
                # Return GitHubIssue objects as the method would
                mock_fetch.return_value = [
                    GitHubIssue.from_dict(data) for data in sample_issue_data
                ]

                issues = await fetch_ready_issues(tmp_project_dir)

            assert len(issues) == 2
            assert isinstance(issues[0], dict)  # Convenience function returns dicts
            assert issues[0]["number"] == 1

        run_async(run_test())


# =============================================================================
# IssueFetcher Tests - Rate Limiting Configuration
# =============================================================================

class TestIssueFetcherRateLimiting:
    """Tests for IssueFetcher rate limiting configuration."""

    def test_rate_limiting_enabled_by_default(self, tmp_project_dir):
        """Test that rate limiting is enabled by default."""
        fetcher = IssueFetcher(project_dir=tmp_project_dir)
        assert fetcher.client.enable_rate_limiting is True

    def test_rate_limiting_can_be_disabled(self, tmp_project_dir):
        """Test that rate limiting can be disabled."""
        fetcher = IssueFetcher(
            project_dir=tmp_project_dir,
            enable_rate_limiting=False,
        )
        assert fetcher.client.enable_rate_limiting is False

    def test_custom_timeout(self, tmp_project_dir):
        """Test custom timeout configuration."""
        fetcher = IssueFetcher(
            project_dir=tmp_project_dir,
            default_timeout=60.0,
        )
        assert fetcher.client.default_timeout == 60.0


# =============================================================================
# Run tests with pytest
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
