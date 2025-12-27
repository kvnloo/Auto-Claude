"""
GitHub Issue Fetcher for Autonomous Mode
=========================================

Fetches GitHub issues with the 'auto-claude-ready' label for autonomous task execution.
Uses GHClient patterns for subprocess execution, error handling, and rate limiting.

Supports:
- Filtering by state (open, closed, all)
- Pagination for large result sets
- JSON output parsing
- Label management for status updates (add/remove labels)

Usage:
    from runners.github.issue_fetcher import IssueFetcher

    async def main():
        fetcher = IssueFetcher(project_dir=Path("/path/to/project"))

        # Fetch all ready issues
        issues = await fetcher.fetch_ready_issues()

        # Update issue status
        await fetcher.mark_in_progress(issue_number=123)
        await fetcher.mark_completed(issue_number=123)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from .gh_client import GHClient, GHCommandError, GHTimeoutError
    from .rate_limiter import RateLimitExceeded
except (ImportError, ValueError, SystemError):
    from gh_client import GHClient, GHCommandError, GHTimeoutError
    from rate_limiter import RateLimitExceeded

# Configure logger
logger = logging.getLogger(__name__)

# Label constants for autonomous mode
LABEL_READY = "auto-claude-ready"
LABEL_IN_PROGRESS = "auto-claude-in-progress"
LABEL_COMPLETED = "auto-claude-completed"
LABEL_FAILED = "auto-claude-failed"


class IssueFetchError(Exception):
    """Raised when issue fetching fails."""

    pass


class IssueLabelError(Exception):
    """Raised when label operations fail."""

    pass


@dataclass
class GitHubIssue:
    """
    Represents a GitHub issue fetched for autonomous processing.

    Attributes:
        number: Issue number
        title: Issue title
        body: Issue body/description
        labels: List of label names
        created_at: ISO timestamp when issue was created
        updated_at: ISO timestamp when issue was last updated
        author: Author login username
        url: GitHub URL for the issue
        state: Issue state (open, closed)
    """

    number: int
    title: str
    body: str
    labels: list[str]
    created_at: str
    updated_at: str
    author: str
    url: str
    state: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GitHubIssue:
        """
        Create GitHubIssue from gh CLI JSON output.

        Args:
            data: Dictionary from gh CLI JSON output

        Returns:
            GitHubIssue instance
        """
        # Extract label names from label objects
        labels = []
        if "labels" in data:
            for label in data.get("labels", []):
                if isinstance(label, dict):
                    labels.append(label.get("name", ""))
                elif isinstance(label, str):
                    labels.append(label)

        # Extract author login
        author = ""
        if "author" in data:
            author_data = data.get("author", {})
            if isinstance(author_data, dict):
                author = author_data.get("login", "")
            elif isinstance(author_data, str):
                author = author_data

        return cls(
            number=data.get("number", 0),
            title=data.get("title", ""),
            body=data.get("body", ""),
            labels=labels,
            created_at=data.get("createdAt", ""),
            updated_at=data.get("updatedAt", ""),
            author=author,
            url=data.get("url", ""),
            state=data.get("state", "open"),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "number": self.number,
            "title": self.title,
            "body": self.body,
            "labels": self.labels,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "author": self.author,
            "url": self.url,
            "state": self.state,
        }


class IssueFetcher:
    """
    Fetches GitHub issues for autonomous task processing.

    Uses GHClient for all GitHub CLI operations with proper timeout,
    retry, and rate limiting support.

    Usage:
        fetcher = IssueFetcher(project_dir=Path("/path/to/project"))

        # Get all issues ready for processing
        issues = await fetcher.fetch_ready_issues()

        # Mark issue as in progress
        await fetcher.mark_in_progress(issue_number=123)
    """

    def __init__(
        self,
        project_dir: Path,
        ready_label: str = LABEL_READY,
        default_timeout: float = 30.0,
        enable_rate_limiting: bool = True,
    ):
        """
        Initialize IssueFetcher.

        Args:
            project_dir: Project directory for gh CLI commands
            ready_label: Label to filter for ready issues (default: 'auto-claude-ready')
            default_timeout: Default timeout in seconds for commands
            enable_rate_limiting: Whether to enforce rate limiting
        """
        self.project_dir = Path(project_dir)
        self.ready_label = ready_label
        self.client = GHClient(
            project_dir=self.project_dir,
            default_timeout=default_timeout,
            enable_rate_limiting=enable_rate_limiting,
        )

    async def fetch_ready_issues(
        self,
        state: str = "open",
        limit: int = 100,
    ) -> list[GitHubIssue]:
        """
        Fetch all issues with the 'auto-claude-ready' label.

        Args:
            state: Issue state filter (open, closed, all)
            limit: Maximum number of issues to return

        Returns:
            List of GitHubIssue objects

        Raises:
            IssueFetchError: If fetching fails
            RateLimitExceeded: If rate limit is exceeded
        """
        try:
            logger.info(
                f"Fetching issues with label '{self.ready_label}' "
                f"(state={state}, limit={limit})"
            )

            # Use gh CLI to fetch issues with specific label
            json_fields = [
                "number",
                "title",
                "body",
                "labels",
                "author",
                "createdAt",
                "updatedAt",
                "url",
                "state",
            ]

            result = await self.client.run(
                [
                    "issue",
                    "list",
                    "--label",
                    self.ready_label,
                    "--state",
                    state,
                    "--limit",
                    str(limit),
                    "--json",
                    ",".join(json_fields),
                ],
                raise_on_error=True,
            )

            # Parse JSON output
            import json

            issues_data = json.loads(result.stdout) if result.stdout.strip() else []

            # Convert to GitHubIssue objects
            issues = [GitHubIssue.from_dict(data) for data in issues_data]

            logger.info(f"Fetched {len(issues)} issues with label '{self.ready_label}'")
            return issues

        except GHTimeoutError as e:
            logger.error(f"Timeout fetching issues: {e}")
            raise IssueFetchError(f"Timeout fetching issues: {e}") from e
        except GHCommandError as e:
            logger.error(f"Command error fetching issues: {e}")
            raise IssueFetchError(f"Failed to fetch issues: {e}") from e
        except RateLimitExceeded:
            # Re-raise rate limit exceptions for caller to handle
            raise
        except Exception as e:
            logger.error(f"Unexpected error fetching issues: {e}")
            raise IssueFetchError(f"Unexpected error fetching issues: {e}") from e

    async def fetch_issue(self, issue_number: int) -> GitHubIssue:
        """
        Fetch a specific issue by number.

        Args:
            issue_number: The issue number to fetch

        Returns:
            GitHubIssue object

        Raises:
            IssueFetchError: If fetching fails
            RateLimitExceeded: If rate limit is exceeded
        """
        try:
            logger.debug(f"Fetching issue #{issue_number}")

            data = await self.client.issue_get(
                issue_number=issue_number,
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

            return GitHubIssue.from_dict(data)

        except GHCommandError as e:
            logger.error(f"Failed to fetch issue #{issue_number}: {e}")
            raise IssueFetchError(f"Failed to fetch issue #{issue_number}: {e}") from e
        except RateLimitExceeded:
            raise

    async def fetch_issues_paginated(
        self,
        state: str = "open",
        page_size: int = 100,
        max_pages: int = 10,
    ) -> list[GitHubIssue]:
        """
        Fetch issues with pagination support for large result sets.

        Note: gh CLI doesn't directly support offset pagination for issues,
        so this fetches up to page_size * max_pages issues in one call.
        For very large result sets, consider using the GitHub API directly.

        Args:
            state: Issue state filter (open, closed, all)
            page_size: Number of issues per page (max 100)
            max_pages: Maximum number of pages to fetch

        Returns:
            List of GitHubIssue objects

        Raises:
            IssueFetchError: If fetching fails
            RateLimitExceeded: If rate limit is exceeded
        """
        total_limit = min(page_size * max_pages, 1000)  # gh CLI max is 1000
        return await self.fetch_ready_issues(state=state, limit=total_limit)

    async def add_label(self, issue_number: int, label: str) -> None:
        """
        Add a label to an issue.

        Args:
            issue_number: The issue number
            label: Label name to add

        Raises:
            IssueLabelError: If adding label fails
            RateLimitExceeded: If rate limit is exceeded
        """
        try:
            logger.debug(f"Adding label '{label}' to issue #{issue_number}")
            await self.client.issue_add_labels(issue_number, [label])
            logger.info(f"Added label '{label}' to issue #{issue_number}")

        except GHCommandError as e:
            logger.error(f"Failed to add label '{label}' to issue #{issue_number}: {e}")
            raise IssueLabelError(
                f"Failed to add label '{label}' to issue #{issue_number}: {e}"
            ) from e
        except RateLimitExceeded:
            raise

    async def remove_label(self, issue_number: int, label: str) -> None:
        """
        Remove a label from an issue.

        Args:
            issue_number: The issue number
            label: Label name to remove

        Note: Does not raise error if label doesn't exist on issue.

        Raises:
            IssueLabelError: If removing label fails unexpectedly
            RateLimitExceeded: If rate limit is exceeded
        """
        try:
            logger.debug(f"Removing label '{label}' from issue #{issue_number}")
            await self.client.issue_remove_labels(issue_number, [label])
            logger.info(f"Removed label '{label}' from issue #{issue_number}")

        except RateLimitExceeded:
            raise
        except Exception as e:
            # Log but don't fail - label might not exist
            logger.warning(
                f"Could not remove label '{label}' from issue #{issue_number}: {e}"
            )

    async def mark_in_progress(self, issue_number: int) -> None:
        """
        Mark an issue as in-progress by updating labels.

        Removes 'auto-claude-ready' label and adds 'auto-claude-in-progress'.

        Args:
            issue_number: The issue number

        Raises:
            IssueLabelError: If label update fails
            RateLimitExceeded: If rate limit is exceeded
        """
        logger.info(f"Marking issue #{issue_number} as in-progress")

        # Remove ready label first
        await self.remove_label(issue_number, LABEL_READY)

        # Add in-progress label
        await self.add_label(issue_number, LABEL_IN_PROGRESS)

    async def mark_completed(self, issue_number: int) -> None:
        """
        Mark an issue as completed by updating labels.

        Removes 'auto-claude-in-progress' label and adds 'auto-claude-completed'.

        Args:
            issue_number: The issue number

        Raises:
            IssueLabelError: If label update fails
            RateLimitExceeded: If rate limit is exceeded
        """
        logger.info(f"Marking issue #{issue_number} as completed")

        # Remove in-progress label
        await self.remove_label(issue_number, LABEL_IN_PROGRESS)

        # Add completed label
        await self.add_label(issue_number, LABEL_COMPLETED)

    async def mark_failed(self, issue_number: int) -> None:
        """
        Mark an issue as failed by updating labels.

        Removes 'auto-claude-in-progress' label and adds 'auto-claude-failed'.

        Args:
            issue_number: The issue number

        Raises:
            IssueLabelError: If label update fails
            RateLimitExceeded: If rate limit is exceeded
        """
        logger.info(f"Marking issue #{issue_number} as failed")

        # Remove in-progress label
        await self.remove_label(issue_number, LABEL_IN_PROGRESS)

        # Add failed label
        await self.add_label(issue_number, LABEL_FAILED)

    async def add_comment(self, issue_number: int, body: str) -> None:
        """
        Add a comment to an issue.

        Args:
            issue_number: The issue number
            body: Comment body text

        Raises:
            IssueLabelError: If commenting fails
            RateLimitExceeded: If rate limit is exceeded
        """
        try:
            logger.debug(f"Adding comment to issue #{issue_number}")
            await self.client.issue_comment(issue_number, body)
            logger.info(f"Added comment to issue #{issue_number}")

        except GHCommandError as e:
            logger.error(f"Failed to add comment to issue #{issue_number}: {e}")
            raise IssueLabelError(
                f"Failed to add comment to issue #{issue_number}: {e}"
            ) from e
        except RateLimitExceeded:
            raise

    async def check_auth_status(self) -> tuple[bool, str]:
        """
        Check if GitHub CLI is authenticated.

        Returns:
            Tuple of (is_authenticated, status_message)
        """
        try:
            result = await self.client.run(
                ["auth", "status"],
                raise_on_error=False,
            )

            if result.returncode == 0:
                return True, result.stdout.strip() or result.stderr.strip()
            else:
                return False, result.stderr.strip() or "Not authenticated"

        except Exception as e:
            return False, f"Auth check failed: {e}"


# Convenience function for quick issue fetching
async def fetch_ready_issues(
    project_dir: Path | str,
    state: str = "open",
    limit: int = 100,
) -> list[dict[str, Any]]:
    """
    Convenience function to fetch ready issues without instantiating IssueFetcher.

    Args:
        project_dir: Project directory path
        state: Issue state filter
        limit: Maximum number of issues

    Returns:
        List of issue dictionaries
    """
    fetcher = IssueFetcher(project_dir=Path(project_dir))
    issues = await fetcher.fetch_ready_issues(state=state, limit=limit)
    return [issue.to_dict() for issue in issues]


# For testing and CLI usage
if __name__ == "__main__":
    import asyncio
    import sys

    async def main():
        """Test issue fetching."""
        project_dir = Path.cwd()
        print(f"Testing IssueFetcher in: {project_dir}")
        print("=" * 60)

        fetcher = IssueFetcher(project_dir=project_dir)

        # Check auth status
        print("\n1. Checking GitHub CLI auth status...")
        is_auth, status = await fetcher.check_auth_status()
        print(f"   Authenticated: {is_auth}")
        print(f"   Status: {status[:100]}..." if len(status) > 100 else f"   Status: {status}")

        if not is_auth:
            print("\n   Please authenticate with: gh auth login")
            sys.exit(1)

        # Fetch ready issues
        print(f"\n2. Fetching issues with label '{LABEL_READY}'...")
        try:
            issues = await fetcher.fetch_ready_issues(limit=10)
            print(f"   Found {len(issues)} issues:")
            for issue in issues:
                print(f"   - #{issue.number}: {issue.title[:50]}...")
        except IssueFetchError as e:
            print(f"   Error: {e}")
        except RateLimitExceeded as e:
            print(f"   Rate limited: {e}")

        print("\nDone!")

    asyncio.run(main())
