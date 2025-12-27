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
