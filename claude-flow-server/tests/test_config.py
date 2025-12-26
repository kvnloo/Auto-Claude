"""
Tests for Configuration Schema Module
=====================================

Unit tests for ClaudeFlowConfig, validation functions, and enums.
"""

import os
from unittest import mock

import pytest
from pydantic import ValidationError

from claude_flow_server.config import (
    DEFAULT_MAX_AGENTS,
    DEFAULT_MODEL,
    DEFAULT_TIMEOUT,
    DEFAULT_TOPOLOGY,
    VALID_AGENT_COUNTS,
    ClaudeFlowConfig,
    ModelConfig,
    ModelProvider,
    ResourceLimits,
    TopologyMode,
    get_default_config,
    validate_agent_count,
    validate_topology,
)


# =============================================================================
# TOPOLOGY MODE TESTS
# =============================================================================


class TestTopologyMode:
    """Tests for TopologyMode enum."""

    def test_all_topology_modes_exist(self):
        """Verify all expected topology modes are defined."""
        assert TopologyMode.DISTRIBUTED == "distributed"
        assert TopologyMode.HIERARCHICAL == "hierarchical"
        assert TopologyMode.MESH == "mesh"
        assert TopologyMode.CENTRALIZED == "centralized"

    def test_topology_mode_values(self):
        """Verify topology modes have correct string values."""
        assert TopologyMode.DISTRIBUTED.value == "distributed"
        assert TopologyMode.HIERARCHICAL.value == "hierarchical"
        assert TopologyMode.MESH.value == "mesh"
        assert TopologyMode.CENTRALIZED.value == "centralized"

    def test_topology_mode_from_string(self):
        """Verify topology modes can be created from strings."""
        assert TopologyMode("distributed") == TopologyMode.DISTRIBUTED
        assert TopologyMode("hierarchical") == TopologyMode.HIERARCHICAL
        assert TopologyMode("mesh") == TopologyMode.MESH
        assert TopologyMode("centralized") == TopologyMode.CENTRALIZED

    def test_invalid_topology_mode_raises(self):
        """Verify invalid topology mode raises ValueError."""
        with pytest.raises(ValueError):
            TopologyMode("invalid_mode")


# =============================================================================
# MODEL PROVIDER TESTS
# =============================================================================


class TestModelProvider:
    """Tests for ModelProvider enum."""

    def test_model_providers_exist(self):
        """Verify model providers are defined."""
        assert ModelProvider.ANTHROPIC == "anthropic"
        assert ModelProvider.OPENROUTER == "openrouter"


# =============================================================================
# MODEL CONFIG TESTS
# =============================================================================


class TestModelConfig:
    """Tests for ModelConfig class."""

    def test_default_model_config(self):
        """Test default ModelConfig values."""
        config = ModelConfig()
        assert config.provider == ModelProvider.ANTHROPIC
        assert config.model_name == DEFAULT_MODEL
        assert config.api_key_env == "ANTHROPIC_API_KEY"

    def test_custom_model_config(self):
        """Test custom ModelConfig values."""
        config = ModelConfig(
            provider=ModelProvider.OPENROUTER,
            model_name="gpt-4",
            api_key_env="OPENROUTER_API_KEY",
        )
        assert config.provider == ModelProvider.OPENROUTER
        assert config.model_name == "gpt-4"
        assert config.api_key_env == "OPENROUTER_API_KEY"

    def test_get_api_key_when_set(self):
        """Test get_api_key returns value when env var is set."""
        config = ModelConfig(api_key_env="TEST_API_KEY")
        with mock.patch.dict(os.environ, {"TEST_API_KEY": "test-key-123"}):
            assert config.get_api_key() == "test-key-123"

    def test_get_api_key_when_not_set(self):
        """Test get_api_key returns None when env var is not set."""
        config = ModelConfig(api_key_env="NONEXISTENT_API_KEY")
        # Ensure the env var is not set
        with mock.patch.dict(os.environ, {}, clear=True):
            assert config.get_api_key() is None

    def test_has_api_key_true(self):
        """Test has_api_key returns True when key exists."""
        config = ModelConfig(api_key_env="TEST_API_KEY")
        with mock.patch.dict(os.environ, {"TEST_API_KEY": "test-key"}):
            assert config.has_api_key() is True

    def test_has_api_key_false(self):
        """Test has_api_key returns False when key missing."""
        config = ModelConfig(api_key_env="NONEXISTENT_API_KEY")
        with mock.patch.dict(os.environ, {}, clear=True):
            assert config.has_api_key() is False


# =============================================================================
# RESOURCE LIMITS TESTS
# =============================================================================


class TestResourceLimits:
    """Tests for ResourceLimits class."""

    def test_default_resource_limits(self):
        """Test default ResourceLimits values."""
        limits = ResourceLimits()
        assert limits.max_memory_mb == 512
        assert limits.max_api_calls == 100
        assert limits.max_retries == 3

    def test_custom_resource_limits(self):
        """Test custom ResourceLimits values."""
        limits = ResourceLimits(
            max_memory_mb=1024,
            max_api_calls=200,
            max_retries=5,
        )
        assert limits.max_memory_mb == 1024
        assert limits.max_api_calls == 200
        assert limits.max_retries == 5

    def test_resource_limits_min_values(self):
        """Test ResourceLimits minimum value validation."""
        limits = ResourceLimits(
            max_memory_mb=128,
            max_api_calls=1,
            max_retries=0,
        )
        assert limits.max_memory_mb == 128
        assert limits.max_api_calls == 1
        assert limits.max_retries == 0

    def test_resource_limits_max_values(self):
        """Test ResourceLimits maximum value validation."""
        limits = ResourceLimits(
            max_memory_mb=4096,
            max_api_calls=1000,
            max_retries=10,
        )
        assert limits.max_memory_mb == 4096
        assert limits.max_api_calls == 1000
        assert limits.max_retries == 10

    def test_resource_limits_below_min_raises(self):
        """Test ResourceLimits below minimum raises error."""
        with pytest.raises(ValidationError):
            ResourceLimits(max_memory_mb=64)  # Below 128 min

    def test_resource_limits_above_max_raises(self):
        """Test ResourceLimits above maximum raises error."""
        with pytest.raises(ValidationError):
            ResourceLimits(max_memory_mb=8192)  # Above 4096 max


# =============================================================================
# CLAUDE FLOW CONFIG TESTS
# =============================================================================


class TestClaudeFlowConfig:
    """Tests for ClaudeFlowConfig class."""

    def test_default_config(self):
        """Test default ClaudeFlowConfig values."""
        config = ClaudeFlowConfig()
        assert config.max_agents == DEFAULT_MAX_AGENTS
        assert config.topology == DEFAULT_TOPOLOGY
        assert config.timeout_seconds == DEFAULT_TIMEOUT
        assert config.enable_metrics is True
        assert config.enable_caching is True
        assert config.swarm_dir == ".swarm"

    def test_valid_agent_count_4(self):
        """Test config with 4 agents is valid."""
        config = ClaudeFlowConfig(max_agents=4)
        assert config.max_agents == 4

    def test_valid_agent_count_8(self):
        """Test config with 8 agents is valid."""
        config = ClaudeFlowConfig(max_agents=8)
        assert config.max_agents == 8

    def test_valid_agent_count_12(self):
        """Test config with 12 agents is valid."""
        config = ClaudeFlowConfig(max_agents=12)
        assert config.max_agents == 12

    def test_invalid_agent_count_raises(self):
        """Test invalid agent count raises ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            ClaudeFlowConfig(max_agents=5)
        assert "Invalid agent count" in str(exc_info.value)

    def test_invalid_agent_count_zero_raises(self):
        """Test zero agents raises ValidationError."""
        with pytest.raises(ValidationError):
            ClaudeFlowConfig(max_agents=0)

    def test_invalid_agent_count_negative_raises(self):
        """Test negative agents raises ValidationError."""
        with pytest.raises(ValidationError):
            ClaudeFlowConfig(max_agents=-1)

    def test_valid_topologies(self):
        """Test all valid topologies are accepted."""
        for mode in TopologyMode:
            config = ClaudeFlowConfig(topology=mode)
            assert config.topology == mode

    def test_valid_timeout_range(self):
        """Test timeout within valid range."""
        config = ClaudeFlowConfig(timeout_seconds=60)
        assert config.timeout_seconds == 60

    def test_timeout_min_boundary(self):
        """Test minimum timeout boundary (30 seconds)."""
        config = ClaudeFlowConfig(timeout_seconds=30)
        assert config.timeout_seconds == 30

    def test_timeout_max_boundary(self):
        """Test maximum timeout boundary (3600 seconds)."""
        config = ClaudeFlowConfig(timeout_seconds=3600)
        assert config.timeout_seconds == 3600

    def test_timeout_below_min_raises(self):
        """Test timeout below minimum raises error."""
        with pytest.raises(ValidationError):
            ClaudeFlowConfig(timeout_seconds=29)

    def test_timeout_above_max_raises(self):
        """Test timeout above maximum raises error."""
        with pytest.raises(ValidationError):
            ClaudeFlowConfig(timeout_seconds=3601)


class TestClaudeFlowConfigMethods:
    """Tests for ClaudeFlowConfig methods."""

    def test_to_cli_args_default(self):
        """Test to_cli_args with default configuration."""
        config = ClaudeFlowConfig()
        args = config.to_cli_args()
        assert "--mode" in args
        assert "distributed" in args
        assert "--max-agents" in args
        assert "4" in args
        assert "--parallel" in args
        assert "--executor" in args

    def test_to_cli_args_custom(self):
        """Test to_cli_args with custom configuration."""
        config = ClaudeFlowConfig(
            max_agents=12,
            topology=TopologyMode.HIERARCHICAL,
            timeout_seconds=600,
        )
        args = config.to_cli_args()
        assert "hierarchical" in args
        assert "12" in args
        assert "--timeout" in args
        assert "600" in args

    def test_to_cli_args_no_timeout_when_default(self):
        """Test to_cli_args excludes timeout when using default."""
        config = ClaudeFlowConfig(timeout_seconds=DEFAULT_TIMEOUT)
        args = config.to_cli_args()
        assert "--timeout" not in args

    def test_to_dict(self):
        """Test to_dict conversion."""
        config = ClaudeFlowConfig(
            max_agents=8,
            topology=TopologyMode.MESH,
        )
        d = config.to_dict()
        assert d["max_agents"] == 8
        assert d["topology"] == "mesh"
        assert "model" in d
        assert "resource_limits" in d
        assert d["enable_metrics"] is True
        assert d["enable_caching"] is True

    def test_from_env_defaults(self):
        """Test from_env with no environment variables."""
        with mock.patch.dict(os.environ, {}, clear=True):
            config = ClaudeFlowConfig.from_env()
            assert config.max_agents == DEFAULT_MAX_AGENTS
            assert config.topology == DEFAULT_TOPOLOGY
            assert config.timeout_seconds == DEFAULT_TIMEOUT

    def test_from_env_custom(self):
        """Test from_env with custom environment variables."""
        env = {
            "CLAUDE_FLOW_MAX_AGENTS": "12",
            "CLAUDE_FLOW_TOPOLOGY": "hierarchical",
            "CLAUDE_FLOW_MODEL": "claude-opus-4-20250514",
            "CLAUDE_FLOW_TIMEOUT": "600",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            config = ClaudeFlowConfig.from_env()
            assert config.max_agents == 12
            assert config.topology == TopologyMode.HIERARCHICAL
            assert config.model.model_name == "claude-opus-4-20250514"
            assert config.timeout_seconds == 600


# =============================================================================
# VALIDATION HELPER FUNCTION TESTS
# =============================================================================


class TestValidationFunctions:
    """Tests for validation helper functions."""

    def test_validate_agent_count_valid(self):
        """Test validate_agent_count with valid counts."""
        for count in VALID_AGENT_COUNTS:
            assert validate_agent_count(count) is True

    def test_validate_agent_count_invalid(self):
        """Test validate_agent_count with invalid counts."""
        invalid_counts = [0, 1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 100, -1]
        for count in invalid_counts:
            assert validate_agent_count(count) is False

    def test_validate_topology_valid(self):
        """Test validate_topology with valid modes."""
        valid_topologies = ["distributed", "hierarchical", "mesh", "centralized"]
        for topology in valid_topologies:
            assert validate_topology(topology) is True

    def test_validate_topology_invalid(self):
        """Test validate_topology with invalid modes."""
        invalid_topologies = ["invalid", "", "DISTRIBUTED", "parallel", "star"]
        for topology in invalid_topologies:
            assert validate_topology(topology) is False


class TestGetDefaultConfig:
    """Tests for get_default_config function."""

    def test_get_default_config(self):
        """Test get_default_config returns valid config."""
        config = get_default_config()
        assert isinstance(config, ClaudeFlowConfig)
        assert config.max_agents == DEFAULT_MAX_AGENTS
        assert config.topology == DEFAULT_TOPOLOGY

    def test_get_default_config_returns_new_instance(self):
        """Test get_default_config returns new instance each time."""
        config1 = get_default_config()
        config2 = get_default_config()
        assert config1 is not config2


# =============================================================================
# VALID AGENT COUNTS CONSTANT TEST
# =============================================================================


class TestConstants:
    """Tests for module constants."""

    def test_valid_agent_counts(self):
        """Test VALID_AGENT_COUNTS contains expected values."""
        assert VALID_AGENT_COUNTS == frozenset({4, 8, 12})

    def test_valid_agent_counts_is_frozen(self):
        """Test VALID_AGENT_COUNTS is immutable."""
        assert isinstance(VALID_AGENT_COUNTS, frozenset)
