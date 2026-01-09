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
    from usage.cost_calculator import CostCalculator

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

    # Calculate cost
    calculator = CostCalculator()
    cost = calculator.calculate_cost(record)
    print(calculator.format_cost_display(cost))
"""

from usage.models import (
    AgentType,
    SessionOutcome,
    TokenUsageRecord,
    TokenUsageSummary,
    AgentUsageBreakdown,
)
from usage.store import (
    TokenUsageStore,
    TokenUsageStoreError,
    FileLockError,
    FileLockTimeout,
)
from usage.cost_calculator import (
    CostCalculator,
    CostBreakdown,
    ModelPricing,
    CLAUDE_PRICING,
    get_cost_calculator,
    calculate_cost,
    format_cost,
)
from usage.tracker import (
    UsageTracker,
    SessionUsageContext,
    create_usage_tracker,
    extract_usage_from_sdk_response,
)

__all__ = [
    # Models
    "AgentType",
    "SessionOutcome",
    "TokenUsageRecord",
    "TokenUsageSummary",
    "AgentUsageBreakdown",
    # Store
    "TokenUsageStore",
    "TokenUsageStoreError",
    "FileLockError",
    "FileLockTimeout",
    # Cost Calculator
    "CostCalculator",
    "CostBreakdown",
    "ModelPricing",
    "CLAUDE_PRICING",
    "get_cost_calculator",
    "calculate_cost",
    "format_cost",
    # Tracker
    "UsageTracker",
    "SessionUsageContext",
    "create_usage_tracker",
    "extract_usage_from_sdk_response",
]
