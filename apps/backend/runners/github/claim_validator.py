"""
Claim Validation Service
========================

Validates issue claims for the distributed task coordination system.
Prevents race conditions, validates fork identity, and ensures atomic claim operations.

This module provides:
- ClaimValidator: Core validation logic for issue claims
- ClaimValidationResult: Structured result of claim validation
- ClaimError enum: Specific error types for actionable messages

Usage:
    validator = ClaimValidator(gh_client=GHClient(project_dir))
    result = await validator.validate_claim(
        issue_number=123,
        fork_owner="user",
        actor="user",
    )

    if result.is_valid:
        # Proceed with claim
        pass
    else:
        # Handle error
        print(result.error_message)
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class ClaimError(str, Enum):
    """Specific error types for claim validation failures."""

    # Label state errors
    MISSING_AVAILABLE_LABEL = "missing_available_label"
    ALREADY_CLAIMED = "already_claimed"
    CONFLICTING_LABELS = "conflicting_labels"

    # Identity errors
    IDENTITY_MISMATCH = "identity_mismatch"
    INVALID_FORK_OWNER = "invalid_fork_owner"

    # Issue state errors
    ISSUE_NOT_FOUND = "issue_not_found"
    ISSUE_CLOSED = "issue_closed"

    # Race condition errors
    RACE_CONDITION_DETECTED = "race_condition_detected"
    CLAIM_MODIFIED = "claim_modified"

    # Permission errors
    RELEASE_NOT_OWNER = "release_not_owner"
    INVALID_CLAIM_ID = "invalid_claim_id"

    # Network/API errors
    API_ERROR = "api_error"
    TIMEOUT = "timeout"

    @property
    def user_message(self) -> str:
        """Get user-friendly error message."""
        messages = {
            ClaimError.MISSING_AVAILABLE_LABEL: (
                "Issue does not have the 'task:available' label. "
                "Only issues marked as available can be claimed."
            ),
            ClaimError.ALREADY_CLAIMED: (
                "Issue has already been claimed by another fork. "
                "Please choose a different issue or wait for the claim to expire."
            ),
            ClaimError.CONFLICTING_LABELS: (
                "Issue has conflicting labels (both available and claimed). "
                "This may indicate a system error. Please contact a maintainer."
            ),
            ClaimError.IDENTITY_MISMATCH: (
                "The fork owner does not match the GitHub actor. "
                "You can only claim issues for your own fork."
            ),
            ClaimError.INVALID_FORK_OWNER: (
                "Invalid fork owner specified. "
                "Fork owner must be a valid GitHub username."
            ),
            ClaimError.ISSUE_NOT_FOUND: (
                "Issue not found. Please verify the issue number exists."
            ),
            ClaimError.ISSUE_CLOSED: (
                "Issue is closed and cannot be claimed. "
                "Only open issues can be claimed."
            ),
            ClaimError.RACE_CONDITION_DETECTED: (
                "Race condition detected - another fork claimed this issue first. "
                "Please choose a different issue."
            ),
            ClaimError.CLAIM_MODIFIED: (
                "Claim state changed during validation. "
                "Please retry the operation."
            ),
            ClaimError.RELEASE_NOT_OWNER: (
                "You cannot release this claim because you are not the owner. "
                "Only the fork that claimed an issue can release it."
            ),
            ClaimError.INVALID_CLAIM_ID: (
                "Invalid or missing claim ID. "
                "Cannot validate claim without a valid claim identifier."
            ),
            ClaimError.API_ERROR: (
                "GitHub API error occurred. Please try again later."
            ),
            ClaimError.TIMEOUT: (
                "Request timed out. Please try again."
            ),
        }
        return messages.get(self, "An unknown error occurred.")


@dataclass
class ClaimValidationResult:
    """Result of claim validation."""

    is_valid: bool
    issue_number: int
    fork_owner: str
    error: ClaimError | None = None
    error_message: str | None = None
    claim_id: str | None = None
    existing_claim: dict[str, Any] | None = None
    issue_data: dict[str, Any] | None = None
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "is_valid": self.is_valid,
            "issue_number": self.issue_number,
            "fork_owner": self.fork_owner,
            "error": self.error.value if self.error else None,
            "error_message": self.error_message,
            "claim_id": self.claim_id,
            "existing_claim": self.existing_claim,
            "warnings": self.warnings,
        }

    @classmethod
    def success(
        cls,
        issue_number: int,
        fork_owner: str,
        claim_id: str,
        issue_data: dict[str, Any] | None = None,
        warnings: list[str] | None = None,
    ) -> ClaimValidationResult:
        """Create a successful validation result."""
        return cls(
            is_valid=True,
            issue_number=issue_number,
            fork_owner=fork_owner,
            claim_id=claim_id,
            issue_data=issue_data,
            warnings=warnings or [],
        )

    @classmethod
    def failure(
        cls,
        issue_number: int,
        fork_owner: str,
        error: ClaimError,
        error_message: str | None = None,
        existing_claim: dict[str, Any] | None = None,
    ) -> ClaimValidationResult:
        """Create a failed validation result."""
        return cls(
            is_valid=False,
            issue_number=issue_number,
            fork_owner=fork_owner,
            error=error,
            error_message=error_message or error.user_message,
            existing_claim=existing_claim,
        )


@dataclass
class ReleaseValidationResult:
    """Result of release validation."""

    is_valid: bool
    issue_number: int
    fork_owner: str
    claim_id: str | None = None
    error: ClaimError | None = None
    error_message: str | None = None
    claim_owner: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "is_valid": self.is_valid,
            "issue_number": self.issue_number,
            "fork_owner": self.fork_owner,
            "claim_id": self.claim_id,
            "error": self.error.value if self.error else None,
            "error_message": self.error_message,
            "claim_owner": self.claim_owner,
        }


class ClaimValidator:
    """
    Validates issue claims for distributed task coordination.

    Implements the check-then-act pattern with race condition detection.

    Usage:
        validator = ClaimValidator(gh_client=GHClient(project_dir))

        # Validate a new claim
        result = await validator.validate_claim(
            issue_number=123,
            fork_owner="user",
            actor="user",
        )

        # Validate a release
        release_result = await validator.validate_release(
            issue_number=123,
            fork_owner="user",
            actor="user",
        )

        # Check if claim is idempotent (same fork claiming again)
        is_idempotent = await validator.is_idempotent_claim(
            issue_number=123,
            fork_owner="user",
        )
    """

    # Label constants
    LABEL_AVAILABLE = "task:available"
    LABEL_CLAIMED = "task:claimed"

    # Username validation pattern
    USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$")

    # Claim metadata patterns for parsing comments
    CLAIM_METADATA_PATTERN = re.compile(
        r"<!--\s*CLAIM_METADATA:\s*(\{.*?\})\s*-->", re.DOTALL
    )
    CLAIM_ID_PATTERN = re.compile(r"claim-[a-f0-9]{12}")

    def __init__(self, gh_client: Any = None):
        """
        Initialize claim validator.

        Args:
            gh_client: GHClient instance for GitHub API calls.
                      If None, validation will be done without API calls (testing mode).
        """
        self.gh_client = gh_client

    def generate_claim_id(self) -> str:
        """Generate a unique claim ID."""
        return f"claim-{uuid.uuid4().hex[:12]}"

    def validate_username(self, username: str) -> bool:
        """
        Validate GitHub username format.

        Args:
            username: Username to validate

        Returns:
            True if valid GitHub username format
        """
        if not username:
            return False
        return bool(self.USERNAME_PATTERN.match(username))

    def extract_labels(self, issue_data: dict[str, Any]) -> list[str]:
        """
        Extract label names from issue data.

        Args:
            issue_data: Issue data from GitHub API

        Returns:
            List of label names
        """
        labels = issue_data.get("labels", [])
        if not labels:
            return []

        # Labels can be strings or dicts with 'name' key
        result = []
        for label in labels:
            if isinstance(label, str):
                result.append(label)
            elif isinstance(label, dict):
                name = label.get("name")
                if name:
                    result.append(name)
        return result

    def parse_claim_metadata(self, comment_body: str) -> dict[str, Any] | None:
        """
        Parse claim metadata from a GitHub comment body.

        Expects JSON in an HTML comment: <!-- CLAIM_METADATA: {...} -->

        Args:
            comment_body: The comment body text

        Returns:
            Parsed metadata dict, or None if not found/invalid
        """
        match = self.CLAIM_METADATA_PATTERN.search(comment_body)
        if not match:
            return None

        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse claim metadata JSON")
            return None

    def find_claim_comment(
        self, comments: list[dict[str, Any]]
    ) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        """
        Find the most recent claim comment with valid metadata.

        Args:
            comments: List of comment dicts from GitHub API

        Returns:
            Tuple of (comment_data, claim_metadata) or (None, None) if not found
        """
        # Sort by created_at descending to get most recent first
        sorted_comments = sorted(
            comments,
            key=lambda c: c.get("createdAt", c.get("created_at", "")),
            reverse=True,
        )

        for comment in sorted_comments:
            body = comment.get("body", "")
            metadata = self.parse_claim_metadata(body)
            if metadata and metadata.get("claim_id"):
                return comment, metadata

        return None, None

    async def get_issue_state(
        self, issue_number: int
    ) -> tuple[dict[str, Any] | None, str | None]:
        """
        Get current issue state from GitHub.

        Args:
            issue_number: Issue number to fetch

        Returns:
            Tuple of (issue_data, error_message) or (None, error) if failed
        """
        if not self.gh_client:
            logger.warning("No GH client available, returning None")
            return None, "No GitHub client configured"

        try:
            issue_data = await self.gh_client.issue_get(
                issue_number,
                json_fields=["number", "title", "state", "labels", "comments"],
            )
            return issue_data, None
        except Exception as e:
            logger.error(f"Failed to get issue #{issue_number}: {e}")
            return None, str(e)

    async def validate_claim(
        self,
        issue_number: int,
        fork_owner: str,
        actor: str,
    ) -> ClaimValidationResult:
        """
        Validate a new claim attempt.

        Checks:
        1. Fork owner is valid GitHub username
        2. Actor matches fork owner (identity verification)
        3. Issue exists and is open
        4. Issue has task:available label
        5. Issue does not have task:claimed label
        6. No existing valid claim comment

        Args:
            issue_number: Issue number to claim
            fork_owner: Username of the fork owner
            actor: GitHub actor (github.actor from Actions)

        Returns:
            ClaimValidationResult with validation outcome
        """
        # Step 1: Validate username format
        if not self.validate_username(fork_owner):
            return ClaimValidationResult.failure(
                issue_number=issue_number,
                fork_owner=fork_owner,
                error=ClaimError.INVALID_FORK_OWNER,
                error_message=f"Invalid fork owner: '{fork_owner}' is not a valid GitHub username.",
            )

        # Step 2: Validate actor matches fork owner
        if actor.lower() != fork_owner.lower():
            return ClaimValidationResult.failure(
                issue_number=issue_number,
                fork_owner=fork_owner,
                error=ClaimError.IDENTITY_MISMATCH,
                error_message=(
                    f"Identity mismatch: actor '{actor}' does not match "
                    f"fork owner '{fork_owner}'. You can only claim for your own fork."
                ),
            )

        # Step 3: Get issue state
        issue_data, error = await self.get_issue_state(issue_number)
        if issue_data is None:
            if "not found" in (error or "").lower():
                return ClaimValidationResult.failure(
                    issue_number=issue_number,
                    fork_owner=fork_owner,
                    error=ClaimError.ISSUE_NOT_FOUND,
                )
            return ClaimValidationResult.failure(
                issue_number=issue_number,
                fork_owner=fork_owner,
                error=ClaimError.API_ERROR,
                error_message=f"Failed to fetch issue: {error}",
            )

        # Step 4: Check issue is open
        state = issue_data.get("state", "").lower()
        if state != "open":
            return ClaimValidationResult.failure(
                issue_number=issue_number,
                fork_owner=fork_owner,
                error=ClaimError.ISSUE_CLOSED,
                error_message=f"Issue #{issue_number} is {state}, not open.",
            )

        # Step 5: Check labels
        labels = self.extract_labels(issue_data)
        has_available = self.LABEL_AVAILABLE in labels
        has_claimed = self.LABEL_CLAIMED in labels

        # Check for conflicting labels
        if has_available and has_claimed:
            return ClaimValidationResult.failure(
                issue_number=issue_number,
                fork_owner=fork_owner,
                error=ClaimError.CONFLICTING_LABELS,
                error_message=(
                    f"Issue #{issue_number} has conflicting labels: "
                    f"both '{self.LABEL_AVAILABLE}' and '{self.LABEL_CLAIMED}'. "
                    "Please contact a maintainer."
                ),
            )

        # Check if already claimed
        if has_claimed:
            # Try to get existing claim details
            existing_claim = await self._get_existing_claim(issue_data)

            # Check for idempotent claim (same fork claiming again)
            if existing_claim and existing_claim.get("claimed_by", "").lower() == fork_owner.lower():
                return ClaimValidationResult.success(
                    issue_number=issue_number,
                    fork_owner=fork_owner,
                    claim_id=existing_claim.get("claim_id", ""),
                    issue_data=issue_data,
                    warnings=["Issue already claimed by this fork (idempotent claim)."],
                )

            return ClaimValidationResult.failure(
                issue_number=issue_number,
                fork_owner=fork_owner,
                error=ClaimError.ALREADY_CLAIMED,
                existing_claim=existing_claim,
                error_message=(
                    f"Issue #{issue_number} has already been claimed"
                    + (f" by @{existing_claim.get('claimed_by')}" if existing_claim else "")
                    + ". Please choose a different issue."
                ),
            )

        # Check if available label is present
        if not has_available:
            return ClaimValidationResult.failure(
                issue_number=issue_number,
                fork_owner=fork_owner,
                error=ClaimError.MISSING_AVAILABLE_LABEL,
                error_message=(
                    f"Issue #{issue_number} does not have the '{self.LABEL_AVAILABLE}' label. "
                    f"Current labels: {', '.join(labels) or 'none'}"
                ),
            )

        # Step 6: Generate claim ID and return success
        claim_id = self.generate_claim_id()

        return ClaimValidationResult.success(
            issue_number=issue_number,
            fork_owner=fork_owner,
            claim_id=claim_id,
            issue_data=issue_data,
        )

    async def _get_existing_claim(
        self, issue_data: dict[str, Any]
    ) -> dict[str, Any] | None:
        """
        Get existing claim metadata from issue comments.

        Args:
            issue_data: Issue data with comments

        Returns:
            Claim metadata dict or None
        """
        comments = issue_data.get("comments", [])
        if not comments:
            return None

        _, metadata = self.find_claim_comment(comments)
        return metadata

    async def validate_release(
        self,
        issue_number: int,
        fork_owner: str,
        actor: str,
    ) -> ReleaseValidationResult:
        """
        Validate a release attempt.

        Checks:
        1. Actor matches fork owner
        2. Issue exists
        3. Issue has task:claimed label
        4. Fork owner matches the original claimer

        Args:
            issue_number: Issue number to release
            fork_owner: Username of the fork owner attempting release
            actor: GitHub actor (github.actor from Actions)

        Returns:
            ReleaseValidationResult with validation outcome
        """
        # Step 1: Validate actor matches fork owner
        if actor.lower() != fork_owner.lower():
            return ReleaseValidationResult(
                is_valid=False,
                issue_number=issue_number,
                fork_owner=fork_owner,
                error=ClaimError.IDENTITY_MISMATCH,
                error_message=(
                    f"Identity mismatch: actor '{actor}' does not match "
                    f"fork owner '{fork_owner}'."
                ),
            )

        # Step 2: Get issue state
        issue_data, error = await self.get_issue_state(issue_number)
        if issue_data is None:
            return ReleaseValidationResult(
                is_valid=False,
                issue_number=issue_number,
                fork_owner=fork_owner,
                error=ClaimError.API_ERROR,
                error_message=f"Failed to fetch issue: {error}",
            )

        # Step 3: Check if issue is claimed
        labels = self.extract_labels(issue_data)
        if self.LABEL_CLAIMED not in labels:
            return ReleaseValidationResult(
                is_valid=False,
                issue_number=issue_number,
                fork_owner=fork_owner,
                error=ClaimError.MISSING_AVAILABLE_LABEL,
                error_message=(
                    f"Issue #{issue_number} is not claimed "
                    f"(missing '{self.LABEL_CLAIMED}' label)."
                ),
            )

        # Step 4: Check claim owner
        existing_claim = await self._get_existing_claim(issue_data)
        if existing_claim:
            claim_owner = existing_claim.get("claimed_by", "")
            claim_id = existing_claim.get("claim_id", "")

            if claim_owner.lower() != fork_owner.lower():
                return ReleaseValidationResult(
                    is_valid=False,
                    issue_number=issue_number,
                    fork_owner=fork_owner,
                    error=ClaimError.RELEASE_NOT_OWNER,
                    error_message=(
                        f"Cannot release claim: issue was claimed by @{claim_owner}, "
                        f"not @{fork_owner}."
                    ),
                    claim_owner=claim_owner,
                )

            return ReleaseValidationResult(
                is_valid=True,
                issue_number=issue_number,
                fork_owner=fork_owner,
                claim_id=claim_id,
                claim_owner=claim_owner,
            )

        # No claim metadata found but label exists - allow release by anyone (recovery mode)
        logger.warning(
            f"Issue #{issue_number} has claimed label but no claim metadata. "
            "Allowing release for recovery."
        )
        return ReleaseValidationResult(
            is_valid=True,
            issue_number=issue_number,
            fork_owner=fork_owner,
            claim_owner=None,
        )

    async def verify_claim_after_action(
        self,
        issue_number: int,
        expected_fork_owner: str,
        expected_claim_id: str,
    ) -> tuple[bool, str | None]:
        """
        Verify claim state after claiming action (race condition check).

        This implements the second check in check-then-act pattern.
        Call this after adding labels/comments to detect if another fork
        claimed the issue between our check and action.

        Args:
            issue_number: Issue number that was claimed
            expected_fork_owner: Expected claim owner
            expected_claim_id: Expected claim ID

        Returns:
            Tuple of (is_valid, error_message)
        """
        issue_data, error = await self.get_issue_state(issue_number)
        if issue_data is None:
            return False, f"Failed to verify claim: {error}"

        # Verify claimed label is present
        labels = self.extract_labels(issue_data)
        if self.LABEL_CLAIMED not in labels:
            return False, "Claim label not present after action"

        # Verify claim metadata matches
        existing_claim = await self._get_existing_claim(issue_data)
        if not existing_claim:
            return False, "No claim metadata found after action"

        actual_owner = existing_claim.get("claimed_by", "")
        actual_claim_id = existing_claim.get("claim_id", "")

        if actual_owner.lower() != expected_fork_owner.lower():
            return False, (
                f"Race condition: claim owner is @{actual_owner}, "
                f"expected @{expected_fork_owner}"
            )

        if actual_claim_id != expected_claim_id:
            return False, (
                f"Race condition: claim ID is {actual_claim_id}, "
                f"expected {expected_claim_id}"
            )

        return True, None

    async def is_idempotent_claim(
        self,
        issue_number: int,
        fork_owner: str,
    ) -> bool:
        """
        Check if a claim would be idempotent (same fork already claimed).

        Args:
            issue_number: Issue number to check
            fork_owner: Fork owner to check

        Returns:
            True if issue is already claimed by this fork owner
        """
        issue_data, _ = await self.get_issue_state(issue_number)
        if not issue_data:
            return False

        labels = self.extract_labels(issue_data)
        if self.LABEL_CLAIMED not in labels:
            return False

        existing_claim = await self._get_existing_claim(issue_data)
        if not existing_claim:
            return False

        return existing_claim.get("claimed_by", "").lower() == fork_owner.lower()

    def get_claim_expiry_timestamp(
        self, claim_metadata: dict[str, Any], stale_days: int = 7
    ) -> datetime | None:
        """
        Calculate when a claim expires based on its timestamp.

        Args:
            claim_metadata: Claim metadata dict
            stale_days: Number of days until claim is considered stale

        Returns:
            Expiry datetime or None if timestamp not found
        """
        timestamp_str = claim_metadata.get("timestamp")
        if not timestamp_str:
            return None

        try:
            claim_time = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
            from datetime import timedelta
            return claim_time + timedelta(days=stale_days)
        except (ValueError, TypeError):
            return None

    def is_claim_stale(
        self, claim_metadata: dict[str, Any], stale_days: int = 7
    ) -> bool:
        """
        Check if a claim is stale (past expiry).

        Args:
            claim_metadata: Claim metadata dict
            stale_days: Number of days until claim is considered stale

        Returns:
            True if claim is stale
        """
        expiry = self.get_claim_expiry_timestamp(claim_metadata, stale_days)
        if not expiry:
            return False

        now = datetime.now(timezone.utc)
        return now > expiry

    def format_error_comment(
        self,
        error: ClaimError,
        fork_owner: str,
        issue_number: int,
        details: str | None = None,
    ) -> str:
        """
        Format an error comment for posting to GitHub.

        Args:
            error: The error type
            fork_owner: Fork owner who encountered the error
            issue_number: Issue number
            details: Additional details

        Returns:
            Formatted comment body
        """
        lines = [
            f"## Claim Failed for @{fork_owner}",
            "",
            f"**Error:** {error.user_message}",
        ]

        if details:
            lines.extend(["", f"**Details:** {details}"])

        lines.extend([
            "",
            "---",
            "*If you believe this is an error, please contact a maintainer.*",
        ])

        return "\n".join(lines)
