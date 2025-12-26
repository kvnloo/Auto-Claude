"""
Configuration Schema Module
===========================

Configuration schema for Claude Flow MCP server.
Handles validation for agent count, models, and topology modes.

The configuration system provides:
- Agent count validation (4, 8, or 12 agents)
- Topology mode selection (distributed, hierarchical, mesh, centralized)
- Model configuration for agent execution
- Timeout and resource limit settings

Usage:
    from claude_flow_server.config import ClaudeFlowConfig

    config = ClaudeFlowConfig(max_agents=8)
    config = ClaudeFlowConfig(max_agents=8, topology="hierarchical")
"""

import os
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


# =============================================================================
# ENUMS
# =============================================================================


class TopologyMode(str, Enum):
    """
    Available topology modes for agent orchestration.

    Attributes:
        DISTRIBUTED: Agents work independently on subtasks, results merged
        HIERARCHICAL: Lead agent coordinates worker agents
        MESH: Agents communicate peer-to-peer for collaborative tasks
        CENTRALIZED: Single coordinator manages all agent assignments
    """

    DISTRIBUTED = "distributed"
    HIERARCHICAL = "hierarchical"
    MESH = "mesh"
    CENTRALIZED = "centralized"


class ModelProvider(str, Enum):
    """
    Supported model providers for agent execution.

    Attributes:
        ANTHROPIC: Claude models via Anthropic API
        OPENROUTER: Multiple models via OpenRouter API
    """

    ANTHROPIC = "anthropic"
    OPENROUTER = "openrouter"


# =============================================================================
# VALID AGENT COUNTS
# =============================================================================

VALID_AGENT_COUNTS = frozenset({4, 8, 12})
DEFAULT_MAX_AGENTS = 4
DEFAULT_TOPOLOGY = TopologyMode.DISTRIBUTED
DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_TIMEOUT = 300  # 5 minutes


# =============================================================================
# CONFIGURATION CLASSES
# =============================================================================


class ModelConfig(BaseModel):
    """
    Configuration for model selection.

    Attributes:
        provider: Model provider (anthropic, openrouter)
        model_name: Name of the model to use
        api_key_env: Environment variable name for API key
    """

    provider: ModelProvider = ModelProvider.ANTHROPIC
    model_name: str = Field(default=DEFAULT_MODEL)
    api_key_env: str = Field(default="ANTHROPIC_API_KEY")

    def get_api_key(self) -> str | None:
        """Get API key from environment variable."""
        return os.environ.get(self.api_key_env)

    def has_api_key(self) -> bool:
        """Check if API key is available."""
        return self.get_api_key() is not None


class ResourceLimits(BaseModel):
    """
    Resource limits for agent execution.

    Attributes:
        max_memory_mb: Maximum memory per agent in MB
        max_api_calls: Maximum API calls per agent
        max_retries: Maximum retries on failure
    """

    max_memory_mb: int = Field(default=512, ge=128, le=4096)
    max_api_calls: int = Field(default=100, ge=1, le=1000)
    max_retries: int = Field(default=3, ge=0, le=10)


class ClaudeFlowConfig(BaseModel):
    """
    Main configuration for Claude Flow MCP server.

    Attributes:
        max_agents: Maximum number of parallel agents (4, 8, or 12)
        topology: Agent orchestration topology mode
        model: Model configuration for agents
        timeout_seconds: Timeout for task execution in seconds
        resource_limits: Resource limits for agent execution
        enable_metrics: Enable performance metrics collection
        enable_caching: Enable result caching
        swarm_dir: Directory for swarm state (default: .swarm/)
    """

    max_agents: int = Field(default=DEFAULT_MAX_AGENTS)
    topology: TopologyMode = Field(default=DEFAULT_TOPOLOGY)
    model: ModelConfig = Field(default_factory=ModelConfig)
    timeout_seconds: int = Field(default=DEFAULT_TIMEOUT, ge=30, le=3600)
    resource_limits: ResourceLimits = Field(default_factory=ResourceLimits)
    enable_metrics: bool = Field(default=True)
    enable_caching: bool = Field(default=True)
    swarm_dir: str = Field(default=".swarm")

    @field_validator("max_agents")
    @classmethod
    def validate_max_agents(cls, v: int) -> int:
        """Validate that max_agents is one of the allowed values (4, 8, or 12)."""
        if v not in VALID_AGENT_COUNTS:
            raise ValueError(
                f"Invalid agent count: {v}. Must be one of: {sorted(VALID_AGENT_COUNTS)}"
            )
        return v

    @model_validator(mode="after")
    def validate_config(self) -> "ClaudeFlowConfig":
        """Validate the complete configuration."""
        # Warn if API key is not available (don't fail, let runtime handle it)
        return self

    def to_cli_args(self) -> list[str]:
        """
        Convert configuration to Claude Flow CLI arguments.

        Returns:
            List of command line arguments for Claude Flow CLI.
        """
        args = [
            "--topology",
            self.topology.value,
            "--max-agents",
            str(self.max_agents),
        ]

        if self.timeout_seconds != DEFAULT_TIMEOUT:
            args.extend(["--timeout", str(self.timeout_seconds)])

        return args

    def to_dict(self) -> dict[str, Any]:
        """
        Convert configuration to dictionary.

        Returns:
            Dictionary representation of the configuration.
        """
        return {
            "max_agents": self.max_agents,
            "topology": self.topology.value,
            "model": {
                "provider": self.model.provider.value,
                "model_name": self.model.model_name,
            },
            "timeout_seconds": self.timeout_seconds,
            "resource_limits": {
                "max_memory_mb": self.resource_limits.max_memory_mb,
                "max_api_calls": self.resource_limits.max_api_calls,
                "max_retries": self.resource_limits.max_retries,
            },
            "enable_metrics": self.enable_metrics,
            "enable_caching": self.enable_caching,
            "swarm_dir": self.swarm_dir,
        }

    @classmethod
    def from_env(cls) -> "ClaudeFlowConfig":
        """
        Create configuration from environment variables.

        Environment variables:
            CLAUDE_FLOW_MAX_AGENTS: Maximum agent count (4, 8, or 12)
            CLAUDE_FLOW_TOPOLOGY: Topology mode
            CLAUDE_FLOW_MODEL: Model name
            CLAUDE_FLOW_TIMEOUT: Timeout in seconds

        Returns:
            ClaudeFlowConfig instance.
        """
        max_agents_str = os.environ.get("CLAUDE_FLOW_MAX_AGENTS")
        max_agents = int(max_agents_str) if max_agents_str else DEFAULT_MAX_AGENTS

        topology_str = os.environ.get("CLAUDE_FLOW_TOPOLOGY")
        topology = TopologyMode(topology_str) if topology_str else DEFAULT_TOPOLOGY

        model_name = os.environ.get("CLAUDE_FLOW_MODEL", DEFAULT_MODEL)

        timeout_str = os.environ.get("CLAUDE_FLOW_TIMEOUT")
        timeout = int(timeout_str) if timeout_str else DEFAULT_TIMEOUT

        return cls(
            max_agents=max_agents,
            topology=topology,
            model=ModelConfig(model_name=model_name),
            timeout_seconds=timeout,
        )


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def get_default_config() -> ClaudeFlowConfig:
    """
    Get the default configuration.

    Returns:
        ClaudeFlowConfig with default values.
    """
    return ClaudeFlowConfig()


def validate_agent_count(count: int) -> bool:
    """
    Check if an agent count is valid.

    Args:
        count: Number of agents to validate.

    Returns:
        True if count is valid (4, 8, or 12), False otherwise.
    """
    return count in VALID_AGENT_COUNTS


def validate_topology(topology: str) -> bool:
    """
    Check if a topology mode is valid.

    Args:
        topology: Topology mode string to validate.

    Returns:
        True if topology is valid, False otherwise.
    """
    try:
        TopologyMode(topology)
        return True
    except ValueError:
        return False
