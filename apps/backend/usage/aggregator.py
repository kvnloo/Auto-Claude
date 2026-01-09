"""
Usage Aggregator
=================

Aggregate and analyze token usage data across time periods, specs, and agent types.

The UsageAggregator builds on TokenUsageStore and CostCalculator to provide
high-level aggregation methods for dashboards and reporting.

Features:
- Daily/weekly/monthly usage aggregation
- Per-spec and per-agent breakdowns
- Date range filtering
- Trend computation (period-over-period changes)
- Efficiency scoring based on success rate and cache utilization

Example usage:
    from pathlib import Path
    from usage.aggregator import UsageAggregator

    aggregator = UsageAggregator(project_dir=Path("/path/to/project"))

    # Get daily usage for last 7 days
    daily = aggregator.get_daily_usage(days=7)

    # Get usage breakdown by agent type
    breakdown = aggregator.get_usage_by_agent_type()

    # Calculate efficiency score
    score = aggregator.calculate_efficiency_score()
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

from usage.models import (
    AgentType,
    AgentUsageBreakdown,
    SessionOutcome,
    TokenUsageRecord,
    TokenUsageSummary,
)
from usage.store import TokenUsageStore
from usage.cost_calculator import CostCalculator, get_cost_calculator


@dataclass
class DailyUsage:
    """
    Token usage for a single day.

    Attributes:
        date: The date (datetime at midnight)
        total_tokens: Total tokens for the day
        total_cost: Total cost in USD
        session_count: Number of sessions
        input_tokens: Total input tokens
        output_tokens: Total output tokens
        thinking_tokens: Total thinking tokens
        cache_hit_tokens: Total cache hit tokens
        success_count: Number of successful sessions
        failure_count: Number of failed sessions
    """

    date: datetime
    total_tokens: int = 0
    total_cost: float = 0.0
    session_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0
    cache_hit_tokens: int = 0
    success_count: int = 0
    failure_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "date": self.date.isoformat(),
            "total_tokens": self.total_tokens,
            "total_cost": round(self.total_cost, 4),
            "session_count": self.session_count,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "thinking_tokens": self.thinking_tokens,
            "cache_hit_tokens": self.cache_hit_tokens,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
        }


@dataclass
class SpecUsage:
    """
    Token usage for a single spec.

    Attributes:
        spec_id: The spec identifier
        total_tokens: Total tokens for the spec
        total_cost: Total cost in USD
        session_count: Number of sessions
        input_tokens: Total input tokens
        output_tokens: Total output tokens
        thinking_tokens: Total thinking tokens
        cache_hit_tokens: Total cache hit tokens
        success_count: Number of successful sessions
        failure_count: Number of failed sessions
        first_session: Timestamp of first session
        last_session: Timestamp of most recent session
        agent_breakdown: Usage breakdown by agent type
    """

    spec_id: str
    total_tokens: int = 0
    total_cost: float = 0.0
    session_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0
    cache_hit_tokens: int = 0
    success_count: int = 0
    failure_count: int = 0
    first_session: Optional[datetime] = None
    last_session: Optional[datetime] = None
    agent_breakdown: dict[str, int] = field(default_factory=dict)

    @property
    def avg_tokens_per_session(self) -> float:
        """Average tokens per session."""
        if self.session_count == 0:
            return 0.0
        return self.total_tokens / self.session_count

    @property
    def success_rate(self) -> float:
        """Success rate as percentage (0-100)."""
        if self.session_count == 0:
            return 0.0
        return (self.success_count / self.session_count) * 100

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "spec_id": self.spec_id,
            "total_tokens": self.total_tokens,
            "total_cost": round(self.total_cost, 4),
            "session_count": self.session_count,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "thinking_tokens": self.thinking_tokens,
            "cache_hit_tokens": self.cache_hit_tokens,
            "success_count": self.success_count,
            "failure_count": self.failure_count,
            "first_session": self.first_session.isoformat() if self.first_session else None,
            "last_session": self.last_session.isoformat() if self.last_session else None,
            "avg_tokens_per_session": round(self.avg_tokens_per_session, 2),
            "success_rate": round(self.success_rate, 1),
            "agent_breakdown": self.agent_breakdown,
        }


@dataclass
class UsageTrend:
    """
    Trend comparison between two periods.

    Attributes:
        current_value: Value for the current period
        previous_value: Value for the previous period
        change_absolute: Absolute change (current - previous)
        change_percentage: Percentage change ((current - previous) / previous * 100)
        trend_direction: "up", "down", or "flat"
    """

    current_value: float
    previous_value: float

    @property
    def change_absolute(self) -> float:
        """Absolute change between periods."""
        return self.current_value - self.previous_value

    @property
    def change_percentage(self) -> float:
        """Percentage change between periods."""
        if self.previous_value == 0:
            if self.current_value == 0:
                return 0.0
            return 100.0  # Infinite increase represented as 100%
        return ((self.current_value - self.previous_value) / self.previous_value) * 100

    @property
    def trend_direction(self) -> str:
        """Direction of the trend: 'up', 'down', or 'flat'."""
        if abs(self.change_percentage) < 1.0:  # Less than 1% change is "flat"
            return "flat"
        return "up" if self.change_absolute > 0 else "down"

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "current_value": round(self.current_value, 4),
            "previous_value": round(self.previous_value, 4),
            "change_absolute": round(self.change_absolute, 4),
            "change_percentage": round(self.change_percentage, 1),
            "trend_direction": self.trend_direction,
        }


@dataclass
class EfficiencyScore:
    """
    Efficiency metrics for usage analysis.

    The overall efficiency score (0-100) is computed from:
    - Success rate (weight: 40%)
    - Cache efficiency (weight: 30%)
    - Token efficiency (weight: 30%)

    Attributes:
        overall_score: Combined efficiency score (0-100)
        success_rate: Session success rate (0-100)
        cache_efficiency: Cache hit rate (0-100)
        token_efficiency: Tokens per successful spec (normalized 0-100)
        total_sessions: Total sessions analyzed
        successful_specs: Number of specs completed successfully
    """

    overall_score: float
    success_rate: float
    cache_efficiency: float
    token_efficiency: float
    total_sessions: int
    successful_specs: int

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "overall_score": round(self.overall_score, 1),
            "success_rate": round(self.success_rate, 1),
            "cache_efficiency": round(self.cache_efficiency, 1),
            "token_efficiency": round(self.token_efficiency, 1),
            "total_sessions": self.total_sessions,
            "successful_specs": self.successful_specs,
        }


class UsageAggregator:
    """
    Aggregate and analyze token usage data.

    Provides methods for aggregating usage by time period, spec, and agent type.
    Supports date range filtering and trend computation.

    Attributes:
        project_dir: Root directory of the project
        store: TokenUsageStore for data access
        calculator: CostCalculator for cost computation
    """

    def __init__(
        self,
        project_dir: Path,
        calculator: Optional[CostCalculator] = None,
    ):
        """
        Initialize the UsageAggregator.

        Args:
            project_dir: Root directory of the project
            calculator: Optional CostCalculator instance (uses default if not provided)
        """
        self.project_dir = Path(project_dir)
        self.store = TokenUsageStore(project_dir=self.project_dir)
        self.calculator = calculator or get_cost_calculator()

    def get_daily_usage(
        self,
        days: int = 7,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> list[DailyUsage]:
        """
        Get usage aggregated by day.

        Args:
            days: Number of days to include (default: 7, used if start/end not provided)
            start_date: Optional start date for range
            end_date: Optional end date for range (default: now)

        Returns:
            List of DailyUsage objects, sorted by date ascending
        """
        # Determine date range
        if end_date is None:
            end_date = datetime.now()

        if start_date is None:
            start_date = end_date - timedelta(days=days)

        # Normalize to start/end of day
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)

        # Get records in range
        records = self.store.get_usage_for_date_range(start_date, end_date)

        # Group by day
        daily_map: dict[str, DailyUsage] = {}

        for record in records:
            date_key = record.timestamp.strftime("%Y-%m-%d")

            if date_key not in daily_map:
                day_start = record.timestamp.replace(
                    hour=0, minute=0, second=0, microsecond=0
                )
                daily_map[date_key] = DailyUsage(date=day_start)

            daily = daily_map[date_key]
            cost = float(self.calculator.calculate_cost(record))

            daily.session_count += 1
            daily.input_tokens += record.input_tokens
            daily.output_tokens += record.output_tokens
            daily.thinking_tokens += record.thinking_tokens
            daily.cache_hit_tokens += record.cache_hit_tokens
            daily.total_tokens += record.total_tokens
            daily.total_cost += cost

            if record.outcome == SessionOutcome.SUCCESS:
                daily.success_count += 1
            elif record.outcome in (SessionOutcome.FAILED, SessionOutcome.ABANDONED):
                daily.failure_count += 1

        # Fill in missing days with zero values
        result = []
        current = start_date
        while current <= end_date:
            date_key = current.strftime("%Y-%m-%d")
            if date_key in daily_map:
                result.append(daily_map[date_key])
            else:
                result.append(DailyUsage(date=current))
            current += timedelta(days=1)

        return result

    def get_weekly_usage(
        self,
        weeks: int = 4,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> list[dict[str, Any]]:
        """
        Get usage aggregated by week.

        Args:
            weeks: Number of weeks to include (default: 4, used if start/end not provided)
            start_date: Optional start date for range
            end_date: Optional end date for range (default: now)

        Returns:
            List of weekly usage dictionaries with:
            - week_start: Start date of the week (Monday)
            - week_end: End date of the week (Sunday)
            - total_tokens, total_cost, session_count, etc.
        """
        # Determine date range
        if end_date is None:
            end_date = datetime.now()

        if start_date is None:
            start_date = end_date - timedelta(weeks=weeks)

        # Normalize to start/end of day
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)

        # Get records in range
        records = self.store.get_usage_for_date_range(start_date, end_date)

        # Group by week (ISO week number)
        weekly_map: dict[str, dict[str, Any]] = {}

        for record in records:
            # Get ISO year and week number
            iso_year, iso_week, _ = record.timestamp.isocalendar()
            week_key = f"{iso_year}-W{iso_week:02d}"

            if week_key not in weekly_map:
                # Calculate week start (Monday) and end (Sunday)
                week_start = record.timestamp - timedelta(days=record.timestamp.weekday())
                week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
                week_end = week_start + timedelta(days=6)
                week_end = week_end.replace(hour=23, minute=59, second=59, microsecond=999999)

                weekly_map[week_key] = {
                    "week_key": week_key,
                    "week_start": week_start,
                    "week_end": week_end,
                    "total_tokens": 0,
                    "total_cost": 0.0,
                    "session_count": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "thinking_tokens": 0,
                    "cache_hit_tokens": 0,
                    "success_count": 0,
                    "failure_count": 0,
                }

            week = weekly_map[week_key]
            cost = float(self.calculator.calculate_cost(record))

            week["session_count"] += 1
            week["input_tokens"] += record.input_tokens
            week["output_tokens"] += record.output_tokens
            week["thinking_tokens"] += record.thinking_tokens
            week["cache_hit_tokens"] += record.cache_hit_tokens
            week["total_tokens"] += record.total_tokens
            week["total_cost"] += cost

            if record.outcome == SessionOutcome.SUCCESS:
                week["success_count"] += 1
            elif record.outcome in (SessionOutcome.FAILED, SessionOutcome.ABANDONED):
                week["failure_count"] += 1

        # Convert to list and sort by week
        result = list(weekly_map.values())
        result.sort(key=lambda w: w["week_key"])

        # Serialize datetime for JSON
        for week in result:
            week["week_start"] = week["week_start"].isoformat()
            week["week_end"] = week["week_end"].isoformat()
            week["total_cost"] = round(week["total_cost"], 4)

        return result

    def get_monthly_usage(
        self,
        months: int = 6,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> list[dict[str, Any]]:
        """
        Get usage aggregated by month.

        Args:
            months: Number of months to include (default: 6, used if start/end not provided)
            start_date: Optional start date for range
            end_date: Optional end date for range (default: now)

        Returns:
            List of monthly usage dictionaries with:
            - month: Month identifier (YYYY-MM)
            - month_name: Human-readable month name
            - total_tokens, total_cost, session_count, etc.
        """
        # Determine date range
        if end_date is None:
            end_date = datetime.now()

        if start_date is None:
            # Go back N months
            year = end_date.year
            month = end_date.month - months
            while month <= 0:
                month += 12
                year -= 1
            start_date = datetime(year, month, 1)

        # Normalize to start/end of day
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)

        # Get records in range
        records = self.store.get_usage_for_date_range(start_date, end_date)

        # Group by month
        monthly_map: dict[str, dict[str, Any]] = {}

        for record in records:
            month_key = record.timestamp.strftime("%Y-%m")

            if month_key not in monthly_map:
                monthly_map[month_key] = {
                    "month": month_key,
                    "month_name": record.timestamp.strftime("%B %Y"),
                    "total_tokens": 0,
                    "total_cost": 0.0,
                    "session_count": 0,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "thinking_tokens": 0,
                    "cache_hit_tokens": 0,
                    "success_count": 0,
                    "failure_count": 0,
                }

            month = monthly_map[month_key]
            cost = float(self.calculator.calculate_cost(record))

            month["session_count"] += 1
            month["input_tokens"] += record.input_tokens
            month["output_tokens"] += record.output_tokens
            month["thinking_tokens"] += record.thinking_tokens
            month["cache_hit_tokens"] += record.cache_hit_tokens
            month["total_tokens"] += record.total_tokens
            month["total_cost"] += cost

            if record.outcome == SessionOutcome.SUCCESS:
                month["success_count"] += 1
            elif record.outcome in (SessionOutcome.FAILED, SessionOutcome.ABANDONED):
                month["failure_count"] += 1

        # Convert to list and sort by month
        result = list(monthly_map.values())
        result.sort(key=lambda m: m["month"])

        # Round costs
        for month in result:
            month["total_cost"] = round(month["total_cost"], 4)

        return result

    def get_usage_by_spec(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> list[SpecUsage]:
        """
        Get usage broken down by spec.

        Args:
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering

        Returns:
            List of SpecUsage objects, sorted by total_cost descending
        """
        # Get all records (optionally filtered by date)
        if start_date is not None and end_date is not None:
            records = self.store.get_usage_for_date_range(start_date, end_date)
        else:
            records = self.store.get_all_usage_for_project()

        # Group by spec
        spec_map: dict[str, SpecUsage] = {}

        for record in records:
            if record.spec_id not in spec_map:
                spec_map[record.spec_id] = SpecUsage(spec_id=record.spec_id)

            spec = spec_map[record.spec_id]
            cost = float(self.calculator.calculate_cost(record))

            spec.session_count += 1
            spec.input_tokens += record.input_tokens
            spec.output_tokens += record.output_tokens
            spec.thinking_tokens += record.thinking_tokens
            spec.cache_hit_tokens += record.cache_hit_tokens
            spec.total_tokens += record.total_tokens
            spec.total_cost += cost

            if record.outcome == SessionOutcome.SUCCESS:
                spec.success_count += 1
            elif record.outcome in (SessionOutcome.FAILED, SessionOutcome.ABANDONED):
                spec.failure_count += 1

            # Track first/last session
            if spec.first_session is None or record.timestamp < spec.first_session:
                spec.first_session = record.timestamp
            if spec.last_session is None or record.timestamp > spec.last_session:
                spec.last_session = record.timestamp

            # Track agent breakdown
            agent_key = record.agent_type.value
            spec.agent_breakdown[agent_key] = (
                spec.agent_breakdown.get(agent_key, 0) + 1
            )

        # Convert to list and sort by cost (highest first)
        result = list(spec_map.values())
        result.sort(key=lambda s: s.total_cost, reverse=True)

        return result

    def get_usage_by_agent_type(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> dict[str, AgentUsageBreakdown]:
        """
        Get usage broken down by agent type.

        Args:
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering

        Returns:
            Dictionary mapping agent type to AgentUsageBreakdown
        """
        # Get all records (optionally filtered by date)
        if start_date is not None and end_date is not None:
            records = self.store.get_usage_for_date_range(start_date, end_date)
        else:
            records = self.store.get_all_usage_for_project()

        # Group by agent type
        agent_map: dict[str, AgentUsageBreakdown] = {}

        for record in records:
            agent_key = record.agent_type.value

            if agent_key not in agent_map:
                agent_map[agent_key] = AgentUsageBreakdown(
                    agent_type=record.agent_type
                )

            cost = float(self.calculator.calculate_cost(record))
            agent_map[agent_key].add_record(record, cost)

        return agent_map

    def get_total_cost(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        spec_id: Optional[str] = None,
    ) -> float:
        """
        Get total cost for a period.

        Args:
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering
            spec_id: Optional spec ID to filter by

        Returns:
            Total cost in USD
        """
        # Get records based on filters
        if spec_id is not None:
            records = self.store.get_usage_for_spec(spec_id)
            # Apply date filter manually
            if start_date is not None and end_date is not None:
                records = [
                    r for r in records
                    if start_date <= r.timestamp <= end_date
                ]
        elif start_date is not None and end_date is not None:
            records = self.store.get_usage_for_date_range(start_date, end_date)
        else:
            records = self.store.get_all_usage_for_project()

        # Sum costs
        total = Decimal("0")
        for record in records:
            total += self.calculator.calculate_cost(record)

        return float(total)

    def calculate_efficiency_score(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> EfficiencyScore:
        """
        Calculate an efficiency score for usage.

        The score is based on:
        - Success rate (40% weight): Higher success rate = better
        - Cache efficiency (30% weight): Higher cache hit rate = better
        - Token efficiency (30% weight): Fewer tokens per successful spec = better

        Args:
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering

        Returns:
            EfficiencyScore with overall score and component metrics
        """
        # Get records
        if start_date is not None and end_date is not None:
            records = self.store.get_usage_for_date_range(start_date, end_date)
        else:
            records = self.store.get_all_usage_for_project()

        if not records:
            return EfficiencyScore(
                overall_score=0.0,
                success_rate=0.0,
                cache_efficiency=0.0,
                token_efficiency=0.0,
                total_sessions=0,
                successful_specs=0,
            )

        # Calculate metrics
        total_sessions = len(records)
        success_count = sum(
            1 for r in records if r.outcome == SessionOutcome.SUCCESS
        )
        total_input_tokens = sum(r.input_tokens for r in records)
        total_cache_hits = sum(r.cache_hit_tokens for r in records)
        total_tokens = sum(r.total_tokens for r in records)

        # Unique successful specs
        successful_specs = len(set(
            r.spec_id for r in records
            if r.outcome == SessionOutcome.SUCCESS
        ))

        # Success rate (0-100)
        success_rate = (success_count / total_sessions * 100) if total_sessions > 0 else 0

        # Cache efficiency (0-100)
        cache_efficiency = (total_cache_hits / total_input_tokens * 100) if total_input_tokens > 0 else 0

        # Token efficiency (normalized 0-100)
        # Lower tokens per spec is better, so we invert
        # Reference: ~100K tokens per spec is "average", ~50K is "excellent"
        if successful_specs > 0:
            tokens_per_spec = total_tokens / successful_specs
            # Normalize: 50K = 100 score, 200K = 0 score
            token_efficiency = max(0, min(100, 100 - ((tokens_per_spec - 50000) / 1500)))
        else:
            token_efficiency = 0

        # Calculate overall score (weighted average)
        overall_score = (
            success_rate * 0.4 +
            cache_efficiency * 0.3 +
            token_efficiency * 0.3
        )

        return EfficiencyScore(
            overall_score=overall_score,
            success_rate=success_rate,
            cache_efficiency=cache_efficiency,
            token_efficiency=token_efficiency,
            total_sessions=total_sessions,
            successful_specs=successful_specs,
        )

    def get_usage_summary(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> TokenUsageSummary:
        """
        Get a comprehensive usage summary.

        Args:
            start_date: Optional start date for filtering (default: all time)
            end_date: Optional end date for filtering (default: now)

        Returns:
            TokenUsageSummary with aggregated stats
        """
        # Default dates
        if end_date is None:
            end_date = datetime.now()
        if start_date is None:
            # Default to all-time (very early date)
            start_date = datetime(2020, 1, 1)

        # Get records
        records = self.store.get_usage_for_date_range(start_date, end_date)

        # Create summary
        summary = TokenUsageSummary(
            period_start=start_date,
            period_end=end_date,
        )

        unique_specs = set()

        for record in records:
            cost = float(self.calculator.calculate_cost(record))
            summary.add_record(record, cost)
            unique_specs.add(record.spec_id)

        summary.unique_specs = len(unique_specs)

        return summary

    def get_cost_trend(
        self,
        period: str = "week",
    ) -> UsageTrend:
        """
        Get cost trend comparing current period to previous period.

        Args:
            period: "day", "week", or "month"

        Returns:
            UsageTrend with current vs previous period comparison
        """
        now = datetime.now()

        if period == "day":
            current_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            current_end = now
            previous_start = current_start - timedelta(days=1)
            previous_end = current_start - timedelta(microseconds=1)
        elif period == "week":
            # Current week (Monday to now)
            current_start = now - timedelta(days=now.weekday())
            current_start = current_start.replace(hour=0, minute=0, second=0, microsecond=0)
            current_end = now
            previous_start = current_start - timedelta(weeks=1)
            previous_end = current_start - timedelta(microseconds=1)
        elif period == "month":
            # Current month
            current_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            current_end = now
            # Previous month
            if current_start.month == 1:
                previous_start = current_start.replace(year=current_start.year - 1, month=12)
            else:
                previous_start = current_start.replace(month=current_start.month - 1)
            previous_end = current_start - timedelta(microseconds=1)
        else:
            raise ValueError(f"Invalid period: {period}. Use 'day', 'week', or 'month'")

        current_cost = self.get_total_cost(current_start, current_end)
        previous_cost = self.get_total_cost(previous_start, previous_end)

        return UsageTrend(
            current_value=current_cost,
            previous_value=previous_cost,
        )

    def get_token_trend(
        self,
        period: str = "week",
    ) -> UsageTrend:
        """
        Get token usage trend comparing current period to previous period.

        Args:
            period: "day", "week", or "month"

        Returns:
            UsageTrend with current vs previous period comparison
        """
        now = datetime.now()

        if period == "day":
            current_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            current_end = now
            previous_start = current_start - timedelta(days=1)
            previous_end = current_start - timedelta(microseconds=1)
        elif period == "week":
            current_start = now - timedelta(days=now.weekday())
            current_start = current_start.replace(hour=0, minute=0, second=0, microsecond=0)
            current_end = now
            previous_start = current_start - timedelta(weeks=1)
            previous_end = current_start - timedelta(microseconds=1)
        elif period == "month":
            current_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            current_end = now
            if current_start.month == 1:
                previous_start = current_start.replace(year=current_start.year - 1, month=12)
            else:
                previous_start = current_start.replace(month=current_start.month - 1)
            previous_end = current_start - timedelta(microseconds=1)
        else:
            raise ValueError(f"Invalid period: {period}. Use 'day', 'week', or 'month'")

        # Get records for each period
        current_records = self.store.get_usage_for_date_range(current_start, current_end)
        previous_records = self.store.get_usage_for_date_range(previous_start, previous_end)

        current_tokens = sum(r.total_tokens for r in current_records)
        previous_tokens = sum(r.total_tokens for r in previous_records)

        return UsageTrend(
            current_value=float(current_tokens),
            previous_value=float(previous_tokens),
        )


def get_usage_aggregator(project_dir: Path) -> UsageAggregator:
    """
    Create a UsageAggregator instance.

    Convenience function for creating an aggregator.

    Args:
        project_dir: Root directory of the project

    Returns:
        Configured UsageAggregator instance
    """
    return UsageAggregator(project_dir)
