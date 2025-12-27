"""
Tests for Fork Reputation Tracker
=================================

Tests the ReputationTracker class and related models for tracking
fork contribution quality and reliability.
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


# Import from local directory (same as pattern files)
from reputation_tracker import (
    ForkReputation,
    ReputationEvent,
    ReputationEventType,
    ReputationStats,
    ReputationTier,
    ReputationTracker,
)


@pytest.fixture
def temp_state_dir(tmp_path):
    """Create temporary state directory."""
    state_dir = tmp_path / "github"
    state_dir.mkdir()
    return state_dir


@pytest.fixture
def tracker(temp_state_dir):
    """Create a ReputationTracker with temporary state directory."""
    return ReputationTracker(state_dir=temp_state_dir)


@pytest.fixture
def in_memory_tracker():
    """Create a ReputationTracker without persistence."""
    return ReputationTracker(state_dir=None)


class TestReputationEventType:
    """Test ReputationEventType enum."""

    def test_score_deltas(self):
        """Test score deltas for each event type."""
        assert ReputationEventType.PR_MERGED.score_delta == 10
        assert ReputationEventType.CLAIM_ABANDONED.score_delta == -5
        assert ReputationEventType.CLAIM_TIMEOUT.score_delta == -3
        assert ReputationEventType.CLAIM_COMPLETED.score_delta == 0
        assert ReputationEventType.CLAIM_RELEASED.score_delta == 0
        assert ReputationEventType.DECAY_APPLIED.score_delta == 0

    def test_enum_values(self):
        """Test enum string values."""
        assert ReputationEventType.PR_MERGED.value == "pr_merged"
        assert ReputationEventType.CLAIM_ABANDONED.value == "claim_abandoned"
        assert ReputationEventType.CLAIM_TIMEOUT.value == "claim_timeout"


class TestReputationTier:
    """Test ReputationTier enum and scoring."""

    def test_from_score_new(self):
        """Test NEW tier for zero or negative scores."""
        assert ReputationTier.from_score(0) == ReputationTier.NEW
        assert ReputationTier.from_score(-10) == ReputationTier.NEW

    def test_from_score_bronze(self):
        """Test BRONZE tier for scores 1-24."""
        assert ReputationTier.from_score(1) == ReputationTier.BRONZE
        assert ReputationTier.from_score(24) == ReputationTier.BRONZE

    def test_from_score_silver(self):
        """Test SILVER tier for scores 25-49."""
        assert ReputationTier.from_score(25) == ReputationTier.SILVER
        assert ReputationTier.from_score(49) == ReputationTier.SILVER

    def test_from_score_gold(self):
        """Test GOLD tier for scores 50-99."""
        assert ReputationTier.from_score(50) == ReputationTier.GOLD
        assert ReputationTier.from_score(99) == ReputationTier.GOLD

    def test_from_score_platinum(self):
        """Test PLATINUM tier for scores 100+."""
        assert ReputationTier.from_score(100) == ReputationTier.PLATINUM
        assert ReputationTier.from_score(500) == ReputationTier.PLATINUM


class TestReputationEvent:
    """Test ReputationEvent data class."""

    def test_to_dict(self):
        """Test serialization to dict."""
        event = ReputationEvent(
            event_id="evt-123",
            event_type=ReputationEventType.PR_MERGED,
            fork_owner="test-fork",
            issue_number=42,
            claim_id="claim-abc",
            score_delta=10,
            score_after=25,
            created_at=datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
            metadata={"pr_number": 100},
        )

        data = event.to_dict()

        assert data["event_id"] == "evt-123"
        assert data["event_type"] == "pr_merged"
        assert data["fork_owner"] == "test-fork"
        assert data["issue_number"] == 42
        assert data["claim_id"] == "claim-abc"
        assert data["score_delta"] == 10
        assert data["score_after"] == 25
        assert "2025-01-01" in data["created_at"]
        assert data["metadata"]["pr_number"] == 100

    def test_from_dict(self):
        """Test deserialization from dict."""
        data = {
            "event_id": "evt-456",
            "event_type": "claim_abandoned",
            "fork_owner": "other-fork",
            "issue_number": 99,
            "claim_id": "claim-xyz",
            "score_delta": -5,
            "score_after": 15,
            "created_at": "2025-01-15T10:30:00+00:00",
            "metadata": {"reason": "no time"},
        }

        event = ReputationEvent.from_dict(data)

        assert event.event_id == "evt-456"
        assert event.event_type == ReputationEventType.CLAIM_ABANDONED
        assert event.fork_owner == "other-fork"
        assert event.issue_number == 99
        assert event.score_delta == -5
        assert event.metadata["reason"] == "no time"

    def test_round_trip(self):
        """Test serialization round-trip."""
        event = ReputationEvent(
            event_id="evt-rt",
            event_type=ReputationEventType.CLAIM_TIMEOUT,
            fork_owner="round-trip-fork",
            score_delta=-3,
            score_after=7,
        )

        data = event.to_dict()
        restored = ReputationEvent.from_dict(data)

        assert restored.event_id == event.event_id
        assert restored.event_type == event.event_type
        assert restored.fork_owner == event.fork_owner
        assert restored.score_delta == event.score_delta


class TestReputationStats:
    """Test ReputationStats data class."""

    def test_completion_rate_empty(self):
        """Test completion rate with no claims."""
        stats = ReputationStats()
        assert stats.completion_rate == 0.0

    def test_completion_rate_with_claims(self):
        """Test completion rate calculation."""
        stats = ReputationStats(
            total_claims=10,
            successful_merges=7,
            abandoned_claims=2,
            timed_out_claims=1,
        )
        assert stats.completion_rate == 0.7

    def test_reliability_score_empty(self):
        """Test reliability score with no outcomes."""
        stats = ReputationStats()
        assert stats.reliability_score == 0.5  # Neutral for new forks

    def test_reliability_score_perfect(self):
        """Test reliability score with all successes."""
        stats = ReputationStats(
            total_claims=5,
            successful_merges=5,
            abandoned_claims=0,
            timed_out_claims=0,
        )
        assert stats.reliability_score == 1.0

    def test_reliability_score_mixed(self):
        """Test reliability score with mixed outcomes."""
        stats = ReputationStats(
            total_claims=10,
            successful_merges=6,
            abandoned_claims=3,
            timed_out_claims=1,
        )
        # 6 / (6 + 3 + 1) = 0.6
        assert stats.reliability_score == 0.6

    def test_to_dict(self):
        """Test stats serialization."""
        stats = ReputationStats(
            total_claims=5,
            successful_merges=3,
            abandoned_claims=1,
            timed_out_claims=1,
            released_claims=0,
        )

        data = stats.to_dict()

        assert data["total_claims"] == 5
        assert data["successful_merges"] == 3
        assert data["completion_rate"] == 0.6
        assert data["reliability_score"] == 0.6


class TestForkReputation:
    """Test ForkReputation data class."""

    def test_initialization(self):
        """Test default initialization."""
        rep = ForkReputation(fork_owner="test-user")

        assert rep.fork_owner == "test-user"
        assert rep.score == 0
        assert rep.tier == ReputationTier.NEW
        assert rep.stats.total_claims == 0
        assert rep.events == []

    def test_tier_auto_update(self):
        """Test tier updates based on score."""
        rep = ForkReputation(fork_owner="test-user", score=50)
        assert rep.tier == ReputationTier.GOLD

    def test_add_event_updates_score(self):
        """Test adding event updates score and tier."""
        rep = ForkReputation(fork_owner="test-user", score=20)

        event = ReputationEvent(
            event_id="evt-1",
            event_type=ReputationEventType.PR_MERGED,
            fork_owner="test-user",
            score_delta=10,
            score_after=30,
        )

        rep.add_event(event)

        assert rep.score == 30
        assert rep.tier == ReputationTier.SILVER
        assert len(rep.events) == 1
        assert rep.stats.successful_merges == 1
        assert rep.stats.total_claims == 1

    def test_add_event_updates_stats_abandon(self):
        """Test stats update for abandon event."""
        rep = ForkReputation(fork_owner="test-user", score=20)

        event = ReputationEvent(
            event_id="evt-1",
            event_type=ReputationEventType.CLAIM_ABANDONED,
            fork_owner="test-user",
            score_delta=-5,
            score_after=15,
        )

        rep.add_event(event)

        assert rep.stats.abandoned_claims == 1
        assert rep.stats.total_claims == 1

    def test_add_event_updates_stats_timeout(self):
        """Test stats update for timeout event."""
        rep = ForkReputation(fork_owner="test-user", score=20)

        event = ReputationEvent(
            event_id="evt-1",
            event_type=ReputationEventType.CLAIM_TIMEOUT,
            fork_owner="test-user",
            score_delta=-3,
            score_after=17,
        )

        rep.add_event(event)

        assert rep.stats.timed_out_claims == 1
        assert rep.stats.total_claims == 1

    def test_add_event_updates_stats_release(self):
        """Test stats update for release event."""
        rep = ForkReputation(fork_owner="test-user", score=20)

        event = ReputationEvent(
            event_id="evt-1",
            event_type=ReputationEventType.CLAIM_RELEASED,
            fork_owner="test-user",
            score_delta=0,
            score_after=20,
        )

        rep.add_event(event)

        assert rep.stats.released_claims == 1
        assert rep.stats.total_claims == 1

    def test_events_trimmed_to_max(self):
        """Test events list is trimmed to max size."""
        rep = ForkReputation(fork_owner="test-user")
        rep.max_events_kept = 5

        for i in range(10):
            event = ReputationEvent(
                event_id=f"evt-{i}",
                event_type=ReputationEventType.PR_MERGED,
                fork_owner="test-user",
                score_delta=10,
                score_after=(i + 1) * 10,
            )
            rep.add_event(event)

        assert len(rep.events) == 5
        assert rep.events[0].event_id == "evt-5"

    def test_get_recent_events(self):
        """Test getting recent events in reverse order."""
        rep = ForkReputation(fork_owner="test-user")

        for i in range(5):
            event = ReputationEvent(
                event_id=f"evt-{i}",
                event_type=ReputationEventType.PR_MERGED,
                fork_owner="test-user",
                score_delta=10,
                score_after=(i + 1) * 10,
            )
            rep.add_event(event)

        recent = rep.get_recent_events(3)

        assert len(recent) == 3
        assert recent[0].event_id == "evt-4"  # Most recent first
        assert recent[2].event_id == "evt-2"

    def test_days_active_no_activity(self):
        """Test days active with no activity."""
        rep = ForkReputation(fork_owner="test-user")
        assert rep.days_active == 0

    def test_days_since_last_activity_no_activity(self):
        """Test days since last activity with no activity."""
        rep = ForkReputation(fork_owner="test-user")
        assert rep.days_since_last_activity == 0

    def test_to_dict_and_from_dict(self):
        """Test serialization round-trip."""
        rep = ForkReputation(fork_owner="test-user", score=50)
        rep.stats.successful_merges = 5
        rep.stats.total_claims = 7

        data = rep.to_dict()
        restored = ForkReputation.from_dict(data)

        assert restored.fork_owner == "test-user"
        assert restored.score == 50
        assert restored.tier == ReputationTier.GOLD
        assert restored.stats.successful_merges == 5


class TestReputationTrackerInit:
    """Test ReputationTracker initialization."""

    def test_init_with_state_dir(self, temp_state_dir):
        """Test initialization with state directory."""
        tracker = ReputationTracker(state_dir=temp_state_dir)

        assert tracker.state_dir == temp_state_dir
        assert tracker.reputation_dir == temp_state_dir / "reputation"
        assert tracker.reputation_dir.exists()

    def test_init_without_state_dir(self):
        """Test initialization without state directory."""
        tracker = ReputationTracker(state_dir=None)

        assert tracker.state_dir is None
        assert tracker.reputation_dir is None

    def test_load_existing_data(self, temp_state_dir):
        """Test loading existing reputation data."""
        # Create reputation data file
        reputation_dir = temp_state_dir / "reputation"
        reputation_dir.mkdir()

        rep_data = {
            "fork_owner": "existing-fork",
            "score": 45,
            "tier": "silver",
            "stats": {
                "total_claims": 5,
                "successful_merges": 4,
                "abandoned_claims": 1,
                "timed_out_claims": 0,
                "released_claims": 0,
            },
            "events": [],
        }

        with open(reputation_dir / "existing-fork.json", "w") as f:
            json.dump(rep_data, f)

        tracker = ReputationTracker(state_dir=temp_state_dir)
        rep = tracker.get_reputation("existing-fork")

        assert rep.score == 45
        assert rep.tier == ReputationTier.SILVER


class TestRecordEvents:
    """Test event recording methods."""

    def test_record_merge(self, in_memory_tracker):
        """Test recording a successful PR merge."""
        event = in_memory_tracker.record_merge(
            fork_owner="test-fork",
            issue_number=123,
            claim_id="claim-abc",
            pr_number=456,
        )

        assert event.event_type == ReputationEventType.PR_MERGED
        assert event.score_delta == 10
        assert event.score_after == 10
        assert event.issue_number == 123
        assert event.metadata["pr_number"] == 456

        rep = in_memory_tracker.get_reputation("test-fork")
        assert rep.score == 10
        assert rep.stats.successful_merges == 1

    def test_record_abandon(self, in_memory_tracker):
        """Test recording a claim abandonment."""
        # First give some points
        in_memory_tracker.record_merge("test-fork", issue_number=1)

        event = in_memory_tracker.record_abandon(
            fork_owner="test-fork",
            issue_number=123,
            reason="too busy",
        )

        assert event.event_type == ReputationEventType.CLAIM_ABANDONED
        assert event.score_delta == -5
        assert event.score_after == 5
        assert event.metadata["reason"] == "too busy"

        rep = in_memory_tracker.get_reputation("test-fork")
        assert rep.score == 5
        assert rep.stats.abandoned_claims == 1

    def test_record_timeout(self, in_memory_tracker):
        """Test recording a claim timeout."""
        # First give some points
        in_memory_tracker.record_merge("test-fork", issue_number=1)

        event = in_memory_tracker.record_timeout(
            fork_owner="test-fork",
            issue_number=123,
            days_stale=8,
        )

        assert event.event_type == ReputationEventType.CLAIM_TIMEOUT
        assert event.score_delta == -3
        assert event.score_after == 7
        assert event.metadata["days_stale"] == 8

        rep = in_memory_tracker.get_reputation("test-fork")
        assert rep.stats.timed_out_claims == 1

    def test_record_release(self, in_memory_tracker):
        """Test recording a voluntary release."""
        # First give some points
        in_memory_tracker.record_merge("test-fork", issue_number=1)

        event = in_memory_tracker.record_release(
            fork_owner="test-fork",
            issue_number=123,
            reason="realized cannot complete",
        )

        assert event.event_type == ReputationEventType.CLAIM_RELEASED
        assert event.score_delta == 0
        assert event.score_after == 10  # No penalty
        assert event.metadata["reason"] == "realized cannot complete"

    def test_score_cannot_go_negative(self, in_memory_tracker):
        """Test score doesn't go below minimum."""
        # Record abandon without any prior points
        event = in_memory_tracker.record_abandon("test-fork", issue_number=1)

        assert event.score_after == 0  # MIN_SCORE

        rep = in_memory_tracker.get_reputation("test-fork")
        assert rep.score == 0

    def test_persistence(self, tracker, temp_state_dir):
        """Test events are persisted to disk."""
        tracker.record_merge("persist-fork", issue_number=1)

        # Create new tracker to read from disk
        new_tracker = ReputationTracker(state_dir=temp_state_dir)
        rep = new_tracker.get_reputation("persist-fork")

        assert rep.score == 10
        assert rep.stats.successful_merges == 1


class TestDecay:
    """Test reputation decay functionality."""

    def test_no_decay_for_new_fork(self, in_memory_tracker):
        """Test decay not applied to new fork."""
        in_memory_tracker.record_merge("test-fork", issue_number=1)

        result = in_memory_tracker._apply_decay("test-fork")

        assert result is False

    def test_no_decay_for_zero_score(self, in_memory_tracker):
        """Test decay not applied to zero score."""
        rep = in_memory_tracker.get_reputation("test-fork")
        rep.score = 0
        rep.last_activity_at = datetime.now(timezone.utc) - timedelta(days=60)

        result = in_memory_tracker._apply_decay("test-fork")

        assert result is False

    def test_decay_applied_after_interval(self, in_memory_tracker):
        """Test decay applied after inactivity interval."""
        # Record a merge to get some points
        in_memory_tracker.record_merge("test-fork", issue_number=1)

        rep = in_memory_tracker.get_reputation("test-fork")
        rep.last_activity_at = datetime.now(timezone.utc) - timedelta(days=60)
        rep.last_decay_at = None

        # Force score high enough to see decay effect
        rep.score = 100

        result = in_memory_tracker._apply_decay("test-fork")

        assert result is True
        assert rep.score < 100

    def test_apply_decay_all(self, in_memory_tracker):
        """Test applying decay to all forks."""
        # Set up multiple forks
        in_memory_tracker.record_merge("fork-1", issue_number=1)
        in_memory_tracker.record_merge("fork-2", issue_number=2)

        # Make both stale
        for fork in ["fork-1", "fork-2"]:
            rep = in_memory_tracker.get_reputation(fork)
            rep.score = 100
            rep.last_activity_at = datetime.now(timezone.utc) - timedelta(days=60)

        count = in_memory_tracker.apply_decay_all()

        assert count == 2


class TestClaimMetadata:
    """Test claim metadata generation and parsing."""

    def test_get_claim_metadata(self, in_memory_tracker):
        """Test generating claim metadata."""
        in_memory_tracker.record_merge("test-fork", issue_number=1)

        metadata = in_memory_tracker.get_claim_metadata(
            fork_owner="test-fork",
            claim_id="claim-123",
            issue_number=42,
        )

        assert metadata["claimed_by"] == "test-fork"
        assert metadata["claim_id"] == "claim-123"
        assert metadata["issue_number"] == 42
        assert "timestamp" in metadata
        assert metadata["fork_reputation"]["score"] == 10
        assert metadata["fork_reputation"]["tier"] == "bronze"

    def test_parse_claim_metadata_code_block(self, in_memory_tracker):
        """Test parsing metadata from code block."""
        comment = """
This is a claim comment.

```json
{"claimed_by": "test-fork", "claim_id": "abc123"}
```
"""
        metadata = in_memory_tracker.parse_claim_metadata(comment)

        assert metadata is not None
        assert metadata["claimed_by"] == "test-fork"
        assert metadata["claim_id"] == "abc123"

    def test_parse_claim_metadata_html_comment(self, in_memory_tracker):
        """Test parsing metadata from HTML comment."""
        comment = """
This is a claim comment.

<!-- CLAIM_METADATA: {"claimed_by": "test-fork", "claim_id": "xyz789"} -->
"""
        metadata = in_memory_tracker.parse_claim_metadata(comment)

        assert metadata is not None
        assert metadata["claimed_by"] == "test-fork"
        assert metadata["claim_id"] == "xyz789"

    def test_parse_claim_metadata_not_found(self, in_memory_tracker):
        """Test parsing when no metadata found."""
        comment = "Just a regular comment with no metadata."

        metadata = in_memory_tracker.parse_claim_metadata(comment)

        assert metadata is None

    def test_parse_claim_metadata_invalid_json(self, in_memory_tracker):
        """Test parsing with invalid JSON."""
        comment = """
```json
{invalid json here}
```
"""
        metadata = in_memory_tracker.parse_claim_metadata(comment)

        assert metadata is None


class TestFormatClaimComment:
    """Test claim comment formatting."""

    def test_format_claim_comment(self, in_memory_tracker):
        """Test formatting a claim comment."""
        in_memory_tracker.record_merge("test-fork", issue_number=1)

        comment = in_memory_tracker.format_claim_comment(
            fork_owner="test-fork",
            claim_id="claim-123",
            issue_number=42,
        )

        assert "Task Claimed by @test-fork" in comment
        assert "claim-123" in comment
        assert "Score:" in comment
        assert "bronze" in comment
        assert "CLAIM_METADATA:" in comment

    def test_format_claim_comment_parseable(self, in_memory_tracker):
        """Test that formatted comment can be parsed."""
        comment = in_memory_tracker.format_claim_comment(
            fork_owner="test-fork",
            claim_id="claim-456",
        )

        metadata = in_memory_tracker.parse_claim_metadata(comment)

        assert metadata is not None
        assert metadata["claimed_by"] == "test-fork"
        assert metadata["claim_id"] == "claim-456"


class TestLeaderboard:
    """Test leaderboard functionality."""

    def test_get_leaderboard_empty(self, in_memory_tracker):
        """Test leaderboard with no forks."""
        leaderboard = in_memory_tracker.get_leaderboard()
        assert leaderboard == []

    def test_get_leaderboard_sorted(self, in_memory_tracker):
        """Test leaderboard is sorted by score."""
        # Create forks with different scores
        for i in range(3):
            for _ in range(i + 1):
                in_memory_tracker.record_merge(f"fork-{i}", issue_number=i)

        leaderboard = in_memory_tracker.get_leaderboard()

        assert len(leaderboard) == 3
        assert leaderboard[0]["fork_owner"] == "fork-2"  # Highest score
        assert leaderboard[0]["rank"] == 1
        assert leaderboard[1]["fork_owner"] == "fork-1"
        assert leaderboard[2]["fork_owner"] == "fork-0"  # Lowest score

    def test_get_leaderboard_limit(self, in_memory_tracker):
        """Test leaderboard respects limit."""
        for i in range(10):
            in_memory_tracker.record_merge(f"fork-{i}", issue_number=i)

        leaderboard = in_memory_tracker.get_leaderboard(limit=3)

        assert len(leaderboard) == 3


class TestSummary:
    """Test summary statistics."""

    def test_get_summary_empty(self, in_memory_tracker):
        """Test summary with no data."""
        summary = in_memory_tracker.get_summary()

        assert summary["total_forks"] == 0
        assert summary["total_claims"] == 0
        assert summary["total_merges"] == 0

    def test_get_summary_with_data(self, in_memory_tracker):
        """Test summary with data."""
        in_memory_tracker.record_merge("fork-1", issue_number=1)
        in_memory_tracker.record_merge("fork-1", issue_number=2)
        in_memory_tracker.record_merge("fork-2", issue_number=3)
        in_memory_tracker.record_abandon("fork-2", issue_number=4)

        summary = in_memory_tracker.get_summary()

        assert summary["total_forks"] == 2
        assert summary["total_claims"] == 4
        assert summary["total_merges"] == 3
        assert "bronze" in summary["by_tier"]


class TestExportImport:
    """Test GitHub export/import functionality."""

    def test_export_for_github(self, in_memory_tracker):
        """Test exporting data for GitHub storage."""
        in_memory_tracker.record_merge("fork-1", issue_number=1)

        exported = in_memory_tracker.export_for_github()
        data = json.loads(exported)

        assert data["version"] == "1.0"
        assert "updated_at" in data
        assert "summary" in data
        assert "fork-1" in data["forks"]

    def test_import_from_github(self, in_memory_tracker):
        """Test importing data from GitHub storage."""
        json_str = json.dumps({
            "version": "1.0",
            "updated_at": "2025-01-01T00:00:00+00:00",
            "forks": {
                "imported-fork": {
                    "fork_owner": "imported-fork",
                    "score": 35,
                    "tier": "silver",
                    "stats": {
                        "total_claims": 4,
                        "successful_merges": 3,
                        "abandoned_claims": 1,
                        "timed_out_claims": 0,
                        "released_claims": 0,
                    },
                    "events": [],
                }
            },
        })

        count = in_memory_tracker.import_from_github(json_str)

        assert count == 1
        rep = in_memory_tracker.get_reputation("imported-fork")
        assert rep.score == 35
        assert rep.tier == ReputationTier.SILVER

    def test_import_from_github_invalid(self, in_memory_tracker):
        """Test importing invalid JSON."""
        count = in_memory_tracker.import_from_github("not valid json")
        assert count == 0

    def test_export_import_round_trip(self, in_memory_tracker):
        """Test export/import round-trip."""
        in_memory_tracker.record_merge("fork-1", issue_number=1)
        in_memory_tracker.record_merge("fork-1", issue_number=2)
        in_memory_tracker.record_abandon("fork-2", issue_number=3)

        exported = in_memory_tracker.export_for_github()

        # Create new tracker and import
        new_tracker = ReputationTracker(state_dir=None)
        count = new_tracker.import_from_github(exported)

        assert count == 2

        rep1 = new_tracker.get_reputation("fork-1")
        assert rep1.score == 20

        rep2 = new_tracker.get_reputation("fork-2")
        assert rep2.score == 0  # -5 capped at 0


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_fork_owner_with_special_chars(self, tracker):
        """Test fork owner names with special characters."""
        tracker.record_merge("user/fork-name", issue_number=1)

        rep = tracker.get_reputation("user/fork-name")
        assert rep.score == 10

    def test_get_reputation_creates_new(self, in_memory_tracker):
        """Test get_reputation creates new entry if not exists."""
        rep = in_memory_tracker.get_reputation("new-fork")

        assert rep.fork_owner == "new-fork"
        assert rep.score == 0
        assert rep.tier == ReputationTier.NEW

    def test_multiple_events_same_fork(self, in_memory_tracker):
        """Test multiple events for same fork."""
        for i in range(5):
            in_memory_tracker.record_merge("active-fork", issue_number=i)

        rep = in_memory_tracker.get_reputation("active-fork")
        assert rep.score == 50
        assert rep.tier == ReputationTier.GOLD
        assert rep.stats.successful_merges == 5

    def test_malformed_state_file(self, temp_state_dir):
        """Test handling malformed state file."""
        reputation_dir = temp_state_dir / "reputation"
        reputation_dir.mkdir()

        # Create invalid JSON file
        with open(reputation_dir / "bad-fork.json", "w") as f:
            f.write("not valid json")

        # Should not crash on load
        tracker = ReputationTracker(state_dir=temp_state_dir)
        rep = tracker.get_reputation("bad-fork")

        assert rep.score == 0  # Fresh reputation

    def test_event_id_generation(self, in_memory_tracker):
        """Test unique event IDs are generated."""
        event1 = in_memory_tracker.record_merge("fork-1", issue_number=1)
        event2 = in_memory_tracker.record_merge("fork-1", issue_number=2)

        assert event1.event_id != event2.event_id
        assert event1.event_id.startswith("evt-")
        assert event2.event_id.startswith("evt-")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
