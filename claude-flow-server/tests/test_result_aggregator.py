"""
Tests for Result Aggregator Module
===================================

Unit tests for ResultAggregator, AgentOutput, ExecutionMetrics,
and aggregation functionality.
"""

from datetime import datetime, timezone, timedelta

import pytest

from claude_flow_server.result_aggregator import (
    DEDUP_SIMILARITY_THRESHOLD,
    SEQUENTIAL_TIME_ESTIMATE_PER_OUTPUT,
    AgentOutput,
    AggregatedResult,
    ExecutionMetrics,
    ResultAggregator,
    aggregate_outputs,
    create_aggregator,
)


# =============================================================================
# AGENT OUTPUT TESTS
# =============================================================================


class TestAgentOutput:
    """Tests for AgentOutput dataclass."""

    def test_default_values(self):
        """Test AgentOutput default values."""
        output = AgentOutput(agent_id="agent-1")
        assert output.agent_id == "agent-1"
        assert output.output == ""
        assert output.success is True
        assert output.error is None
        assert output.execution_time == 0.0
        assert output.api_calls == 0
        assert output.metadata == {}

    def test_custom_values(self):
        """Test AgentOutput with custom values."""
        output = AgentOutput(
            agent_id="agent-2",
            output="Research findings",
            success=True,
            error=None,
            execution_time=5.5,
            api_calls=10,
            metadata={"topic": "testing"},
        )
        assert output.output == "Research findings"
        assert output.execution_time == 5.5
        assert output.api_calls == 10
        assert output.metadata["topic"] == "testing"

    def test_failed_output(self):
        """Test AgentOutput for failed agent."""
        output = AgentOutput(
            agent_id="agent-3",
            success=False,
            error="Rate limit exceeded",
        )
        assert output.success is False
        assert output.error == "Rate limit exceeded"

    def test_from_dict_basic(self):
        """Test AgentOutput.from_dict with basic data."""
        data = {"agent_id": "agent-1", "output": "Hello"}
        output = AgentOutput.from_dict(data)
        assert output.agent_id == "agent-1"
        assert output.output == "Hello"

    def test_from_dict_with_result_key(self):
        """Test AgentOutput.from_dict with 'result' key instead of 'output'."""
        data = {"id": "agent-2", "result": "World"}
        output = AgentOutput.from_dict(data)
        assert output.agent_id == "agent-2"
        assert output.output == "World"

    def test_from_dict_with_duration_key(self):
        """Test AgentOutput.from_dict with 'duration' key."""
        data = {"agent_id": "agent-3", "duration": 10.5}
        output = AgentOutput.from_dict(data)
        assert output.execution_time == 10.5

    def test_from_dict_generates_agent_id(self):
        """Test AgentOutput.from_dict generates ID when missing."""
        data = {"output": "No ID provided"}
        output = AgentOutput.from_dict(data)
        assert output.agent_id.startswith("agent-")


# =============================================================================
# EXECUTION METRICS TESTS
# =============================================================================


class TestExecutionMetrics:
    """Tests for ExecutionMetrics class."""

    def test_default_values(self):
        """Test ExecutionMetrics default values."""
        metrics = ExecutionMetrics()
        assert metrics.execution_time_seconds == 0.0
        assert metrics.agent_count == 0
        assert metrics.speedup_factor == 1.0
        assert metrics.sequential_baseline_seconds == 0.0
        assert metrics.agents_successful == 0
        assert metrics.agents_failed == 0
        assert metrics.api_calls_total == 0
        assert metrics.started_at is None
        assert metrics.completed_at is None

    def test_custom_values(self):
        """Test ExecutionMetrics with custom values."""
        now = datetime.now(timezone.utc)
        metrics = ExecutionMetrics(
            execution_time_seconds=45.0,
            agent_count=8,
            speedup_factor=6.5,
            sequential_baseline_seconds=292.5,
            agents_successful=7,
            agents_failed=1,
            api_calls_total=96,
            started_at=now,
            completed_at=now + timedelta(seconds=45),
        )
        assert metrics.execution_time_seconds == 45.0
        assert metrics.agent_count == 8
        assert metrics.speedup_factor == 6.5

    def test_to_dict(self):
        """Test ExecutionMetrics to_dict conversion."""
        now = datetime.now(timezone.utc)
        metrics = ExecutionMetrics(
            execution_time_seconds=30.0,
            agent_count=4,
            speedup_factor=3.5,
            sequential_baseline_seconds=105.0,
            started_at=now,
            completed_at=now + timedelta(seconds=30),
        )
        d = metrics.to_dict()
        assert d["execution_time_seconds"] == 30.0
        assert d["agent_count"] == 4
        assert d["speedup_factor"] == 3.5
        assert "started_at" in d
        assert "completed_at" in d

    def test_to_dict_rounds_speedup(self):
        """Test to_dict rounds speedup factor to 2 decimal places."""
        metrics = ExecutionMetrics(speedup_factor=5.6789)
        d = metrics.to_dict()
        assert d["speedup_factor"] == 5.68

    def test_validation_non_negative(self):
        """Test ExecutionMetrics validates non-negative values."""
        # These should not raise
        metrics = ExecutionMetrics(
            execution_time_seconds=0,
            agent_count=0,
            speedup_factor=0,
        )
        assert metrics.execution_time_seconds == 0


# =============================================================================
# AGGREGATED RESULT TESTS
# =============================================================================


class TestAggregatedResult:
    """Tests for AggregatedResult dataclass."""

    def test_default_values(self):
        """Test AggregatedResult default values."""
        result = AggregatedResult()
        assert result.success is True
        assert result.combined_output == ""
        assert result.outputs == []
        assert result.errors == []
        assert result.deduplicated_count == 0

    def test_custom_values(self):
        """Test AggregatedResult with custom values."""
        outputs = [AgentOutput(agent_id="agent-1", output="Finding 1")]
        result = AggregatedResult(
            success=True,
            combined_output="Finding 1",
            outputs=outputs,
            errors=[],
            deduplicated_count=2,
        )
        assert len(result.outputs) == 1
        assert result.deduplicated_count == 2

    def test_to_dict(self):
        """Test AggregatedResult to_dict conversion."""
        outputs = [AgentOutput(agent_id="agent-1", output="Test")]
        result = AggregatedResult(
            success=True,
            combined_output="Test",
            outputs=outputs,
        )
        d = result.to_dict()
        assert d["success"] is True
        assert d["combined_output"] == "Test"
        assert len(d["outputs"]) == 1
        assert d["outputs"][0]["agent_id"] == "agent-1"


# =============================================================================
# RESULT AGGREGATOR INITIALIZATION TESTS
# =============================================================================


class TestResultAggregatorInit:
    """Tests for ResultAggregator initialization."""

    def test_default_initialization(self):
        """Test ResultAggregator with default settings."""
        aggregator = ResultAggregator()
        assert aggregator.enable_deduplication is True
        assert aggregator.similarity_threshold == DEDUP_SIMILARITY_THRESHOLD

    def test_custom_initialization(self):
        """Test ResultAggregator with custom settings."""
        aggregator = ResultAggregator(
            enable_deduplication=False,
            similarity_threshold=0.9,
        )
        assert aggregator.enable_deduplication is False
        assert aggregator.similarity_threshold == 0.9


# =============================================================================
# RESULT AGGREGATOR AGGREGATE TESTS
# =============================================================================


class TestResultAggregatorAggregate:
    """Tests for ResultAggregator.aggregate method."""

    def test_aggregate_empty_list(self):
        """Test aggregate with empty list."""
        aggregator = ResultAggregator()
        result = aggregator.aggregate([])
        assert result.success is True
        assert result.combined_output == ""
        assert len(result.outputs) == 0

    def test_aggregate_single_output(self):
        """Test aggregate with single output."""
        aggregator = ResultAggregator()
        outputs = [{"agent_id": "agent-1", "output": "Single finding"}]
        result = aggregator.aggregate(outputs)
        assert result.success is True
        assert result.combined_output == "Single finding"
        assert len(result.outputs) == 1

    def test_aggregate_multiple_outputs(self):
        """Test aggregate with multiple outputs."""
        aggregator = ResultAggregator()
        outputs = [
            {"agent_id": "agent-1", "output": "Finding A"},
            {"agent_id": "agent-2", "output": "Finding B"},
            {"agent_id": "agent-3", "output": "Finding C"},
        ]
        result = aggregator.aggregate(outputs)
        assert result.success is True
        assert len(result.outputs) == 3
        assert "Finding A" in result.combined_output
        assert "Finding B" in result.combined_output
        assert "Finding C" in result.combined_output

    def test_aggregate_with_failed_output(self):
        """Test aggregate with mixed success/failure."""
        aggregator = ResultAggregator()
        outputs = [
            {"agent_id": "agent-1", "output": "Success", "success": True},
            {"agent_id": "agent-2", "output": "", "success": False, "error": "Failed"},
        ]
        result = aggregator.aggregate(outputs)
        assert result.success is True  # At least one success
        assert len(result.errors) == 1
        assert "Failed" in result.errors

    def test_aggregate_all_failed(self):
        """Test aggregate when all outputs failed."""
        # Disable deduplication to ensure both failed outputs are kept
        aggregator = ResultAggregator(enable_deduplication=False)
        outputs = [
            {"agent_id": "agent-1", "success": False, "error": "Error 1"},
            {"agent_id": "agent-2", "success": False, "error": "Error 2"},
        ]
        result = aggregator.aggregate(outputs)
        assert result.success is False
        assert len(result.errors) == 2

    def test_aggregate_with_execution_time(self):
        """Test aggregate with explicit execution time."""
        aggregator = ResultAggregator()
        outputs = [{"agent_id": "agent-1", "output": "Test"}]
        result = aggregator.aggregate(outputs, execution_time=10.0)
        assert result.metrics.execution_time_seconds == 10.0

    def test_aggregate_with_timestamps(self):
        """Test aggregate with explicit timestamps."""
        aggregator = ResultAggregator()
        now = datetime.now(timezone.utc)
        started = now - timedelta(seconds=30)
        outputs = [{"agent_id": "agent-1", "output": "Test"}]

        result = aggregator.aggregate(
            outputs,
            started_at=started,
            completed_at=now,
        )
        assert result.metrics.started_at == started
        assert result.metrics.completed_at == now


# =============================================================================
# RESULT AGGREGATOR DEDUPLICATION TESTS
# =============================================================================


class TestResultAggregatorDeduplication:
    """Tests for ResultAggregator deduplication functionality."""

    def test_deduplicate_exact_duplicates(self):
        """Test deduplication removes exact duplicates."""
        aggregator = ResultAggregator(enable_deduplication=True)
        outputs = [
            {"agent_id": "agent-1", "output": "Same content"},
            {"agent_id": "agent-2", "output": "Same content"},
            {"agent_id": "agent-3", "output": "Different content"},
        ]
        result = aggregator.aggregate(outputs)
        assert result.deduplicated_count == 1
        assert len(result.outputs) == 2

    def test_deduplicate_similar_outputs(self):
        """Test deduplication removes highly similar outputs."""
        aggregator = ResultAggregator(
            enable_deduplication=True,
            similarity_threshold=0.8,
        )
        outputs = [
            {"agent_id": "agent-1", "output": "The quick brown fox jumps over the lazy dog"},
            {"agent_id": "agent-2", "output": "The quick brown fox jumps over a lazy dog"},
            {"agent_id": "agent-3", "output": "Something completely different"},
        ]
        result = aggregator.aggregate(outputs)
        # The first two are similar, should be deduplicated
        assert result.deduplicated_count >= 1 or len(result.outputs) <= 2

    def test_deduplication_disabled(self):
        """Test deduplication can be disabled."""
        aggregator = ResultAggregator(enable_deduplication=False)
        outputs = [
            {"agent_id": "agent-1", "output": "Same content"},
            {"agent_id": "agent-2", "output": "Same content"},
        ]
        result = aggregator.aggregate(outputs)
        assert result.deduplicated_count == 0
        assert len(result.outputs) == 2

    def test_deduplicate_keeps_first_unique(self):
        """Test deduplication keeps first occurrence."""
        aggregator = ResultAggregator(enable_deduplication=True)
        outputs = [
            {"agent_id": "first", "output": "Duplicate content"},
            {"agent_id": "second", "output": "Duplicate content"},
        ]
        result = aggregator.aggregate(outputs)
        assert len(result.outputs) == 1
        assert result.outputs[0].agent_id == "first"


# =============================================================================
# RESULT AGGREGATOR FORMAT TESTS
# =============================================================================


class TestResultAggregatorFormat:
    """Tests for ResultAggregator formatting methods."""

    def test_aggregate_with_structure_sections(self):
        """Test aggregate_with_structure using sections format."""
        aggregator = ResultAggregator()
        outputs = [
            {"agent_id": "agent-1", "output": "Section 1 content"},
            {"agent_id": "agent-2", "output": "Section 2 content"},
        ]
        result = aggregator.aggregate_with_structure(outputs, structure="sections")
        assert "## Agent" in result.combined_output
        assert "Section 1 content" in result.combined_output

    def test_aggregate_with_structure_list(self):
        """Test aggregate_with_structure using list format."""
        aggregator = ResultAggregator()
        outputs = [
            {"agent_id": "agent-1", "output": "Item one"},
            {"agent_id": "agent-2", "output": "Item two"},
        ]
        result = aggregator.aggregate_with_structure(outputs, structure="list")
        assert result.combined_output.count("-") >= 2

    def test_aggregate_with_structure_merged(self):
        """Test aggregate_with_structure using merged format."""
        aggregator = ResultAggregator()
        outputs = [
            {"agent_id": "agent-1", "output": "Paragraph one."},
            {"agent_id": "agent-2", "output": "Paragraph two."},
        ]
        result = aggregator.aggregate_with_structure(outputs, structure="merged")
        assert "Paragraph one." in result.combined_output
        assert "Paragraph two." in result.combined_output


# =============================================================================
# RESULT AGGREGATOR METRICS CALCULATION TESTS
# =============================================================================


class TestResultAggregatorMetrics:
    """Tests for ResultAggregator metrics calculation."""

    def test_metrics_agent_count(self):
        """Test metrics calculates correct agent count."""
        aggregator = ResultAggregator()
        outputs = [
            {"agent_id": "agent-1", "output": "A"},
            {"agent_id": "agent-2", "output": "B"},
            {"agent_id": "agent-3", "output": "C"},
        ]
        result = aggregator.aggregate(outputs)
        assert result.metrics.agent_count == 3

    def test_metrics_successful_vs_failed(self):
        """Test metrics counts successful and failed agents."""
        aggregator = ResultAggregator()
        outputs = [
            {"agent_id": "agent-1", "output": "Success", "success": True},
            {"agent_id": "agent-2", "success": False, "error": "Error"},
            {"agent_id": "agent-3", "output": "Success 2", "success": True},
        ]
        result = aggregator.aggregate(outputs)
        assert result.metrics.agents_successful == 2
        assert result.metrics.agents_failed == 1

    def test_metrics_api_calls_total(self):
        """Test metrics sums API calls from all agents."""
        aggregator = ResultAggregator()
        outputs = [
            {"agent_id": "agent-1", "output": "A", "api_calls": 10},
            {"agent_id": "agent-2", "output": "B", "api_calls": 15},
            {"agent_id": "agent-3", "output": "C", "api_calls": 20},
        ]
        result = aggregator.aggregate(outputs)
        assert result.metrics.api_calls_total == 45

    def test_metrics_speedup_factor(self):
        """Test metrics calculates speedup factor."""
        aggregator = ResultAggregator()
        outputs = [
            {"agent_id": "agent-1", "output": "A"},
            {"agent_id": "agent-2", "output": "B"},
        ]
        result = aggregator.aggregate(outputs, execution_time=10.0)
        # Sequential baseline: 2 agents * 30s = 60s
        # Execution time: 10s
        # Speedup: 60/10 = 6x
        assert result.metrics.speedup_factor == 6.0

    def test_metrics_sequential_baseline(self):
        """Test metrics estimates sequential baseline time."""
        aggregator = ResultAggregator()
        outputs = [
            {"agent_id": "agent-1", "output": "A"},
            {"agent_id": "agent-2", "output": "B"},
            {"agent_id": "agent-3", "output": "C"},
            {"agent_id": "agent-4", "output": "D"},
        ]
        result = aggregator.aggregate(outputs)
        # 4 agents * 30s = 120s baseline
        expected_baseline = 4 * SEQUENTIAL_TIME_ESTIMATE_PER_OUTPUT
        assert result.metrics.sequential_baseline_seconds == expected_baseline


# =============================================================================
# RESULT AGGREGATOR COMBINE OUTPUTS TESTS
# =============================================================================


class TestResultAggregatorCombine:
    """Tests for ResultAggregator._combine_outputs method."""

    def test_combine_empty(self):
        """Test combining empty outputs."""
        aggregator = ResultAggregator()
        result = aggregator._combine_outputs([])
        assert result == ""

    def test_combine_single(self):
        """Test combining single output."""
        aggregator = ResultAggregator()
        output = AgentOutput(agent_id="agent-1", output="Only output")
        result = aggregator._combine_outputs([output])
        assert result == "Only output"

    def test_combine_multiple_with_separator(self):
        """Test combining multiple outputs uses separator."""
        aggregator = ResultAggregator()
        outputs = [
            AgentOutput(agent_id="agent-1", output="First"),
            AgentOutput(agent_id="agent-2", output="Second"),
        ]
        result = aggregator._combine_outputs(outputs)
        assert "---" in result
        assert "First" in result
        assert "Second" in result

    def test_combine_skips_empty_outputs(self):
        """Test combining skips empty/whitespace outputs."""
        aggregator = ResultAggregator()
        outputs = [
            AgentOutput(agent_id="agent-1", output="Content"),
            AgentOutput(agent_id="agent-2", output="   "),
            AgentOutput(agent_id="agent-3", output=""),
        ]
        result = aggregator._combine_outputs(outputs)
        # Should only include "Content", not empty strings
        assert result == "Content"


# =============================================================================
# RESULT AGGREGATOR SIMILARITY TESTS
# =============================================================================


class TestResultAggregatorSimilarity:
    """Tests for ResultAggregator similarity calculation."""

    def test_similarity_identical(self):
        """Test similarity of identical texts is 1.0."""
        aggregator = ResultAggregator()
        similarity = aggregator._calculate_similarity(
            "hello world",
            "hello world",
        )
        assert similarity == 1.0

    def test_similarity_empty_texts(self):
        """Test similarity of empty texts is 1.0."""
        aggregator = ResultAggregator()
        similarity = aggregator._calculate_similarity("", "")
        assert similarity == 1.0

    def test_similarity_one_empty(self):
        """Test similarity with one empty text is 0.0."""
        aggregator = ResultAggregator()
        similarity = aggregator._calculate_similarity("hello", "")
        assert similarity == 0.0

    def test_similarity_completely_different(self):
        """Test similarity of completely different texts is low."""
        aggregator = ResultAggregator()
        similarity = aggregator._calculate_similarity(
            "apple banana cherry",
            "xyz123 abc456",
        )
        assert similarity < 0.5

    def test_similarity_partially_overlapping(self):
        """Test similarity of partially overlapping texts."""
        aggregator = ResultAggregator()
        similarity = aggregator._calculate_similarity(
            "the quick brown fox",
            "the quick brown dog",
        )
        # 3/5 words match (the, quick, brown)
        assert 0.5 < similarity < 1.0


# =============================================================================
# RESULT AGGREGATOR NORMALIZE TEXT TESTS
# =============================================================================


class TestResultAggregatorNormalize:
    """Tests for ResultAggregator._normalize_text method."""

    def test_normalize_lowercase(self):
        """Test normalize converts to lowercase."""
        aggregator = ResultAggregator()
        result = aggregator._normalize_text("HELLO WORLD")
        assert result == "hello world"

    def test_normalize_removes_punctuation(self):
        """Test normalize removes punctuation."""
        aggregator = ResultAggregator()
        result = aggregator._normalize_text("Hello, World!")
        assert result == "hello world"

    def test_normalize_collapses_whitespace(self):
        """Test normalize collapses multiple whitespace."""
        aggregator = ResultAggregator()
        result = aggregator._normalize_text("hello   \n\t  world")
        assert result == "hello world"

    def test_normalize_strips(self):
        """Test normalize strips leading/trailing whitespace."""
        aggregator = ResultAggregator()
        result = aggregator._normalize_text("  hello world  ")
        assert result == "hello world"


# =============================================================================
# HELPER FUNCTION TESTS
# =============================================================================


class TestHelperFunctions:
    """Tests for module helper functions."""

    def test_create_aggregator_default(self):
        """Test create_aggregator with defaults."""
        aggregator = create_aggregator()
        assert isinstance(aggregator, ResultAggregator)
        assert aggregator.enable_deduplication is True

    def test_create_aggregator_custom(self):
        """Test create_aggregator with custom settings."""
        aggregator = create_aggregator(
            enable_deduplication=False,
            similarity_threshold=0.9,
        )
        assert aggregator.enable_deduplication is False
        assert aggregator.similarity_threshold == 0.9

    def test_aggregate_outputs_function(self):
        """Test aggregate_outputs convenience function."""
        outputs = [
            {"agent_id": "agent-1", "output": "Test output"},
        ]
        result = aggregate_outputs(outputs)
        assert isinstance(result, AggregatedResult)
        assert result.success is True
        assert "Test output" in result.combined_output

    def test_aggregate_outputs_with_kwargs(self):
        """Test aggregate_outputs passes kwargs correctly."""
        outputs = [{"agent_id": "agent-1", "output": "Test"}]
        result = aggregate_outputs(outputs, execution_time=15.0)
        assert result.metrics.execution_time_seconds == 15.0


# =============================================================================
# CONSTANTS TESTS
# =============================================================================


class TestConstants:
    """Tests for module constants."""

    def test_sequential_time_estimate(self):
        """Test SEQUENTIAL_TIME_ESTIMATE_PER_OUTPUT value."""
        assert SEQUENTIAL_TIME_ESTIMATE_PER_OUTPUT == 30.0

    def test_dedup_similarity_threshold(self):
        """Test DEDUP_SIMILARITY_THRESHOLD value."""
        assert DEDUP_SIMILARITY_THRESHOLD == 0.85
