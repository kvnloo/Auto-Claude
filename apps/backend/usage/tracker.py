"""
Token Usage Tracker
====================

High-level tracker for recording token usage from agent sessions.
Provides a convenient interface between agent sessions and the TokenUsageStore.

This module:
- Extracts token counts from Claude SDK response metadata
- Creates TokenUsageRecord objects with all required fields
- Stores records via TokenUsageStore
- Handles cases where token data is unavailable

Usage:
    from usage.tracker import UsageTracker

    tracker = UsageTracker(project_dir, spec_dir)
    tracker.record_session(
        session_id="session-123",
        agent_type="coder",
        model_name="claude-sonnet-4-5-20250929",
        outcome="success",
        input_tokens=1500,
        output_tokens=3200,
        thinking_tokens=500,
        cache_hit_tokens=800,
    )
"""

import logging
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from usage.models import AgentType, SessionOutcome, TokenUsageRecord
from usage.store import TokenUsageStore

logger = logging.getLogger(__name__)


class UsageTracker:
    """
    High-level tracker for recording token usage from agent sessions.

    Provides a simple interface for agent code to record usage without
    needing to understand the details of TokenUsageRecord and TokenUsageStore.

    Attributes:
        project_dir: Root directory of the project
        spec_dir: Directory containing the spec
        store: TokenUsageStore instance for persistence
    """

    def __init__(
        self,
        project_dir: Path,
        spec_dir: Path,
    ):
        """
        Initialize the UsageTracker.

        Args:
            project_dir: Root directory of the project
            spec_dir: Directory containing the spec (e.g., .auto-claude/specs/025-feature/)
        """
        self.project_dir = Path(project_dir)
        self.spec_dir = Path(spec_dir)
        self.store = TokenUsageStore(project_dir=self.project_dir)

        # Extract spec_id from spec_dir name (e.g., "025-token-usage")
        self.spec_id = self.spec_dir.name

    def record_session(
        self,
        session_id: str,
        agent_type: str | AgentType,
        model_name: str,
        outcome: str | SessionOutcome,
        input_tokens: int = 0,
        output_tokens: int = 0,
        thinking_tokens: int = 0,
        cache_hit_tokens: int = 0,
        duration_seconds: float | None = None,
        context_files_count: int | None = None,
        subtask_id: str | None = None,
    ) -> TokenUsageRecord | None:
        """
        Record token usage for a completed agent session.

        Args:
            session_id: Unique identifier for this session
            agent_type: Type of agent (e.g., "coder", "planner", "qa_reviewer")
            model_name: Claude model used (e.g., "claude-sonnet-4-5-20250929")
            outcome: Session outcome ("success", "failed", "retry", "abandoned")
            input_tokens: Number of input tokens consumed
            output_tokens: Number of output tokens generated
            thinking_tokens: Number of extended thinking tokens
            cache_hit_tokens: Number of tokens served from cache
            duration_seconds: Session duration in seconds (optional)
            context_files_count: Number of files loaded as context (optional)
            subtask_id: Subtask being worked on, if applicable (optional)

        Returns:
            TokenUsageRecord if recorded successfully, None if failed
        """
        try:
            # Convert string agent_type to enum
            if isinstance(agent_type, str):
                agent_type = AgentType.from_string(agent_type)

            # Convert string outcome to enum
            if isinstance(outcome, str):
                outcome = SessionOutcome.from_string(outcome)

            # Create the record
            record = TokenUsageRecord(
                spec_id=self.spec_id,
                session_id=session_id,
                agent_type=agent_type,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                thinking_tokens=thinking_tokens,
                cache_hit_tokens=cache_hit_tokens,
                model_name=model_name,
                outcome=outcome,
                timestamp=datetime.now(),
                duration_seconds=duration_seconds,
                context_files_count=context_files_count,
                subtask_id=subtask_id,
            )

            # Store the record
            self.store.record_usage(record, spec_dir=self.spec_dir)

            logger.info(
                f"Recorded usage for session {session_id}: "
                f"{input_tokens} in, {output_tokens} out, {thinking_tokens} thinking"
            )

            return record

        except Exception as e:
            logger.warning(f"Failed to record token usage: {e}")
            return None

    def generate_session_id(self) -> str:
        """Generate a unique session ID."""
        return f"session-{uuid.uuid4().hex[:12]}"


def extract_usage_from_sdk_response(messages: list[Any]) -> dict[str, int]:
    """
    Extract token usage from Claude SDK response messages.

    The Claude SDK provides usage information in the response metadata.
    This function extracts input_tokens, output_tokens, and cache-related
    token counts from the accumulated messages.

    Args:
        messages: List of messages from client.receive_response()

    Returns:
        Dictionary with token counts:
        - input_tokens: Total input tokens
        - output_tokens: Total output tokens
        - thinking_tokens: Extended thinking tokens (if used)
        - cache_hit_tokens: Tokens served from cache (cache_read_input_tokens)
    """
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "thinking_tokens": 0,
        "cache_hit_tokens": 0,
    }

    for msg in messages:
        # Check for usage attribute on the message
        if hasattr(msg, "usage"):
            msg_usage = msg.usage
            if hasattr(msg_usage, "input_tokens"):
                usage["input_tokens"] = max(usage["input_tokens"], msg_usage.input_tokens)
            if hasattr(msg_usage, "output_tokens"):
                usage["output_tokens"] = max(usage["output_tokens"], msg_usage.output_tokens)
            # Claude SDK may expose thinking tokens differently
            if hasattr(msg_usage, "thinking_tokens"):
                usage["thinking_tokens"] = max(usage["thinking_tokens"], msg_usage.thinking_tokens)
            # Cache hits are typically in cache_read_input_tokens
            if hasattr(msg_usage, "cache_read_input_tokens"):
                usage["cache_hit_tokens"] = max(usage["cache_hit_tokens"], msg_usage.cache_read_input_tokens)
            elif hasattr(msg_usage, "cache_hit_tokens"):
                usage["cache_hit_tokens"] = max(usage["cache_hit_tokens"], msg_usage.cache_hit_tokens)

        # Also check message-level attributes (some SDK versions)
        if hasattr(msg, "input_tokens"):
            usage["input_tokens"] = max(usage["input_tokens"], msg.input_tokens)
        if hasattr(msg, "output_tokens"):
            usage["output_tokens"] = max(usage["output_tokens"], msg.output_tokens)

    return usage


class SessionUsageContext:
    """
    Context manager for tracking usage during an agent session.

    Tracks session duration and provides helper methods for recording
    usage at the end of the session.

    Usage:
        tracker = UsageTracker(project_dir, spec_dir)

        with SessionUsageContext(tracker, "coder", model_name) as ctx:
            # Run agent session
            async for msg in client.receive_response():
                ctx.add_message(msg)

            # At the end, record usage
            ctx.record(outcome="success", subtask_id="1.1")
    """

    def __init__(
        self,
        tracker: UsageTracker,
        agent_type: str,
        model_name: str,
        subtask_id: str | None = None,
        context_files_count: int | None = None,
    ):
        """
        Initialize the session usage context.

        Args:
            tracker: UsageTracker instance
            agent_type: Type of agent running the session
            model_name: Claude model being used
            subtask_id: Subtask being worked on (optional)
            context_files_count: Number of context files loaded (optional)
        """
        self.tracker = tracker
        self.agent_type = agent_type
        self.model_name = model_name
        self.subtask_id = subtask_id
        self.context_files_count = context_files_count

        self.session_id = tracker.generate_session_id()
        self.start_time: float | None = None
        self.end_time: float | None = None
        self.messages: list[Any] = []
        self._recorded = False

    def __enter__(self) -> "SessionUsageContext":
        """Start tracking the session."""
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        """End tracking (but don't auto-record - caller should call record())."""
        self.end_time = time.time()

    def add_message(self, msg: Any) -> None:
        """Add a message from receive_response() to track."""
        self.messages.append(msg)

    @property
    def duration_seconds(self) -> float | None:
        """Get session duration in seconds."""
        if self.start_time is None:
            return None
        end = self.end_time or time.time()
        return end - self.start_time

    def record(
        self,
        outcome: str | SessionOutcome,
        subtask_id: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        thinking_tokens: int | None = None,
        cache_hit_tokens: int | None = None,
    ) -> TokenUsageRecord | None:
        """
        Record the session usage.

        Args:
            outcome: Session outcome
            subtask_id: Override subtask_id from constructor
            input_tokens: Override extracted input tokens
            output_tokens: Override extracted output tokens
            thinking_tokens: Override extracted thinking tokens
            cache_hit_tokens: Override extracted cache hit tokens

        Returns:
            TokenUsageRecord if successful, None otherwise
        """
        if self._recorded:
            logger.debug("Session usage already recorded")
            return None

        # Extract usage from collected messages if not provided
        extracted = extract_usage_from_sdk_response(self.messages)

        record = self.tracker.record_session(
            session_id=self.session_id,
            agent_type=self.agent_type,
            model_name=self.model_name,
            outcome=outcome,
            input_tokens=input_tokens if input_tokens is not None else extracted["input_tokens"],
            output_tokens=output_tokens if output_tokens is not None else extracted["output_tokens"],
            thinking_tokens=thinking_tokens if thinking_tokens is not None else extracted["thinking_tokens"],
            cache_hit_tokens=cache_hit_tokens if cache_hit_tokens is not None else extracted["cache_hit_tokens"],
            duration_seconds=self.duration_seconds,
            context_files_count=self.context_files_count,
            subtask_id=subtask_id or self.subtask_id,
        )

        self._recorded = True
        return record


def create_usage_tracker(
    project_dir: Path,
    spec_dir: Path,
) -> UsageTracker:
    """
    Create a UsageTracker instance.

    Convenience function for creating a tracker.

    Args:
        project_dir: Root directory of the project
        spec_dir: Directory containing the spec

    Returns:
        Configured UsageTracker instance
    """
    return UsageTracker(project_dir, spec_dir)
