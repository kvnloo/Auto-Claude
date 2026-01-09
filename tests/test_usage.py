#!/usr/bin/env python3
"""
Tests for Token Usage & Cost Dashboard
========================================

Tests for the usage tracking system including:
- TokenUsageStore: Recording, querying, and persistence
- CostCalculator: Cost computation with various models and token types
- UsageAggregator: Aggregation by time period, spec, and agent type

These tests verify the core functionality for tracking and analyzing
token usage across agent sessions.
"""

import json
import tempfile
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Generator

import pytest

from usage.models import (
    AgentType,
    AgentUsageBreakdown,
    SessionOutcome,
    TokenUsageRecord,
    TokenUsageSummary,
)
from usage.store import TokenUsageStore, TokenUsageStoreError
from usage.cost_calculator import (
    CostCalculator,
    CostBreakdown,
    ModelPricing,
    CLAUDE_PRICING,
    get_cost_calculator,
    calculate_cost,
    format_cost,
)
from usage.aggregator import (
    UsageAggregator,
    DailyUsage,
    SpecUsage,
    UsageTrend,
    EfficiencyScore,
    get_usage_aggregator,
)


# =============================================================================
# FIXTURES
# =============================================================================


@pytest.fixture
def usage_temp_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for usage data storage."""
    import shutil

    temp_path = Path(tempfile.mkdtemp())
    yield temp_path
    shutil.rmtree(temp_path, ignore_errors=True)


@pytest.fixture
def project_with_specs(usage_temp_dir: Path) -> Path:
    """Create a project directory with .auto-claude/specs structure."""
    specs_dir = usage_temp_dir / ".auto-claude" / "specs"
    specs_dir.mkdir(parents=True, exist_ok=True)
    return usage_temp_dir


@pytest.fixture
def spec_dir_with_usage(project_with_specs: Path) -> Path:
    """Create a spec directory with usage subdirectory."""
    spec_dir = project_with_specs / ".auto-claude" / "specs" / "001-test-feature"
    spec_dir.mkdir(parents=True, exist_ok=True)
    return spec_dir


@pytest.fixture
def sample_record() -> TokenUsageRecord:
    """Create a sample TokenUsageRecord for testing."""
    return TokenUsageRecord(
        spec_id="001-test-feature",
        session_id="session-001",
        agent_type=AgentType.CODER,
        input_tokens=1000,
        output_tokens=500,
        thinking_tokens=200,
        cache_hit_tokens=300,
        model_name="claude-sonnet-4-5-20250929",
        outcome=SessionOutcome.SUCCESS,
        timestamp=datetime(2024, 1, 15, 10, 0, 0),
    )


@pytest.fixture
def sample_records() -> list[TokenUsageRecord]:
    """Create multiple sample records for aggregation testing."""
    base_time = datetime(2024, 1, 15, 10, 0, 0)
    records = [
        TokenUsageRecord(
            spec_id="001-feature-a",
            session_id="session-001",
            agent_type=AgentType.PLANNER,
            input_tokens=2000,
            output_tokens=1000,
            thinking_tokens=500,
            cache_hit_tokens=400,
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.SUCCESS,
            timestamp=base_time,
        ),
        TokenUsageRecord(
            spec_id="001-feature-a",
            session_id="session-002",
            agent_type=AgentType.CODER,
            input_tokens=5000,
            output_tokens=3000,
            thinking_tokens=1000,
            cache_hit_tokens=1000,
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.SUCCESS,
            timestamp=base_time + timedelta(hours=1),
        ),
        TokenUsageRecord(
            spec_id="001-feature-a",
            session_id="session-003",
            agent_type=AgentType.QA_REVIEWER,
            input_tokens=3000,
            output_tokens=500,
            thinking_tokens=200,
            cache_hit_tokens=800,
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.FAILED,
            timestamp=base_time + timedelta(hours=2),
        ),
        TokenUsageRecord(
            spec_id="002-feature-b",
            session_id="session-004",
            agent_type=AgentType.CODER,
            input_tokens=4000,
            output_tokens=2000,
            thinking_tokens=800,
            cache_hit_tokens=600,
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.SUCCESS,
            timestamp=base_time + timedelta(days=1),
        ),
    ]
    return records


@pytest.fixture
def store(project_with_specs: Path) -> TokenUsageStore:
    """Create a TokenUsageStore instance with project directory."""
    return TokenUsageStore(project_dir=project_with_specs)


@pytest.fixture
def calculator() -> CostCalculator:
    """Create a CostCalculator instance."""
    return CostCalculator()


@pytest.fixture
def populated_store(
    store: TokenUsageStore,
    sample_records: list[TokenUsageRecord],
    project_with_specs: Path,
) -> TokenUsageStore:
    """Create a store populated with sample records."""
    for record in sample_records:
        spec_dir = (
            project_with_specs / ".auto-claude" / "specs" / record.spec_id
        )
        spec_dir.mkdir(parents=True, exist_ok=True)
        store.record_usage(record, spec_dir=spec_dir)
    return store


# =============================================================================
# TOKEN USAGE RECORD TESTS
# =============================================================================


class TestTokenUsageRecord:
    """Tests for TokenUsageRecord data model."""

    def test_create_record(self, sample_record: TokenUsageRecord):
        """Creates record with all required fields."""
        assert sample_record.spec_id == "001-test-feature"
        assert sample_record.agent_type == AgentType.CODER
        assert sample_record.input_tokens == 1000
        assert sample_record.outcome == SessionOutcome.SUCCESS

    def test_total_tokens(self, sample_record: TokenUsageRecord):
        """Calculates total tokens correctly."""
        # input + output + thinking = 1000 + 500 + 200 = 1700
        assert sample_record.total_tokens == 1700

    def test_billable_output_tokens(self, sample_record: TokenUsageRecord):
        """Calculates billable output tokens (output + thinking)."""
        # output + thinking = 500 + 200 = 700
        assert sample_record.billable_output_tokens == 700

    def test_effective_input_tokens(self, sample_record: TokenUsageRecord):
        """Calculates effective input tokens with cache discount."""
        # input - cache_hits * 0.9 = 1000 - 300 * 0.9 = 730
        assert sample_record.effective_input_tokens == 730

    def test_serialization_roundtrip(self, sample_record: TokenUsageRecord):
        """Serializes and deserializes correctly."""
        data = sample_record.to_dict()
        restored = TokenUsageRecord.from_dict(data)

        assert restored.spec_id == sample_record.spec_id
        assert restored.agent_type == sample_record.agent_type
        assert restored.input_tokens == sample_record.input_tokens
        assert restored.outcome == sample_record.outcome
        assert restored.timestamp == sample_record.timestamp

    def test_json_roundtrip(self, sample_record: TokenUsageRecord):
        """Serializes and deserializes JSON correctly."""
        json_str = sample_record.to_json()
        restored = TokenUsageRecord.from_json(json_str)

        assert restored.spec_id == sample_record.spec_id
        assert restored.session_id == sample_record.session_id


class TestAgentUsageBreakdown:
    """Tests for AgentUsageBreakdown data model."""

    def test_add_record(self, sample_record: TokenUsageRecord):
        """Adds record to breakdown correctly."""
        breakdown = AgentUsageBreakdown(agent_type=AgentType.CODER)
        breakdown.add_record(sample_record, cost_usd=0.05)

        assert breakdown.session_count == 1
        assert breakdown.total_input_tokens == 1000
        assert breakdown.total_output_tokens == 500
        assert breakdown.success_count == 1
        assert breakdown.total_cost_usd == 0.05

    def test_avg_tokens_per_session(self):
        """Calculates average tokens per session."""
        breakdown = AgentUsageBreakdown(
            agent_type=AgentType.CODER,
            session_count=4,
            total_input_tokens=4000,
            total_output_tokens=2000,
            total_thinking_tokens=1000,
        )
        # (4000 + 2000 + 1000) / 4 = 1750
        assert breakdown.avg_tokens_per_session == 1750.0

    def test_success_rate(self):
        """Calculates success rate correctly."""
        breakdown = AgentUsageBreakdown(
            agent_type=AgentType.CODER,
            session_count=10,
            success_count=7,
            failure_count=3,
        )
        assert breakdown.success_rate == 70.0

    def test_success_rate_zero_sessions(self):
        """Returns 0 for zero sessions."""
        breakdown = AgentUsageBreakdown(agent_type=AgentType.CODER)
        assert breakdown.success_rate == 0.0


class TestTokenUsageSummary:
    """Tests for TokenUsageSummary data model."""

    def test_add_record_updates_counts(self, sample_record: TokenUsageRecord):
        """Adding record updates all counts."""
        summary = TokenUsageSummary(
            period_start=datetime(2024, 1, 1),
            period_end=datetime(2024, 1, 31),
        )
        summary.add_record(sample_record, cost_usd=0.10)

        assert summary.total_sessions == 1
        assert summary.total_input_tokens == 1000
        assert summary.success_count == 1
        assert summary.total_cost_usd == 0.10

    def test_agent_breakdown_created(self, sample_record: TokenUsageRecord):
        """Creates agent breakdown when adding records."""
        summary = TokenUsageSummary(
            period_start=datetime(2024, 1, 1),
            period_end=datetime(2024, 1, 31),
        )
        summary.add_record(sample_record)

        assert AgentType.CODER.value in summary.agent_breakdown
        assert summary.agent_breakdown[AgentType.CODER.value].session_count == 1

    def test_cache_efficiency(self):
        """Calculates cache efficiency correctly."""
        summary = TokenUsageSummary(
            period_start=datetime(2024, 1, 1),
            period_end=datetime(2024, 1, 31),
            total_input_tokens=10000,
            total_cache_hit_tokens=3000,
        )
        # 3000 / 10000 * 100 = 30%
        assert summary.cache_efficiency == 30.0


# =============================================================================
# TOKEN USAGE STORE TESTS
# =============================================================================


class TestTokenUsageStore:
    """Tests for TokenUsageStore persistence."""

    def test_record_usage_creates_file(
        self,
        store: TokenUsageStore,
        sample_record: TokenUsageRecord,
        spec_dir_with_usage: Path,
    ):
        """Recording usage creates usage.json file."""
        store.record_usage(sample_record, spec_dir=spec_dir_with_usage)

        usage_file = spec_dir_with_usage / "usage" / "usage.json"
        assert usage_file.exists()

    def test_record_and_retrieve(
        self,
        store: TokenUsageStore,
        sample_record: TokenUsageRecord,
        spec_dir_with_usage: Path,
    ):
        """Records and retrieves usage correctly."""
        store.record_usage(sample_record, spec_dir=spec_dir_with_usage)
        records = store.get_usage_for_spec("001-test-feature", spec_dir=spec_dir_with_usage)

        assert len(records) == 1
        assert records[0].spec_id == sample_record.spec_id
        assert records[0].input_tokens == sample_record.input_tokens

    def test_multiple_records_same_spec(
        self,
        store: TokenUsageStore,
        spec_dir_with_usage: Path,
    ):
        """Stores multiple records for the same spec."""
        for i in range(3):
            record = TokenUsageRecord(
                spec_id="001-test-feature",
                session_id=f"session-{i}",
                agent_type=AgentType.CODER,
                input_tokens=1000 * (i + 1),
                output_tokens=500,
                thinking_tokens=0,
                cache_hit_tokens=0,
                model_name="claude-sonnet-4-5-20250929",
                outcome=SessionOutcome.SUCCESS,
            )
            store.record_usage(record, spec_dir=spec_dir_with_usage)

        records = store.get_usage_for_spec("001-test-feature", spec_dir=spec_dir_with_usage)
        assert len(records) == 3

    def test_get_usage_for_nonexistent_spec(self, store: TokenUsageStore):
        """Returns empty list for nonexistent spec."""
        records = store.get_usage_for_spec("nonexistent-spec")
        assert records == []

    def test_get_usage_for_date_range(
        self,
        populated_store: TokenUsageStore,
        sample_records: list[TokenUsageRecord],
    ):
        """Filters records by date range."""
        start = datetime(2024, 1, 15, 0, 0, 0)
        end = datetime(2024, 1, 15, 23, 59, 59)

        records = populated_store.get_usage_for_date_range(start, end)

        # First 3 records are on Jan 15, 4th is on Jan 16
        assert len(records) == 3

    def test_get_usage_by_agent_type(
        self,
        populated_store: TokenUsageStore,
        sample_records: list[TokenUsageRecord],
    ):
        """Filters records by agent type."""
        coder_records = populated_store.get_usage_by_agent_type(AgentType.CODER)

        # 2 coder sessions in sample_records
        assert len(coder_records) == 2
        assert all(r.agent_type == AgentType.CODER for r in coder_records)

    def test_get_all_usage_for_project(
        self,
        populated_store: TokenUsageStore,
        sample_records: list[TokenUsageRecord],
    ):
        """Gets all records across all specs."""
        records = populated_store.get_all_usage_for_project()

        assert len(records) == len(sample_records)

    def test_get_unique_spec_ids(
        self,
        populated_store: TokenUsageStore,
    ):
        """Gets unique spec IDs with usage data."""
        spec_ids = populated_store.get_unique_spec_ids()

        assert len(spec_ids) == 2
        assert "001-feature-a" in spec_ids
        assert "002-feature-b" in spec_ids

    def test_delete_usage_for_spec(
        self,
        store: TokenUsageStore,
        sample_record: TokenUsageRecord,
        spec_dir_with_usage: Path,
    ):
        """Deletes usage data for a spec."""
        store.record_usage(sample_record, spec_dir=spec_dir_with_usage)
        deleted = store.delete_usage_for_spec("001-test-feature", spec_dir=spec_dir_with_usage)

        assert deleted is True

        records = store.get_usage_for_spec("001-test-feature", spec_dir=spec_dir_with_usage)
        assert len(records) == 0

    def test_get_usage_count(
        self,
        populated_store: TokenUsageStore,
    ):
        """Gets count of usage records."""
        count = populated_store.get_usage_count()
        assert count == 4

    def test_error_without_project_dir(self, sample_record: TokenUsageRecord):
        """Raises error when project_dir not set and needed."""
        store = TokenUsageStore()  # No project_dir

        with pytest.raises(TokenUsageStoreError):
            store.record_usage(sample_record)

    def test_error_getting_all_usage_without_project_dir(self):
        """Raises error for project-wide query without project_dir."""
        store = TokenUsageStore()

        with pytest.raises(TokenUsageStoreError):
            store.get_all_usage_for_project()


class TestTokenUsageStoreEdgeCases:
    """Edge case tests for TokenUsageStore."""

    def test_empty_usage_file(
        self,
        store: TokenUsageStore,
        spec_dir_with_usage: Path,
    ):
        """Handles empty usage file gracefully."""
        usage_dir = spec_dir_with_usage / "usage"
        usage_dir.mkdir(parents=True, exist_ok=True)
        (usage_dir / "usage.json").write_text("[]")

        records = store.get_usage_for_spec("001-test-feature", spec_dir=spec_dir_with_usage)
        assert records == []

    def test_corrupted_usage_file(
        self,
        store: TokenUsageStore,
        spec_dir_with_usage: Path,
    ):
        """Handles corrupted usage file gracefully."""
        usage_dir = spec_dir_with_usage / "usage"
        usage_dir.mkdir(parents=True, exist_ok=True)
        (usage_dir / "usage.json").write_text("not valid json")

        records = store.get_usage_for_spec("001-test-feature", spec_dir=spec_dir_with_usage)
        assert records == []

    def test_date_range_no_matching_records(
        self,
        populated_store: TokenUsageStore,
    ):
        """Returns empty list when no records match date range."""
        start = datetime(2020, 1, 1)
        end = datetime(2020, 12, 31)

        records = populated_store.get_usage_for_date_range(start, end)
        assert records == []

    def test_date_range_boundary_inclusive(
        self,
        store: TokenUsageStore,
        spec_dir_with_usage: Path,
    ):
        """Date range is inclusive of boundaries."""
        exact_time = datetime(2024, 1, 15, 12, 0, 0)
        record = TokenUsageRecord(
            spec_id="001-test-feature",
            session_id="session-boundary",
            agent_type=AgentType.CODER,
            input_tokens=1000,
            output_tokens=500,
            thinking_tokens=0,
            cache_hit_tokens=0,
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.SUCCESS,
            timestamp=exact_time,
        )
        store.record_usage(record, spec_dir=spec_dir_with_usage)

        # Exact boundary match
        records = store.get_usage_for_date_range(
            exact_time,
            exact_time,
            spec_dir=spec_dir_with_usage,
        )
        assert len(records) == 1

    def test_partial_spec_id_match(
        self,
        store: TokenUsageStore,
        project_with_specs: Path,
    ):
        """Finds spec directory with partial spec ID match."""
        spec_dir = project_with_specs / ".auto-claude" / "specs" / "025-token-usage-dashboard"
        spec_dir.mkdir(parents=True, exist_ok=True)

        record = TokenUsageRecord(
            spec_id="025",
            session_id="session-partial",
            agent_type=AgentType.CODER,
            input_tokens=1000,
            output_tokens=500,
            thinking_tokens=0,
            cache_hit_tokens=0,
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.SUCCESS,
        )
        store.record_usage(record, spec_dir=spec_dir)

        # Should find by partial match
        records = store.get_usage_for_spec("025")
        assert len(records) == 1


# =============================================================================
# COST CALCULATOR TESTS
# =============================================================================


class TestCostCalculator:
    """Tests for CostCalculator."""

    def test_get_pricing_for_sonnet(self, calculator: CostCalculator):
        """Gets correct pricing for Sonnet model."""
        pricing = calculator.get_pricing_for_model("claude-sonnet-4-5-20250929")

        assert pricing.model_family == "sonnet"
        assert pricing.input_price_per_million == Decimal("3.00")
        assert pricing.output_price_per_million == Decimal("15.00")

    def test_get_pricing_for_opus(self, calculator: CostCalculator):
        """Gets correct pricing for Opus model."""
        pricing = calculator.get_pricing_for_model("claude-opus-4-20250929")

        assert pricing.model_family == "opus"
        assert pricing.input_price_per_million == Decimal("15.00")
        assert pricing.output_price_per_million == Decimal("75.00")

    def test_get_pricing_for_haiku(self, calculator: CostCalculator):
        """Gets correct pricing for Haiku model."""
        pricing = calculator.get_pricing_for_model("claude-haiku-3-5-20250929")

        assert pricing.model_family == "haiku"
        assert pricing.input_price_per_million == Decimal("0.25")
        assert pricing.output_price_per_million == Decimal("1.25")

    def test_get_pricing_defaults_to_sonnet(self, calculator: CostCalculator):
        """Defaults to Sonnet for unknown models."""
        pricing = calculator.get_pricing_for_model("unknown-model")

        assert pricing.model_family == "sonnet"

    def test_calculate_cost_basic(
        self,
        calculator: CostCalculator,
        sample_record: TokenUsageRecord,
    ):
        """Calculates basic cost correctly."""
        cost = calculator.calculate_cost(sample_record)

        # Input: 1000 - 300 cache = 700 tokens @ $3/1M = $0.0021
        # Output: 500 tokens @ $15/1M = $0.0075
        # Thinking: 200 tokens @ $15/1M = $0.003
        # Cache: 300 tokens @ $3/1M * 0.1 = $0.00009
        # Total: ~$0.01269
        assert isinstance(cost, Decimal)
        assert cost > Decimal("0.012")
        assert cost < Decimal("0.013")

    def test_calculate_cost_with_breakdown(
        self,
        calculator: CostCalculator,
        sample_record: TokenUsageRecord,
    ):
        """Returns detailed breakdown when requested."""
        breakdown = calculator.calculate_cost(sample_record, return_breakdown=True)

        assert isinstance(breakdown, CostBreakdown)
        assert breakdown.input_cost > Decimal("0")
        assert breakdown.output_cost > Decimal("0")
        assert breakdown.thinking_cost > Decimal("0")
        assert breakdown.cache_cost > Decimal("0")
        assert breakdown.total_cost > Decimal("0")

    def test_calculate_cost_thinking_at_output_rate(self, calculator: CostCalculator):
        """Thinking tokens are billed at output rate."""
        record = TokenUsageRecord(
            spec_id="test",
            session_id="test",
            agent_type=AgentType.CODER,
            input_tokens=0,
            output_tokens=0,
            thinking_tokens=1000000,  # 1M thinking tokens
            cache_hit_tokens=0,
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.SUCCESS,
        )

        breakdown = calculator.calculate_cost(record, return_breakdown=True)

        # 1M thinking tokens @ $15/1M output rate = $15
        assert breakdown.thinking_cost == Decimal("15.00")

    def test_calculate_cost_cache_discount(self, calculator: CostCalculator):
        """Cache hits get 90% discount."""
        record = TokenUsageRecord(
            spec_id="test",
            session_id="test",
            agent_type=AgentType.CODER,
            input_tokens=1000000,  # 1M input tokens
            output_tokens=0,
            thinking_tokens=0,
            cache_hit_tokens=1000000,  # All are cache hits
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.SUCCESS,
        )

        breakdown = calculator.calculate_cost(record, return_breakdown=True)

        # All input is from cache: 1M @ $3/1M * 0.1 = $0.30
        assert breakdown.input_cost == Decimal("0")  # No non-cached input
        assert breakdown.cache_cost == Decimal("0.30")

    def test_calculate_cost_from_tokens(self, calculator: CostCalculator):
        """Calculates cost from raw token counts."""
        cost = calculator.calculate_cost_from_tokens(
            model_name="sonnet",
            input_tokens=1000000,
            output_tokens=1000000,
            thinking_tokens=0,
            cache_hit_tokens=0,
        )

        # 1M input @ $3 + 1M output @ $15 = $18
        assert cost == Decimal("18.00")

    def test_calculate_batch_cost(
        self,
        calculator: CostCalculator,
        sample_records: list[TokenUsageRecord],
    ):
        """Calculates total cost for multiple records."""
        total = calculator.calculate_batch_cost(sample_records)

        assert isinstance(total, Decimal)
        assert total > Decimal("0")

    def test_estimate_cost(self, calculator: CostCalculator):
        """Estimates cost for future session."""
        estimate = calculator.estimate_cost(
            model_name="sonnet",
            estimated_input_tokens=10000,
            estimated_output_tokens=5000,
            estimated_cache_hit_rate=0.5,  # 50% cache hit rate
        )

        # With 50% cache rate on 10K input:
        # Non-cached: 5000 @ $3/1M = $0.015
        # Cached: 5000 @ $0.3/1M = $0.0015
        # Output: 5000 @ $15/1M = $0.075
        # Total: ~$0.0915
        assert estimate > Decimal("0.09")
        assert estimate < Decimal("0.10")

    def test_format_cost_display(self, calculator: CostCalculator):
        """Formats cost for display."""
        formatted = calculator.format_cost_display(Decimal("12.3456"))

        assert formatted == "$12.3456"

    def test_format_cost_abbreviated(self, calculator: CostCalculator):
        """Formats large costs with abbreviation."""
        formatted = calculator.format_cost_display(Decimal("1234.56"), abbreviate=True)

        assert formatted == "$1.23K"

    def test_format_cost_no_symbol(self, calculator: CostCalculator):
        """Formats without dollar symbol."""
        formatted = calculator.format_cost_display(
            Decimal("5.00"),
            include_symbol=False,
            precision=2,
        )

        assert formatted == "5.00"

    def test_get_available_models(self, calculator: CostCalculator):
        """Gets list of available model families."""
        models = calculator.get_available_models()

        assert "sonnet" in models
        assert "opus" in models
        assert "haiku" in models

    def test_custom_pricing(self):
        """Supports custom pricing overrides."""
        custom_pricing = {
            "custom": ModelPricing(
                model_family="custom",
                input_price_per_million=Decimal("1.00"),
                output_price_per_million=Decimal("5.00"),
            )
        }

        calc = CostCalculator(custom_pricing=custom_pricing)
        pricing = calc.get_pricing_for_model("custom")

        assert pricing.input_price_per_million == Decimal("1.00")


class TestCostCalculatorEdgeCases:
    """Edge case tests for CostCalculator."""

    def test_zero_tokens(self, calculator: CostCalculator):
        """Handles zero tokens correctly."""
        record = TokenUsageRecord(
            spec_id="test",
            session_id="test",
            agent_type=AgentType.CODER,
            input_tokens=0,
            output_tokens=0,
            thinking_tokens=0,
            cache_hit_tokens=0,
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.SUCCESS,
        )

        cost = calculator.calculate_cost(record)
        assert cost == Decimal("0")

    def test_cache_exceeds_input(self, calculator: CostCalculator):
        """Handles cache hits exceeding input (defensive)."""
        record = TokenUsageRecord(
            spec_id="test",
            session_id="test",
            agent_type=AgentType.CODER,
            input_tokens=100,
            output_tokens=0,
            thinking_tokens=0,
            cache_hit_tokens=200,  # More cache hits than input
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.SUCCESS,
        )

        breakdown = calculator.calculate_cost(record, return_breakdown=True)

        # Non-cached input should be 0 (not negative)
        assert breakdown.tokens_billed["input_tokens"] == 0

    def test_very_large_token_counts(self, calculator: CostCalculator):
        """Handles very large token counts."""
        record = TokenUsageRecord(
            spec_id="test",
            session_id="test",
            agent_type=AgentType.CODER,
            input_tokens=100_000_000,  # 100M tokens
            output_tokens=50_000_000,
            thinking_tokens=10_000_000,
            cache_hit_tokens=0,
            model_name="claude-sonnet-4-5-20250929",
            outcome=SessionOutcome.SUCCESS,
        )

        cost = calculator.calculate_cost(record)

        # 100M input @ $3 + 50M output @ $15 + 10M thinking @ $15 = $1200
        assert cost == Decimal("1200.00")


class TestCostCalculatorConvenienceFunctions:
    """Tests for module-level convenience functions."""

    def test_get_cost_calculator_singleton(self):
        """get_cost_calculator returns singleton."""
        calc1 = get_cost_calculator()
        calc2 = get_cost_calculator()

        assert calc1 is calc2

    def test_calculate_cost_function(self, sample_record: TokenUsageRecord):
        """calculate_cost convenience function works."""
        cost = calculate_cost(sample_record)

        assert isinstance(cost, float)
        assert cost > 0

    def test_format_cost_function(self):
        """format_cost convenience function works."""
        formatted = format_cost(12.3456, precision=2)

        assert formatted == "$12.35"


# =============================================================================
# USAGE AGGREGATOR TESTS
# =============================================================================


class TestUsageAggregator:
    """Tests for UsageAggregator."""

    def test_get_daily_usage(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Aggregates usage by day."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        daily = aggregator.get_daily_usage(
            start_date=datetime(2024, 1, 14),
            end_date=datetime(2024, 1, 17),
        )

        # Should have entries for each day in range
        assert len(daily) == 4  # 14th, 15th, 16th, 17th

        # 15th should have 3 sessions
        day_15 = [d for d in daily if d.date.day == 15][0]
        assert day_15.session_count == 3

        # 16th should have 1 session
        day_16 = [d for d in daily if d.date.day == 16][0]
        assert day_16.session_count == 1

    def test_get_daily_usage_fills_gaps(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Fills gaps in daily usage with zero values."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        daily = aggregator.get_daily_usage(
            start_date=datetime(2024, 1, 14),
            end_date=datetime(2024, 1, 17),
        )

        # 14th should have 0 sessions (gap filled)
        day_14 = [d for d in daily if d.date.day == 14][0]
        assert day_14.session_count == 0
        assert day_14.total_tokens == 0

    def test_get_weekly_usage(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Aggregates usage by week."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        weekly = aggregator.get_weekly_usage(
            start_date=datetime(2024, 1, 1),
            end_date=datetime(2024, 1, 31),
        )

        # Should have at least one week with data
        assert len(weekly) > 0
        assert all("week_key" in w for w in weekly)
        assert all("total_tokens" in w for w in weekly)

    def test_get_monthly_usage(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Aggregates usage by month."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        monthly = aggregator.get_monthly_usage(
            start_date=datetime(2024, 1, 1),
            end_date=datetime(2024, 1, 31),
        )

        assert len(monthly) == 1
        assert monthly[0]["month"] == "2024-01"
        assert monthly[0]["session_count"] == 4

    def test_get_usage_by_spec(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Aggregates usage by spec."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        specs = aggregator.get_usage_by_spec()

        assert len(specs) == 2

        # Specs should be sorted by cost descending
        assert specs[0].total_cost >= specs[1].total_cost

        # Check spec details
        spec_a = next(s for s in specs if s.spec_id == "001-feature-a")
        assert spec_a.session_count == 3
        assert spec_a.success_count == 2
        assert spec_a.failure_count == 1

    def test_get_usage_by_agent_type(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Aggregates usage by agent type."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        breakdown = aggregator.get_usage_by_agent_type()

        assert AgentType.CODER.value in breakdown
        assert AgentType.PLANNER.value in breakdown
        assert AgentType.QA_REVIEWER.value in breakdown

        # Coder should have 2 sessions
        coder = breakdown[AgentType.CODER.value]
        assert coder.session_count == 2

    def test_get_total_cost(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Calculates total cost for all records."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        total = aggregator.get_total_cost()

        assert isinstance(total, float)
        assert total > 0

    def test_get_total_cost_with_date_filter(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Calculates total cost with date filter."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        total = aggregator.get_total_cost(
            start_date=datetime(2024, 1, 15, 0, 0, 0),
            end_date=datetime(2024, 1, 15, 23, 59, 59),
        )

        # Should only include day 1 costs (3 sessions)
        assert total > 0

    def test_get_total_cost_with_spec_filter(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Calculates total cost for specific spec."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        total = aggregator.get_total_cost(spec_id="001-feature-a")

        assert total > 0

    def test_calculate_efficiency_score(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Calculates efficiency score."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        score = aggregator.calculate_efficiency_score()

        assert isinstance(score, EfficiencyScore)
        assert 0 <= score.overall_score <= 100
        assert 0 <= score.success_rate <= 100
        assert 0 <= score.cache_efficiency <= 100
        assert score.total_sessions == 4

    def test_get_usage_summary(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Gets comprehensive usage summary."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        summary = aggregator.get_usage_summary()

        assert isinstance(summary, TokenUsageSummary)
        assert summary.total_sessions == 4
        assert summary.unique_specs == 2
        assert summary.total_cost_usd > 0


class TestUsageAggregatorTrends:
    """Tests for UsageAggregator trend calculations."""

    def test_get_cost_trend_up(
        self,
        project_with_specs: Path,
        store: TokenUsageStore,
    ):
        """Detects upward cost trend."""
        now = datetime.now()
        today = now.replace(hour=10, minute=0, second=0, microsecond=0)
        yesterday = today - timedelta(days=1)

        # Yesterday: small usage
        spec_dir = project_with_specs / ".auto-claude" / "specs" / "001-trend-test"
        spec_dir.mkdir(parents=True, exist_ok=True)

        store.record_usage(
            TokenUsageRecord(
                spec_id="001-trend-test",
                session_id="s1",
                agent_type=AgentType.CODER,
                input_tokens=1000,
                output_tokens=500,
                thinking_tokens=0,
                cache_hit_tokens=0,
                model_name="claude-sonnet-4-5-20250929",
                outcome=SessionOutcome.SUCCESS,
                timestamp=yesterday,
            ),
            spec_dir=spec_dir,
        )

        # Today: larger usage
        store.record_usage(
            TokenUsageRecord(
                spec_id="001-trend-test",
                session_id="s2",
                agent_type=AgentType.CODER,
                input_tokens=10000,
                output_tokens=5000,
                thinking_tokens=0,
                cache_hit_tokens=0,
                model_name="claude-sonnet-4-5-20250929",
                outcome=SessionOutcome.SUCCESS,
                timestamp=today,
            ),
            spec_dir=spec_dir,
        )

        aggregator = UsageAggregator(project_dir=project_with_specs)
        trend = aggregator.get_cost_trend(period="day")

        assert trend.current_value > trend.previous_value
        assert trend.trend_direction == "up"
        assert trend.change_percentage > 0

    def test_get_token_trend(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Gets token usage trend."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        trend = aggregator.get_token_trend(period="week")

        assert isinstance(trend, UsageTrend)
        assert hasattr(trend, "current_value")
        assert hasattr(trend, "previous_value")
        assert trend.trend_direction in ("up", "down", "flat")


class TestUsageAggregatorEdgeCases:
    """Edge case tests for UsageAggregator."""

    def test_empty_project(self, usage_temp_dir: Path):
        """Handles project with no usage data."""
        project_dir = usage_temp_dir / "empty_project"
        specs_dir = project_dir / ".auto-claude" / "specs"
        specs_dir.mkdir(parents=True, exist_ok=True)

        aggregator = UsageAggregator(project_dir=project_dir)

        daily = aggregator.get_daily_usage(days=7)
        summary = aggregator.get_usage_summary()
        efficiency = aggregator.calculate_efficiency_score()

        # Should return empty/zero values, not error
        assert len(daily) == 8  # 8 days of zeros
        assert summary.total_sessions == 0
        assert efficiency.overall_score == 0

    def test_efficiency_score_no_successes(
        self,
        project_with_specs: Path,
        store: TokenUsageStore,
    ):
        """Handles efficiency calculation with no successful specs."""
        spec_dir = project_with_specs / ".auto-claude" / "specs" / "001-failed"
        spec_dir.mkdir(parents=True, exist_ok=True)

        store.record_usage(
            TokenUsageRecord(
                spec_id="001-failed",
                session_id="s1",
                agent_type=AgentType.CODER,
                input_tokens=1000,
                output_tokens=500,
                thinking_tokens=0,
                cache_hit_tokens=0,
                model_name="claude-sonnet-4-5-20250929",
                outcome=SessionOutcome.FAILED,
            ),
            spec_dir=spec_dir,
        )

        aggregator = UsageAggregator(project_dir=project_with_specs)
        efficiency = aggregator.calculate_efficiency_score()

        assert efficiency.success_rate == 0.0
        assert efficiency.successful_specs == 0

    def test_trend_invalid_period(
        self,
        project_with_specs: Path,
        populated_store: TokenUsageStore,
    ):
        """Raises error for invalid trend period."""
        aggregator = UsageAggregator(project_dir=project_with_specs)

        with pytest.raises(ValueError, match="Invalid period"):
            aggregator.get_cost_trend(period="invalid")


class TestUsageTrendDataclass:
    """Tests for UsageTrend dataclass."""

    def test_change_absolute(self):
        """Calculates absolute change."""
        trend = UsageTrend(current_value=150.0, previous_value=100.0)

        assert trend.change_absolute == 50.0

    def test_change_percentage(self):
        """Calculates percentage change."""
        trend = UsageTrend(current_value=150.0, previous_value=100.0)

        assert trend.change_percentage == 50.0

    def test_change_percentage_from_zero(self):
        """Handles percentage change from zero."""
        trend = UsageTrend(current_value=100.0, previous_value=0.0)

        # Infinite increase capped at 100%
        assert trend.change_percentage == 100.0

    def test_change_percentage_both_zero(self):
        """Handles both values being zero."""
        trend = UsageTrend(current_value=0.0, previous_value=0.0)

        assert trend.change_percentage == 0.0

    def test_trend_direction_up(self):
        """Detects upward trend."""
        trend = UsageTrend(current_value=200.0, previous_value=100.0)

        assert trend.trend_direction == "up"

    def test_trend_direction_down(self):
        """Detects downward trend."""
        trend = UsageTrend(current_value=50.0, previous_value=100.0)

        assert trend.trend_direction == "down"

    def test_trend_direction_flat(self):
        """Detects flat trend (< 1% change)."""
        trend = UsageTrend(current_value=100.5, previous_value=100.0)

        assert trend.trend_direction == "flat"


class TestDailyUsageDataclass:
    """Tests for DailyUsage dataclass."""

    def test_to_dict(self):
        """Serializes to dictionary correctly."""
        daily = DailyUsage(
            date=datetime(2024, 1, 15, 0, 0, 0),
            total_tokens=5000,
            total_cost=1.50,
            session_count=3,
            input_tokens=3000,
            output_tokens=1500,
            thinking_tokens=500,
            cache_hit_tokens=1000,
            success_count=2,
            failure_count=1,
        )

        data = daily.to_dict()

        assert data["date"] == "2024-01-15T00:00:00"
        assert data["total_tokens"] == 5000
        assert data["total_cost"] == 1.5
        assert data["session_count"] == 3


class TestSpecUsageDataclass:
    """Tests for SpecUsage dataclass."""

    def test_avg_tokens_per_session(self):
        """Calculates average tokens per session."""
        spec = SpecUsage(
            spec_id="001-test",
            total_tokens=10000,
            session_count=4,
        )

        assert spec.avg_tokens_per_session == 2500.0

    def test_success_rate(self):
        """Calculates success rate."""
        spec = SpecUsage(
            spec_id="001-test",
            session_count=10,
            success_count=8,
            failure_count=2,
        )

        assert spec.success_rate == 80.0

    def test_to_dict(self):
        """Serializes to dictionary correctly."""
        spec = SpecUsage(
            spec_id="001-test",
            total_tokens=5000,
            total_cost=1.25,
            session_count=2,
            first_session=datetime(2024, 1, 15, 10, 0, 0),
            last_session=datetime(2024, 1, 15, 12, 0, 0),
        )

        data = spec.to_dict()

        assert data["spec_id"] == "001-test"
        assert data["first_session"] == "2024-01-15T10:00:00"
        assert data["avg_tokens_per_session"] == 2500.0


class TestEfficiencyScoreDataclass:
    """Tests for EfficiencyScore dataclass."""

    def test_to_dict(self):
        """Serializes to dictionary correctly."""
        score = EfficiencyScore(
            overall_score=75.5,
            success_rate=80.0,
            cache_efficiency=60.0,
            token_efficiency=70.0,
            total_sessions=50,
            successful_specs=10,
        )

        data = score.to_dict()

        assert data["overall_score"] == 75.5
        assert data["success_rate"] == 80.0
        assert data["total_sessions"] == 50


class TestGetUsageAggregator:
    """Tests for get_usage_aggregator convenience function."""

    def test_creates_aggregator(self, project_with_specs: Path):
        """Creates UsageAggregator instance."""
        aggregator = get_usage_aggregator(project_with_specs)

        assert isinstance(aggregator, UsageAggregator)
        assert aggregator.project_dir == project_with_specs
