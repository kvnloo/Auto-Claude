"""
GitHub CLI Client with Timeout and Retry Logic
==============================================

Wrapper for gh CLI commands that prevents hung processes through:
- Configurable timeouts (default 30s)
- Exponential backoff retry (3 attempts: 1s, 2s, 4s)
- Structured logging for monitoring
- Async subprocess execution for non-blocking operations

This eliminates the risk of indefinite hangs in GitHub automation workflows.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    from .rate_limiter import RateLimiter, RateLimitExceeded
except (ImportError, ValueError, SystemError):
    from rate_limiter import RateLimiter, RateLimitExceeded

# Configure logger
logger = logging.getLogger(__name__)


class GHTimeoutError(Exception):
    """Raised when gh CLI command times out after all retry attempts."""

    pass


class GHCommandError(Exception):
    """Raised when gh CLI command fails with non-zero exit code."""

    pass


class PRTooLargeError(Exception):
    """Raised when PR diff exceeds GitHub's 20,000 line limit."""

    pass


@dataclass
class GHCommandResult:
    """Result of a gh CLI command execution."""

    stdout: str
    stderr: str
    returncode: int
    command: list[str]
    attempts: int
    total_time: float


class GHClient:
    """
    Async client for GitHub CLI with timeout and retry protection.

    Usage:
        client = GHClient(project_dir=Path("/path/to/project"))

        # Simple command
        result = await client.run(["pr", "list"])

        # With custom timeout
        result = await client.run(["pr", "diff", "123"], timeout=60.0)

        # Convenience methods
        pr_data = await client.pr_get(123)
        diff = await client.pr_diff(123)
        await client.pr_review(123, body="LGTM", event="approve")
    """

    def __init__(
        self,
        project_dir: Path,
        default_timeout: float = 30.0,
        max_retries: int = 3,
        enable_rate_limiting: bool = True,
    ):
        """
        Initialize GitHub CLI client.

        Args:
            project_dir: Project directory for gh commands
            default_timeout: Default timeout in seconds for commands
            max_retries: Maximum number of retry attempts
            enable_rate_limiting: Whether to enforce rate limiting (default: True)
        """
        self.project_dir = Path(project_dir)
        self.default_timeout = default_timeout
        self.max_retries = max_retries
        self.enable_rate_limiting = enable_rate_limiting

        # Initialize rate limiter singleton
        if enable_rate_limiting:
            self._rate_limiter = RateLimiter.get_instance()

    async def run(
        self,
        args: list[str],
        timeout: float | None = None,
        raise_on_error: bool = True,
    ) -> GHCommandResult:
        """
        Execute a gh CLI command with timeout and retry logic.

        Args:
            args: Command arguments (e.g., ["pr", "list"])
            timeout: Timeout in seconds (uses default if None)
            raise_on_error: Raise GHCommandError on non-zero exit

        Returns:
            GHCommandResult with command output and metadata

        Raises:
            GHTimeoutError: If command times out after all retries
            GHCommandError: If command fails and raise_on_error is True
        """
        timeout = timeout or self.default_timeout
        cmd = ["gh"] + args
        start_time = asyncio.get_event_loop().time()

        # Pre-flight rate limit check
        if self.enable_rate_limiting:
            available, msg = self._rate_limiter.check_github_available()
            if not available:
                # Try to acquire (will wait if needed)
                logger.info(f"Rate limited, waiting for token: {msg}")
                if not await self._rate_limiter.acquire_github(timeout=30.0):
                    raise RateLimitExceeded(f"GitHub API rate limit exceeded: {msg}")
            else:
                # Consume a token for this request
                await self._rate_limiter.acquire_github(timeout=1.0)

        for attempt in range(1, self.max_retries + 1):
            try:
                logger.debug(
                    f"Executing gh command (attempt {attempt}/{self.max_retries}): {' '.join(cmd)}"
                )

                # Create subprocess
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=self.project_dir,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )

                # Wait for completion with timeout
                try:
                    stdout, stderr = await asyncio.wait_for(
                        proc.communicate(), timeout=timeout
                    )
                except asyncio.TimeoutError:
                    # Kill the hung process
                    try:
                        proc.kill()
                        await proc.wait()
                    except Exception as e:
                        logger.warning(f"Failed to kill hung process: {e}")

                    # Calculate backoff delay
                    backoff_delay = 2 ** (attempt - 1)

                    logger.warning(
                        f"gh {args[0]} timed out after {timeout}s "
                        f"(attempt {attempt}/{self.max_retries})"
                    )

                    # Retry if attempts remain
                    if attempt < self.max_retries:
                        logger.info(f"Retrying in {backoff_delay}s...")
                        await asyncio.sleep(backoff_delay)
                        continue
                    else:
                        # All retries exhausted
                        total_time = asyncio.get_event_loop().time() - start_time
                        logger.error(
                            f"gh {args[0]} timed out after {self.max_retries} attempts "
                            f"({total_time:.1f}s total)"
                        )
                        raise GHTimeoutError(
                            f"gh {args[0]} timed out after {self.max_retries} attempts "
                            f"({timeout}s each, {total_time:.1f}s total)"
                        )

                # Successful execution (no timeout)
                total_time = asyncio.get_event_loop().time() - start_time
                stdout_str = stdout.decode("utf-8")
                stderr_str = stderr.decode("utf-8")

                result = GHCommandResult(
                    stdout=stdout_str,
                    stderr=stderr_str,
                    returncode=proc.returncode or 0,
                    command=cmd,
                    attempts=attempt,
                    total_time=total_time,
                )

                if result.returncode != 0:
                    logger.warning(
                        f"gh {args[0]} failed with exit code {result.returncode}: {stderr_str}"
                    )

                    # Check for rate limit errors (403/429)
                    error_lower = stderr_str.lower()
                    if (
                        "403" in stderr_str
                        or "429" in stderr_str
                        or "rate limit" in error_lower
                    ):
                        if self.enable_rate_limiting:
                            self._rate_limiter.record_github_error()
                        raise RateLimitExceeded(
                            f"GitHub API rate limit (HTTP 403/429): {stderr_str}"
                        )

                    if raise_on_error:
                        raise GHCommandError(
                            f"gh {args[0]} failed: {stderr_str or 'Unknown error'}"
                        )
                else:
                    logger.debug(
                        f"gh {args[0]} completed successfully "
                        f"(attempt {attempt}, {total_time:.2f}s)"
                    )

                return result

            except (GHTimeoutError, GHCommandError, RateLimitExceeded):
                # Re-raise our custom exceptions
                raise
            except Exception as e:
                # Unexpected error
                logger.error(f"Unexpected error in gh command: {e}")
                if attempt == self.max_retries:
                    raise GHCommandError(f"gh {args[0]} failed: {str(e)}")
                else:
                    # Retry on unexpected errors too
                    backoff_delay = 2 ** (attempt - 1)
                    logger.info(f"Retrying in {backoff_delay}s after error...")
                    await asyncio.sleep(backoff_delay)
                    continue

        # Should never reach here, but for type safety
        raise GHCommandError(f"gh {args[0]} failed after {self.max_retries} attempts")

    # =========================================================================
    # Convenience methods for common gh commands
    # =========================================================================

    async def pr_list(
        self,
        state: str = "open",
        limit: int = 100,
        json_fields: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """
        List pull requests.

        Args:
            state: PR state (open, closed, merged, all)
            limit: Maximum number of PRs to return
            json_fields: Fields to include in JSON output

        Returns:
            List of PR data dictionaries
        """
        if json_fields is None:
            json_fields = [
                "number",
                "title",
                "state",
                "author",
                "headRefName",
                "baseRefName",
            ]

        args = [
            "pr",
            "list",
            "--state",
            state,
            "--limit",
            str(limit),
            "--json",
            ",".join(json_fields),
        ]

        result = await self.run(args)
        return json.loads(result.stdout)

    async def pr_get(
        self, pr_number: int, json_fields: list[str] | None = None
    ) -> dict[str, Any]:
        """
        Get PR data by number.

        Args:
            pr_number: PR number
            json_fields: Fields to include in JSON output

        Returns:
            PR data dictionary
        """
        if json_fields is None:
            json_fields = [
                "number",
                "title",
                "body",
                "state",
                "headRefName",
                "baseRefName",
                "author",
                "files",
                "additions",
                "deletions",
                "changedFiles",
            ]

        args = [
            "pr",
            "view",
            str(pr_number),
            "--json",
            ",".join(json_fields),
        ]

        result = await self.run(args)
        return json.loads(result.stdout)

    async def pr_diff(self, pr_number: int) -> str:
        """
        Get PR diff.

        Args:
            pr_number: PR number

        Returns:
            Unified diff string

        Raises:
            PRTooLargeError: If PR exceeds GitHub's 20,000 line diff limit
        """
        args = ["pr", "diff", str(pr_number)]
        try:
            result = await self.run(args)
            return result.stdout
        except GHCommandError as e:
            # Check if error is due to PR being too large
            error_msg = str(e)
            if (
                "diff exceeded the maximum number of lines" in error_msg
                or "HTTP 406" in error_msg
            ):
                raise PRTooLargeError(
                    f"PR #{pr_number} exceeds GitHub's 20,000 line diff limit. "
                    "Consider splitting into smaller PRs or review files individually."
                ) from e
            # Re-raise other command errors
            raise

    async def pr_review(
        self,
        pr_number: int,
        body: str,
        event: str = "comment",
    ) -> int:
        """
        Post a review to a PR.

        Args:
            pr_number: PR number
            body: Review comment body
            event: Review event (approve, request-changes, comment)

        Returns:
            Review ID (currently 0, as gh CLI doesn't return ID)
        """
        args = ["pr", "review", str(pr_number)]

        if event.lower() == "approve":
            args.append("--approve")
        elif event.lower() in ["request-changes", "request_changes"]:
            args.append("--request-changes")
        else:
            args.append("--comment")

        args.extend(["--body", body])

        await self.run(args)
        return 0  # gh CLI doesn't return review ID

    async def issue_list(
        self,
        state: str = "open",
        limit: int = 100,
        json_fields: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """
        List issues.

        Args:
            state: Issue state (open, closed, all)
            limit: Maximum number of issues to return
            json_fields: Fields to include in JSON output

        Returns:
            List of issue data dictionaries
        """
        if json_fields is None:
            json_fields = [
                "number",
                "title",
                "body",
                "labels",
                "author",
                "createdAt",
                "updatedAt",
                "comments",
            ]

        args = [
            "issue",
            "list",
            "--state",
            state,
            "--limit",
            str(limit),
            "--json",
            ",".join(json_fields),
        ]

        result = await self.run(args)
        return json.loads(result.stdout)

    async def issue_get(
        self, issue_number: int, json_fields: list[str] | None = None
    ) -> dict[str, Any]:
        """
        Get issue data by number.

        Args:
            issue_number: Issue number
            json_fields: Fields to include in JSON output

        Returns:
            Issue data dictionary
        """
        if json_fields is None:
            json_fields = [
                "number",
                "title",
                "body",
                "state",
                "labels",
                "author",
                "comments",
                "createdAt",
                "updatedAt",
            ]

        args = [
            "issue",
            "view",
            str(issue_number),
            "--json",
            ",".join(json_fields),
        ]

        result = await self.run(args)
        return json.loads(result.stdout)

    async def issue_comment(self, issue_number: int, body: str) -> None:
        """
        Post a comment to an issue.

        Args:
            issue_number: Issue number
            body: Comment body
        """
        args = ["issue", "comment", str(issue_number), "--body", body]
        await self.run(args)

    async def issue_add_labels(self, issue_number: int, labels: list[str]) -> None:
        """
        Add labels to an issue.

        Args:
            issue_number: Issue number
            labels: List of label names to add
        """
        if not labels:
            return

        args = [
            "issue",
            "edit",
            str(issue_number),
            "--add-label",
            ",".join(labels),
        ]
        await self.run(args)

    async def issue_remove_labels(self, issue_number: int, labels: list[str]) -> None:
        """
        Remove labels from an issue.

        Args:
            issue_number: Issue number
            labels: List of label names to remove
        """
        if not labels:
            return

        args = [
            "issue",
            "edit",
            str(issue_number),
            "--remove-label",
            ",".join(labels),
        ]
        # Don't raise on error - labels might not exist
        await self.run(args, raise_on_error=False)

    async def api_get(self, endpoint: str, params: dict[str, str] | None = None) -> Any:
        """
        Make a GET request to GitHub API.

        Args:
            endpoint: API endpoint (e.g., "/repos/owner/repo/contents/path")
            params: Query parameters

        Returns:
            JSON response
        """
        args = ["api", endpoint]

        if params:
            for key, value in params.items():
                args.extend(["-f", f"{key}={value}"])

        result = await self.run(args)
        return json.loads(result.stdout)

    async def pr_merge(
        self,
        pr_number: int,
        merge_method: str = "squash",
        commit_title: str | None = None,
        commit_message: str | None = None,
    ) -> None:
        """
        Merge a pull request.

        Args:
            pr_number: PR number to merge
            merge_method: Merge method - "merge", "squash", or "rebase" (default: "squash")
            commit_title: Custom commit title (optional)
            commit_message: Custom commit message (optional)
        """
        args = ["pr", "merge", str(pr_number), f"--{merge_method}"]

        if commit_title:
            args.extend(["--subject", commit_title])
        if commit_message:
            args.extend(["--body", commit_message])

        await self.run(args)

    async def pr_comment(self, pr_number: int, body: str) -> None:
        """
        Post a comment on a pull request.

        Args:
            pr_number: PR number
            body: Comment body
        """
        args = ["pr", "comment", str(pr_number), "--body", body]
        await self.run(args)

    async def pr_get_assignees(self, pr_number: int) -> list[str]:
        """
        Get assignees for a pull request.

        Args:
            pr_number: PR number

        Returns:
            List of assignee logins
        """
        data = await self.pr_get(pr_number, json_fields=["assignees"])
        assignees = data.get("assignees", [])
        return [a["login"] for a in assignees]

    async def pr_assign(self, pr_number: int, assignees: list[str]) -> None:
        """
        Assign users to a pull request.

        Args:
            pr_number: PR number
            assignees: List of GitHub usernames to assign
        """
        if not assignees:
            return

        # Use gh api to add assignees
        endpoint = f"/repos/{{owner}}/{{repo}}/issues/{pr_number}/assignees"
        args = [
            "api",
            endpoint,
            "-X",
            "POST",
            "-f",
            f"assignees={','.join(assignees)}",
        ]
        await self.run(args)

    async def compare_commits(self, base_sha: str, head_sha: str) -> dict[str, Any]:
        """
        Compare two commits to get changes between them.

        Uses: GET /repos/{owner}/{repo}/compare/{base}...{head}

        Args:
            base_sha: Base commit SHA (e.g., last reviewed commit)
            head_sha: Head commit SHA (e.g., current PR HEAD)

        Returns:
            Dict with:
            - commits: List of commits between base and head
            - files: List of changed files with patches
            - ahead_by: Number of commits head is ahead of base
            - behind_by: Number of commits head is behind base
            - total_commits: Total number of commits in comparison
        """
        endpoint = f"repos/{{owner}}/{{repo}}/compare/{base_sha}...{head_sha}"
        args = ["api", endpoint]

        result = await self.run(args, timeout=60.0)  # Longer timeout for large diffs
        return json.loads(result.stdout)

    async def get_comments_since(
        self, pr_number: int, since_timestamp: str
    ) -> dict[str, list[dict]]:
        """
        Get all comments (review + issue) since a timestamp.

        Args:
            pr_number: PR number
            since_timestamp: ISO timestamp to filter from (e.g., "2025-12-25T10:30:00Z")

        Returns:
            Dict with:
            - review_comments: Inline review comments on files
            - issue_comments: General PR discussion comments
        """
        # Fetch inline review comments
        # Use query string syntax - the -f flag sends POST body fields, not query params
        review_endpoint = f"repos/{{owner}}/{{repo}}/pulls/{pr_number}/comments?since={since_timestamp}"
        review_args = ["api", "--method", "GET", review_endpoint]
        review_result = await self.run(review_args, raise_on_error=False)

        review_comments = []
        if review_result.returncode == 0:
            try:
                review_comments = json.loads(review_result.stdout)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse review comments for PR #{pr_number}")

        # Fetch general issue comments
        # Use query string syntax - the -f flag sends POST body fields, not query params
        issue_endpoint = f"repos/{{owner}}/{{repo}}/issues/{pr_number}/comments?since={since_timestamp}"
        issue_args = ["api", "--method", "GET", issue_endpoint]
        issue_result = await self.run(issue_args, raise_on_error=False)

        issue_comments = []
        if issue_result.returncode == 0:
            try:
                issue_comments = json.loads(issue_result.stdout)
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse issue comments for PR #{pr_number}")

        return {
            "review_comments": review_comments,
            "issue_comments": issue_comments,
        }

    async def get_pr_head_sha(self, pr_number: int) -> str | None:
        """
        Get the current HEAD SHA of a PR.

        Args:
            pr_number: PR number

        Returns:
            HEAD commit SHA or None if not found
        """
        data = await self.pr_get(pr_number, json_fields=["commits"])
        commits = data.get("commits", [])
        if commits:
            # Last commit is the HEAD
            return commits[-1].get("oid")
        return None

    # =========================================================================
    # Claim metadata methods for distributed task coordination
    # =========================================================================

    # Claim label constants
    LABEL_AVAILABLE = "task:available"
    LABEL_CLAIMED = "task:claimed"

    # Pattern for parsing claim metadata from HTML comments
    _CLAIM_METADATA_PATTERN = None

    @classmethod
    def _get_claim_metadata_pattern(cls):
        """Get compiled regex pattern for claim metadata (lazy initialization)."""
        if cls._CLAIM_METADATA_PATTERN is None:
            import re
            cls._CLAIM_METADATA_PATTERN = re.compile(
                r"<!--\s*CLAIM_METADATA:\s*(\{.*?\})\s*-->", re.DOTALL
            )
        return cls._CLAIM_METADATA_PATTERN

    def parse_claim_metadata(self, comment_body: str) -> dict[str, Any] | None:
        """
        Parse claim metadata from a GitHub comment body.

        Expects JSON in an HTML comment format:
        <!-- CLAIM_METADATA: {"claimed_by": "user", "claim_id": "xxx", ...} -->

        Args:
            comment_body: The comment body text

        Returns:
            Parsed metadata dict with keys like 'claimed_by', 'claim_id',
            'timestamp', 'fork_reputation', or None if not found/invalid
        """
        if not comment_body:
            return None

        pattern = self._get_claim_metadata_pattern()
        match = pattern.search(comment_body)
        if not match:
            return None

        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            logger.warning("Failed to parse claim metadata JSON from comment")
            return None

    def format_claim_comment(
        self,
        fork_owner: str,
        claim_id: str,
        reputation_data: dict[str, Any] | None = None,
        issue_number: int | None = None,
    ) -> str:
        """
        Format a claim comment for posting to GitHub.

        Creates a human-readable comment with embedded machine-readable metadata.

        Args:
            fork_owner: GitHub username of the fork owner
            claim_id: Unique claim identifier (e.g., "claim-abc123def456")
            reputation_data: Optional reputation info dict with keys:
                - score: int
                - tier: str (new, bronze, silver, gold, platinum)
                - total_claims: int
                - successful_merges: int
                - reliability_score: float (0-1)
            issue_number: Optional issue number for metadata

        Returns:
            Formatted comment body with embedded CLAIM_METADATA JSON
        """
        from datetime import datetime, timezone

        timestamp = datetime.now(timezone.utc).isoformat()

        # Build metadata dict
        metadata: dict[str, Any] = {
            "claimed_by": fork_owner,
            "claim_id": claim_id,
            "timestamp": timestamp,
        }

        if issue_number is not None:
            metadata["issue_number"] = issue_number

        # Add reputation if provided
        if reputation_data:
            metadata["fork_reputation"] = reputation_data

        # Build human-readable comment
        lines = [
            f"## Task Claimed by @{fork_owner}",
            "",
            f"**Claim ID:** `{claim_id}`",
            f"**Timestamp:** {timestamp}",
            "",
        ]

        # Add reputation info if available
        if reputation_data:
            score = reputation_data.get("score", 0)
            tier = reputation_data.get("tier", "new")
            merges = reputation_data.get("successful_merges", 0)
            reliability = reputation_data.get("reliability_score", 0.0)

            lines.extend([
                "### Fork Reputation",
                f"- **Score:** {score} ({tier})",
                f"- **Completed Tasks:** {merges}",
                f"- **Reliability:** {reliability:.0%}",
                "",
            ])

        lines.extend([
            "---",
            "*This claim will expire in 7 days if no PR is submitted.*",
            "",
            f"<!-- CLAIM_METADATA: {json.dumps(metadata)} -->",
        ])

        return "\n".join(lines)

    async def post_claim_comment(
        self,
        issue_number: int,
        fork_owner: str,
        claim_id: str,
        reputation_data: dict[str, Any] | None = None,
    ) -> None:
        """
        Post a claim comment to an issue.

        This atomically posts a formatted claim comment with embedded metadata
        that can be parsed by parse_claim_metadata().

        Args:
            issue_number: Issue number to comment on
            fork_owner: GitHub username of the fork owner
            claim_id: Unique claim identifier
            reputation_data: Optional reputation info dict

        Raises:
            GHCommandError: If the comment fails to post
        """
        comment_body = self.format_claim_comment(
            fork_owner=fork_owner,
            claim_id=claim_id,
            reputation_data=reputation_data,
            issue_number=issue_number,
        )
        await self.issue_comment(issue_number, comment_body)
        logger.info(
            f"Posted claim comment for @{fork_owner} on issue #{issue_number} "
            f"(claim_id: {claim_id})"
        )

    async def get_claim_status(
        self,
        issue_number: int,
    ) -> dict[str, Any]:
        """
        Get the claim status of an issue.

        Checks labels and comments to determine if an issue is claimed,
        available, or in an unknown state.

        Args:
            issue_number: Issue number to check

        Returns:
            Dict with claim status:
            {
                "status": "claimed" | "available" | "unknown",
                "issue_number": int,
                "labels": list[str],
                "has_available_label": bool,
                "has_claimed_label": bool,
                "claim_metadata": dict | None,  # From most recent claim comment
                "claimed_by": str | None,
                "claim_id": str | None,
                "claim_timestamp": str | None,
            }
        """
        # Fetch issue with labels and comments
        issue_data = await self.issue_get(
            issue_number,
            json_fields=["number", "title", "state", "labels", "comments"],
        )

        # Extract labels
        labels_raw = issue_data.get("labels", [])
        labels: list[str] = []
        for label in labels_raw:
            if isinstance(label, str):
                labels.append(label)
            elif isinstance(label, dict):
                name = label.get("name")
                if name:
                    labels.append(name)

        has_available = self.LABEL_AVAILABLE in labels
        has_claimed = self.LABEL_CLAIMED in labels

        # Try to find claim metadata from comments
        claim_metadata: dict[str, Any] | None = None
        comments = issue_data.get("comments", [])

        # Sort comments by createdAt descending to find most recent claim
        sorted_comments = sorted(
            comments,
            key=lambda c: c.get("createdAt", c.get("created_at", "")),
            reverse=True,
        )

        for comment in sorted_comments:
            body = comment.get("body", "")
            metadata = self.parse_claim_metadata(body)
            if metadata and metadata.get("claim_id"):
                claim_metadata = metadata
                break

        # Determine status
        if has_claimed and not has_available:
            status = "claimed"
        elif has_available and not has_claimed:
            status = "available"
        elif has_claimed and has_available:
            # Conflicting state - likely needs reconciliation
            status = "claimed"  # Prefer claimed in conflict
            logger.warning(
                f"Issue #{issue_number} has conflicting labels "
                f"(both {self.LABEL_AVAILABLE} and {self.LABEL_CLAIMED})"
            )
        else:
            status = "unknown"

        return {
            "status": status,
            "issue_number": issue_number,
            "labels": labels,
            "has_available_label": has_available,
            "has_claimed_label": has_claimed,
            "claim_metadata": claim_metadata,
            "claimed_by": claim_metadata.get("claimed_by") if claim_metadata else None,
            "claim_id": claim_metadata.get("claim_id") if claim_metadata else None,
            "claim_timestamp": claim_metadata.get("timestamp") if claim_metadata else None,
        }

    def format_release_comment(
        self,
        fork_owner: str,
        claim_id: str | None = None,
        reason: str | None = None,
    ) -> str:
        """
        Format a release comment for posting to GitHub.

        Args:
            fork_owner: GitHub username of the fork owner releasing the claim
            claim_id: Optional claim ID being released
            reason: Optional reason for release

        Returns:
            Formatted release comment body
        """
        from datetime import datetime, timezone

        timestamp = datetime.now(timezone.utc).isoformat()

        lines = [
            f"## Task Released by @{fork_owner}",
            "",
            f"**Released At:** {timestamp}",
        ]

        if claim_id:
            lines.append(f"**Claim ID:** `{claim_id}`")

        if reason:
            lines.extend(["", f"**Reason:** {reason}"])

        lines.extend([
            "",
            "---",
            "*This task is now available for claiming by other contributors.*",
        ])

        return "\n".join(lines)

    async def post_release_comment(
        self,
        issue_number: int,
        fork_owner: str,
        claim_id: str | None = None,
        reason: str | None = None,
    ) -> None:
        """
        Post a release comment to an issue.

        Args:
            issue_number: Issue number to comment on
            fork_owner: GitHub username of the fork owner
            claim_id: Optional claim ID being released
            reason: Optional reason for release

        Raises:
            GHCommandError: If the comment fails to post
        """
        comment_body = self.format_release_comment(
            fork_owner=fork_owner,
            claim_id=claim_id,
            reason=reason,
        )
        await self.issue_comment(issue_number, comment_body)
        logger.info(
            f"Posted release comment for @{fork_owner} on issue #{issue_number}"
        )

    async def claim_issue(
        self,
        issue_number: int,
        fork_owner: str,
        claim_id: str,
        reputation_data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Claim an issue by updating labels and posting a claim comment.

        This is a convenience method that performs the full claim operation:
        1. Adds task:claimed label
        2. Removes task:available label
        3. Posts claim comment with metadata

        Args:
            issue_number: Issue number to claim
            fork_owner: GitHub username of the fork owner
            claim_id: Unique claim identifier
            reputation_data: Optional reputation info dict

        Returns:
            Dict with claim result:
            {
                "success": bool,
                "issue_number": int,
                "claim_id": str,
                "claimed_by": str,
            }

        Raises:
            GHCommandError: If any step fails
        """
        # Add claimed label
        await self.issue_add_labels(issue_number, [self.LABEL_CLAIMED])

        # Remove available label (don't raise on error - might not exist)
        await self.issue_remove_labels(issue_number, [self.LABEL_AVAILABLE])

        # Post claim comment
        await self.post_claim_comment(
            issue_number=issue_number,
            fork_owner=fork_owner,
            claim_id=claim_id,
            reputation_data=reputation_data,
        )

        logger.info(
            f"Successfully claimed issue #{issue_number} for @{fork_owner} "
            f"(claim_id: {claim_id})"
        )

        return {
            "success": True,
            "issue_number": issue_number,
            "claim_id": claim_id,
            "claimed_by": fork_owner,
        }

    async def release_issue(
        self,
        issue_number: int,
        fork_owner: str,
        claim_id: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """
        Release a claimed issue by updating labels and posting a release comment.

        This is a convenience method that performs the full release operation:
        1. Removes task:claimed label
        2. Adds task:available label
        3. Posts release comment

        Args:
            issue_number: Issue number to release
            fork_owner: GitHub username of the fork owner
            claim_id: Optional claim ID being released
            reason: Optional reason for release

        Returns:
            Dict with release result:
            {
                "success": bool,
                "issue_number": int,
                "released_by": str,
            }

        Raises:
            GHCommandError: If any step fails
        """
        # Remove claimed label (don't raise on error - might not exist)
        await self.issue_remove_labels(issue_number, [self.LABEL_CLAIMED])

        # Add available label
        await self.issue_add_labels(issue_number, [self.LABEL_AVAILABLE])

        # Post release comment
        await self.post_release_comment(
            issue_number=issue_number,
            fork_owner=fork_owner,
            claim_id=claim_id,
            reason=reason,
        )

        logger.info(
            f"Successfully released issue #{issue_number} by @{fork_owner}"
        )

        return {
            "success": True,
            "issue_number": issue_number,
            "released_by": fork_owner,
        }
