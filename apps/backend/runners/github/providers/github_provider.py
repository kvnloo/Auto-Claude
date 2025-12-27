"""
GitHub Provider Implementation
==============================

Implements the GitProvider protocol for GitHub using the gh CLI.
Wraps the existing GHClient functionality.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

# Import from parent package or direct import
try:
    from ..gh_client import GHClient
except (ImportError, ValueError, SystemError):
    from gh_client import GHClient

try:
    from .protocol import (
        IssueData,
        IssueFilters,
        LabelData,
        PRData,
        PRFilters,
        ProviderType,
        ReviewData,
    )
except (ImportError, ValueError, SystemError):
    from protocol import (
        IssueData,
        IssueFilters,
        LabelData,
        PRData,
        PRFilters,
        ProviderType,
        ReviewData,
    )

import re


@dataclass
class PRClaimMetadata:
    """
    Claim metadata associated with a pull request.

    Contains information about the fork that claimed the related issue
    and submitted this PR.
    """

    claimed_by: str | None = None  # Fork owner who claimed the issue
    claim_id: str | None = None  # Unique claim identifier
    fork_reputation: dict[str, Any] | None = None  # Reputation at claim time
    claim_timestamp: str | None = None  # When the claim was made
    linked_issue: int | None = None  # Issue number this PR addresses
    source: str = "unknown"  # Where metadata was found: "pr_body", "issue_comment"

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "claimed_by": self.claimed_by,
            "claim_id": self.claim_id,
            "fork_reputation": self.fork_reputation,
            "claim_timestamp": self.claim_timestamp,
            "linked_issue": self.linked_issue,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PRClaimMetadata":
        """Create from dictionary."""
        return cls(
            claimed_by=data.get("claimed_by"),
            claim_id=data.get("claim_id"),
            fork_reputation=data.get("fork_reputation"),
            claim_timestamp=data.get("claim_timestamp") or data.get("timestamp"),
            linked_issue=data.get("linked_issue") or data.get("issue_number"),
            source=data.get("source", "unknown"),
        )


@dataclass
class GitHubProvider:
    """
    GitHub implementation of the GitProvider protocol.

    Uses the gh CLI for all operations.

    Usage:
        provider = GitHubProvider(repo="owner/repo")
        pr = await provider.fetch_pr(123)
        await provider.post_review(123, review)
    """

    _repo: str
    _gh_client: GHClient | None = None
    _project_dir: str | None = None
    enable_rate_limiting: bool = True

    def __post_init__(self):
        if self._gh_client is None:
            from pathlib import Path

            project_dir = Path(self._project_dir) if self._project_dir else Path.cwd()
            self._gh_client = GHClient(
                project_dir=project_dir,
                enable_rate_limiting=self.enable_rate_limiting,
            )

    @property
    def provider_type(self) -> ProviderType:
        return ProviderType.GITHUB

    @property
    def repo(self) -> str:
        return self._repo

    @property
    def gh_client(self) -> GHClient:
        """Get the underlying GHClient."""
        return self._gh_client

    # -------------------------------------------------------------------------
    # Pull Request Operations
    # -------------------------------------------------------------------------

    async def fetch_pr(self, number: int) -> PRData:
        """Fetch a pull request by number."""
        fields = [
            "number",
            "title",
            "body",
            "author",
            "state",
            "headRefName",
            "baseRefName",
            "additions",
            "deletions",
            "changedFiles",
            "files",
            "url",
            "createdAt",
            "updatedAt",
            "labels",
            "reviewRequests",
            "isDraft",
            "mergeable",
        ]

        pr_data = await self._gh_client.pr_get(number, json_fields=fields)
        diff = await self._gh_client.pr_diff(number)

        return self._parse_pr_data(pr_data, diff)

    async def fetch_prs(self, filters: PRFilters | None = None) -> list[PRData]:
        """Fetch pull requests with optional filters."""
        filters = filters or PRFilters()

        prs = await self._gh_client.pr_list(
            state=filters.state,
            limit=filters.limit,
            json_fields=[
                "number",
                "title",
                "author",
                "state",
                "headRefName",
                "baseRefName",
                "labels",
                "url",
                "createdAt",
                "updatedAt",
            ],
        )

        result = []
        for pr_data in prs:
            # Apply additional filters
            if (
                filters.author
                and pr_data.get("author", {}).get("login") != filters.author
            ):
                continue
            if (
                filters.base_branch
                and pr_data.get("baseRefName") != filters.base_branch
            ):
                continue
            if (
                filters.head_branch
                and pr_data.get("headRefName") != filters.head_branch
            ):
                continue
            if filters.labels:
                pr_labels = [label.get("name") for label in pr_data.get("labels", [])]
                if not all(label in pr_labels for label in filters.labels):
                    continue

            # Parse to PRData (lightweight, no diff)
            result.append(self._parse_pr_data(pr_data, ""))

        return result

    async def fetch_pr_diff(self, number: int) -> str:
        """Fetch the diff for a pull request."""
        return await self._gh_client.pr_diff(number)

    async def post_review(self, pr_number: int, review: ReviewData) -> int:
        """Post a review to a pull request."""
        return await self._gh_client.pr_review(
            pr_number=pr_number,
            body=review.body,
            event=review.event.upper(),
        )

    async def merge_pr(
        self,
        pr_number: int,
        merge_method: str = "merge",
        commit_title: str | None = None,
    ) -> bool:
        """Merge a pull request."""
        cmd = ["pr", "merge", str(pr_number)]

        if merge_method == "squash":
            cmd.append("--squash")
        elif merge_method == "rebase":
            cmd.append("--rebase")
        else:
            cmd.append("--merge")

        if commit_title:
            cmd.extend(["--subject", commit_title])

        cmd.append("--yes")

        try:
            await self._gh_client._run_gh_command(cmd)
            return True
        except Exception:
            return False

    async def close_pr(
        self,
        pr_number: int,
        comment: str | None = None,
    ) -> bool:
        """Close a pull request without merging."""
        try:
            if comment:
                await self.add_comment(pr_number, comment)
            await self._gh_client._run_gh_command(["pr", "close", str(pr_number)])
            return True
        except Exception:
            return False

    # -------------------------------------------------------------------------
    # Issue Operations
    # -------------------------------------------------------------------------

    async def fetch_issue(self, number: int) -> IssueData:
        """Fetch an issue by number."""
        fields = [
            "number",
            "title",
            "body",
            "author",
            "state",
            "labels",
            "createdAt",
            "updatedAt",
            "url",
            "assignees",
            "milestone",
        ]

        issue_data = await self._gh_client.issue_get(number, json_fields=fields)
        return self._parse_issue_data(issue_data)

    async def fetch_issues(
        self, filters: IssueFilters | None = None
    ) -> list[IssueData]:
        """Fetch issues with optional filters."""
        filters = filters or IssueFilters()

        issues = await self._gh_client.issue_list(
            state=filters.state,
            limit=filters.limit,
            json_fields=[
                "number",
                "title",
                "body",
                "author",
                "state",
                "labels",
                "createdAt",
                "updatedAt",
                "url",
                "assignees",
                "milestone",
            ],
        )

        result = []
        for issue_data in issues:
            # Filter out PRs if requested
            if not filters.include_prs and "pullRequest" in issue_data:
                continue

            # Apply filters
            if (
                filters.author
                and issue_data.get("author", {}).get("login") != filters.author
            ):
                continue
            if filters.labels:
                issue_labels = [
                    label.get("name") for label in issue_data.get("labels", [])
                ]
                if not all(label in issue_labels for label in filters.labels):
                    continue

            result.append(self._parse_issue_data(issue_data))

        return result

    async def create_issue(
        self,
        title: str,
        body: str,
        labels: list[str] | None = None,
        assignees: list[str] | None = None,
    ) -> IssueData:
        """Create a new issue."""
        cmd = ["issue", "create", "--title", title, "--body", body]

        if labels:
            for label in labels:
                cmd.extend(["--label", label])

        if assignees:
            for assignee in assignees:
                cmd.extend(["--assignee", assignee])

        result = await self._gh_client._run_gh_command(cmd)

        # Parse the issue URL to get the number
        # gh issue create outputs the URL
        url = result.strip()
        number = int(url.split("/")[-1])

        return await self.fetch_issue(number)

    async def close_issue(
        self,
        number: int,
        comment: str | None = None,
    ) -> bool:
        """Close an issue."""
        try:
            if comment:
                await self.add_comment(number, comment)
            await self._gh_client._run_gh_command(["issue", "close", str(number)])
            return True
        except Exception:
            return False

    async def add_comment(
        self,
        issue_or_pr_number: int,
        body: str,
    ) -> int:
        """Add a comment to an issue or PR."""
        await self._gh_client.issue_comment(issue_or_pr_number, body)
        # gh CLI doesn't return comment ID, return 0
        return 0

    # -------------------------------------------------------------------------
    # Label Operations
    # -------------------------------------------------------------------------

    async def apply_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """Apply labels to an issue or PR."""
        await self._gh_client.issue_add_labels(issue_or_pr_number, labels)

    async def remove_labels(
        self,
        issue_or_pr_number: int,
        labels: list[str],
    ) -> None:
        """Remove labels from an issue or PR."""
        await self._gh_client.issue_remove_labels(issue_or_pr_number, labels)

    async def create_label(self, label: LabelData) -> None:
        """Create a label in the repository."""
        cmd = ["label", "create", label.name, "--color", label.color]
        if label.description:
            cmd.extend(["--description", label.description])
        cmd.append("--force")  # Update if exists

        await self._gh_client._run_gh_command(cmd)

    async def list_labels(self) -> list[LabelData]:
        """List all labels in the repository."""
        result = await self._gh_client._run_gh_command(
            [
                "label",
                "list",
                "--json",
                "name,color,description",
            ]
        )

        labels_data = json.loads(result) if result else []
        return [
            LabelData(
                name=label["name"],
                color=label.get("color", ""),
                description=label.get("description", ""),
            )
            for label in labels_data
        ]

    # -------------------------------------------------------------------------
    # Repository Operations
    # -------------------------------------------------------------------------

    async def get_repository_info(self) -> dict[str, Any]:
        """Get repository information."""
        return await self._gh_client.api_get(f"/repos/{self._repo}")

    async def get_default_branch(self) -> str:
        """Get the default branch name."""
        repo_info = await self.get_repository_info()
        return repo_info.get("default_branch", "main")

    async def check_permissions(self, username: str) -> str:
        """Check a user's permission level on the repository."""
        try:
            result = await self._gh_client.api_get(
                f"/repos/{self._repo}/collaborators/{username}/permission"
            )
            return result.get("permission", "none")
        except Exception:
            return "none"

    # -------------------------------------------------------------------------
    # API Operations
    # -------------------------------------------------------------------------

    async def api_get(
        self,
        endpoint: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Make a GET request to the GitHub API."""
        return await self._gh_client.api_get(endpoint, params)

    async def api_post(
        self,
        endpoint: str,
        data: dict[str, Any] | None = None,
    ) -> Any:
        """Make a POST request to the GitHub API."""
        return await self._gh_client.api_post(endpoint, data)

    # -------------------------------------------------------------------------
    # PR Claim Metadata Operations
    # -------------------------------------------------------------------------

    # Pattern for extracting issue references from PR body
    # Matches: Fixes #123, Closes #456, Resolves #789, etc.
    _ISSUE_REFERENCE_PATTERN = re.compile(
        r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*[:#]?\s*#?(\d+)",
        re.IGNORECASE,
    )

    # Pattern for Claimed-By field in PR body
    # Handles: Claimed-By: @user, **Claimed-By:** @user, - **Claimed-By:** @user
    _CLAIMED_BY_PATTERN = re.compile(
        r"\*{0,2}Claimed-By:?\*{0,2}\s*@?(\S+)",
        re.IGNORECASE,
    )

    # Pattern for Claim-ID field in PR body
    # Handles: Claim-ID: id, **Claim-ID:** `id`, - **Claim-ID:** `claim-abc`
    _CLAIM_ID_PATTERN = re.compile(
        r"\*{0,2}Claim-ID:?\*{0,2}\s*`?([a-zA-Z0-9-]+)`?",
        re.IGNORECASE,
    )

    def extract_linked_issues(self, pr_body: str) -> list[int]:
        """
        Extract linked issue numbers from a PR body.

        Looks for patterns like:
        - Fixes #123
        - Closes #456
        - Resolves #789
        - fixes: #123
        - close: 456

        Args:
            pr_body: The PR body/description text

        Returns:
            List of unique issue numbers found
        """
        if not pr_body:
            return []

        matches = self._ISSUE_REFERENCE_PATTERN.findall(pr_body)
        # Return unique issue numbers
        return list(set(int(m) for m in matches))

    def parse_pr_body_claim_fields(self, pr_body: str) -> dict[str, Any]:
        """
        Parse claim-related fields from a PR body.

        Looks for:
        - Claimed-By: @username
        - Claim-ID: claim-abc123

        Args:
            pr_body: The PR body/description text

        Returns:
            Dict with parsed fields (may be empty or partial)
        """
        result: dict[str, Any] = {}

        if not pr_body:
            return result

        # Look for Claimed-By field
        claimed_by_match = self._CLAIMED_BY_PATTERN.search(pr_body)
        if claimed_by_match:
            result["claimed_by"] = claimed_by_match.group(1)

        # Look for Claim-ID field
        claim_id_match = self._CLAIM_ID_PATTERN.search(pr_body)
        if claim_id_match:
            result["claim_id"] = claim_id_match.group(1)

        # Also try to parse embedded CLAIM_METADATA JSON (same format as issue comments)
        metadata = self._gh_client.parse_claim_metadata(pr_body)
        if metadata:
            # Merge with any fields found above (explicit fields take precedence)
            for key, value in metadata.items():
                if key not in result:
                    result[key] = value

        return result

    async def get_pr_claim_metadata(self, pr_number: int) -> PRClaimMetadata:
        """
        Get claim metadata for a pull request.

        Attempts to find claim information from:
        1. PR body (Claimed-By, Claim-ID fields or embedded CLAIM_METADATA)
        2. Linked issue comments (if issue is referenced in PR)

        Args:
            pr_number: PR number to get claim metadata for

        Returns:
            PRClaimMetadata with available claim information
            (fields may be None if not found)
        """
        # Fetch PR data including body
        pr_data = await self._gh_client.pr_get(
            pr_number,
            json_fields=["number", "title", "body", "author"],
        )

        pr_body = pr_data.get("body", "") or ""
        pr_author = pr_data.get("author", {})
        if isinstance(pr_author, dict):
            pr_author_login = pr_author.get("login", "")
        else:
            pr_author_login = str(pr_author) if pr_author else ""

        # First, try to parse claim fields from PR body
        body_fields = self.parse_pr_body_claim_fields(pr_body)

        if body_fields.get("claim_id"):
            # Found claim metadata in PR body
            return PRClaimMetadata(
                claimed_by=body_fields.get("claimed_by", pr_author_login),
                claim_id=body_fields.get("claim_id"),
                fork_reputation=body_fields.get("fork_reputation"),
                claim_timestamp=body_fields.get("timestamp"),
                linked_issue=body_fields.get("issue_number"),
                source="pr_body",
            )

        # Extract linked issues from PR body
        linked_issues = self.extract_linked_issues(pr_body)

        # Try to find claim metadata from linked issue comments
        for issue_number in linked_issues:
            try:
                claim_status = await self._gh_client.get_claim_status(issue_number)
                claim_metadata = claim_status.get("claim_metadata")

                if claim_metadata and claim_metadata.get("claim_id"):
                    return PRClaimMetadata(
                        claimed_by=claim_metadata.get("claimed_by"),
                        claim_id=claim_metadata.get("claim_id"),
                        fork_reputation=claim_metadata.get("fork_reputation"),
                        claim_timestamp=claim_metadata.get("timestamp"),
                        linked_issue=issue_number,
                        source="issue_comment",
                    )
            except Exception:
                # If we can't fetch the issue, continue to next
                continue

        # No claim metadata found - return with PR author as claimed_by
        # (assuming PR author is the one who worked on it)
        return PRClaimMetadata(
            claimed_by=body_fields.get("claimed_by", pr_author_login or None),
            claim_id=body_fields.get("claim_id"),
            fork_reputation=None,
            claim_timestamp=None,
            linked_issue=linked_issues[0] if linked_issues else None,
            source="unknown",
        )

    async def get_pr_with_claim_metadata(self, pr_number: int) -> tuple[PRData, PRClaimMetadata]:
        """
        Fetch a PR with its associated claim metadata.

        Convenience method that fetches both the full PR data and claim metadata
        in one logical operation.

        Args:
            pr_number: PR number to fetch

        Returns:
            Tuple of (PRData, PRClaimMetadata)
        """
        # Fetch PR and claim metadata in parallel would be ideal,
        # but claim metadata depends on PR body, so we do it sequentially
        pr = await self.fetch_pr(pr_number)
        claim_metadata = await self.get_pr_claim_metadata(pr_number)

        return pr, claim_metadata

    def format_pr_claim_body_section(
        self,
        claimed_by: str,
        claim_id: str,
        linked_issue: int | None = None,
        reputation_data: dict[str, Any] | None = None,
    ) -> str:
        """
        Format a claim metadata section for including in a PR body.

        Creates a standardized section with claim information that can be
        parsed by parse_pr_body_claim_fields().

        Args:
            claimed_by: GitHub username of the fork owner
            claim_id: Unique claim identifier
            linked_issue: Optional issue number this PR addresses
            reputation_data: Optional reputation info dict

        Returns:
            Formatted markdown section with claim metadata

        Example output:
            ---
            ## Task Claim Information
            - **Claimed-By:** @username
            - **Claim-ID:** `claim-abc123`
            - **Linked Issue:** #42
            <!-- CLAIM_METADATA: {...} -->
        """
        lines = [
            "",
            "---",
            "## Task Claim Information",
            f"- **Claimed-By:** @{claimed_by}",
            f"- **Claim-ID:** `{claim_id}`",
        ]

        if linked_issue is not None:
            lines.append(f"- **Linked Issue:** #{linked_issue}")

        if reputation_data:
            score = reputation_data.get("score", 0)
            tier = reputation_data.get("tier", "new")
            reliability = reputation_data.get("reliability_score", 0.0)
            lines.extend([
                "",
                "### Fork Reputation",
                f"- **Score:** {score} ({tier})",
                f"- **Reliability:** {reliability:.0%}",
            ])

        # Add machine-readable metadata
        metadata = {
            "claimed_by": claimed_by,
            "claim_id": claim_id,
        }
        if linked_issue is not None:
            metadata["issue_number"] = linked_issue
        if reputation_data:
            metadata["fork_reputation"] = reputation_data

        lines.append("")
        lines.append(f"<!-- CLAIM_METADATA: {json.dumps(metadata)} -->")

        return "\n".join(lines)

    # -------------------------------------------------------------------------
    # Helper Methods
    # -------------------------------------------------------------------------

    def _parse_pr_data(self, data: dict[str, Any], diff: str) -> PRData:
        """Parse GitHub PR data into PRData."""
        author = data.get("author", {})
        if isinstance(author, dict):
            author_login = author.get("login", "unknown")
        else:
            author_login = str(author) if author else "unknown"

        labels = []
        for label in data.get("labels", []):
            if isinstance(label, dict):
                labels.append(label.get("name", ""))
            else:
                labels.append(str(label))

        files = data.get("files", [])
        if files is None:
            files = []

        return PRData(
            number=data.get("number", 0),
            title=data.get("title", ""),
            body=data.get("body", "") or "",
            author=author_login,
            state=data.get("state", "open"),
            source_branch=data.get("headRefName", ""),
            target_branch=data.get("baseRefName", ""),
            additions=data.get("additions", 0),
            deletions=data.get("deletions", 0),
            changed_files=data.get("changedFiles", len(files)),
            files=files,
            diff=diff,
            url=data.get("url", ""),
            created_at=self._parse_datetime(data.get("createdAt")),
            updated_at=self._parse_datetime(data.get("updatedAt")),
            labels=labels,
            reviewers=self._parse_reviewers(data.get("reviewRequests", [])),
            is_draft=data.get("isDraft", False),
            mergeable=data.get("mergeable") != "CONFLICTING",
            provider=ProviderType.GITHUB,
            raw_data=data,
        )

    def _parse_issue_data(self, data: dict[str, Any]) -> IssueData:
        """Parse GitHub issue data into IssueData."""
        author = data.get("author", {})
        if isinstance(author, dict):
            author_login = author.get("login", "unknown")
        else:
            author_login = str(author) if author else "unknown"

        labels = []
        for label in data.get("labels", []):
            if isinstance(label, dict):
                labels.append(label.get("name", ""))
            else:
                labels.append(str(label))

        assignees = []
        for assignee in data.get("assignees", []):
            if isinstance(assignee, dict):
                assignees.append(assignee.get("login", ""))
            else:
                assignees.append(str(assignee))

        milestone = data.get("milestone")
        if isinstance(milestone, dict):
            milestone = milestone.get("title")

        return IssueData(
            number=data.get("number", 0),
            title=data.get("title", ""),
            body=data.get("body", "") or "",
            author=author_login,
            state=data.get("state", "open"),
            labels=labels,
            created_at=self._parse_datetime(data.get("createdAt")),
            updated_at=self._parse_datetime(data.get("updatedAt")),
            url=data.get("url", ""),
            assignees=assignees,
            milestone=milestone,
            provider=ProviderType.GITHUB,
            raw_data=data,
        )

    def _parse_datetime(self, dt_str: str | None) -> datetime:
        """Parse ISO datetime string."""
        if not dt_str:
            return datetime.now(timezone.utc)
        try:
            return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return datetime.now(timezone.utc)

    def _parse_reviewers(self, review_requests: list | None) -> list[str]:
        """Parse review requests into list of usernames."""
        if not review_requests:
            return []
        reviewers = []
        for req in review_requests:
            if isinstance(req, dict):
                if "requestedReviewer" in req:
                    reviewer = req["requestedReviewer"]
                    if isinstance(reviewer, dict):
                        reviewers.append(reviewer.get("login", ""))
        return reviewers
