"""
Tests for GHClient claim metadata methods.

This test file is placed in the worktree root to avoid package import issues.
"""

import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest


def _import_module(module_name: str, module_path: Path):
    """Import a module directly from file path."""
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


# Import rate_limiter first (dependency)
_rate_limiter = _import_module(
    "rate_limiter",
    Path(__file__).parent / "apps/backend/runners/github/rate_limiter.py"
)

# Import gh_client
_gh_client = _import_module(
    "gh_client",
    Path(__file__).parent / "apps/backend/runners/github/gh_client.py"
)

GHClient = _gh_client.GHClient
GHCommandError = _gh_client.GHCommandError
GHCommandResult = _gh_client.GHCommandResult
GHTimeoutError = _gh_client.GHTimeoutError


class TestClaimMetadataParsing:
    """Tests for parse_claim_metadata method."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client with rate limiting disabled."""
        return GHClient(
            project_dir=tmp_path,
            default_timeout=30.0,
            max_retries=3,
            enable_rate_limiting=False,
        )

    def test_parse_claim_metadata_valid(self, client):
        """Test parsing valid claim metadata from comment."""
        comment = """## Task Claimed by @testuser

**Claim ID:** `claim-abc123def456`
**Timestamp:** 2025-12-26T10:30:00+00:00

---
*This claim will expire in 7 days if no PR is submitted.*

<!-- CLAIM_METADATA: {"claimed_by": "testuser", "claim_id": "claim-abc123def456", "timestamp": "2025-12-26T10:30:00+00:00"} -->"""

        result = client.parse_claim_metadata(comment)

        assert result is not None
        assert result["claimed_by"] == "testuser"
        assert result["claim_id"] == "claim-abc123def456"
        assert result["timestamp"] == "2025-12-26T10:30:00+00:00"

    def test_parse_claim_metadata_with_reputation(self, client):
        """Test parsing claim metadata with reputation info."""
        metadata = {
            "claimed_by": "testuser",
            "claim_id": "claim-abc123",
            "timestamp": "2025-12-26T10:30:00+00:00",
            "fork_reputation": {
                "score": 50,
                "tier": "silver",
                "total_claims": 5,
                "successful_merges": 4,
                "reliability_score": 0.8,
            },
        }
        comment = f"Some text\n<!-- CLAIM_METADATA: {json.dumps(metadata)} -->"

        result = client.parse_claim_metadata(comment)

        assert result is not None
        assert result["fork_reputation"]["score"] == 50
        assert result["fork_reputation"]["tier"] == "silver"

    def test_parse_claim_metadata_empty_comment(self, client):
        """Test parsing empty comment returns None."""
        assert client.parse_claim_metadata("") is None
        assert client.parse_claim_metadata(None) is None

    def test_parse_claim_metadata_no_metadata(self, client):
        """Test parsing comment without metadata returns None."""
        comment = "This is just a regular comment without any claim metadata."
        assert client.parse_claim_metadata(comment) is None

    def test_parse_claim_metadata_invalid_json(self, client):
        """Test parsing invalid JSON returns None."""
        comment = "<!-- CLAIM_METADATA: {invalid json here} -->"
        assert client.parse_claim_metadata(comment) is None

    def test_parse_claim_metadata_whitespace_variations(self, client):
        """Test parsing with various whitespace in the HTML comment."""
        # Extra whitespace
        comment1 = '<!--   CLAIM_METADATA:   {"claimed_by": "user"}   -->'
        result1 = client.parse_claim_metadata(comment1)
        assert result1 is not None
        assert result1["claimed_by"] == "user"

        # Newlines in metadata
        comment2 = """<!-- CLAIM_METADATA: {
            "claimed_by": "user",
            "claim_id": "claim-123"
        } -->"""
        result2 = client.parse_claim_metadata(comment2)
        assert result2 is not None
        assert result2["claimed_by"] == "user"


class TestClaimCommentFormatting:
    """Tests for format_claim_comment method."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client."""
        return GHClient(
            project_dir=tmp_path,
            enable_rate_limiting=False,
        )

    def test_format_claim_comment_basic(self, client):
        """Test basic claim comment formatting."""
        comment = client.format_claim_comment(
            fork_owner="testuser",
            claim_id="claim-abc123def456",
        )

        assert "## Task Claimed by @testuser" in comment
        assert "**Claim ID:** `claim-abc123def456`" in comment
        assert "**Timestamp:**" in comment
        assert "<!-- CLAIM_METADATA:" in comment
        assert '"claimed_by": "testuser"' in comment
        assert '"claim_id": "claim-abc123def456"' in comment

    def test_format_claim_comment_with_reputation(self, client):
        """Test claim comment formatting with reputation data."""
        reputation_data = {
            "score": 75,
            "tier": "gold",
            "total_claims": 10,
            "successful_merges": 8,
            "reliability_score": 0.85,
        }

        comment = client.format_claim_comment(
            fork_owner="contributor",
            claim_id="claim-xyz789",
            reputation_data=reputation_data,
        )

        assert "### Fork Reputation" in comment
        assert "**Score:** 75 (gold)" in comment
        assert "**Completed Tasks:** 8" in comment
        assert "**Reliability:** 85%" in comment

    def test_format_claim_comment_with_issue_number(self, client):
        """Test claim comment includes issue number in metadata."""
        comment = client.format_claim_comment(
            fork_owner="testuser",
            claim_id="claim-123",
            issue_number=42,
        )

        # Parse the metadata to verify issue_number
        metadata = client.parse_claim_metadata(comment)
        assert metadata is not None
        assert metadata["issue_number"] == 42

    def test_format_claim_comment_roundtrip(self, client):
        """Test that format and parse are consistent."""
        reputation_data = {
            "score": 25,
            "tier": "bronze",
            "successful_merges": 2,
            "reliability_score": 0.5,
        }

        comment = client.format_claim_comment(
            fork_owner="roundtrip-user",
            claim_id="claim-roundtrip123",
            reputation_data=reputation_data,
            issue_number=99,
        )

        parsed = client.parse_claim_metadata(comment)

        assert parsed is not None
        assert parsed["claimed_by"] == "roundtrip-user"
        assert parsed["claim_id"] == "claim-roundtrip123"
        assert parsed["issue_number"] == 99
        assert parsed["fork_reputation"]["score"] == 25


class TestReleaseCommentFormatting:
    """Tests for format_release_comment method."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client."""
        return GHClient(
            project_dir=tmp_path,
            enable_rate_limiting=False,
        )

    def test_format_release_comment_basic(self, client):
        """Test basic release comment formatting."""
        comment = client.format_release_comment(fork_owner="releaser")

        assert "## Task Released by @releaser" in comment
        assert "**Released At:**" in comment
        assert "This task is now available" in comment

    def test_format_release_comment_with_claim_id(self, client):
        """Test release comment with claim ID."""
        comment = client.format_release_comment(
            fork_owner="releaser",
            claim_id="claim-released123",
        )

        assert "**Claim ID:** `claim-released123`" in comment

    def test_format_release_comment_with_reason(self, client):
        """Test release comment with reason."""
        comment = client.format_release_comment(
            fork_owner="releaser",
            reason="Unable to complete due to time constraints",
        )

        assert "**Reason:** Unable to complete due to time constraints" in comment


class TestClaimLabelConstants:
    """Tests for claim label constants."""

    def test_label_constants_defined(self, tmp_path):
        """Test that label constants are properly defined."""
        client = GHClient(
            project_dir=tmp_path,
            enable_rate_limiting=False,
        )

        assert client.LABEL_AVAILABLE == "task:available"
        assert client.LABEL_CLAIMED == "task:claimed"


def run_async(coro):
    """Helper to run async coroutines in sync tests."""
    return asyncio.run(coro)


class TestGetClaimStatusMocked:
    """Tests for get_claim_status with mocked GitHub API."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client."""
        return GHClient(
            project_dir=tmp_path,
            enable_rate_limiting=False,
        )

    def test_get_claim_status_available(self, client):
        """Test getting status of an available issue."""
        mock_issue_data = {
            "number": 123,
            "title": "Test Issue",
            "state": "open",
            "labels": [{"name": "task:available"}, {"name": "enhancement"}],
            "comments": [],
        }

        async def run_test():
            with patch.object(client, "issue_get", new_callable=AsyncMock) as mock_get:
                mock_get.return_value = mock_issue_data
                return await client.get_claim_status(123)

        status = run_async(run_test())

        assert status["status"] == "available"
        assert status["issue_number"] == 123
        assert status["has_available_label"] is True
        assert status["has_claimed_label"] is False
        assert status["claim_metadata"] is None
        assert status["claimed_by"] is None

    def test_get_claim_status_claimed(self, client):
        """Test getting status of a claimed issue."""
        claim_metadata = {
            "claimed_by": "testuser",
            "claim_id": "claim-abc123",
            "timestamp": "2025-12-26T10:00:00+00:00",
        }

        mock_issue_data = {
            "number": 456,
            "title": "Claimed Issue",
            "state": "open",
            "labels": [{"name": "task:claimed"}],
            "comments": [
                {
                    "body": "Regular comment",
                    "createdAt": "2025-12-26T09:00:00+00:00",
                },
                {
                    "body": f"Claim comment\n<!-- CLAIM_METADATA: {json.dumps(claim_metadata)} -->",
                    "createdAt": "2025-12-26T10:00:00+00:00",
                },
            ],
        }

        async def run_test():
            with patch.object(client, "issue_get", new_callable=AsyncMock) as mock_get:
                mock_get.return_value = mock_issue_data
                return await client.get_claim_status(456)

        status = run_async(run_test())

        assert status["status"] == "claimed"
        assert status["has_claimed_label"] is True
        assert status["has_available_label"] is False
        assert status["claimed_by"] == "testuser"
        assert status["claim_id"] == "claim-abc123"
        assert status["claim_timestamp"] == "2025-12-26T10:00:00+00:00"

    def test_get_claim_status_unknown(self, client):
        """Test getting status of an issue with no claim labels."""
        mock_issue_data = {
            "number": 789,
            "title": "Regular Issue",
            "state": "open",
            "labels": [{"name": "bug"}, {"name": "priority:high"}],
            "comments": [],
        }

        async def run_test():
            with patch.object(client, "issue_get", new_callable=AsyncMock) as mock_get:
                mock_get.return_value = mock_issue_data
                return await client.get_claim_status(789)

        status = run_async(run_test())

        assert status["status"] == "unknown"
        assert status["has_available_label"] is False
        assert status["has_claimed_label"] is False

    def test_get_claim_status_conflicting_labels(self, client):
        """Test getting status with conflicting labels (both claimed and available)."""
        mock_issue_data = {
            "number": 999,
            "title": "Conflicting Issue",
            "state": "open",
            "labels": [{"name": "task:available"}, {"name": "task:claimed"}],
            "comments": [],
        }

        async def run_test():
            with patch.object(client, "issue_get", new_callable=AsyncMock) as mock_get:
                mock_get.return_value = mock_issue_data
                return await client.get_claim_status(999)

        status = run_async(run_test())

        # Should prefer claimed status in conflict
        assert status["status"] == "claimed"
        assert status["has_available_label"] is True
        assert status["has_claimed_label"] is True

    def test_get_claim_status_labels_as_strings(self, client):
        """Test handling labels returned as strings instead of dicts."""
        mock_issue_data = {
            "number": 100,
            "title": "String Labels Issue",
            "state": "open",
            "labels": ["task:available", "enhancement"],
            "comments": [],
        }

        async def run_test():
            with patch.object(client, "issue_get", new_callable=AsyncMock) as mock_get:
                mock_get.return_value = mock_issue_data
                return await client.get_claim_status(100)

        status = run_async(run_test())

        assert status["status"] == "available"
        assert "task:available" in status["labels"]


class TestClaimIssueMocked:
    """Tests for claim_issue with mocked GitHub API."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client."""
        return GHClient(
            project_dir=tmp_path,
            enable_rate_limiting=False,
        )

    def test_claim_issue_success(self, client):
        """Test successful issue claiming."""
        async def run_test():
            with patch.object(client, "issue_add_labels", new_callable=AsyncMock) as mock_add:
                with patch.object(client, "issue_remove_labels", new_callable=AsyncMock) as mock_remove:
                    with patch.object(client, "issue_comment", new_callable=AsyncMock) as mock_comment:
                        result = await client.claim_issue(
                            issue_number=123,
                            fork_owner="testuser",
                            claim_id="claim-test123",
                            reputation_data={"score": 10, "tier": "bronze"},
                        )

                        assert result["success"] is True
                        assert result["issue_number"] == 123
                        assert result["claim_id"] == "claim-test123"
                        assert result["claimed_by"] == "testuser"

                        # Verify correct labels were modified
                        mock_add.assert_called_once_with(123, ["task:claimed"])
                        mock_remove.assert_called_once_with(123, ["task:available"])

                        # Verify comment was posted
                        mock_comment.assert_called_once()
                        comment_body = mock_comment.call_args[0][1]
                        assert "testuser" in comment_body
                        assert "claim-test123" in comment_body

                        return result

        run_async(run_test())


class TestReleaseIssueMocked:
    """Tests for release_issue with mocked GitHub API."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client."""
        return GHClient(
            project_dir=tmp_path,
            enable_rate_limiting=False,
        )

    def test_release_issue_success(self, client):
        """Test successful issue release."""
        async def run_test():
            with patch.object(client, "issue_add_labels", new_callable=AsyncMock) as mock_add:
                with patch.object(client, "issue_remove_labels", new_callable=AsyncMock) as mock_remove:
                    with patch.object(client, "issue_comment", new_callable=AsyncMock) as mock_comment:
                        result = await client.release_issue(
                            issue_number=456,
                            fork_owner="releaser",
                            claim_id="claim-release456",
                            reason="Time constraints",
                        )

                        assert result["success"] is True
                        assert result["issue_number"] == 456
                        assert result["released_by"] == "releaser"

                        # Verify correct labels were modified
                        mock_remove.assert_called_once_with(456, ["task:claimed"])
                        mock_add.assert_called_once_with(456, ["task:available"])

                        # Verify comment was posted with reason
                        mock_comment.assert_called_once()
                        comment_body = mock_comment.call_args[0][1]
                        assert "releaser" in comment_body
                        assert "Time constraints" in comment_body

                        return result

        run_async(run_test())


class TestPostClaimCommentMocked:
    """Tests for post_claim_comment with mocked GitHub API."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client."""
        return GHClient(
            project_dir=tmp_path,
            enable_rate_limiting=False,
        )

    def test_post_claim_comment(self, client):
        """Test posting a claim comment."""
        async def run_test():
            with patch.object(client, "issue_comment", new_callable=AsyncMock) as mock_comment:
                await client.post_claim_comment(
                    issue_number=789,
                    fork_owner="commenter",
                    claim_id="claim-comment789",
                    reputation_data={"score": 100, "tier": "platinum"},
                )

                mock_comment.assert_called_once()
                call_args = mock_comment.call_args
                assert call_args[0][0] == 789  # issue_number

                comment_body = call_args[0][1]
                assert "commenter" in comment_body
                assert "claim-comment789" in comment_body
                assert "CLAIM_METADATA" in comment_body

        run_async(run_test())


class TestPostReleaseCommentMocked:
    """Tests for post_release_comment with mocked GitHub API."""

    @pytest.fixture
    def client(self, tmp_path):
        """Create a test client."""
        return GHClient(
            project_dir=tmp_path,
            enable_rate_limiting=False,
        )

    def test_post_release_comment(self, client):
        """Test posting a release comment."""
        async def run_test():
            with patch.object(client, "issue_comment", new_callable=AsyncMock) as mock_comment:
                await client.post_release_comment(
                    issue_number=321,
                    fork_owner="releaser",
                    claim_id="claim-rel321",
                    reason="Changing priorities",
                )

                mock_comment.assert_called_once()
                call_args = mock_comment.call_args
                assert call_args[0][0] == 321

                comment_body = call_args[0][1]
                assert "releaser" in comment_body
                assert "Changing priorities" in comment_body

        run_async(run_test())


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-k", "claim"])
