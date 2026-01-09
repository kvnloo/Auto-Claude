"""
Token Usage Data Models
========================

Data classes for tracking and analyzing token usage in Claude agent sessions.

Models:
- TokenUsageRecord: Per-session usage data (input/output/thinking/cache tokens)
- TokenUsageSummary: Aggregated usage statistics over a time period
- AgentUsageBreakdown: Usage breakdown by agent type (planner/coder/qa)
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from typing import Any
import json


class AgentType(str, Enum):
    """Agent types that contribute to token usage."""

    PLANNER = "planner"
    CODER = "coder"
    QA_REVIEWER = "qa_reviewer"
    QA_FIXER = "qa_fixer"

    # Spec creation agents
    SPEC_GATHERER = "spec_gatherer"
    SPEC_RESEARCHER = "spec_researcher"
    SPEC_WRITER = "spec_writer"
    SPEC_CRITIC = "spec_critic"
    SPEC_DISCOVERY = "spec_discovery"
    SPEC_CONTEXT = "spec_context"
    SPEC_VALIDATION = "spec_validation"

    # Other agents
    INSIGHTS = "insights"
    PR_REVIEWER = "pr_reviewer"
    ANALYSIS = "analysis"
    UNKNOWN = "unknown"

    @classmethod
    def from_string(cls, value: str) -> "AgentType":
        """Convert string to AgentType, defaulting to UNKNOWN for unrecognized values."""
        try:
            return cls(value.lower())
        except ValueError:
            return cls.UNKNOWN


class SessionOutcome(str, Enum):
    """Possible outcomes for an agent session."""

    SUCCESS = "success"  # Session completed successfully
    RETRY = "retry"  # Session needed retry (may have succeeded after)
    FAILED = "failed"  # Session failed (error or unrecoverable)
    ABANDONED = "abandoned"  # Session was manually stopped/abandoned
    IN_PROGRESS = "in_progress"  # Session is still running

    @classmethod
    def from_string(cls, value: str) -> "SessionOutcome":
        """Convert string to SessionOutcome, defaulting to IN_PROGRESS."""
        try:
            return cls(value.lower())
        except ValueError:
            return cls.IN_PROGRESS


@dataclass
class TokenUsageRecord:
    """
    Record of token usage for a single agent session.

    This is the atomic unit of tracking - one record per agent session.
    Multiple records may exist for a single spec (planner + coder + qa).

    Attributes:
        spec_id: Identifier for the spec (e.g., "025-token-usage")
        session_id: Unique identifier for this session
        agent_type: Type of agent that ran this session
        input_tokens: Number of input tokens consumed
        output_tokens: Number of output tokens generated
        thinking_tokens: Number of extended thinking tokens (billed as output)
        cache_hit_tokens: Number of tokens served from cache (90% cheaper)
        timestamp: When the session completed
        model_name: Claude model used (e.g., "claude-sonnet-4-5-20250929")
        outcome: Session outcome (success/retry/failed/abandoned)
        duration_seconds: Session duration in seconds (optional)
        context_files_count: Number of files loaded as context (optional)
        subtask_id: Subtask being worked on, if applicable (optional)
    """

    spec_id: str
    session_id: str
    agent_type: AgentType
    input_tokens: int
    output_tokens: int
    thinking_tokens: int
    cache_hit_tokens: int
    model_name: str
    outcome: SessionOutcome
    timestamp: datetime = field(default_factory=datetime.now)
    duration_seconds: float | None = None
    context_files_count: int | None = None
    subtask_id: str | None = None

    @property
    def total_tokens(self) -> int:
        """Total tokens including input, output, and thinking."""
        return self.input_tokens + self.output_tokens + self.thinking_tokens

    @property
    def billable_output_tokens(self) -> int:
        """Output tokens + thinking tokens (both billed at output rate)."""
        return self.output_tokens + self.thinking_tokens

    @property
    def effective_input_tokens(self) -> int:
        """Input tokens minus cache hits (cache hits are 90% cheaper)."""
        # Actual billable = (input - cache_hits) + (cache_hits * 0.1)
        # = input - cache_hits * 0.9
        return int(self.input_tokens - (self.cache_hit_tokens * 0.9))

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        data = asdict(self)
        # Convert enums to strings
        data["agent_type"] = self.agent_type.value
        data["outcome"] = self.outcome.value
        # Convert datetime to ISO format
        data["timestamp"] = self.timestamp.isoformat()
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TokenUsageRecord":
        """Create from dictionary (JSON deserialization)."""
        # Convert strings back to enums
        data = data.copy()
        data["agent_type"] = AgentType.from_string(data.get("agent_type", "unknown"))
        data["outcome"] = SessionOutcome.from_string(
            data.get("outcome", "in_progress")
        )
        # Convert ISO format back to datetime
        if isinstance(data.get("timestamp"), str):
            data["timestamp"] = datetime.fromisoformat(data["timestamp"])
        return cls(**data)

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, json_str: str) -> "TokenUsageRecord":
        """Deserialize from JSON string."""
        return cls.from_dict(json.loads(json_str))


@dataclass
class AgentUsageBreakdown:
    """
    Token usage breakdown for a specific agent type.

    Used to show how much each agent type (planner/coder/qa) contributes
    to total token usage and cost.

    Attributes:
        agent_type: The agent type this breakdown represents
        session_count: Number of sessions for this agent type
        total_input_tokens: Sum of input tokens across all sessions
        total_output_tokens: Sum of output tokens across all sessions
        total_thinking_tokens: Sum of thinking tokens across all sessions
        total_cache_hit_tokens: Sum of cache hit tokens across all sessions
        total_cost_usd: Total cost in USD for this agent type
        success_count: Number of successful sessions
        failure_count: Number of failed/abandoned sessions
        avg_tokens_per_session: Average total tokens per session
    """

    agent_type: AgentType
    session_count: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_thinking_tokens: int = 0
    total_cache_hit_tokens: int = 0
    total_cost_usd: float = 0.0
    success_count: int = 0
    failure_count: int = 0

    @property
    def total_tokens(self) -> int:
        """Total tokens for this agent type."""
        return (
            self.total_input_tokens
            + self.total_output_tokens
            + self.total_thinking_tokens
        )

    @property
    def avg_tokens_per_session(self) -> float:
        """Average tokens per session."""
        if self.session_count == 0:
            return 0.0
        return self.total_tokens / self.session_count

    @property
    def success_rate(self) -> float:
        """Success rate as a percentage (0-100)."""
        if self.session_count == 0:
            return 0.0
        return (self.success_count / self.session_count) * 100

    def add_record(self, record: TokenUsageRecord, cost_usd: float = 0.0) -> None:
        """Add a usage record to this breakdown."""
        self.session_count += 1
        self.total_input_tokens += record.input_tokens
        self.total_output_tokens += record.output_tokens
        self.total_thinking_tokens += record.thinking_tokens
        self.total_cache_hit_tokens += record.cache_hit_tokens
        self.total_cost_usd += cost_usd

        if record.outcome == SessionOutcome.SUCCESS:
            self.success_count += 1
        elif record.outcome in (SessionOutcome.FAILED, SessionOutcome.ABANDONED):
            self.failure_count += 1

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "agent_type": self.agent_type.value,
            "session_count": self.session_count,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_thinking_tokens": self.total_thinking_tokens,
            "total_cache_hit_tokens": self.total_cache_hit_tokens,
            "total_cost_usd": round(self.total_cost_usd, 4),
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "total_tokens": self.total_tokens,
            "avg_tokens_per_session": round(self.avg_tokens_per_session, 2),
            "success_rate": round(self.success_rate, 1),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentUsageBreakdown":
        """Create from dictionary (JSON deserialization)."""
        return cls(
            agent_type=AgentType.from_string(data.get("agent_type", "unknown")),
            session_count=data.get("session_count", 0),
            total_input_tokens=data.get("total_input_tokens", 0),
            total_output_tokens=data.get("total_output_tokens", 0),
            total_thinking_tokens=data.get("total_thinking_tokens", 0),
            total_cache_hit_tokens=data.get("total_cache_hit_tokens", 0),
            total_cost_usd=data.get("total_cost_usd", 0.0),
            success_count=data.get("success_count", 0),
            failure_count=data.get("failure_count", 0),
        )


@dataclass
class TokenUsageSummary:
    """
    Aggregated token usage summary over a time period or scope.

    Used for dashboard display and reporting. Can represent:
    - Total usage for a spec
    - Daily/weekly/monthly aggregations
    - Project-wide totals

    Attributes:
        period_start: Start of the aggregation period
        period_end: End of the aggregation period
        spec_id: Spec ID if scoped to a single spec (None for project-wide)
        total_sessions: Total number of agent sessions
        total_input_tokens: Sum of all input tokens
        total_output_tokens: Sum of all output tokens
        total_thinking_tokens: Sum of all thinking tokens
        total_cache_hit_tokens: Sum of all cache hit tokens
        total_cost_usd: Total cost in USD
        agent_breakdown: Breakdown by agent type
        success_count: Number of successful sessions
        failure_count: Number of failed sessions
        unique_specs: Number of unique specs (for project-wide summaries)
    """

    period_start: datetime
    period_end: datetime
    total_sessions: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_thinking_tokens: int = 0
    total_cache_hit_tokens: int = 0
    total_cost_usd: float = 0.0
    success_count: int = 0
    failure_count: int = 0
    unique_specs: int = 0
    spec_id: str | None = None
    agent_breakdown: dict[str, AgentUsageBreakdown] = field(default_factory=dict)

    @property
    def total_tokens(self) -> int:
        """Total tokens across all types."""
        return (
            self.total_input_tokens
            + self.total_output_tokens
            + self.total_thinking_tokens
        )

    @property
    def avg_cost_per_spec(self) -> float:
        """Average cost per unique spec."""
        if self.unique_specs == 0:
            return 0.0
        return self.total_cost_usd / self.unique_specs

    @property
    def avg_tokens_per_session(self) -> float:
        """Average tokens per session."""
        if self.total_sessions == 0:
            return 0.0
        return self.total_tokens / self.total_sessions

    @property
    def success_rate(self) -> float:
        """Overall success rate as a percentage (0-100)."""
        if self.total_sessions == 0:
            return 0.0
        return (self.success_count / self.total_sessions) * 100

    @property
    def cache_efficiency(self) -> float:
        """Cache hit rate as a percentage of input tokens (0-100)."""
        if self.total_input_tokens == 0:
            return 0.0
        return (self.total_cache_hit_tokens / self.total_input_tokens) * 100

    def add_record(self, record: TokenUsageRecord, cost_usd: float = 0.0) -> None:
        """Add a usage record to this summary."""
        self.total_sessions += 1
        self.total_input_tokens += record.input_tokens
        self.total_output_tokens += record.output_tokens
        self.total_thinking_tokens += record.thinking_tokens
        self.total_cache_hit_tokens += record.cache_hit_tokens
        self.total_cost_usd += cost_usd

        if record.outcome == SessionOutcome.SUCCESS:
            self.success_count += 1
        elif record.outcome in (SessionOutcome.FAILED, SessionOutcome.ABANDONED):
            self.failure_count += 1

        # Update agent breakdown
        agent_key = record.agent_type.value
        if agent_key not in self.agent_breakdown:
            self.agent_breakdown[agent_key] = AgentUsageBreakdown(
                agent_type=record.agent_type
            )
        self.agent_breakdown[agent_key].add_record(record, cost_usd)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "period_start": self.period_start.isoformat(),
            "period_end": self.period_end.isoformat(),
            "spec_id": self.spec_id,
            "total_sessions": self.total_sessions,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_thinking_tokens": self.total_thinking_tokens,
            "total_cache_hit_tokens": self.total_cache_hit_tokens,
            "total_cost_usd": round(self.total_cost_usd, 4),
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "unique_specs": self.unique_specs,
            "total_tokens": self.total_tokens,
            "avg_cost_per_spec": round(self.avg_cost_per_spec, 4),
            "avg_tokens_per_session": round(self.avg_tokens_per_session, 2),
            "success_rate": round(self.success_rate, 1),
            "cache_efficiency": round(self.cache_efficiency, 1),
            "agent_breakdown": {
                k: v.to_dict() for k, v in self.agent_breakdown.items()
            },
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TokenUsageSummary":
        """Create from dictionary (JSON deserialization)."""
        # Parse agent breakdown
        agent_breakdown = {}
        for key, value in data.get("agent_breakdown", {}).items():
            agent_breakdown[key] = AgentUsageBreakdown.from_dict(value)

        return cls(
            period_start=datetime.fromisoformat(data["period_start"]),
            period_end=datetime.fromisoformat(data["period_end"]),
            spec_id=data.get("spec_id"),
            total_sessions=data.get("total_sessions", 0),
            total_input_tokens=data.get("total_input_tokens", 0),
            total_output_tokens=data.get("total_output_tokens", 0),
            total_thinking_tokens=data.get("total_thinking_tokens", 0),
            total_cache_hit_tokens=data.get("total_cache_hit_tokens", 0),
            total_cost_usd=data.get("total_cost_usd", 0.0),
            success_count=data.get("success_count", 0),
            failure_count=data.get("failure_count", 0),
            unique_specs=data.get("unique_specs", 0),
            agent_breakdown=agent_breakdown,
        )

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_json(cls, json_str: str) -> "TokenUsageSummary":
        """Deserialize from JSON string."""
        return cls.from_dict(json.loads(json_str))
