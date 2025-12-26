"""
Claude SDK Client Configuration
===============================

Functions for creating and configuring the Claude Agent SDK client.

All AI interactions should use `create_client()` to ensure consistent OAuth authentication
and proper tool/MCP configuration. For simple message calls without full agent sessions,
use `ClaudeSDKClient` directly with `allowed_tools=[]` and `max_turns=1`.

For vision API calls (multimodal with images), use the vision helper functions:
- `is_vision_api_available()` - Check if vision API can be used
- `create_vision_image_block()` - Create a single image content block
- `create_vision_message_content()` - Create complete multimodal message content
- `get_anthropic_client()` - Get configured Anthropic client for vision calls
"""

import json
import os
from pathlib import Path
from typing import Any

from auto_claude_tools import (
    create_auto_claude_mcp_server,
    is_tools_available,
)
from auto_claude_tools import (
    get_allowed_tools as get_agent_allowed_tools,
)
from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
from claude_agent_sdk.types import HookMatcher
from core.auth import get_sdk_env_vars, require_auth_token
from linear_updater import is_linear_enabled
from prompts_pkg.project_context import detect_project_capabilities, load_project_index
from security import bash_security_hook


def is_graphiti_mcp_enabled() -> bool:
    """
    Check if Graphiti MCP server integration is enabled.

    Requires GRAPHITI_MCP_URL to be set (e.g., http://localhost:8000/mcp/)
    This is separate from GRAPHITI_ENABLED which controls the Python library integration.
    """
    return bool(os.environ.get("GRAPHITI_MCP_URL"))


def get_graphiti_mcp_url() -> str:
    """Get the Graphiti MCP server URL."""
    return os.environ.get("GRAPHITI_MCP_URL", "http://localhost:8000/mcp/")


def is_electron_mcp_enabled() -> bool:
    """
    Check if Electron MCP server integration is enabled.

    Requires ELECTRON_MCP_ENABLED to be set to 'true'.
    When enabled, QA agents can use Puppeteer MCP tools to connect to Electron apps
    via Chrome DevTools Protocol on the configured debug port.
    """
    return os.environ.get("ELECTRON_MCP_ENABLED", "").lower() == "true"


def get_electron_debug_port() -> int:
    """Get the Electron remote debugging port (default: 9222)."""
    return int(os.environ.get("ELECTRON_DEBUG_PORT", "9222"))


# =============================================================================
# VISION API HELPERS
# =============================================================================
#
# These functions provide reusable utilities for working with Claude's vision API.
# Use these for multimodal image analysis tasks like screenshot analysis.
# The Claude Agent SDK may not fully support vision, so we use Anthropic SDK directly.


def is_vision_api_available() -> tuple[bool, str | None]:
    """
    Check if the vision API is available for use.

    Vision API requires:
    1. The anthropic SDK to be installed
    2. A valid API key (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN)

    Returns:
        Tuple of (is_available, error_message)
        - (True, None) if vision API is ready
        - (False, "error description") if not available
    """
    # Check if anthropic SDK is installed
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False, "Anthropic SDK not installed. Run: pip install anthropic"

    # Check for API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        api_key = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")

    if not api_key:
        return False, "Missing API key. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN"

    return True, None


def get_anthropic_client() -> Any:
    """
    Get a configured Anthropic AsyncAnthropic client for vision API calls.

    Uses environment variables for configuration:
    - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN for authentication
    - ANTHROPIC_BASE_URL for custom endpoint (optional)

    Returns:
        Configured anthropic.AsyncAnthropic client

    Raises:
        ImportError: If anthropic SDK is not installed
        ValueError: If no API key is available
    """
    import anthropic

    # Get API key from environment
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        api_key = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")

    if not api_key:
        raise ValueError("Missing API key. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN")

    # Build client kwargs
    client_kwargs: dict[str, Any] = {"api_key": api_key}

    # Add optional base URL
    base_url = os.environ.get("ANTHROPIC_BASE_URL")
    if base_url:
        client_kwargs["base_url"] = base_url

    return anthropic.AsyncAnthropic(**client_kwargs)


def create_vision_image_block(
    base64_data: str,
    media_type: str = "image/png",
) -> dict[str, Any]:
    """
    Create a single image content block for Claude's vision API.

    Args:
        base64_data: Base64 encoded image data (without data URL prefix)
        media_type: MIME type of the image (e.g., 'image/png', 'image/jpeg')

    Returns:
        Image content block in Claude's expected format

    Example:
        >>> block = create_vision_image_block(base64_data, "image/png")
        >>> # Result:
        >>> {
        ...     "type": "image",
        ...     "source": {
        ...         "type": "base64",
        ...         "media_type": "image/png",
        ...         "data": "..."
        ...     }
        ... }
    """
    # Normalize MIME type (jpeg vs jpg)
    if media_type == "image/jpg":
        media_type = "image/jpeg"

    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": base64_data,
        },
    }


def create_vision_message_content(
    text_prompt: str,
    images: list[dict[str, str]],
) -> list[dict[str, Any]]:
    """
    Create complete multimodal message content for Claude's vision API.

    This combines a text prompt with one or more images into the content array
    format expected by Claude's messages API.

    Args:
        text_prompt: The text prompt to include
        images: List of image dicts, each with 'data' (base64) and 'media_type'

    Returns:
        List of content blocks ready for Claude's messages API

    Example:
        >>> content = create_vision_message_content(
        ...     "Analyze this UI design",
        ...     [{"data": "base64...", "media_type": "image/png"}]
        ... )
        >>> # Use with:
        >>> response = await client.messages.create(
        ...     model="claude-sonnet-4-20250514",
        ...     max_tokens=4096,
        ...     messages=[{"role": "user", "content": content}]
        ... )
    """
    content: list[dict[str, Any]] = []

    # Add text prompt first
    content.append({
        "type": "text",
        "text": text_prompt,
    })

    # Add each image
    for image in images:
        content.append(
            create_vision_image_block(
                base64_data=image.get("data", ""),
                media_type=image.get("media_type", "image/png"),
            )
        )

    return content


# Puppeteer MCP tools for browser automation
# NOTE: Screenshots must be compressed (1280x720, quality 60, JPEG) to stay under
# Claude SDK's 1MB JSON message buffer limit. See GitHub issue #74.
PUPPETEER_TOOLS = [
    "mcp__puppeteer__puppeteer_connect_active_tab",
    "mcp__puppeteer__puppeteer_navigate",
    "mcp__puppeteer__puppeteer_screenshot",
    "mcp__puppeteer__puppeteer_click",
    "mcp__puppeteer__puppeteer_fill",
    "mcp__puppeteer__puppeteer_select",
    "mcp__puppeteer__puppeteer_hover",
    "mcp__puppeteer__puppeteer_evaluate",
]

# Linear MCP tools for project management (when LINEAR_API_KEY is set)
LINEAR_TOOLS = [
    "mcp__linear-server__list_teams",
    "mcp__linear-server__get_team",
    "mcp__linear-server__list_projects",
    "mcp__linear-server__get_project",
    "mcp__linear-server__create_project",
    "mcp__linear-server__update_project",
    "mcp__linear-server__list_issues",
    "mcp__linear-server__get_issue",
    "mcp__linear-server__create_issue",
    "mcp__linear-server__update_issue",
    "mcp__linear-server__list_comments",
    "mcp__linear-server__create_comment",
    "mcp__linear-server__list_issue_statuses",
    "mcp__linear-server__list_issue_labels",
    "mcp__linear-server__list_users",
    "mcp__linear-server__get_user",
]

# Context7 MCP tools for documentation lookup (always enabled)
CONTEXT7_TOOLS = [
    "mcp__context7__resolve-library-id",
    "mcp__context7__get-library-docs",
]

# Graphiti MCP tools for knowledge graph memory (when GRAPHITI_MCP_ENABLED is set)
# See: https://github.com/getzep/graphiti
GRAPHITI_MCP_TOOLS = [
    "mcp__graphiti-memory__search_nodes",  # Search entity summaries
    "mcp__graphiti-memory__search_facts",  # Search relationships between entities
    "mcp__graphiti-memory__add_episode",  # Add data to knowledge graph
    "mcp__graphiti-memory__get_episodes",  # Retrieve recent episodes
    "mcp__graphiti-memory__get_entity_edge",  # Get specific entity/relationship
]

# Electron MCP tools for desktop app automation (when ELECTRON_MCP_ENABLED is set)
# Uses electron-mcp-server to connect to Electron apps via Chrome DevTools Protocol.
# Electron app must be started with --remote-debugging-port=9222 (or ELECTRON_DEBUG_PORT).
# These tools are only available to QA agents (qa_reviewer, qa_fixer), not Coder/Planner.
# NOTE: Screenshots must be compressed to stay under Claude SDK's 1MB JSON message buffer limit.
# See GitHub issue #74.
ELECTRON_TOOLS = [
    "mcp__electron__get_electron_window_info",  # Get info about running Electron windows
    "mcp__electron__take_screenshot",  # Capture screenshot of Electron window
    "mcp__electron__send_command_to_electron",  # Send commands (click, fill, evaluate JS)
    "mcp__electron__read_electron_logs",  # Read console logs from Electron app
]

# Built-in tools
BUILTIN_TOOLS = [
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "Bash",
]


def create_client(
    project_dir: Path,
    spec_dir: Path,
    model: str,
    agent_type: str = "coder",
    max_thinking_tokens: int | None = None,
) -> ClaudeSDKClient:
    """
    Create a Claude Agent SDK client with multi-layered security.

    Args:
        project_dir: Root directory for the project (working directory)
        spec_dir: Directory containing the spec (for settings file)
        model: Claude model to use
        agent_type: Type of agent - 'planner', 'coder', 'qa_reviewer', or 'qa_fixer'
                   This determines which custom auto-claude tools are available.
        max_thinking_tokens: Token budget for extended thinking (None = disabled)
                            - ultrathink: 16000 (spec creation)
                            - high: 10000 (QA review)
                            - medium: 5000 (planning, validation)
                            - None: disabled (coding)

    Returns:
        Configured ClaudeSDKClient

    Security layers (defense in depth):
    1. Sandbox - OS-level bash command isolation prevents filesystem escape
    2. Permissions - File operations restricted to project_dir only
    3. Security hooks - Bash commands validated against an allowlist
       (see security.py for ALLOWED_COMMANDS)
    4. Tool filtering - Each agent type only sees relevant tools (prevents misuse)
    """
    oauth_token = require_auth_token()
    # Ensure SDK can access it via its expected env var
    os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = oauth_token

    # Collect env vars to pass to SDK (ANTHROPIC_BASE_URL, etc.)
    sdk_env = get_sdk_env_vars()

    # Check if Linear integration is enabled
    linear_enabled = is_linear_enabled()
    linear_api_key = os.environ.get("LINEAR_API_KEY", "")

    # Check if custom auto-claude tools are available
    auto_claude_tools_enabled = is_tools_available()

    # Load project capabilities for dynamic MCP tool selection
    # This enables context-aware tool injection based on project type
    project_index = load_project_index(project_dir)
    project_capabilities = detect_project_capabilities(project_index)

    # Build the list of allowed tools
    # Start with agent-specific tools (includes base tools + auto-claude tools)
    # Pass project capabilities for dynamic MCP tool filtering
    if auto_claude_tools_enabled:
        allowed_tools_list = get_agent_allowed_tools(agent_type, project_capabilities)
    else:
        allowed_tools_list = [*BUILTIN_TOOLS]

    # Check if Graphiti MCP is enabled
    graphiti_mcp_enabled = is_graphiti_mcp_enabled()

    # Check if Electron MCP is enabled (for QA agents testing Electron apps)
    electron_mcp_enabled = is_electron_mcp_enabled()

    # Add external MCP tools based on project capabilities
    # This saves context window by only including relevant tools
    allowed_tools_list.extend(CONTEXT7_TOOLS)  # Always available
    if linear_enabled:
        allowed_tools_list.extend(LINEAR_TOOLS)
    if graphiti_mcp_enabled:
        allowed_tools_list.extend(GRAPHITI_MCP_TOOLS)
    # Note: Browser automation tools (ELECTRON_TOOLS, PUPPETEER_TOOLS) are already
    # added by get_agent_allowed_tools() via _get_qa_mcp_tools() for QA agents

    # Determine which browser automation tools to allow based on project type
    # Note: Must check "not is_electron" for Puppeteer to avoid tool mismatch
    # when Electron MCP is disabled for an Electron project
    browser_tools_permissions = []
    if agent_type in ("qa_reviewer", "qa_fixer"):
        if project_capabilities.get("is_electron") and electron_mcp_enabled:
            browser_tools_permissions = ELECTRON_TOOLS
        elif project_capabilities.get(
            "is_web_frontend"
        ) and not project_capabilities.get("is_electron"):
            # Only add Puppeteer for non-Electron web frontends
            browser_tools_permissions = PUPPETEER_TOOLS

    # Create comprehensive security settings
    # Note: Using relative paths ("./**") restricts access to project directory
    # since cwd is set to project_dir
    security_settings = {
        "sandbox": {"enabled": True, "autoAllowBashIfSandboxed": True},
        "permissions": {
            "defaultMode": "acceptEdits",  # Auto-approve edits within allowed directories
            "allow": [
                # Allow all file operations within the project directory
                "Read(./**)",
                "Write(./**)",
                "Edit(./**)",
                "Glob(./**)",
                "Grep(./**)",
                # Bash permission granted here, but actual commands are validated
                # by the bash_security_hook (see security.py for allowed commands)
                "Bash(*)",
                # Allow Context7 MCP tools for documentation lookup
                *CONTEXT7_TOOLS,
                # Allow Linear MCP tools for project management (if enabled)
                *(LINEAR_TOOLS if linear_enabled else []),
                # Allow Graphiti MCP tools for knowledge graph memory (if enabled)
                *(GRAPHITI_MCP_TOOLS if graphiti_mcp_enabled else []),
                # Allow browser automation tools based on project type
                *browser_tools_permissions,
            ],
        },
    }

    # Write settings to a file in the project directory
    settings_file = project_dir / ".claude_settings.json"
    with open(settings_file, "w") as f:
        json.dump(security_settings, f, indent=2)

    print(f"Security settings: {settings_file}")
    print("   - Sandbox enabled (OS-level bash isolation)")
    print(f"   - Filesystem restricted to: {project_dir.resolve()}")
    print("   - Bash commands restricted to allowlist")
    if max_thinking_tokens:
        print(f"   - Extended thinking: {max_thinking_tokens:,} tokens")
    else:
        print("   - Extended thinking: disabled")

    # Build list of MCP servers for display
    mcp_servers_list = ["context7 (documentation)"]
    if agent_type in ("qa_reviewer", "qa_fixer"):
        if project_capabilities.get("is_electron") and electron_mcp_enabled:
            mcp_servers_list.append(
                f"electron (desktop automation, port {get_electron_debug_port()})"
            )
        elif project_capabilities.get(
            "is_web_frontend"
        ) and not project_capabilities.get("is_electron"):
            mcp_servers_list.append("puppeteer (browser automation)")
    if linear_enabled:
        mcp_servers_list.append("linear (project management)")
    if graphiti_mcp_enabled:
        mcp_servers_list.append("graphiti-memory (knowledge graph)")
    if auto_claude_tools_enabled:
        mcp_servers_list.append(f"auto-claude ({agent_type} tools)")
    print(f"   - MCP servers: {', '.join(mcp_servers_list)}")

    # Show detected project capabilities for QA agents
    if agent_type in ("qa_reviewer", "qa_fixer") and any(project_capabilities.values()):
        caps = [
            k.replace("is_", "").replace("has_", "")
            for k, v in project_capabilities.items()
            if v
        ]
        print(f"   - Project capabilities: {', '.join(caps)}")
    print()

    # Configure MCP servers
    mcp_servers = {
        "context7": {"command": "npx", "args": ["-y", "@upstash/context7-mcp"]},
    }

    # Add browser automation MCP server based on project type
    if agent_type in ("qa_reviewer", "qa_fixer"):
        if project_capabilities.get("is_electron") and electron_mcp_enabled:
            # Electron MCP for desktop apps
            # Electron app must be started with --remote-debugging-port=<port>
            mcp_servers["electron"] = {
                "command": "npm",
                "args": ["exec", "electron-mcp-server"],
            }
        elif project_capabilities.get(
            "is_web_frontend"
        ) and not project_capabilities.get("is_electron"):
            # Puppeteer for web frontends (not Electron)
            mcp_servers["puppeteer"] = {
                "command": "npx",
                "args": ["puppeteer-mcp-server"],
            }

    # Add Linear MCP server if enabled
    if linear_enabled:
        mcp_servers["linear"] = {
            "type": "http",
            "url": "https://mcp.linear.app/mcp",
            "headers": {"Authorization": f"Bearer {linear_api_key}"},
        }

    # Add Graphiti MCP server if enabled
    # Graphiti MCP server for knowledge graph memory (uses embedded LadybugDB)
    if graphiti_mcp_enabled:
        mcp_servers["graphiti-memory"] = {
            "type": "http",
            "url": get_graphiti_mcp_url(),
        }

    # Add custom auto-claude MCP server if available
    auto_claude_mcp_server = None
    if auto_claude_tools_enabled:
        auto_claude_mcp_server = create_auto_claude_mcp_server(spec_dir, project_dir)
        if auto_claude_mcp_server:
            mcp_servers["auto-claude"] = auto_claude_mcp_server

    return ClaudeSDKClient(
        options=ClaudeAgentOptions(
            model=model,
            system_prompt=(
                f"You are an expert full-stack developer building production-quality software. "
                f"Your working directory is: {project_dir.resolve()}\n"
                f"Your filesystem access is RESTRICTED to this directory only. "
                f"Use relative paths (starting with ./) for all file operations. "
                f"Never use absolute paths or try to access files outside your working directory.\n\n"
                f"You follow existing code patterns, write clean maintainable code, and verify "
                f"your work through thorough testing. You communicate progress through Git commits "
                f"and build-progress.txt updates."
            ),
            allowed_tools=allowed_tools_list,
            mcp_servers=mcp_servers,
            hooks={
                "PreToolUse": [
                    HookMatcher(matcher="Bash", hooks=[bash_security_hook]),
                ],
            },
            max_turns=1000,
            cwd=str(project_dir.resolve()),
            settings=str(settings_file.resolve()),
            env=sdk_env,  # Pass ANTHROPIC_BASE_URL etc. to subprocess
            max_thinking_tokens=max_thinking_tokens,  # Extended thinking budget
        )
    )
