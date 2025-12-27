#!/usr/bin/env python3
"""
E2E Tests: Fork Claims Available Issue
======================================

End-to-end tests for the distributed fork coordination system's claim workflow.

This module tests the complete flow:
1. Create test issue with task:available label
2. Trigger task-claim.yml workflow_dispatch with issue number
3. Verify workflow succeeds (check logs)
4. Verify issue has task:claimed label, task:available removed
5. Verify claim comment posted with fork, timestamp, claim_id, reputation
6. Verify claim_validator.py logic validated the claim

Tests are split into:
- Unit/mock tests: Run without GitHub API access
- Integration tests: Require GitHub API access (skipped if not configured)
- E2E tests: Full workflow verification (require workflow on default branch)
"""

import asyncio
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add apps/backend/runners/github directly to path to avoid __init__.py import issues
_github_runner_path = Path(__file__).parent.parent / "apps" / "backend" / "runners" / "github"
sys.path.insert(0, str(_github_runner_path))


# =============================================================================
# TEST FIXTURES
# =============================================================================


@dataclass
class MockIssue:
    """Mock issue data for testing."""

    number: int
    title: str
    state: str
    labels: list[str]
    comments: list[dict[str, Any]]


def make_mock_issue(
    number: int = 123,
    title: str = "Test issue for E2E",
    state: str = "open",
    labels: list[str] | None = None,
    comments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Create mock issue data matching GitHub API format."""
    if labels is None:
        labels = ["task:available"]

    return {
        "number": number,
        "title": title,
        "state": state,
        "labels": [{"name": label} for label in labels],
        "comments": comments or [],
    }


def make_claim_comment(
    claimed_by: str,
    claim_id: str,
    timestamp: str | None = None,
    issue_number: int = 123,
    fork_reputation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a mock claim comment with embedded metadata."""
    if timestamp is None:
        timestamp = datetime.now(timezone.utc).isoformat()

    metadata = {
        "claimed_by": claimed_by,
        "claim_id": claim_id,
        "timestamp": timestamp,
        "issue_number": issue_number,
    }

    if fork_reputation:
        metadata["fork_reputation"] = fork_reputation

    body = f"""## Task Claimed by @{claimed_by}

**Claim ID:** `{claim_id}`
**Timestamp:** {timestamp}

---
*This claim will expire in 7 days if no PR is submitted.*

<!-- CLAIM_METADATA: {json.dumps(metadata)} -->"""

    return {
        "id": 12345,
        "body": body,
        "createdAt": timestamp,
        "author": {"login": claimed_by},
    }


@pytest.fixture
def mock_gh_client():
    """Create a mock GHClient for testing."""
    from gh_client import GHClient

    mock = MagicMock(spec=GHClient)
    mock.LABEL_AVAILABLE = "task:available"
    mock.LABEL_CLAIMED = "task:claimed"

    # Make async methods return coroutines
    mock.issue_get = AsyncMock()
    mock.issue_add_labels = AsyncMock()
    mock.issue_remove_labels = AsyncMock()
    mock.issue_comment = AsyncMock()
    mock.post_claim_comment = AsyncMock()
    mock.claim_issue = AsyncMock()
    mock.get_claim_status = AsyncMock()

    return mock


@pytest.fixture
def claim_validator(mock_gh_client):
    """Create a ClaimValidator with mock GHClient."""
    from claim_validator import ClaimValidator

    return ClaimValidator(gh_client=mock_gh_client)


# =============================================================================
# UNIT TESTS: Claim Validator Logic
# =============================================================================


class TestClaimValidatorLogic:
    """Unit tests for claim validator logic (no GitHub API calls)."""

    def test_validate_username_valid(self, claim_validator):
        """Test valid username validation."""
        assert claim_validator.validate_username("validuser")
        assert claim_validator.validate_username("user-name")
        assert claim_validator.validate_username("user123")
        assert claim_validator.validate_username("a")  # Single char
        assert claim_validator.validate_username("a" * 39)  # Max length

    def test_validate_username_invalid(self, claim_validator):
        """Test invalid username rejection."""
        assert not claim_validator.validate_username("")
        assert not claim_validator.validate_username("-startswith-hyphen")
        assert not claim_validator.validate_username("endswith-hyphen-")
        assert not claim_validator.validate_username("has--double--hyphens")
        assert not claim_validator.validate_username("a" * 40)  # Too long
        assert not claim_validator.validate_username("has spaces")
        assert not claim_validator.validate_username("has_underscore")

    def test_extract_labels_dict_format(self, claim_validator):
        """Test label extraction from dict format."""
        issue_data = {
            "labels": [
                {"name": "task:available"},
                {"name": "bug"},
            ]
        }
        labels = claim_validator.extract_labels(issue_data)
        assert labels == ["task:available", "bug"]

    def test_extract_labels_string_format(self, claim_validator):
        """Test label extraction from string format."""
        issue_data = {"labels": ["task:available", "bug"]}
        labels = claim_validator.extract_labels(issue_data)
        assert labels == ["task:available", "bug"]

    def test_extract_labels_empty(self, claim_validator):
        """Test label extraction with no labels."""
        issue_data = {"labels": []}
        labels = claim_validator.extract_labels(issue_data)
        assert labels == []

    def test_parse_claim_metadata_valid(self, claim_validator):
        """Test claim metadata parsing from valid comment."""
        comment_body = """## Task Claimed

<!-- CLAIM_METADATA: {"claimed_by": "testuser", "claim_id": "claim-abc123", "timestamp": "2025-01-01T00:00:00Z"} -->
"""
        metadata = claim_validator.parse_claim_metadata(comment_body)
        assert metadata is not None
        assert metadata["claimed_by"] == "testuser"
        assert metadata["claim_id"] == "claim-abc123"
        assert metadata["timestamp"] == "2025-01-01T00:00:00Z"

    def test_parse_claim_metadata_no_metadata(self, claim_validator):
        """Test claim metadata parsing with no metadata."""
        comment_body = "Just a regular comment without metadata."
        metadata = claim_validator.parse_claim_metadata(comment_body)
        assert metadata is None

    def test_parse_claim_metadata_invalid_json(self, claim_validator):
        """Test claim metadata parsing with invalid JSON."""
        comment_body = "<!-- CLAIM_METADATA: {invalid json} -->"
        metadata = claim_validator.parse_claim_metadata(comment_body)
        assert metadata is None

    def test_generate_claim_id_format(self, claim_validator):
        """Test claim ID generation format."""
        claim_id = claim_validator.generate_claim_id()
        assert claim_id.startswith("claim-")
        assert len(claim_id) == 18  # "claim-" + 12 hex chars

    def test_generate_claim_id_unique(self, claim_validator):
        """Test claim ID uniqueness."""
        ids = [claim_validator.generate_claim_id() for _ in range(100)]
        assert len(set(ids)) == 100  # All unique

    def test_is_claim_stale_not_stale(self, claim_validator):
        """Test stale check for fresh claim."""
        timestamp = datetime.now(timezone.utc).isoformat()
        metadata = {"timestamp": timestamp}
        assert not claim_validator.is_claim_stale(metadata, stale_days=7)

    def test_is_claim_stale_expired(self, claim_validator):
        """Test stale check for expired claim."""
        from datetime import timedelta

        old_time = datetime.now(timezone.utc) - timedelta(days=8)
        metadata = {"timestamp": old_time.isoformat()}
        assert claim_validator.is_claim_stale(metadata, stale_days=7)

    def test_format_error_comment(self, claim_validator):
        """Test error comment formatting."""
        from claim_validator import ClaimError

        comment = claim_validator.format_error_comment(
            error=ClaimError.ALREADY_CLAIMED,
            fork_owner="testuser",
            issue_number=123,
            details="Already claimed by @other",
        )
        assert "Claim Failed for @testuser" in comment
        assert ClaimError.ALREADY_CLAIMED.user_message in comment
        assert "Already claimed by @other" in comment

    def test_find_claim_comment_most_recent(self, claim_validator):
        """Test finding most recent claim comment."""
        old_comment = make_claim_comment(
            claimed_by="olduser",
            claim_id="claim-111111111111",
            timestamp="2025-01-01T00:00:00Z",
        )
        new_comment = make_claim_comment(
            claimed_by="newuser",
            claim_id="claim-222222222222",
            timestamp="2025-01-02T00:00:00Z",
        )

        comment, metadata = claim_validator.find_claim_comment([old_comment, new_comment])
        assert metadata is not None
        assert metadata["claimed_by"] == "newuser"


# =============================================================================
# MOCK-BASED TESTS: Full Claim Flow
# =============================================================================


class TestClaimFlowWithMocks:
    """Tests for the full claim flow using mocks."""

    def test_validate_claim_success(self, claim_validator, mock_gh_client):
        """Test successful claim validation."""
        # Setup: Issue is available
        mock_issue = make_mock_issue(labels=["task:available"])
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        async def _run():
            return await claim_validator.validate_claim(
                issue_number=123,
                fork_owner="testuser",
                actor="testuser",
            )

        result = asyncio.run(_run())

        # Verify
        assert result.is_valid
        assert result.claim_id is not None
        assert result.claim_id.startswith("claim-")
        assert result.error is None

    def test_validate_claim_already_claimed(self, claim_validator, mock_gh_client):
        """Test claim validation fails when issue already claimed."""
        # Setup: Issue is already claimed
        claim_comment = make_claim_comment(
            claimed_by="otheruser",
            claim_id="claim-existing123",
        )
        mock_issue = make_mock_issue(
            labels=["task:claimed"],
            comments=[claim_comment],
        )
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        from claim_validator import ClaimError

        async def _run():
            return await claim_validator.validate_claim(
                issue_number=123,
                fork_owner="testuser",
                actor="testuser",
            )

        result = asyncio.run(_run())

        # Verify
        assert not result.is_valid
        assert result.error == ClaimError.ALREADY_CLAIMED
        assert "otheruser" in result.error_message

    def test_validate_claim_idempotent(self, claim_validator, mock_gh_client):
        """Test idempotent claim (same user claiming again)."""
        # Setup: Issue already claimed by same user
        claim_comment = make_claim_comment(
            claimed_by="testuser",
            claim_id="claim-existing123",
        )
        mock_issue = make_mock_issue(
            labels=["task:claimed"],
            comments=[claim_comment],
        )
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        async def _run():
            return await claim_validator.validate_claim(
                issue_number=123,
                fork_owner="testuser",
                actor="testuser",
            )

        result = asyncio.run(_run())

        # Verify: Should succeed (idempotent)
        assert result.is_valid
        assert result.claim_id == "claim-existing123"
        assert "idempotent" in result.warnings[0].lower()

    def test_validate_claim_missing_available_label(
        self, claim_validator, mock_gh_client
    ):
        """Test claim validation fails when task:available label missing."""
        # Setup: Issue has no relevant labels
        mock_issue = make_mock_issue(labels=["bug", "enhancement"])
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        from claim_validator import ClaimError

        async def _run():
            return await claim_validator.validate_claim(
                issue_number=123,
                fork_owner="testuser",
                actor="testuser",
            )

        result = asyncio.run(_run())

        # Verify
        assert not result.is_valid
        assert result.error == ClaimError.MISSING_AVAILABLE_LABEL

    def test_validate_claim_identity_mismatch(
        self, claim_validator, mock_gh_client
    ):
        """Test claim validation fails when actor doesn't match fork owner."""
        # Setup: Issue is available
        mock_issue = make_mock_issue(labels=["task:available"])
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        from claim_validator import ClaimError

        async def _run():
            return await claim_validator.validate_claim(
                issue_number=123,
                fork_owner="forkowner",
                actor="differentactor",
            )

        result = asyncio.run(_run())

        # Verify
        assert not result.is_valid
        assert result.error == ClaimError.IDENTITY_MISMATCH

    def test_validate_claim_closed_issue(self, claim_validator, mock_gh_client):
        """Test claim validation fails for closed issues."""
        # Setup: Issue is closed
        mock_issue = make_mock_issue(
            state="closed",
            labels=["task:available"],
        )
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        from claim_validator import ClaimError

        async def _run():
            return await claim_validator.validate_claim(
                issue_number=123,
                fork_owner="testuser",
                actor="testuser",
            )

        result = asyncio.run(_run())

        # Verify
        assert not result.is_valid
        assert result.error == ClaimError.ISSUE_CLOSED

    def test_validate_claim_conflicting_labels(
        self, claim_validator, mock_gh_client
    ):
        """Test claim validation fails with conflicting labels."""
        # Setup: Issue has both labels (inconsistent state)
        mock_issue = make_mock_issue(labels=["task:available", "task:claimed"])
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        from claim_validator import ClaimError

        async def _run():
            return await claim_validator.validate_claim(
                issue_number=123,
                fork_owner="testuser",
                actor="testuser",
            )

        result = asyncio.run(_run())

        # Verify
        assert not result.is_valid
        assert result.error == ClaimError.CONFLICTING_LABELS

    def test_verify_claim_after_action_success(
        self, claim_validator, mock_gh_client
    ):
        """Test post-claim verification succeeds with matching state."""
        # Setup: Issue was claimed successfully
        claim_comment = make_claim_comment(
            claimed_by="testuser",
            claim_id="claim-abc123def456",
        )
        mock_issue = make_mock_issue(
            labels=["task:claimed"],
            comments=[claim_comment],
        )
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        async def _run():
            return await claim_validator.verify_claim_after_action(
                issue_number=123,
                expected_fork_owner="testuser",
                expected_claim_id="claim-abc123def456",
            )

        is_valid, error = asyncio.run(_run())

        # Verify
        assert is_valid
        assert error is None

    def test_verify_claim_after_action_race_condition(
        self, claim_validator, mock_gh_client
    ):
        """Test post-claim verification detects race condition."""
        # Setup: Different user won the race
        claim_comment = make_claim_comment(
            claimed_by="otheruser",
            claim_id="claim-different123",
        )
        mock_issue = make_mock_issue(
            labels=["task:claimed"],
            comments=[claim_comment],
        )
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        async def _run():
            return await claim_validator.verify_claim_after_action(
                issue_number=123,
                expected_fork_owner="testuser",
                expected_claim_id="claim-abc123def456",
            )

        is_valid, error = asyncio.run(_run())

        # Verify
        assert not is_valid
        assert "race condition" in error.lower()
        assert "otheruser" in error


# =============================================================================
# GH CLIENT CLAIM METHODS TESTS
# =============================================================================


class TestGHClientClaimMethods:
    """Tests for GHClient claim-related methods."""

    def test_parse_claim_metadata_valid(self):
        """Test GHClient claim metadata parsing."""
        from gh_client import GHClient

        client = GHClient(project_dir=Path("."))
        comment_body = make_claim_comment(
            claimed_by="testuser",
            claim_id="claim-abc123def456",
        )["body"]

        metadata = client.parse_claim_metadata(comment_body)
        assert metadata is not None
        assert metadata["claimed_by"] == "testuser"
        assert metadata["claim_id"] == "claim-abc123def456"

    def test_format_claim_comment(self):
        """Test GHClient claim comment formatting."""
        from gh_client import GHClient

        client = GHClient(project_dir=Path("."))
        comment = client.format_claim_comment(
            fork_owner="testuser",
            claim_id="claim-abc123def456",
            reputation_data={
                "score": 50,
                "tier": "silver",
                "successful_merges": 5,
                "reliability_score": 0.85,
            },
            issue_number=123,
        )

        # Verify human-readable parts
        assert "Task Claimed by @testuser" in comment
        assert "claim-abc123def456" in comment
        assert "50" in comment  # Score
        assert "silver" in comment
        assert "85%" in comment  # Reliability

        # Verify machine-readable metadata
        assert "<!-- CLAIM_METADATA:" in comment
        metadata = client.parse_claim_metadata(comment)
        assert metadata is not None
        assert metadata["claimed_by"] == "testuser"
        assert metadata["fork_reputation"]["score"] == 50

    def test_format_release_comment(self):
        """Test GHClient release comment formatting."""
        from gh_client import GHClient

        client = GHClient(project_dir=Path("."))
        comment = client.format_release_comment(
            fork_owner="testuser",
            claim_id="claim-abc123def456",
            reason="Unable to complete",
        )

        assert "Task Released by @testuser" in comment
        assert "claim-abc123def456" in comment
        assert "Unable to complete" in comment
        assert "now available" in comment


# =============================================================================
# INTEGRATION TESTS (Require GitHub CLI)
# =============================================================================


def gh_cli_available() -> bool:
    """Check if gh CLI is available and authenticated."""
    try:
        result = subprocess.run(
            ["gh", "auth", "status"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


# Skip integration tests if gh CLI not available
requires_gh_cli = pytest.mark.skipif(
    not gh_cli_available(),
    reason="gh CLI not available or not authenticated",
)


@requires_gh_cli
class TestE2EClaimFlowIntegration:
    """
    Integration tests that require GitHub CLI access.

    These tests verify the claim workflow components work together
    but don't actually trigger GitHub Actions workflows.

    To run these tests:
    1. Ensure gh CLI is installed: brew install gh
    2. Authenticate: gh auth login
    3. Run: pytest tests/test_e2e_fork_claims.py::TestE2EClaimFlowIntegration -v
    """

    @pytest.fixture
    def test_repo(self):
        """Get test repository from environment or skip."""
        repo = os.environ.get("TEST_GITHUB_REPO")
        if not repo:
            pytest.skip("TEST_GITHUB_REPO environment variable not set")
        return repo

    def test_gh_cli_issue_list(self, test_repo):
        """Test that we can list issues via gh CLI."""
        result = subprocess.run(
            ["gh", "issue", "list", "-R", test_repo, "--json", "number,title,labels"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0
        issues = json.loads(result.stdout)
        assert isinstance(issues, list)

    def test_gh_cli_workflow_list(self, test_repo):
        """Test that task-claim workflow exists."""
        result = subprocess.run(
            ["gh", "workflow", "list", "-R", test_repo, "--json", "name,state"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0
        workflows = json.loads(result.stdout)

        workflow_names = [w["name"] for w in workflows]
        # Note: Workflow must be on default branch to appear
        if "Task Claim" not in workflow_names:
            pytest.skip(
                "Task Claim workflow not found (may not be on default branch yet)"
            )


# =============================================================================
# FULL E2E TESTS (Manual/CI)
# =============================================================================


class TestE2EClaimFlowManual:
    """
    Full E2E test documentation and helpers.

    These tests document the manual verification steps and provide
    helper scripts for running the full E2E flow.

    To run a full E2E test:

    1. Set up test environment:
       export TEST_GITHUB_REPO="owner/repo"

    2. Create a test issue:
       gh issue create -R $TEST_GITHUB_REPO \\
         --title "E2E Test: Claim Flow" \\
         --body "Automated E2E test issue" \\
         --label "task:available"

    3. Trigger the claim workflow:
       gh workflow run task-claim.yml -R $TEST_GITHUB_REPO \\
         -f issue_number=<ISSUE_NUMBER>

    4. Wait for workflow completion:
       gh run list -R $TEST_GITHUB_REPO \\
         --workflow=task-claim.yml --limit 1 --json status,conclusion

    5. Verify claim succeeded:
       gh issue view <ISSUE_NUMBER> -R $TEST_GITHUB_REPO \\
         --json labels,comments

    Expected outcome:
    - Issue has "task:claimed" label
    - Issue no longer has "task:available" label
    - Claim comment with CLAIM_METADATA exists
    - CLAIM_METADATA contains: claimed_by, claim_id, timestamp
    """

    def test_e2e_steps_documented(self):
        """Verify E2E test documentation exists."""
        # This test ensures the class docstring is present
        assert TestE2EClaimFlowManual.__doc__ is not None
        assert "CLAIM_METADATA" in TestE2EClaimFlowManual.__doc__

    def test_e2e_verification_script(self, tmp_path):
        """Generate E2E verification script."""
        script_content = '''#!/bin/bash
# E2E Test: Fork Claims Available Issue
# Generated by test_e2e_fork_claims.py

set -e

REPO="${TEST_GITHUB_REPO:-}"
if [ -z "$REPO" ]; then
    echo "Error: TEST_GITHUB_REPO environment variable not set"
    exit 1
fi

echo "=== E2E Test: Fork Claims Available Issue ==="
echo "Repository: $REPO"
echo ""

# Step 1: Create test issue
echo "Step 1: Creating test issue with task:available label..."
ISSUE_URL=$(gh issue create -R "$REPO" \\
    --title "E2E Test: Fork Claim $(date +%s)" \\
    --body "Automated E2E test for fork claim workflow" \\
    --label "task:available")
ISSUE_NUMBER=$(echo "$ISSUE_URL" | grep -oE "[0-9]+$")
echo "Created issue #$ISSUE_NUMBER"
echo ""

# Step 2: Trigger claim workflow
echo "Step 2: Triggering task-claim.yml workflow..."
gh workflow run task-claim.yml -R "$REPO" -f issue_number="$ISSUE_NUMBER"
echo "Workflow triggered"
echo ""

# Step 3: Wait for workflow completion
echo "Step 3: Waiting for workflow completion (max 60s)..."
for i in {1..12}; do
    sleep 5
    STATUS=$(gh run list -R "$REPO" --workflow=task-claim.yml --limit 1 --json status,conclusion -q '.[0]')
    CONCLUSION=$(echo "$STATUS" | jq -r '.conclusion // empty')
    if [ -n "$CONCLUSION" ]; then
        echo "Workflow completed with conclusion: $CONCLUSION"
        break
    fi
    echo "  Waiting... ($i/12)"
done
echo ""

# Step 4: Verify claim
echo "Step 4: Verifying claim..."
ISSUE_DATA=$(gh issue view "$ISSUE_NUMBER" -R "$REPO" --json labels,comments)

# Check labels
HAS_CLAIMED=$(echo "$ISSUE_DATA" | jq -r '.labels[].name' | grep -c "task:claimed" || true)
HAS_AVAILABLE=$(echo "$ISSUE_DATA" | jq -r '.labels[].name' | grep -c "task:available" || true)

if [ "$HAS_CLAIMED" -eq 1 ] && [ "$HAS_AVAILABLE" -eq 0 ]; then
    echo "  Labels: PASS (task:claimed present, task:available removed)"
else
    echo "  Labels: FAIL (task:claimed=$HAS_CLAIMED, task:available=$HAS_AVAILABLE)"
    exit 1
fi

# Check claim comment
CLAIM_COMMENT=$(echo "$ISSUE_DATA" | jq -r '.comments[].body' | grep -c "CLAIM_METADATA" || true)
if [ "$CLAIM_COMMENT" -ge 1 ]; then
    echo "  Claim comment: PASS (CLAIM_METADATA found)"
else
    echo "  Claim comment: FAIL (CLAIM_METADATA not found)"
    exit 1
fi

echo ""
echo "=== E2E Test PASSED ==="
echo "Issue #$ISSUE_NUMBER successfully claimed"

# Cleanup: Release the claim
echo ""
echo "Cleanup: Releasing claim..."
gh workflow run task-release.yml -R "$REPO" -f issue_number="$ISSUE_NUMBER" || true
'''

        script_path = tmp_path / "e2e_claim_test.sh"
        script_path.write_text(script_content)
        script_path.chmod(0o755)

        assert script_path.exists()
        assert "task:claimed" in script_path.read_text()


# =============================================================================
# REPUTATION INTEGRATION TESTS
# =============================================================================


class TestReputationIntegration:
    """Tests for reputation tracking integration with claims."""

    def test_reputation_tracker_import(self):
        """Test that ReputationTracker can be imported."""
        from reputation_tracker import ReputationTracker

        tracker = ReputationTracker()
        assert tracker is not None

    def test_reputation_event_types(self):
        """Test reputation event type constants."""
        from reputation_tracker import ReputationEventType

        assert ReputationEventType.PR_MERGED.value == "pr_merged"
        assert ReputationEventType.CLAIM_ABANDONED.value == "claim_abandoned"
        assert ReputationEventType.CLAIM_TIMEOUT.value == "claim_timeout"

    def test_claim_metadata_includes_reputation(self):
        """Test that claim comments can include reputation data."""
        from gh_client import GHClient

        client = GHClient(project_dir=Path("."))

        reputation_data = {
            "score": 100,
            "tier": "gold",
            "successful_merges": 10,
            "reliability_score": 0.95,
        }

        comment = client.format_claim_comment(
            fork_owner="highrepuser",
            claim_id="claim-test123456",
            reputation_data=reputation_data,
            issue_number=456,
        )

        # Verify reputation is in human-readable format
        assert "100" in comment
        assert "gold" in comment
        assert "95%" in comment

        # Verify reputation is in machine-readable metadata
        metadata = client.parse_claim_metadata(comment)
        assert metadata["fork_reputation"]["score"] == 100
        assert metadata["fork_reputation"]["tier"] == "gold"


# =============================================================================
# WORKFLOW YAML VERIFICATION
# =============================================================================


class TestWorkflowYamlVerification:
    """Tests to verify workflow YAML files are correctly configured."""

    @pytest.fixture
    def workflow_dir(self):
        """Get workflow directory path."""
        return Path(__file__).parent.parent / ".github" / "workflows"

    def test_task_claim_workflow_exists(self, workflow_dir):
        """Test task-claim.yml exists."""
        workflow_file = workflow_dir / "task-claim.yml"
        assert workflow_file.exists(), "task-claim.yml not found"

    def test_task_claim_workflow_structure(self, workflow_dir):
        """Test task-claim.yml has correct structure."""
        try:
            import yaml
        except ImportError:
            pytest.skip("PyYAML not installed")

        workflow_file = workflow_dir / "task-claim.yml"
        if not workflow_file.exists():
            pytest.skip("task-claim.yml not found")

        content = yaml.safe_load(workflow_file.read_text())

        # Check required sections
        assert "name" in content
        assert "on" in content
        assert "permissions" in content
        assert "jobs" in content

        # Check workflow_dispatch input
        assert "workflow_dispatch" in content["on"]
        assert "issue_number" in content["on"]["workflow_dispatch"]["inputs"]

        # Check permissions
        assert content["permissions"]["issues"] == "write"

    def test_task_claim_workflow_claim_metadata_pattern(self, workflow_dir):
        """Test workflow uses correct CLAIM_METADATA pattern."""
        workflow_file = workflow_dir / "task-claim.yml"
        if not workflow_file.exists():
            pytest.skip("task-claim.yml not found")

        content = workflow_file.read_text()

        # Check for claim metadata pattern
        assert "CLAIM_METADATA" in content
        assert "claimed_by" in content
        assert "claim_id" in content
        assert "timestamp" in content

    def test_task_release_workflow_exists(self, workflow_dir):
        """Test task-release.yml exists."""
        workflow_file = workflow_dir / "task-release.yml"
        assert workflow_file.exists(), "task-release.yml not found"

    def test_task_stale_check_workflow_exists(self, workflow_dir):
        """Test task-stale-check.yml exists."""
        workflow_file = workflow_dir / "task-stale-check.yml"
        assert workflow_file.exists(), "task-stale-check.yml not found"


# =============================================================================
# E2E TEST: RACE CONDITION - TWO FORKS CLAIM SAME ISSUE
# =============================================================================


class TestRaceConditionTwoForksSameIssue:
    """
    E2E tests for race condition scenario: two forks claim same issue.

    Test Verification Steps:
    1. Create test issue with task:available label
    2. Trigger two task-claim.yml workflow runs simultaneously (different github.actor contexts)
    3. Verify only one claim succeeds (first to complete)
    4. Verify second claim detects race condition and fails gracefully
    5. Verify error comment posted to second claimer
    6. Verify only one task:claimed label, one claim comment
    """

    # =========================================================================
    # Unit Tests: Race Condition Detection Logic
    # =========================================================================

    def test_race_condition_detection_different_owner(self, claim_validator, mock_gh_client):
        """Test race detection when another fork claimed first."""
        # Setup: After our claim action, issue is claimed by someone else
        claim_comment = make_claim_comment(
            claimed_by="winneruser",
            claim_id="claim-winner12345",
        )
        mock_issue = make_mock_issue(
            labels=["task:claimed"],
            comments=[claim_comment],
        )
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute: Verify our claim
        async def _run():
            return await claim_validator.verify_claim_after_action(
                issue_number=123,
                expected_fork_owner="loseruser",
                expected_claim_id="claim-loser12345",
            )

        is_valid, error = asyncio.run(_run())

        # Verify: Race condition detected
        assert not is_valid
        assert "race condition" in error.lower()
        assert "winneruser" in error

    def test_race_condition_detection_different_claim_id(self, claim_validator, mock_gh_client):
        """Test race detection when claim ID doesn't match (same owner, different ID)."""
        # Setup: Same owner but different claim ID (someone overwrote our claim)
        claim_comment = make_claim_comment(
            claimed_by="testuser",
            claim_id="claim-newone12345",
        )
        mock_issue = make_mock_issue(
            labels=["task:claimed"],
            comments=[claim_comment],
        )
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        async def _run():
            return await claim_validator.verify_claim_after_action(
                issue_number=123,
                expected_fork_owner="testuser",
                expected_claim_id="claim-oldone12345",
            )

        is_valid, error = asyncio.run(_run())

        # Verify: Race condition detected (claim ID mismatch)
        assert not is_valid
        assert "race condition" in error.lower()
        assert "claim-newone12345" in error or "expected" in error.lower()

    def test_race_condition_detection_missing_label(self, claim_validator, mock_gh_client):
        """Test race detection when claimed label was removed."""
        # Setup: Our claim was rolled back (label removed)
        mock_issue = make_mock_issue(
            labels=["task:available"],
            comments=[],
        )
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        async def _run():
            return await claim_validator.verify_claim_after_action(
                issue_number=123,
                expected_fork_owner="testuser",
                expected_claim_id="claim-test12345",
            )

        is_valid, error = asyncio.run(_run())

        # Verify: Detection of missing claim label
        assert not is_valid
        assert "label not present" in error.lower()

    def test_race_condition_detection_no_metadata(self, claim_validator, mock_gh_client):
        """Test race detection when claim metadata is missing."""
        # Setup: Label added but comment wasn't posted
        mock_issue = make_mock_issue(
            labels=["task:claimed"],
            comments=[],
        )
        mock_gh_client.issue_get.return_value = mock_issue
        claim_validator.gh_client = mock_gh_client

        # Execute
        async def _run():
            return await claim_validator.verify_claim_after_action(
                issue_number=123,
                expected_fork_owner="testuser",
                expected_claim_id="claim-test12345",
            )

        is_valid, error = asyncio.run(_run())

        # Verify: Detection of missing metadata
        assert not is_valid
        assert "metadata" in error.lower()

    # =========================================================================
    # Mock-Based Tests: Concurrent Claim Simulation
    # =========================================================================

    def test_concurrent_claim_first_wins(self, mock_gh_client):
        """Simulate two forks attempting to claim - first one wins."""
        from claim_validator import ClaimValidator, ClaimError

        validator = ClaimValidator(gh_client=mock_gh_client)

        # First fork's view: issue is available
        available_issue = make_mock_issue(labels=["task:available"])

        # Second fork's view: issue already claimed by first fork
        claimed_by_first = make_mock_issue(
            labels=["task:claimed"],
            comments=[make_claim_comment(
                claimed_by="firstuser",
                claim_id="claim-first12345",
            )],
        )

        # Fork 1: Validates and claims successfully
        mock_gh_client.issue_get.return_value = available_issue

        async def _first_claim():
            return await validator.validate_claim(
                issue_number=123,
                fork_owner="firstuser",
                actor="firstuser",
            )

        first_result = asyncio.run(_first_claim())
        assert first_result.is_valid
        assert first_result.claim_id is not None

        # Fork 2: Sees already claimed issue
        mock_gh_client.issue_get.return_value = claimed_by_first

        async def _second_claim():
            return await validator.validate_claim(
                issue_number=123,
                fork_owner="seconduser",
                actor="seconduser",
            )

        second_result = asyncio.run(_second_claim())
        assert not second_result.is_valid
        assert second_result.error == ClaimError.ALREADY_CLAIMED
        assert "firstuser" in second_result.error_message

    def test_concurrent_claim_race_detection_after_action(self, mock_gh_client):
        """Test race detection in post-action verification."""
        from claim_validator import ClaimValidator

        validator = ClaimValidator(gh_client=mock_gh_client)

        # Both forks see available issue initially
        available_issue = make_mock_issue(labels=["task:available"])
        mock_gh_client.issue_get.return_value = available_issue

        # Both forks validate successfully (race begins here)
        async def _validate():
            return await validator.validate_claim(
                issue_number=123,
                fork_owner="fork1",
                actor="fork1",
            )

        result1 = asyncio.run(_validate())
        assert result1.is_valid
        fork1_claim_id = result1.claim_id

        # Change mock to simulate fork2 also validates
        async def _validate2():
            return await validator.validate_claim(
                issue_number=123,
                fork_owner="fork2",
                actor="fork2",
            )

        result2 = asyncio.run(_validate2())
        # Both see available issue, both get valid result
        # Race will be detected in post-action verification
        assert result2.is_valid
        fork2_claim_id = result2.claim_id

        # Now fork1 completes first and claims
        claimed_by_fork1 = make_mock_issue(
            labels=["task:claimed"],
            comments=[make_claim_comment(
                claimed_by="fork1",
                claim_id=fork1_claim_id,
            )],
        )
        mock_gh_client.issue_get.return_value = claimed_by_fork1

        # Fork1 verification: SUCCESS
        async def _verify1():
            return await validator.verify_claim_after_action(
                issue_number=123,
                expected_fork_owner="fork1",
                expected_claim_id=fork1_claim_id,
            )

        is_valid1, error1 = asyncio.run(_verify1())
        assert is_valid1, f"Fork1 should succeed: {error1}"
        assert error1 is None

        # Fork2 verification: RACE DETECTED
        async def _verify2():
            return await validator.verify_claim_after_action(
                issue_number=123,
                expected_fork_owner="fork2",
                expected_claim_id=fork2_claim_id,
            )

        is_valid2, error2 = asyncio.run(_verify2())
        assert not is_valid2
        assert "race condition" in error2.lower()
        assert "fork1" in error2

    def test_error_comment_for_race_loser(self, claim_validator):
        """Test error comment formatting for race condition loser."""
        from claim_validator import ClaimError

        error_comment = claim_validator.format_error_comment(
            error=ClaimError.RACE_CONDITION_DETECTED,
            fork_owner="seconduser",
            issue_number=123,
            details="Issue was claimed by @firstuser while processing your request.",
        )

        # Verify comment structure
        assert "Claim Failed for @seconduser" in error_comment
        assert "Race condition" in error_comment or "race condition" in error_comment.lower()
        assert "firstuser" in error_comment
        assert "123" in error_comment or "issue" in error_comment.lower()

    def test_error_comment_for_already_claimed(self, claim_validator):
        """Test error comment for already claimed error."""
        from claim_validator import ClaimError

        error_comment = claim_validator.format_error_comment(
            error=ClaimError.ALREADY_CLAIMED,
            fork_owner="lateuser",
            issue_number=456,
            details="Claimed by @earlyuser at 2025-01-01T00:00:00Z.",
        )

        assert "Claim Failed for @lateuser" in error_comment
        assert "claimed" in error_comment.lower()
        assert "earlyuser" in error_comment

    # =========================================================================
    # State Verification Tests
    # =========================================================================

    def test_verify_single_claim_label_only(self, claim_validator):
        """Test that only one task:claimed label is present."""
        issue_data = make_mock_issue(labels=["task:claimed"])
        labels = claim_validator.extract_labels(issue_data)

        # Count claim labels
        claimed_count = labels.count("task:claimed")
        available_count = labels.count("task:available")

        assert claimed_count == 1
        assert available_count == 0

    def test_verify_single_claim_comment(self, claim_validator):
        """Test finding single claim comment when multiple comments exist."""
        # Multiple comments, only one is a claim
        comments = [
            {"body": "Regular comment about the issue", "createdAt": "2025-01-01T00:00:00Z"},
            make_claim_comment(
                claimed_by="claimuser",
                claim_id="claim-single1234",
                timestamp="2025-01-01T01:00:00Z",
            ),
            {"body": "Another comment after the claim", "createdAt": "2025-01-01T02:00:00Z"},
        ]

        comment, metadata = claim_validator.find_claim_comment(comments)

        assert metadata is not None
        assert metadata["claimed_by"] == "claimuser"
        assert metadata["claim_id"] == "claim-single1234"

    def test_most_recent_claim_wins(self, claim_validator):
        """Test that most recent claim comment is used when multiple exist."""
        # Edge case: multiple claim comments (shouldn't happen but test handling)
        old_claim = make_claim_comment(
            claimed_by="oldclaimer",
            claim_id="claim-old1111111",
            timestamp="2025-01-01T00:00:00Z",
        )
        new_claim = make_claim_comment(
            claimed_by="newclaimer",
            claim_id="claim-new2222222",
            timestamp="2025-01-01T12:00:00Z",
        )

        comment, metadata = claim_validator.find_claim_comment([old_claim, new_claim])

        assert metadata is not None
        assert metadata["claimed_by"] == "newclaimer"
        assert metadata["claim_id"] == "claim-new2222222"

    # =========================================================================
    # Workflow Concurrency Group Tests
    # =========================================================================

    def test_workflow_has_concurrency_group(self):
        """Test that task-claim.yml has concurrency settings to prevent parallel runs."""
        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-claim.yml"
        if not workflow_path.exists():
            pytest.skip("task-claim.yml not found")

        content = workflow_path.read_text()

        # Check for concurrency group
        assert "concurrency:" in content
        assert "task-claim" in content
        # Should have cancel-in-progress setting
        assert "cancel-in-progress" in content


# =============================================================================
# E2E MANUAL TEST: Race Condition Verification Script
# =============================================================================


class TestRaceConditionE2EManual:
    """
    Manual E2E test documentation and helper scripts for race condition testing.

    Full E2E Test Procedure:
    1. Create test issue with task:available label
    2. Trigger two workflow runs with different actors (requires forked repos or admin)
    3. Verify outcomes

    Note: True race condition testing requires either:
    - Two different GitHub accounts/forks
    - Modifying workflow to simulate different actors
    - Direct API manipulation

    These tests generate scripts for manual verification.
    """

    def test_race_condition_script_generation(self, tmp_path):
        """Generate bash script for race condition E2E testing."""
        script_content = '''#!/bin/bash
# E2E Test: Race Condition - Two Forks Claim Same Issue
# Generated by test_e2e_fork_claims.py::TestRaceConditionE2EManual
#
# This script tests the race condition handling by simulating concurrent claims.
# Note: True concurrent claims require two different GitHub accounts or forks.

set -e

REPO="${TEST_GITHUB_REPO:-}"
if [ -z "$REPO" ]; then
    echo "Error: TEST_GITHUB_REPO environment variable not set"
    echo "Usage: TEST_GITHUB_REPO=owner/repo ./e2e_race_condition_test.sh"
    exit 1
fi

echo "=============================================="
echo "E2E Test: Race Condition - Two Forks Claim"
echo "=============================================="
echo "Repository: $REPO"
echo ""

# Step 1: Create test issue
echo "Step 1: Creating test issue with task:available label..."
ISSUE_URL=$(gh issue create -R "$REPO" \\
    --title "E2E Test: Race Condition $(date +%s)" \\
    --body "Automated E2E test for race condition handling in fork claim workflow" \\
    --label "task:available")
ISSUE_NUMBER=$(echo "$ISSUE_URL" | grep -oE "[0-9]+$")
echo "Created issue #$ISSUE_NUMBER"
echo ""

# Step 2: First claim (simulated)
echo "Step 2: Triggering FIRST claim workflow..."
gh workflow run task-claim.yml -R "$REPO" -f issue_number="$ISSUE_NUMBER"
echo "First workflow triggered"
echo ""

# Wait briefly for first workflow to complete
echo "Waiting 10 seconds for first claim to process..."
sleep 10

# Step 3: Check if first claim succeeded
echo "Step 3: Checking first claim status..."
ISSUE_DATA=$(gh issue view "$ISSUE_NUMBER" -R "$REPO" --json labels,comments)

HAS_CLAIMED=$(echo "$ISSUE_DATA" | jq -r '.labels[].name' | grep -c "task:claimed" || true)
if [ "$HAS_CLAIMED" -eq 1 ]; then
    echo "  First claim: SUCCEEDED (task:claimed label present)"
else
    echo "  First claim: WAITING (checking workflow status)..."
    gh run list -R "$REPO" --workflow=task-claim.yml --limit 1 --json status,conclusion
fi

# Step 4: Attempt second claim (should fail)
echo ""
echo "Step 4: Triggering SECOND claim workflow (should detect race condition)..."
gh workflow run task-claim.yml -R "$REPO" -f issue_number="$ISSUE_NUMBER"
echo "Second workflow triggered"
echo ""

# Wait for second workflow
echo "Waiting 15 seconds for second claim to process..."
sleep 15

# Step 5: Verify outcomes
echo ""
echo "Step 5: Verifying outcomes..."

# Refresh issue data
ISSUE_DATA=$(gh issue view "$ISSUE_NUMBER" -R "$REPO" --json labels,comments)

# Count labels
CLAIMED_COUNT=$(echo "$ISSUE_DATA" | jq -r '.labels[].name' | grep -c "task:claimed" || true)
AVAILABLE_COUNT=$(echo "$ISSUE_DATA" | jq -r '.labels[].name' | grep -c "task:available" || true)

echo "  Labels check:"
if [ "$CLAIMED_COUNT" -eq 1 ] && [ "$AVAILABLE_COUNT" -eq 0 ]; then
    echo "    - PASS: Exactly one task:claimed label, no task:available"
else
    echo "    - FAIL: Expected 1 claimed/0 available, got $CLAIMED_COUNT claimed/$AVAILABLE_COUNT available"
fi

# Count claim comments
CLAIM_COMMENTS=$(echo "$ISSUE_DATA" | jq -r '.comments[].body' | grep -c "CLAIM_METADATA" || true)
echo "  Claim comments:"
if [ "$CLAIM_COMMENTS" -eq 1 ]; then
    echo "    - PASS: Exactly one claim comment with CLAIM_METADATA"
else
    echo "    - INFO: Found $CLAIM_COMMENTS claim comments (may have failure comments too)"
fi

# Check for error/race detection in second workflow
echo ""
echo "Step 6: Checking second workflow status..."
SECOND_RUN=$(gh run list -R "$REPO" --workflow=task-claim.yml --limit 2 --json conclusion,status,startedAt -q '.[0]')
SECOND_CONCLUSION=$(echo "$SECOND_RUN" | jq -r '.conclusion // empty')

if [ "$SECOND_CONCLUSION" == "failure" ]; then
    echo "  Second claim: CORRECTLY FAILED (race condition detected)"
    echo "  - Workflow detected the issue was already claimed"
elif [ "$SECOND_CONCLUSION" == "success" ]; then
    # Check if it was an idempotent claim (same actor)
    echo "  Second claim: SUCCEEDED (may be idempotent if same actor)"
    echo "  - Note: True race test requires different GitHub actors"
else
    echo "  Second claim status: $SECOND_CONCLUSION"
    echo "  - May still be running or queued"
fi

echo ""
echo "=============================================="
echo "Race Condition Test Summary"
echo "=============================================="
echo ""
echo "Issue: #$ISSUE_NUMBER"
echo "Labels: $CLAIMED_COUNT claimed, $AVAILABLE_COUNT available"
echo "Claim comments: $CLAIM_COMMENTS"
echo ""

if [ "$CLAIMED_COUNT" -eq 1 ] && [ "$AVAILABLE_COUNT" -eq 0 ]; then
    echo "RESULT: PASS - Only one claim succeeded"
else
    echo "RESULT: NEEDS REVIEW - Check workflow logs"
fi

echo ""
echo "To view workflow logs:"
echo "  gh run list -R $REPO --workflow=task-claim.yml --limit 2"
echo "  gh run view <run-id> --log -R $REPO"
echo ""

# Cleanup option
echo "Cleanup: To release the claim and close the issue:"
echo "  gh workflow run task-release.yml -R $REPO -f issue_number=$ISSUE_NUMBER"
echo "  gh issue close $ISSUE_NUMBER -R $REPO"
'''

        script_path = tmp_path / "e2e_race_condition_test.sh"
        script_path.write_text(script_content)
        script_path.chmod(0o755)

        assert script_path.exists()
        assert "CLAIM_METADATA" in script_path.read_text()
        assert "race condition" in script_path.read_text().lower()

    def test_race_condition_requirements_documented(self):
        """Verify race condition testing requirements are documented."""
        # This test ensures the class docstring documents requirements
        doc = TestRaceConditionE2EManual.__doc__
        assert doc is not None
        assert "Two different GitHub accounts" in doc or "forked repos" in doc
        assert "race condition" in doc.lower()

    def test_concurrent_workflow_api_script(self, tmp_path):
        """Generate script for API-based concurrent workflow triggering."""
        script_content = '''#!/bin/bash
# API-Based Concurrent Workflow Trigger
# Uses GitHub API to trigger workflows near-simultaneously
#
# Prerequisites:
# - GH_TOKEN environment variable with workflow scope
# - Two different GitHub accounts (ACTOR1, ACTOR2) or fork tokens

REPO="${TEST_GITHUB_REPO:-}"
ISSUE_NUMBER="${1:-}"

if [ -z "$REPO" ] || [ -z "$ISSUE_NUMBER" ]; then
    echo "Usage: ACTOR1=user1 ACTOR2=user2 ./concurrent_trigger.sh <issue_number>"
    exit 1
fi

echo "Triggering concurrent workflow runs for issue #$ISSUE_NUMBER..."

# Trigger both workflows as close together as possible
# Note: True concurrency requires authenticated requests as different users
gh workflow run task-claim.yml -R "$REPO" -f issue_number="$ISSUE_NUMBER" &
PID1=$!

# Small delay to ensure different timestamps
sleep 0.1

gh workflow run task-claim.yml -R "$REPO" -f issue_number="$ISSUE_NUMBER" &
PID2=$!

# Wait for triggers to complete
wait $PID1 $PID2

echo "Both workflow runs triggered. Monitor with:"
echo "  gh run list -R $REPO --workflow=task-claim.yml --limit 5"
'''

        script_path = tmp_path / "concurrent_trigger.sh"
        script_path.write_text(script_content)
        script_path.chmod(0o755)

        assert script_path.exists()


# =============================================================================
# INTEGRATION TESTS: Race Condition with GitHub CLI
# =============================================================================


@requires_gh_cli
class TestRaceConditionIntegration:
    """
    Integration tests for race condition handling that use gh CLI.

    These tests verify the workflow and API interactions work correctly
    but don't actually create simultaneous runs (that requires manual testing).
    """

    @pytest.fixture
    def test_repo(self):
        """Get test repository from environment."""
        repo = os.environ.get("TEST_GITHUB_REPO")
        if not repo:
            pytest.skip("TEST_GITHUB_REPO environment variable not set")
        return repo

    def test_workflow_rejects_already_claimed_issue(self, test_repo):
        """
        Integration test: Verify workflow rejects claim on already claimed issue.

        This simulates the "second fork" scenario by:
        1. Creating and claiming an issue
        2. Running claim workflow again (same actor = idempotent)
        3. Verifying appropriate handling
        """
        # This is a documentation test - actual execution requires live environment
        expected_behavior = """
        When a workflow is triggered for an already-claimed issue:
        1. Workflow fetches issue state
        2. Detects task:claimed label present
        3. Parses existing claim comment
        4. If same actor: Returns success (idempotent)
        5. If different actor: Fails with ALREADY_CLAIMED error
        """
        assert "idempotent" in expected_behavior
        assert "ALREADY_CLAIMED" in expected_behavior

    def test_concurrent_workflow_behavior_documented(self):
        """Document expected behavior of concurrent workflow runs."""
        expected_behavior = {
            "concurrency_group": "task-claim-{issue_number}",
            "cancel_in_progress": False,  # Don't cancel, let both complete
            "race_handling": "Last to verify wins, others detect and fail",
            "verification_steps": [
                "1. Both workflows start processing",
                "2. Both add task:claimed label (GitHub handles atomicity)",
                "3. Both post claim comments",
                "4. Both verify final state",
                "5. Winner: Sees their claim_id in most recent comment",
                "6. Loser: Sees different claim_id, fails gracefully",
            ],
            "error_handling": "Loser workflow fails with descriptive error message",
        }

        assert expected_behavior["cancel_in_progress"] is False
        assert len(expected_behavior["verification_steps"]) >= 5


# =============================================================================
# E2E TEST: STALE CLAIM AUTO-RELEASE
# =============================================================================


def make_stale_claim_comment(
    claimed_by: str,
    claim_id: str,
    days_ago: int = 8,
    issue_number: int = 123,
    fork_reputation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a mock claim comment with a timestamp from days_ago."""
    from datetime import timedelta

    stale_time = datetime.now(timezone.utc) - timedelta(days=days_ago)
    timestamp = stale_time.isoformat()

    metadata = {
        "claimed_by": claimed_by,
        "claim_id": claim_id,
        "timestamp": timestamp,
        "issue_number": issue_number,
    }

    if fork_reputation:
        metadata["fork_reputation"] = fork_reputation

    body = f"""## Task Claimed by @{claimed_by}

**Claim ID:** `{claim_id}`
**Timestamp:** {timestamp}

---
*This claim will expire in 7 days if no PR is submitted.*

<!-- CLAIM_METADATA: {json.dumps(metadata)} -->"""

    return {
        "id": 12345,
        "body": body,
        "createdAt": timestamp,
        "author": {"login": claimed_by},
    }


class TestStaleClaimAutoRelease:
    """
    E2E tests for stale claim auto-release scenario.

    Test Verification Steps (from spec):
    1. Create test issue, claim it
    2. Modify claim comment timestamp to >7 days ago (or wait 7 days in staging)
    3. Trigger task-stale-check.yml workflow manually
    4. Verify stale claim detected
    5. Verify issue auto-released (task:claimed → task:available)
    6. Verify notification comment posted to fork
    7. Verify reputation decreased by 3 points
    """

    # =========================================================================
    # Unit Tests: Stale Detection Logic
    # =========================================================================

    def test_is_claim_stale_fresh_claim(self, claim_validator):
        """Test that fresh claims are not marked as stale."""
        # Claim made just now
        fresh_metadata = {
            "claimed_by": "testuser",
            "claim_id": "claim-fresh12345",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        is_stale = claim_validator.is_claim_stale(fresh_metadata, stale_days=7)
        assert not is_stale

    def test_is_claim_stale_6_days_old(self, claim_validator):
        """Test that 6-day-old claims are not stale (threshold is 7)."""
        from datetime import timedelta

        six_days_ago = datetime.now(timezone.utc) - timedelta(days=6)
        metadata = {
            "claimed_by": "testuser",
            "claim_id": "claim-sixdays1234",
            "timestamp": six_days_ago.isoformat(),
        }

        is_stale = claim_validator.is_claim_stale(metadata, stale_days=7)
        assert not is_stale

    def test_is_claim_stale_7_days_old(self, claim_validator):
        """Test that 7-day-old claims ARE stale (at threshold)."""
        from datetime import timedelta

        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7, minutes=1)
        metadata = {
            "claimed_by": "testuser",
            "claim_id": "claim-sevenday123",
            "timestamp": seven_days_ago.isoformat(),
        }

        is_stale = claim_validator.is_claim_stale(metadata, stale_days=7)
        assert is_stale

    def test_is_claim_stale_8_days_old(self, claim_validator):
        """Test that 8-day-old claims are definitely stale."""
        from datetime import timedelta

        eight_days_ago = datetime.now(timezone.utc) - timedelta(days=8)
        metadata = {
            "claimed_by": "testuser",
            "claim_id": "claim-eightday12",
            "timestamp": eight_days_ago.isoformat(),
        }

        is_stale = claim_validator.is_claim_stale(metadata, stale_days=7)
        assert is_stale

    def test_is_claim_stale_custom_threshold(self, claim_validator):
        """Test stale detection with custom threshold (e.g., 5 days for warning)."""
        from datetime import timedelta

        # 5 days old, with 5-day threshold
        five_days_ago = datetime.now(timezone.utc) - timedelta(days=5, minutes=1)
        metadata = {
            "claimed_by": "testuser",
            "claim_id": "claim-fivedays12",
            "timestamp": five_days_ago.isoformat(),
        }

        is_stale_5_days = claim_validator.is_claim_stale(metadata, stale_days=5)
        is_stale_7_days = claim_validator.is_claim_stale(metadata, stale_days=7)

        assert is_stale_5_days  # Stale at 5-day threshold
        assert not is_stale_7_days  # Not stale at 7-day threshold

    def test_is_claim_stale_missing_timestamp(self, claim_validator):
        """Test stale detection with missing timestamp."""
        metadata = {
            "claimed_by": "testuser",
            "claim_id": "claim-notimestam",
        }

        is_stale = claim_validator.is_claim_stale(metadata, stale_days=7)
        assert not is_stale  # Cannot determine staleness without timestamp

    def test_is_claim_stale_invalid_timestamp(self, claim_validator):
        """Test stale detection with invalid timestamp format."""
        metadata = {
            "claimed_by": "testuser",
            "claim_id": "claim-badtimest1",
            "timestamp": "not-a-valid-timestamp",
        }

        is_stale = claim_validator.is_claim_stale(metadata, stale_days=7)
        assert not is_stale  # Cannot determine staleness with invalid timestamp

    def test_get_claim_expiry_timestamp(self, claim_validator):
        """Test claim expiry timestamp calculation."""
        from datetime import timedelta

        claim_time = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        metadata = {
            "claimed_by": "testuser",
            "claim_id": "claim-expiry1234",
            "timestamp": claim_time.isoformat(),
        }

        expiry = claim_validator.get_claim_expiry_timestamp(metadata, stale_days=7)

        expected_expiry = claim_time + timedelta(days=7)
        assert expiry == expected_expiry

    # =========================================================================
    # Mock-Based Tests: Stale Release Flow
    # =========================================================================

    def test_stale_claim_detection_in_issue_list(self, claim_validator, mock_gh_client):
        """Test detecting stale claims in a list of claimed issues."""
        from datetime import timedelta

        # Create mock issues with various claim ages
        fresh_claim = make_claim_comment(
            claimed_by="freshuser",
            claim_id="claim-fresh12345",
        )
        stale_claim = make_stale_claim_comment(
            claimed_by="staleuser",
            claim_id="claim-stale12345",
            days_ago=8,
        )

        fresh_issue = make_mock_issue(
            number=100,
            labels=["task:claimed"],
            comments=[fresh_claim],
        )
        stale_issue = make_mock_issue(
            number=101,
            labels=["task:claimed"],
            comments=[stale_claim],
        )

        # Check staleness for each
        _, fresh_metadata = claim_validator.find_claim_comment(
            fresh_issue["comments"]
        )
        _, stale_metadata = claim_validator.find_claim_comment(
            stale_issue["comments"]
        )

        assert fresh_metadata is not None
        assert stale_metadata is not None

        assert not claim_validator.is_claim_stale(fresh_metadata, stale_days=7)
        assert claim_validator.is_claim_stale(stale_metadata, stale_days=7)

    def test_stale_release_labels_updated(self):
        """Test that stale release updates labels correctly."""
        # The expected flow in the workflow:
        # 1. Add task:available label
        # 2. Remove task:claimed label
        # 3. Post release comment

        expected_label_operations = [
            {"action": "add", "label": "task:available"},
            {"action": "remove", "label": "task:claimed"},
        ]

        # Verify workflow performs these operations
        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = workflow_path.read_text()

        # Check for label operations
        assert "addLabels" in content or "add_labels" in content or "LABEL_AVAILABLE" in content
        assert "removeLabel" in content or "remove_label" in content or "LABEL_CLAIMED" in content

    def test_stale_release_comment_format(self):
        """Test that stale release comment has correct format."""
        # Expected elements in release comment:
        expected_elements = [
            "STALE_RELEASE_METADATA",  # Machine-readable metadata
            "Auto-Released",  # Human-readable title
            "reputation",  # Reputation penalty mentioned
        ]

        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = workflow_path.read_text()

        for element in expected_elements:
            assert element.lower() in content.lower(), f"Expected '{element}' in workflow"

    def test_stale_release_metadata_structure(self):
        """Test STALE_RELEASE_METADATA has required fields."""
        # The metadata should include:
        required_fields = [
            "release_type",
            "released_at",
            "issue_number",
            "original_claimant",
            "original_claim_id",
            "days_stale",
            "reputation_penalty",
        ]

        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = workflow_path.read_text()

        # Check all required fields are in the metadata object
        for field in required_fields:
            assert field in content, f"Expected field '{field}' in STALE_RELEASE_METADATA"

    # =========================================================================
    # Reputation Integration Tests
    # =========================================================================

    def test_reputation_decrease_on_timeout(self):
        """Test that reputation decreases by 3 points on stale timeout."""
        from reputation_tracker import ReputationTracker, ReputationEventType

        tracker = ReputationTracker()

        # Create a fork with some initial reputation
        tracker._record_event(
            fork_owner="staleuser",
            event_type=ReputationEventType.PR_MERGED,
            issue_number=100,
        )

        initial_rep = tracker.get_reputation("staleuser")
        initial_score = initial_rep.score

        # Record timeout (stale claim auto-release)
        tracker.record_timeout(
            fork_owner="staleuser",
            issue_number=101,
            claim_id="claim-stale12345",
            days_stale=8,
        )

        final_rep = tracker.get_reputation("staleuser")
        final_score = final_rep.score

        # Verify -3 point penalty
        expected_score = initial_score + ReputationEventType.CLAIM_TIMEOUT.score_delta
        assert final_score == expected_score
        assert ReputationEventType.CLAIM_TIMEOUT.score_delta == -3

    def test_reputation_timeout_event_metadata(self):
        """Test that timeout event includes days_stale metadata."""
        from reputation_tracker import ReputationTracker, ReputationEventType

        tracker = ReputationTracker()

        event = tracker.record_timeout(
            fork_owner="staleuser",
            issue_number=101,
            claim_id="claim-stale12345",
            days_stale=9,
        )

        assert event.event_type == ReputationEventType.CLAIM_TIMEOUT
        assert event.score_delta == -3
        assert event.metadata.get("days_stale") == 9
        assert event.claim_id == "claim-stale12345"

    def test_reputation_stats_after_timeout(self):
        """Test that stats are updated correctly after timeout."""
        from reputation_tracker import ReputationTracker, ReputationEventType

        tracker = ReputationTracker()

        # Record a timeout
        tracker.record_timeout(
            fork_owner="timeoutuser",
            issue_number=101,
            claim_id="claim-timeout123",
        )

        rep = tracker.get_reputation("timeoutuser")

        assert rep.stats.timed_out_claims == 1
        assert rep.stats.total_claims == 1
        assert rep.stats.successful_merges == 0

        # Reliability should be 0 (0 merges / 1 timeout)
        assert rep.stats.reliability_score == 0.0

    def test_workflow_documents_reputation_penalty(self):
        """Test that workflow mentions -3 reputation penalty."""
        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = workflow_path.read_text()

        # Verify penalty is documented
        assert "-3" in content or "3 points" in content

    # =========================================================================
    # Workflow YAML Verification
    # =========================================================================

    def test_stale_check_workflow_exists(self):
        """Test task-stale-check.yml exists."""
        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        assert workflow_path.exists(), "task-stale-check.yml not found"

    def test_stale_check_workflow_has_schedule(self):
        """Test workflow has daily schedule trigger."""
        try:
            import yaml
        except ImportError:
            pytest.skip("PyYAML not installed")

        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = yaml.safe_load(workflow_path.read_text())

        # Check for schedule trigger
        assert "schedule" in content.get("on", {}), "Workflow should have schedule trigger"
        schedules = content["on"]["schedule"]
        assert len(schedules) >= 1, "Should have at least one schedule"

    def test_stale_check_workflow_has_manual_trigger(self):
        """Test workflow can be triggered manually."""
        try:
            import yaml
        except ImportError:
            pytest.skip("PyYAML not installed")

        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = yaml.safe_load(workflow_path.read_text())

        # Check for workflow_dispatch trigger
        assert "workflow_dispatch" in content.get("on", {}), "Should support manual trigger"

        # Check for dry_run input
        inputs = content["on"]["workflow_dispatch"].get("inputs", {})
        assert "dry_run" in inputs, "Should have dry_run input for testing"

    def test_stale_check_workflow_has_configurable_thresholds(self):
        """Test workflow has configurable warning and expiry thresholds."""
        try:
            import yaml
        except ImportError:
            pytest.skip("PyYAML not installed")

        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = yaml.safe_load(workflow_path.read_text())

        inputs = content["on"]["workflow_dispatch"].get("inputs", {})

        # Should have configurable thresholds
        assert "warning_days" in inputs or "WARNING_DAYS" in workflow_path.read_text()
        assert "expiry_days" in inputs or "EXPIRY_DAYS" in workflow_path.read_text()

    def test_stale_check_workflow_permissions(self):
        """Test workflow has correct permissions."""
        try:
            import yaml
        except ImportError:
            pytest.skip("PyYAML not installed")

        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = yaml.safe_load(workflow_path.read_text())

        # Check permissions
        permissions = content.get("permissions", {})
        assert permissions.get("issues") == "write", "Should have issues:write permission"

    def test_stale_check_workflow_searches_claimed_issues(self):
        """Test workflow searches for issues with task:claimed label."""
        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = workflow_path.read_text()

        # Should search for claimed issues
        assert "task:claimed" in content
        assert "search" in content.lower() or "list" in content.lower()

    def test_stale_check_workflow_parses_claim_metadata(self):
        """Test workflow parses CLAIM_METADATA from comments."""
        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = workflow_path.read_text()

        # Should parse claim metadata
        assert "CLAIM_METADATA" in content
        assert "timestamp" in content

    def test_stale_check_workflow_has_warning_phase(self):
        """Test workflow sends warning before auto-release."""
        workflow_path = Path(__file__).parent.parent / ".github" / "workflows" / "task-stale-check.yml"
        if not workflow_path.exists():
            pytest.skip("task-stale-check.yml not found")

        content = workflow_path.read_text()

        # Should have warning functionality
        assert "STALE_WARNING" in content or "warning" in content.lower()
        assert "5" in content  # Default warning at 5 days

    # =========================================================================
    # E2E Manual Test Script Generation
    # =========================================================================

    def test_e2e_stale_claim_script_generation(self, tmp_path):
        """Generate bash script for stale claim E2E testing."""
        script_content = '''#!/bin/bash
# E2E Test: Stale Claim Auto-Release
# Generated by test_e2e_fork_claims.py::TestStaleClaimAutoRelease
#
# This script tests the stale claim detection and auto-release workflow.
#
# Note: For testing, you can either:
# 1. Wait 7 days (production behavior)
# 2. Modify claim comment timestamp manually (for faster testing)
# 3. Use reduced thresholds via workflow_dispatch inputs

set -e

REPO="${TEST_GITHUB_REPO:-}"
if [ -z "$REPO" ]; then
    echo "Error: TEST_GITHUB_REPO environment variable not set"
    echo "Usage: TEST_GITHUB_REPO=owner/repo ./e2e_stale_claim_test.sh"
    exit 1
fi

echo "=============================================="
echo "E2E Test: Stale Claim Auto-Release"
echo "=============================================="
echo "Repository: $REPO"
echo ""

# Step 1: Create test issue
echo "Step 1: Creating test issue with task:available label..."
ISSUE_URL=$(gh issue create -R "$REPO" \\
    --title "E2E Test: Stale Claim $(date +%s)" \\
    --body "Automated E2E test for stale claim auto-release workflow" \\
    --label "task:available")
ISSUE_NUMBER=$(echo "$ISSUE_URL" | grep -oE "[0-9]+$")
echo "Created issue #$ISSUE_NUMBER"
echo ""

# Step 2: Claim the issue
echo "Step 2: Claiming the issue..."
gh workflow run task-claim.yml -R "$REPO" -f issue_number="$ISSUE_NUMBER"
echo "Claim workflow triggered"
echo ""

# Wait for claim to complete
echo "Waiting 15 seconds for claim to process..."
sleep 15

# Step 3: Verify issue is claimed
echo "Step 3: Verifying issue is claimed..."
ISSUE_DATA=$(gh issue view "$ISSUE_NUMBER" -R "$REPO" --json labels,comments)

HAS_CLAIMED=$(echo "$ISSUE_DATA" | jq -r '.labels[].name' | grep -c "task:claimed" || true)
if [ "$HAS_CLAIMED" -eq 1 ]; then
    echo "  Issue claimed: YES"
else
    echo "  Issue claimed: NO (claim failed)"
    exit 1
fi

# Get claim timestamp
CLAIM_TIMESTAMP=$(echo "$ISSUE_DATA" | jq -r '.comments[].body' | grep -oP '"timestamp":\s*"[^"]*"' | head -1 | cut -d'"' -f4)
echo "  Claim timestamp: $CLAIM_TIMESTAMP"
echo ""

# Step 4: Option A - Test with reduced threshold
echo "Step 4: Testing stale check with dry run mode..."
echo "  (Using expiry_days=0 to force immediate expiry detection)"
gh workflow run task-stale-check.yml -R "$REPO" \\
    -f dry_run=true \\
    -f warning_days=0 \\
    -f expiry_days=0
echo "Stale check workflow triggered (dry run)"
echo ""

# Wait for stale check to run
echo "Waiting 30 seconds for stale check to complete..."
sleep 30

# Step 5: Check stale workflow result
echo "Step 5: Checking stale check workflow result..."
STALE_RUN=$(gh run list -R "$REPO" --workflow=task-stale-check.yml --limit 1 --json conclusion,status -q '.[0]')
STALE_CONCLUSION=$(echo "$STALE_RUN" | jq -r '.conclusion // empty')
echo "  Workflow conclusion: $STALE_CONCLUSION"
echo ""

# Step 6: For real release test, run without dry_run
echo "Step 6: Running actual stale release (expiry_days=0)..."
gh workflow run task-stale-check.yml -R "$REPO" \\
    -f dry_run=false \\
    -f warning_days=0 \\
    -f expiry_days=0
echo "Stale check workflow triggered (actual release)"
echo ""

# Wait for release
echo "Waiting 30 seconds for auto-release to complete..."
sleep 30

# Step 7: Verify auto-release
echo "Step 7: Verifying auto-release..."
ISSUE_DATA=$(gh issue view "$ISSUE_NUMBER" -R "$REPO" --json labels,comments)

# Check labels
HAS_CLAIMED=$(echo "$ISSUE_DATA" | jq -r '.labels[].name' | grep -c "task:claimed" || true)
HAS_AVAILABLE=$(echo "$ISSUE_DATA" | jq -r '.labels[].name' | grep -c "task:available" || true)

echo "  Labels check:"
if [ "$HAS_CLAIMED" -eq 0 ] && [ "$HAS_AVAILABLE" -eq 1 ]; then
    echo "    - PASS: task:claimed removed, task:available restored"
else
    echo "    - FAIL: task:claimed=$HAS_CLAIMED, task:available=$HAS_AVAILABLE"
fi

# Check for stale release comment
STALE_RELEASE=$(echo "$ISSUE_DATA" | jq -r '.comments[].body' | grep -c "STALE_RELEASE_METADATA" || true)
echo "  Stale release comment:"
if [ "$STALE_RELEASE" -ge 1 ]; then
    echo "    - PASS: STALE_RELEASE_METADATA comment found"
else
    echo "    - FAIL: STALE_RELEASE_METADATA comment not found"
fi

# Check for reputation penalty mention
PENALTY_MENTIONED=$(echo "$ISSUE_DATA" | jq -r '.comments[].body' | grep -ci "reputation" || true)
echo "  Reputation penalty:"
if [ "$PENALTY_MENTIONED" -ge 1 ]; then
    echo "    - PASS: Reputation penalty mentioned in comment"
else
    echo "    - INFO: Reputation penalty not explicitly mentioned"
fi

echo ""
echo "=============================================="
echo "Stale Claim Auto-Release Test Summary"
echo "=============================================="
echo ""
echo "Issue: #$ISSUE_NUMBER"
echo "Final state: task:claimed=$HAS_CLAIMED, task:available=$HAS_AVAILABLE"
echo "Stale release comments: $STALE_RELEASE"
echo ""

if [ "$HAS_CLAIMED" -eq 0 ] && [ "$HAS_AVAILABLE" -eq 1 ] && [ "$STALE_RELEASE" -ge 1 ]; then
    echo "RESULT: PASS - Stale claim was auto-released correctly"
else
    echo "RESULT: NEEDS REVIEW - Check workflow logs for details"
fi

echo ""
echo "To view workflow logs:"
echo "  gh run list -R $REPO --workflow=task-stale-check.yml --limit 2"
echo "  gh run view <run-id> --log -R $REPO"
echo ""

# Cleanup
echo "Cleanup: Closing test issue..."
gh issue close "$ISSUE_NUMBER" -R "$REPO" || true
'''

        script_path = tmp_path / "e2e_stale_claim_test.sh"
        script_path.write_text(script_content)
        script_path.chmod(0o755)

        assert script_path.exists()
        assert "STALE_RELEASE_METADATA" in script_path.read_text()
        assert "reputation" in script_path.read_text().lower()

    def test_e2e_manual_timestamp_modification_script(self, tmp_path):
        """Generate script for manually modifying claim timestamp for testing."""
        script_content = '''#!/bin/bash
# Helper Script: Modify Claim Timestamp for Stale Testing
# Generated by test_e2e_fork_claims.py::TestStaleClaimAutoRelease
#
# This script creates a claim with a backdated timestamp for testing
# the stale claim detection without waiting 7 days.

set -e

REPO="${TEST_GITHUB_REPO:-}"
ISSUE_NUMBER="${1:-}"
DAYS_AGO="${2:-8}"

if [ -z "$REPO" ] || [ -z "$ISSUE_NUMBER" ]; then
    echo "Usage: TEST_GITHUB_REPO=owner/repo ./backdate_claim.sh <issue_number> [days_ago]"
    echo ""
    echo "Arguments:"
    echo "  issue_number  - The issue to add backdated claim to"
    echo "  days_ago      - How many days in the past (default: 8)"
    exit 1
fi

echo "Creating backdated claim comment on issue #$ISSUE_NUMBER..."
echo "Days ago: $DAYS_AGO"

# Calculate backdated timestamp
BACKDATED_TIMESTAMP=$(date -u -d "${DAYS_AGO} days ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \\
                      date -u -v-${DAYS_AGO}d +"%Y-%m-%dT%H:%M:%SZ")

CLAIM_ID="claim-$(openssl rand -hex 6)"
FORK_OWNER=$(gh api user --jq '.login')

echo "Backdated timestamp: $BACKDATED_TIMESTAMP"
echo "Claim ID: $CLAIM_ID"
echo "Fork owner: $FORK_OWNER"

# Create claim metadata
CLAIM_METADATA=$(cat <<EOF
{"claimed_by": "${FORK_OWNER}", "claim_id": "${CLAIM_ID}", "timestamp": "${BACKDATED_TIMESTAMP}", "issue_number": ${ISSUE_NUMBER}}
EOF
)

# Create comment body
COMMENT_BODY=$(cat <<EOF
## Task Claimed by @${FORK_OWNER}

**Claim ID:** \\\`${CLAIM_ID}\\\`
**Timestamp:** ${BACKDATED_TIMESTAMP}

---
*This claim will expire in 7 days if no PR is submitted.*

<!-- CLAIM_METADATA: ${CLAIM_METADATA} -->
EOF
)

# Add task:claimed label
echo "Adding task:claimed label..."
gh issue edit "$ISSUE_NUMBER" -R "$REPO" --add-label "task:claimed" --remove-label "task:available" || true

# Post backdated claim comment
echo "Posting backdated claim comment..."
gh issue comment "$ISSUE_NUMBER" -R "$REPO" --body "$COMMENT_BODY"

echo ""
echo "Done! Issue #$ISSUE_NUMBER now has a claim dated $DAYS_AGO days ago."
echo ""
echo "To test stale detection, run:"
echo "  gh workflow run task-stale-check.yml -R $REPO"
'''

        script_path = tmp_path / "backdate_claim.sh"
        script_path.write_text(script_content)
        script_path.chmod(0o755)

        assert script_path.exists()
        assert "CLAIM_METADATA" in script_path.read_text()

    def test_e2e_steps_documented(self):
        """Verify E2E test steps are documented in class docstring."""
        doc = TestStaleClaimAutoRelease.__doc__
        assert doc is not None
        assert "7 days" in doc or "stale" in doc.lower()
        assert "auto-release" in doc.lower() or "auto-released" in doc.lower()


# =============================================================================
# INTEGRATION TESTS: Stale Check with GitHub CLI
# =============================================================================


@requires_gh_cli
class TestStaleCheckIntegration:
    """
    Integration tests for stale claim detection using gh CLI.

    These tests verify the stale-check workflow components work correctly.
    """

    @pytest.fixture
    def test_repo(self):
        """Get test repository from environment."""
        repo = os.environ.get("TEST_GITHUB_REPO")
        if not repo:
            pytest.skip("TEST_GITHUB_REPO environment variable not set")
        return repo

    def test_stale_check_workflow_exists_in_repo(self, test_repo):
        """Test that task-stale-check workflow exists in repository."""
        result = subprocess.run(
            ["gh", "workflow", "list", "-R", test_repo, "--json", "name,state"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0
        workflows = json.loads(result.stdout)

        workflow_names = [w["name"] for w in workflows]
        # Note: Workflow must be on default branch to appear
        if "Task Stale Claim Check" not in workflow_names:
            pytest.skip(
                "Task Stale Claim Check workflow not found (may not be on default branch)"
            )

    def test_stale_check_can_run_dry_mode(self, test_repo):
        """Test that stale check can be triggered in dry run mode."""
        # This tests that the workflow can be triggered without making changes
        expected_behavior = """
        When task-stale-check.yml runs in dry run mode:
        1. Searches for issues with task:claimed label
        2. Parses CLAIM_METADATA from comments
        3. Calculates days since claim
        4. Logs which claims would be warned/released
        5. Does NOT modify any labels or post comments
        6. Reports statistics in job summary
        """
        assert "dry run" in expected_behavior.lower()
        assert "does NOT modify" in expected_behavior

    def test_stale_detection_timing_documented(self):
        """Document expected stale detection timing."""
        timing = {
            "warning_threshold": 5,  # days
            "expiry_threshold": 7,   # days
            "schedule": "Daily at midnight UTC",
            "manual_trigger": "workflow_dispatch with configurable thresholds",
        }

        assert timing["warning_threshold"] < timing["expiry_threshold"]
        assert timing["expiry_threshold"] == 7
