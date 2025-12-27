"""
Fork Reputation Tracking
========================

Tracks fork reliability and contribution quality for distributed task coordination.

Features:
- ForkReputation model for tracking fork scores and history
- Score adjustments for merges (+10), abandons (-5), timeouts (-3)
- Time-based decay to prevent gaming and reward active contributors
- Persistence via GitHub API (issue comments) or local JSON files

Usage:
    tracker = ReputationTracker(state_dir=Path(".auto-claude/github"))

    # Record a successful PR merge
    tracker.record_merge("fork-owner", issue_number=123)

    # Record a claim timeout
    tracker.record_timeout("fork-owner", issue_number=456)

    # Get fork reputation
    reputation = tracker.get_reputation("fork-owner")
    print(f"Score: {reputation.score}")

    # Get claim metadata with reputation
    metadata = tracker.get_claim_metadata("fork-owner", claim_id="abc123")
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any


class ReputationEventType(str, Enum):
    """Types of events that affect reputation score."""

    PR_MERGED = "pr_merged"  # +10 points
    CLAIM_ABANDONED = "claim_abandoned"  # -5 points
    CLAIM_TIMEOUT = "claim_timeout"  # -3 points
    CLAIM_COMPLETED = "claim_completed"  # Neutral, tracked for history
    CLAIM_RELEASED = "claim_released"  # Neutral, voluntary release
    DECAY_APPLIED = "decay_applied"  # Time-based decay

    @property
    def score_delta(self) -> int:
        """Get the score change for this event type."""
        deltas = {
            ReputationEventType.PR_MERGED: 10,
            ReputationEventType.CLAIM_ABANDONED: -5,
            ReputationEventType.CLAIM_TIMEOUT: -3,
            ReputationEventType.CLAIM_COMPLETED: 0,
            ReputationEventType.CLAIM_RELEASED: 0,
            ReputationEventType.DECAY_APPLIED: 0,
        }
        return deltas.get(self, 0)


class ReputationTier(str, Enum):
    """Reputation tiers for displaying fork trustworthiness."""

    NEW = "new"  # No history, default tier
    BRONZE = "bronze"  # 1-24 points
    SILVER = "silver"  # 25-49 points
    GOLD = "gold"  # 50-99 points
    PLATINUM = "platinum"  # 100+ points

    @classmethod
    def from_score(cls, score: int) -> ReputationTier:
        """Get tier from score."""
        if score <= 0:
            return cls.NEW
        elif score < 25:
            return cls.BRONZE
        elif score < 50:
            return cls.SILVER
        elif score < 100:
            return cls.GOLD
        else:
            return cls.PLATINUM


@dataclass
class ReputationEvent:
    """
    A single reputation-affecting event.

    Stored for audit trail and history analysis.
    """

    event_id: str
    event_type: ReputationEventType
    fork_owner: str
    issue_number: int | None = None
    claim_id: str | None = None
    score_delta: int = 0
    score_after: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type.value,
            "fork_owner": self.fork_owner,
            "issue_number": self.issue_number,
            "claim_id": self.claim_id,
            "score_delta": self.score_delta,
            "score_after": self.score_after,
            "created_at": self.created_at.isoformat(),
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ReputationEvent:
        return cls(
            event_id=data["event_id"],
            event_type=ReputationEventType(data["event_type"]),
            fork_owner=data["fork_owner"],
            issue_number=data.get("issue_number"),
            claim_id=data.get("claim_id"),
            score_delta=data.get("score_delta", 0),
            score_after=data.get("score_after", 0),
            created_at=datetime.fromisoformat(data["created_at"]),
            metadata=data.get("metadata", {}),
        )


@dataclass
class ReputationStats:
    """Statistics for a fork's reputation history."""

    total_claims: int = 0
    successful_merges: int = 0
    abandoned_claims: int = 0
    timed_out_claims: int = 0
    released_claims: int = 0

    @property
    def completion_rate(self) -> float:
        """Rate of claims that resulted in merged PRs."""
        if self.total_claims == 0:
            return 0.0
        return self.successful_merges / self.total_claims

    @property
    def reliability_score(self) -> float:
        """Reliability score (0-1) based on successful vs abandoned/timed out."""
        total_outcomes = (
            self.successful_merges + self.abandoned_claims + self.timed_out_claims
        )
        if total_outcomes == 0:
            return 0.5  # Neutral for new forks
        return self.successful_merges / total_outcomes

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_claims": self.total_claims,
            "successful_merges": self.successful_merges,
            "abandoned_claims": self.abandoned_claims,
            "timed_out_claims": self.timed_out_claims,
            "released_claims": self.released_claims,
            "completion_rate": self.completion_rate,
            "reliability_score": self.reliability_score,
        }


@dataclass
class ForkReputation:
    """
    Reputation state for a single fork.

    Tracks score, history, and statistics.
    """

    fork_owner: str
    score: int = 0
    tier: ReputationTier = ReputationTier.NEW
    stats: ReputationStats = field(default_factory=ReputationStats)
    last_activity_at: datetime | None = None
    first_activity_at: datetime | None = None
    last_decay_at: datetime | None = None
    events: list[ReputationEvent] = field(default_factory=list)

    # Configuration
    max_events_kept: int = 100  # Keep last N events in memory

    def __post_init__(self) -> None:
        """Update tier based on current score."""
        self.tier = ReputationTier.from_score(self.score)

    @property
    def days_active(self) -> int:
        """Days since first activity."""
        if not self.first_activity_at:
            return 0
        now = datetime.now(timezone.utc)
        return (now - self.first_activity_at).days

    @property
    def days_since_last_activity(self) -> int:
        """Days since last activity."""
        if not self.last_activity_at:
            return 0
        now = datetime.now(timezone.utc)
        return (now - self.last_activity_at).days

    def add_event(self, event: ReputationEvent) -> None:
        """Add an event and update stats."""
        self.events.append(event)
        self.score = event.score_after
        self.tier = ReputationTier.from_score(self.score)

        now = datetime.now(timezone.utc)
        self.last_activity_at = now
        if not self.first_activity_at:
            self.first_activity_at = now

        # Update stats based on event type
        if event.event_type == ReputationEventType.PR_MERGED:
            self.stats.successful_merges += 1
            self.stats.total_claims += 1
        elif event.event_type == ReputationEventType.CLAIM_ABANDONED:
            self.stats.abandoned_claims += 1
            self.stats.total_claims += 1
        elif event.event_type == ReputationEventType.CLAIM_TIMEOUT:
            self.stats.timed_out_claims += 1
            self.stats.total_claims += 1
        elif event.event_type == ReputationEventType.CLAIM_RELEASED:
            self.stats.released_claims += 1
            self.stats.total_claims += 1
        elif event.event_type == ReputationEventType.DECAY_APPLIED:
            self.last_decay_at = now

        # Trim old events
        if len(self.events) > self.max_events_kept:
            self.events = self.events[-self.max_events_kept :]

    def get_recent_events(self, limit: int = 10) -> list[ReputationEvent]:
        """Get recent events, most recent first."""
        return list(reversed(self.events[-limit:]))

    def to_dict(self) -> dict[str, Any]:
        return {
            "fork_owner": self.fork_owner,
            "score": self.score,
            "tier": self.tier.value,
            "stats": self.stats.to_dict(),
            "last_activity_at": self.last_activity_at.isoformat()
            if self.last_activity_at
            else None,
            "first_activity_at": self.first_activity_at.isoformat()
            if self.first_activity_at
            else None,
            "last_decay_at": self.last_decay_at.isoformat()
            if self.last_decay_at
            else None,
            "events": [e.to_dict() for e in self.events[-50:]],  # Keep last 50 in JSON
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ForkReputation:
        stats = ReputationStats(
            total_claims=data.get("stats", {}).get("total_claims", 0),
            successful_merges=data.get("stats", {}).get("successful_merges", 0),
            abandoned_claims=data.get("stats", {}).get("abandoned_claims", 0),
            timed_out_claims=data.get("stats", {}).get("timed_out_claims", 0),
            released_claims=data.get("stats", {}).get("released_claims", 0),
        )

        events = [
            ReputationEvent.from_dict(e) for e in data.get("events", [])
        ]

        last_activity = None
        if data.get("last_activity_at"):
            last_activity = datetime.fromisoformat(data["last_activity_at"])

        first_activity = None
        if data.get("first_activity_at"):
            first_activity = datetime.fromisoformat(data["first_activity_at"])

        last_decay = None
        if data.get("last_decay_at"):
            last_decay = datetime.fromisoformat(data["last_decay_at"])

        return cls(
            fork_owner=data["fork_owner"],
            score=data.get("score", 0),
            tier=ReputationTier(data.get("tier", "new")),
            stats=stats,
            last_activity_at=last_activity,
            first_activity_at=first_activity,
            last_decay_at=last_decay,
            events=events,
        )


class ReputationTracker:
    """
    Tracks fork reputation across the system.

    Usage:
        tracker = ReputationTracker(state_dir=Path(".auto-claude/github"))

        # Record events
        tracker.record_merge("fork-owner", issue_number=123)
        tracker.record_timeout("fork-owner", issue_number=456)
        tracker.record_abandon("fork-owner", issue_number=789)

        # Query reputation
        rep = tracker.get_reputation("fork-owner")
        print(f"Score: {rep.score}, Tier: {rep.tier.value}")

        # Get claim metadata for comments
        metadata = tracker.get_claim_metadata("fork-owner", claim_id="abc123")
    """

    # Decay configuration
    DECAY_INTERVAL_DAYS = 30  # Apply decay every 30 days of inactivity
    DECAY_RATE = 0.1  # Decay 10% of score per interval
    MIN_SCORE = 0  # Score cannot go below this

    def __init__(self, state_dir: Path | None = None):
        """
        Initialize reputation tracker.

        Args:
            state_dir: Directory for state persistence. If None, uses in-memory only.
        """
        self.state_dir = state_dir
        if state_dir:
            self.reputation_dir = state_dir / "reputation"
            self.reputation_dir.mkdir(parents=True, exist_ok=True)
        else:
            self.reputation_dir = None

        self._reputations: dict[str, ForkReputation] = {}
        self._load_all()

    def _get_reputation_file(self, fork_owner: str) -> Path | None:
        """Get path to reputation file for a fork."""
        if not self.reputation_dir:
            return None
        safe_name = fork_owner.replace("/", "_").replace("\\", "_")
        return self.reputation_dir / f"{safe_name}.json"

    def _load_all(self) -> None:
        """Load all reputation data from disk."""
        if not self.reputation_dir:
            return

        for file in self.reputation_dir.glob("*.json"):
            try:
                with open(file) as f:
                    data = json.load(f)
                    reputation = ForkReputation.from_dict(data)
                    self._reputations[reputation.fork_owner] = reputation
            except (json.JSONDecodeError, KeyError, ValueError):
                continue

    def _save(self, fork_owner: str) -> None:
        """Save reputation data for a fork with file locking."""
        if not self.reputation_dir:
            return

        reputation = self._reputations.get(fork_owner)
        if not reputation:
            return

        file = self._get_reputation_file(fork_owner)
        if not file:
            return

        # Try to use file locking if available
        try:
            from .file_lock import FileLock, atomic_write

            with FileLock(file, timeout=5.0):
                with atomic_write(file) as f:
                    json.dump(reputation.to_dict(), f, indent=2)
        except ImportError:
            # Fall back to simple write if file_lock not available
            with open(file, "w") as f:
                json.dump(reputation.to_dict(), f, indent=2)

    def _generate_event_id(self) -> str:
        """Generate a unique event ID."""
        import uuid

        return f"evt-{uuid.uuid4().hex[:12]}"

    def get_reputation(self, fork_owner: str) -> ForkReputation:
        """
        Get reputation for a fork.

        Creates a new entry if fork is not tracked yet.

        Args:
            fork_owner: The fork owner's username

        Returns:
            ForkReputation instance
        """
        if fork_owner not in self._reputations:
            self._reputations[fork_owner] = ForkReputation(fork_owner=fork_owner)
        return self._reputations[fork_owner]

    def _record_event(
        self,
        fork_owner: str,
        event_type: ReputationEventType,
        issue_number: int | None = None,
        claim_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ReputationEvent:
        """
        Record a reputation event.

        Args:
            fork_owner: Fork owner's username
            event_type: Type of event
            issue_number: Related issue number
            claim_id: Related claim ID
            metadata: Additional metadata

        Returns:
            The created event
        """
        reputation = self.get_reputation(fork_owner)

        # Apply any pending decay first
        self._apply_decay(fork_owner)

        # Calculate new score
        score_delta = event_type.score_delta
        new_score = max(self.MIN_SCORE, reputation.score + score_delta)

        event = ReputationEvent(
            event_id=self._generate_event_id(),
            event_type=event_type,
            fork_owner=fork_owner,
            issue_number=issue_number,
            claim_id=claim_id,
            score_delta=score_delta,
            score_after=new_score,
            metadata=metadata or {},
        )

        reputation.add_event(event)
        self._save(fork_owner)

        return event

    def record_merge(
        self,
        fork_owner: str,
        issue_number: int | None = None,
        claim_id: str | None = None,
        pr_number: int | None = None,
        pr_url: str | None = None,
    ) -> ReputationEvent:
        """
        Record a successful PR merge (+10 points).

        Args:
            fork_owner: Fork owner's username
            issue_number: Related issue number
            claim_id: Claim ID that was completed
            pr_number: PR number that was merged
            pr_url: URL to the merged PR

        Returns:
            The created event
        """
        metadata = {}
        if pr_number:
            metadata["pr_number"] = pr_number
        if pr_url:
            metadata["pr_url"] = pr_url

        return self._record_event(
            fork_owner=fork_owner,
            event_type=ReputationEventType.PR_MERGED,
            issue_number=issue_number,
            claim_id=claim_id,
            metadata=metadata,
        )

    def record_abandon(
        self,
        fork_owner: str,
        issue_number: int | None = None,
        claim_id: str | None = None,
        reason: str | None = None,
    ) -> ReputationEvent:
        """
        Record a claim abandonment (-5 points).

        Args:
            fork_owner: Fork owner's username
            issue_number: Related issue number
            claim_id: Claim ID that was abandoned
            reason: Reason for abandonment

        Returns:
            The created event
        """
        metadata = {}
        if reason:
            metadata["reason"] = reason

        return self._record_event(
            fork_owner=fork_owner,
            event_type=ReputationEventType.CLAIM_ABANDONED,
            issue_number=issue_number,
            claim_id=claim_id,
            metadata=metadata,
        )

    def record_timeout(
        self,
        fork_owner: str,
        issue_number: int | None = None,
        claim_id: str | None = None,
        days_stale: int | None = None,
    ) -> ReputationEvent:
        """
        Record a claim timeout (-3 points).

        Args:
            fork_owner: Fork owner's username
            issue_number: Related issue number
            claim_id: Claim ID that timed out
            days_stale: How many days the claim was stale

        Returns:
            The created event
        """
        metadata = {}
        if days_stale is not None:
            metadata["days_stale"] = days_stale

        return self._record_event(
            fork_owner=fork_owner,
            event_type=ReputationEventType.CLAIM_TIMEOUT,
            issue_number=issue_number,
            claim_id=claim_id,
            metadata=metadata,
        )

    def record_release(
        self,
        fork_owner: str,
        issue_number: int | None = None,
        claim_id: str | None = None,
        reason: str | None = None,
    ) -> ReputationEvent:
        """
        Record a voluntary claim release (no penalty).

        Args:
            fork_owner: Fork owner's username
            issue_number: Related issue number
            claim_id: Claim ID that was released
            reason: Reason for release

        Returns:
            The created event
        """
        metadata = {}
        if reason:
            metadata["reason"] = reason

        return self._record_event(
            fork_owner=fork_owner,
            event_type=ReputationEventType.CLAIM_RELEASED,
            issue_number=issue_number,
            claim_id=claim_id,
            metadata=metadata,
        )

    def _apply_decay(self, fork_owner: str) -> bool:
        """
        Apply time-based decay to reputation score.

        Decay is applied for each DECAY_INTERVAL_DAYS of inactivity.

        Args:
            fork_owner: Fork owner's username

        Returns:
            True if decay was applied, False otherwise
        """
        reputation = self.get_reputation(fork_owner)

        if reputation.score <= 0:
            return False

        if not reputation.last_activity_at:
            return False

        # Calculate days since last activity
        now = datetime.now(timezone.utc)
        days_inactive = (now - reputation.last_activity_at).days

        # Check when we last applied decay
        last_decay_check = reputation.last_decay_at or reputation.last_activity_at
        days_since_decay_check = (now - last_decay_check).days

        # Only apply decay if enough time has passed since last check
        if days_since_decay_check < self.DECAY_INTERVAL_DAYS:
            return False

        # Calculate number of decay periods
        decay_periods = days_inactive // self.DECAY_INTERVAL_DAYS

        if decay_periods <= 0:
            return False

        # Apply decay: score * (1 - decay_rate) ^ periods
        decay_multiplier = math.pow(1 - self.DECAY_RATE, decay_periods)
        old_score = reputation.score
        new_score = max(self.MIN_SCORE, int(old_score * decay_multiplier))

        if new_score == old_score:
            reputation.last_decay_at = now
            return False

        # Record decay event
        decay_amount = old_score - new_score
        event = ReputationEvent(
            event_id=self._generate_event_id(),
            event_type=ReputationEventType.DECAY_APPLIED,
            fork_owner=fork_owner,
            score_delta=-decay_amount,
            score_after=new_score,
            metadata={
                "days_inactive": days_inactive,
                "decay_periods": decay_periods,
                "decay_rate": self.DECAY_RATE,
            },
        )

        reputation.score = new_score
        reputation.tier = ReputationTier.from_score(new_score)
        reputation.last_decay_at = now
        reputation.events.append(event)

        return True

    def apply_decay_all(self) -> int:
        """
        Apply decay to all tracked forks.

        Returns:
            Number of forks that had decay applied
        """
        decayed_count = 0
        for fork_owner in list(self._reputations.keys()):
            if self._apply_decay(fork_owner):
                self._save(fork_owner)
                decayed_count += 1
        return decayed_count

    def get_claim_metadata(
        self,
        fork_owner: str,
        claim_id: str,
        issue_number: int | None = None,
    ) -> dict[str, Any]:
        """
        Get metadata for a claim comment.

        This is used when posting claim comments to GitHub issues.

        Args:
            fork_owner: Fork owner's username
            claim_id: Unique claim ID
            issue_number: Issue number being claimed

        Returns:
            Metadata dict suitable for JSON embedding in comments
        """
        reputation = self.get_reputation(fork_owner)

        return {
            "claimed_by": fork_owner,
            "claim_id": claim_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "fork_reputation": {
                "score": reputation.score,
                "tier": reputation.tier.value,
                "total_claims": reputation.stats.total_claims,
                "successful_merges": reputation.stats.successful_merges,
                "reliability_score": round(reputation.stats.reliability_score, 2),
            },
            "issue_number": issue_number,
        }

    def parse_claim_metadata(self, comment_body: str) -> dict[str, Any] | None:
        """
        Parse claim metadata from a GitHub comment body.

        Expects JSON in a code block or at the end of the comment.

        Args:
            comment_body: The comment body text

        Returns:
            Parsed metadata dict, or None if not found/invalid
        """
        import re

        # Try to find JSON in a code block
        code_block_pattern = r"```json?\s*\n(.*?)\n```"
        match = re.search(code_block_pattern, comment_body, re.DOTALL)

        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        # Try to find JSON at the end (hidden in HTML comment)
        html_comment_pattern = r"<!--\s*CLAIM_METADATA:\s*(.*?)\s*-->"
        match = re.search(html_comment_pattern, comment_body, re.DOTALL)

        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass

        return None

    def format_claim_comment(
        self,
        fork_owner: str,
        claim_id: str,
        issue_number: int | None = None,
    ) -> str:
        """
        Format a claim comment for posting to GitHub.

        Args:
            fork_owner: Fork owner's username
            claim_id: Unique claim ID
            issue_number: Issue number being claimed

        Returns:
            Formatted comment body with embedded metadata
        """
        metadata = self.get_claim_metadata(fork_owner, claim_id, issue_number)
        reputation = self.get_reputation(fork_owner)

        lines = [
            f"## Task Claimed by @{fork_owner}",
            "",
            f"**Claim ID:** `{claim_id}`",
            f"**Timestamp:** {metadata['timestamp']}",
            "",
            "### Fork Reputation",
            f"- **Score:** {reputation.score} ({reputation.tier.value})",
            f"- **Completed Tasks:** {reputation.stats.successful_merges}",
            f"- **Reliability:** {reputation.stats.reliability_score:.0%}",
            "",
            "---",
            "*This claim will expire in 7 days if no PR is submitted.*",
            "",
            f"<!-- CLAIM_METADATA: {json.dumps(metadata)} -->",
        ]

        return "\n".join(lines)

    def get_leaderboard(self, limit: int = 10) -> list[dict[str, Any]]:
        """
        Get top forks by reputation score.

        Args:
            limit: Maximum number of entries to return

        Returns:
            List of dicts with fork info, sorted by score descending
        """
        forks = sorted(
            self._reputations.values(),
            key=lambda r: (r.score, r.stats.successful_merges),
            reverse=True,
        )[:limit]

        return [
            {
                "rank": i + 1,
                "fork_owner": rep.fork_owner,
                "score": rep.score,
                "tier": rep.tier.value,
                "successful_merges": rep.stats.successful_merges,
                "total_claims": rep.stats.total_claims,
                "reliability": round(rep.stats.reliability_score, 2),
                "days_active": rep.days_active,
            }
            for i, rep in enumerate(forks)
        ]

    def get_summary(self) -> dict[str, Any]:
        """
        Get summary statistics for all tracked forks.

        Returns:
            Summary dict with aggregate statistics
        """
        if not self._reputations:
            return {
                "total_forks": 0,
                "total_claims": 0,
                "total_merges": 0,
                "by_tier": {},
                "average_score": 0,
                "average_reliability": 0,
            }

        total_claims = sum(r.stats.total_claims for r in self._reputations.values())
        total_merges = sum(
            r.stats.successful_merges for r in self._reputations.values()
        )

        by_tier: dict[str, int] = {}
        for rep in self._reputations.values():
            tier = rep.tier.value
            by_tier[tier] = by_tier.get(tier, 0) + 1

        scores = [r.score for r in self._reputations.values()]
        reliabilities = [
            r.stats.reliability_score
            for r in self._reputations.values()
            if r.stats.total_claims > 0
        ]

        return {
            "total_forks": len(self._reputations),
            "total_claims": total_claims,
            "total_merges": total_merges,
            "by_tier": by_tier,
            "average_score": sum(scores) / len(scores) if scores else 0,
            "average_reliability": sum(reliabilities) / len(reliabilities)
            if reliabilities
            else 0,
        }

    def export_for_github(self) -> str:
        """
        Export reputation data for storage in GitHub (e.g., issue comments).

        Returns:
            JSON string suitable for embedding in a GitHub comment
        """
        data = {
            "version": "1.0",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "summary": self.get_summary(),
            "forks": {
                owner: rep.to_dict() for owner, rep in self._reputations.items()
            },
        }
        return json.dumps(data, indent=2)

    def import_from_github(self, json_str: str) -> int:
        """
        Import reputation data from GitHub storage.

        Args:
            json_str: JSON string from GitHub comment

        Returns:
            Number of fork records imported
        """
        try:
            data = json.loads(json_str)
            forks_data = data.get("forks", {})

            for owner, rep_data in forks_data.items():
                self._reputations[owner] = ForkReputation.from_dict(rep_data)
                self._save(owner)

            return len(forks_data)
        except (json.JSONDecodeError, KeyError, ValueError):
            return 0
