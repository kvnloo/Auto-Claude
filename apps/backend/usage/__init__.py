"""
Token Usage Tracking Module
============================

Track and analyze token usage for Claude agent sessions.

This module provides data models and utilities for:
- Recording per-session token usage
- Aggregating usage statistics
- Breaking down usage by agent type
- Calculating costs based on Claude pricing

Example usage:
    from usage.models import TokenUsageRecord, AgentType, SessionOutcome

    record = TokenUsageRecord(
        spec_id="025-feature",
        session_id="session-abc123",
        agent_type=AgentType.CODER,
        input_tokens=1500,
        output_tokens=3200,
        thinking_tokens=500,
        cache_hit_tokens=800,
        model_name="claude-sonnet-4-5-20250929",
        outcome=SessionOutcome.SUCCESS,
    )
"""

from usage.models import (
    AgentType,
    SessionOutcome,
    TokenUsageRecord,
    TokenUsageSummary,
    AgentUsageBreakdown,
)

__all__ = [
    "AgentType",
    "SessionOutcome",
    "TokenUsageRecord",
    "TokenUsageSummary",
    "AgentUsageBreakdown",
]
