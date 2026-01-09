"""
Agent Session Management
========================

Handles running agent sessions and post-session processing including
memory updates, recovery tracking, Linear integration, and token usage tracking.
"""

import logging
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from claude_agent_sdk import ClaudeSDKClient
from debug import debug, debug_detailed, debug_error, debug_section, debug_success
from insight_extractor import extract_session_insights
from linear_updater import (
    linear_subtask_completed,
    linear_subtask_failed,
)
from progress import (
    count_subtasks_detailed,
    is_build_complete,
)
from recovery import RecoveryManager
from security.tool_input_validator import get_safe_tool_input
from task_logger import (
    LogEntryType,
    LogPhase,
    get_task_logger,
)
from ui import (
    StatusManager,
    muted,
    print_key_value,
    print_status,
)

from .memory_manager import save_session_memory
from .utils import (
    find_subtask_in_plan,
    get_commit_count,
    get_latest_commit,
    load_implementation_plan,
    sync_spec_to_source,
)

logger = logging.getLogger(__name__)


@dataclass
class SessionUsageInfo:
    """
    Token usage information from a completed agent session.

    This is extracted from SDK response messages and passed to
    post_session_processing for storage.
    """

    session_id: str
    input_tokens: int = 0
    output_tokens: int = 0
    thinking_tokens: int = 0
    cache_hit_tokens: int = 0
    duration_seconds: float | None = None
    message_count: int = 0
    tool_count: int = 0


def _extract_usage_from_messages(messages: list[Any]) -> dict[str, int]:
    """
    Extract token usage from Claude SDK response messages.

    The SDK may expose usage in different ways depending on version.
    This function tries multiple approaches to extract the data.

    Args:
        messages: List of messages from client.receive_response()

    Returns:
        Dictionary with input_tokens, output_tokens, thinking_tokens, cache_hit_tokens
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
            # Extended thinking tokens
            if hasattr(msg_usage, "thinking_tokens"):
                usage["thinking_tokens"] = max(usage["thinking_tokens"], msg_usage.thinking_tokens)
            # Cache hits (may be named differently in different SDK versions)
            if hasattr(msg_usage, "cache_read_input_tokens"):
                usage["cache_hit_tokens"] = max(
                    usage["cache_hit_tokens"], msg_usage.cache_read_input_tokens
                )
            elif hasattr(msg_usage, "cache_hit_tokens"):
                usage["cache_hit_tokens"] = max(
                    usage["cache_hit_tokens"], msg_usage.cache_hit_tokens
                )

        # Some SDK versions expose usage at message level
        if hasattr(msg, "input_tokens"):
            usage["input_tokens"] = max(usage["input_tokens"], msg.input_tokens)
        if hasattr(msg, "output_tokens"):
            usage["output_tokens"] = max(usage["output_tokens"], msg.output_tokens)

    return usage


def _record_token_usage(
    spec_dir: Path,
    project_dir: Path,
    usage_info: SessionUsageInfo,
    agent_type: str,
    model_name: str,
    outcome: str,
    subtask_id: str | None = None,
) -> None:
    """
    Record token usage for a completed session.

    Args:
        spec_dir: Spec directory path
        project_dir: Project root directory
        usage_info: Session usage information
        agent_type: Type of agent (coder, planner, qa_reviewer, etc.)
        model_name: Claude model used
        outcome: Session outcome (success, failed, retry, abandoned)
        subtask_id: Subtask ID if applicable
    """
    try:
        from usage.tracker import UsageTracker

        tracker = UsageTracker(project_dir, spec_dir)
        record = tracker.record_session(
            session_id=usage_info.session_id,
            agent_type=agent_type,
            model_name=model_name,
            outcome=outcome,
            input_tokens=usage_info.input_tokens,
            output_tokens=usage_info.output_tokens,
            thinking_tokens=usage_info.thinking_tokens,
            cache_hit_tokens=usage_info.cache_hit_tokens,
            duration_seconds=usage_info.duration_seconds,
            subtask_id=subtask_id,
        )

        if record:
            total_tokens = record.total_tokens
            logger.debug(
                f"Recorded token usage: {total_tokens:,} total "
                f"({usage_info.input_tokens:,} in, {usage_info.output_tokens:,} out)"
            )
        else:
            logger.warning("Failed to record token usage")

    except ImportError:
        logger.debug("Usage tracking module not available")
    except Exception as e:
        # Don't let usage tracking failures break the main flow
        logger.warning(f"Error recording token usage: {e}")


async def post_session_processing(
    spec_dir: Path,
    project_dir: Path,
    subtask_id: str,
    session_num: int,
    commit_before: str | None,
    commit_count_before: int,
    recovery_manager: RecoveryManager,
    linear_enabled: bool = False,
    status_manager: StatusManager | None = None,
    source_spec_dir: Path | None = None,
    usage_info: SessionUsageInfo | None = None,
    agent_type: str = "coder",
    model_name: str = "claude-sonnet-4-5-20250929",
) -> bool:
    """
    Process session results and update memory automatically.

    This runs in Python (100% reliable) instead of relying on agent compliance.

    Args:
        spec_dir: Spec directory containing memory/
        project_dir: Project root for git operations
        subtask_id: The subtask that was being worked on
        session_num: Current session number
        commit_before: Git commit hash before session
        commit_count_before: Number of commits before session
        recovery_manager: Recovery manager instance
        linear_enabled: Whether Linear integration is enabled
        status_manager: Optional status manager for ccstatusline
        source_spec_dir: Original spec directory (for syncing back from worktree)
        usage_info: Token usage information from the session (optional)
        agent_type: Type of agent that ran the session (for usage tracking)
        model_name: Claude model used (for usage tracking)

    Returns:
        True if subtask was completed successfully
    """
    print()
    print(muted("--- Post-Session Processing ---"))

    # Sync implementation plan back to source (for worktree mode)
    if sync_spec_to_source(spec_dir, source_spec_dir):
        print_status("Implementation plan synced to main project", "success")

    # Check if implementation plan was updated
    plan = load_implementation_plan(spec_dir)
    if not plan:
        print("  Warning: Could not load implementation plan")
        return False

    subtask = find_subtask_in_plan(plan, subtask_id)
    if not subtask:
        print(f"  Warning: Subtask {subtask_id} not found in plan")
        return False

    subtask_status = subtask.get("status", "pending")

    # Check for new commits
    commit_after = get_latest_commit(project_dir)
    commit_count_after = get_commit_count(project_dir)
    new_commits = commit_count_after - commit_count_before

    print_key_value("Subtask status", subtask_status)
    print_key_value("New commits", str(new_commits))

    if subtask_status == "completed":
        # Success! Record the attempt and good commit
        print_status(f"Subtask {subtask_id} completed successfully", "success")

        # Update status file
        if status_manager:
            subtasks = count_subtasks_detailed(spec_dir)
            status_manager.update_subtasks(
                completed=subtasks["completed"],
                total=subtasks["total"],
                in_progress=0,
            )

        # Record successful attempt
        recovery_manager.record_attempt(
            subtask_id=subtask_id,
            session=session_num,
            success=True,
            approach=f"Implemented: {subtask.get('description', 'subtask')[:100]}",
        )

        # Record good commit for rollback safety
        if commit_after and commit_after != commit_before:
            recovery_manager.record_good_commit(commit_after, subtask_id)
            print_status(f"Recorded good commit: {commit_after[:8]}", "success")

        # Record Linear session result (if enabled)
        if linear_enabled:
            # Get progress counts for the comment
            subtasks_detail = count_subtasks_detailed(spec_dir)
            await linear_subtask_completed(
                spec_dir=spec_dir,
                subtask_id=subtask_id,
                completed_count=subtasks_detail["completed"],
                total_count=subtasks_detail["total"],
            )
            print_status("Linear progress recorded", "success")

        # Extract rich insights from session (LLM-powered analysis)
        try:
            extracted_insights = await extract_session_insights(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                commit_before=commit_before,
                commit_after=commit_after,
                success=True,
                recovery_manager=recovery_manager,
            )
            insight_count = len(extracted_insights.get("file_insights", []))
            pattern_count = len(extracted_insights.get("patterns_discovered", []))
            if insight_count > 0 or pattern_count > 0:
                print_status(
                    f"Extracted {insight_count} file insights, {pattern_count} patterns",
                    "success",
                )
        except Exception as e:
            logger.warning(f"Insight extraction failed: {e}")
            extracted_insights = None

        # Save session memory (Graphiti=primary, file-based=fallback)
        try:
            save_success, storage_type = await save_session_memory(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                success=True,
                subtasks_completed=[subtask_id],
                discoveries=extracted_insights,
            )
            if save_success:
                if storage_type == "graphiti":
                    print_status("Session saved to Graphiti memory", "success")
                else:
                    print_status(
                        "Session saved to file-based memory (fallback)", "info"
                    )
            else:
                print_status("Failed to save session memory", "warning")
        except Exception as e:
            logger.warning(f"Error saving session memory: {e}")
            print_status("Memory save failed", "warning")

        # Record token usage (for cost tracking dashboard)
        if usage_info:
            _record_token_usage(
                spec_dir=spec_dir,
                project_dir=project_dir,
                usage_info=usage_info,
                agent_type=agent_type,
                model_name=model_name,
                outcome="success",
                subtask_id=subtask_id,
            )
            if usage_info.input_tokens > 0 or usage_info.output_tokens > 0:
                print_status(
                    f"Token usage recorded: {usage_info.input_tokens:,} in, "
                    f"{usage_info.output_tokens:,} out",
                    "success",
                )

        return True

    elif subtask_status == "in_progress":
        # Session ended without completion
        print_status(f"Subtask {subtask_id} still in progress", "warning")

        recovery_manager.record_attempt(
            subtask_id=subtask_id,
            session=session_num,
            success=False,
            approach="Session ended with subtask in_progress",
            error="Subtask not marked as completed",
        )

        # Still record commit if one was made (partial progress)
        if commit_after and commit_after != commit_before:
            recovery_manager.record_good_commit(commit_after, subtask_id)
            print_status(
                f"Recorded partial progress commit: {commit_after[:8]}", "info"
            )

        # Record Linear session result (if enabled)
        if linear_enabled:
            attempt_count = recovery_manager.get_attempt_count(subtask_id)
            await linear_subtask_failed(
                spec_dir=spec_dir,
                subtask_id=subtask_id,
                attempt=attempt_count,
                error_summary="Session ended without completion",
            )

        # Extract insights even from failed sessions (valuable for future attempts)
        try:
            extracted_insights = await extract_session_insights(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                commit_before=commit_before,
                commit_after=commit_after,
                success=False,
                recovery_manager=recovery_manager,
            )
        except Exception as e:
            logger.debug(f"Insight extraction failed for incomplete session: {e}")
            extracted_insights = None

        # Save failed session memory (to track what didn't work)
        try:
            await save_session_memory(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                success=False,
                subtasks_completed=[],
                discoveries=extracted_insights,
            )
        except Exception as e:
            logger.debug(f"Failed to save incomplete session memory: {e}")

        # Record token usage even for incomplete sessions (still consumed tokens)
        if usage_info:
            _record_token_usage(
                spec_dir=spec_dir,
                project_dir=project_dir,
                usage_info=usage_info,
                agent_type=agent_type,
                model_name=model_name,
                outcome="in_progress",
                subtask_id=subtask_id,
            )

        return False

    else:
        # Subtask still pending or failed
        print_status(
            f"Subtask {subtask_id} not completed (status: {subtask_status})", "error"
        )

        recovery_manager.record_attempt(
            subtask_id=subtask_id,
            session=session_num,
            success=False,
            approach="Session ended without progress",
            error=f"Subtask status is {subtask_status}",
        )

        # Record Linear session result (if enabled)
        if linear_enabled:
            attempt_count = recovery_manager.get_attempt_count(subtask_id)
            await linear_subtask_failed(
                spec_dir=spec_dir,
                subtask_id=subtask_id,
                attempt=attempt_count,
                error_summary=f"Subtask status: {subtask_status}",
            )

        # Extract insights even from completely failed sessions
        try:
            extracted_insights = await extract_session_insights(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                commit_before=commit_before,
                commit_after=commit_after,
                success=False,
                recovery_manager=recovery_manager,
            )
        except Exception as e:
            logger.debug(f"Insight extraction failed for failed session: {e}")
            extracted_insights = None

        # Save failed session memory (to track what didn't work)
        try:
            await save_session_memory(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=subtask_id,
                session_num=session_num,
                success=False,
                subtasks_completed=[],
                discoveries=extracted_insights,
            )
        except Exception as e:
            logger.debug(f"Failed to save failed session memory: {e}")

        # Record token usage even for failed sessions (still consumed tokens)
        if usage_info:
            _record_token_usage(
                spec_dir=spec_dir,
                project_dir=project_dir,
                usage_info=usage_info,
                agent_type=agent_type,
                model_name=model_name,
                outcome="failed",
                subtask_id=subtask_id,
            )

        return False


async def run_agent_session(
    client: ClaudeSDKClient,
    message: str,
    spec_dir: Path,
    verbose: bool = False,
    phase: LogPhase = LogPhase.CODING,
) -> tuple[str, str, SessionUsageInfo | None]:
    """
    Run a single agent session using Claude Agent SDK.

    Args:
        client: Claude SDK client
        message: The prompt to send
        spec_dir: Spec directory path
        verbose: Whether to show detailed output
        phase: Current execution phase for logging

    Returns:
        (status, response_text, usage_info) where status is:
        - "continue" if agent should continue working
        - "complete" if all subtasks complete
        - "error" if an error occurred
        And usage_info contains token usage metrics (or None if unavailable)
    """
    debug_section("session", f"Agent Session - {phase.value}")
    debug(
        "session",
        "Starting agent session",
        spec_dir=str(spec_dir),
        phase=phase.value,
        prompt_length=len(message),
        prompt_preview=message[:200] + "..." if len(message) > 200 else message,
    )
    print("Sending prompt to Claude Agent SDK...\n")

    # Get task logger for this spec
    task_logger = get_task_logger(spec_dir)
    current_tool = None
    message_count = 0
    tool_count = 0

    # Track session for usage metrics
    session_id = f"session-{uuid.uuid4().hex[:12]}"
    session_start = time.time()
    collected_messages: list[Any] = []

    try:
        # Send the query
        debug("session", "Sending query to Claude SDK...")
        await client.query(message)
        debug_success("session", "Query sent successfully")

        # Collect response text and show tool use
        response_text = ""
        debug("session", "Starting to receive response stream...")
        async for msg in client.receive_response():
            msg_type = type(msg).__name__
            message_count += 1
            collected_messages.append(msg)  # Collect for usage extraction
            debug_detailed(
                "session",
                f"Received message #{message_count}",
                msg_type=msg_type,
            )

            # Handle AssistantMessage (text and tool use)
            if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    block_type = type(block).__name__

                    if block_type == "TextBlock" and hasattr(block, "text"):
                        response_text += block.text
                        print(block.text, end="", flush=True)
                        # Log text to task logger (persist without double-printing)
                        if task_logger and block.text.strip():
                            task_logger.log(
                                block.text,
                                LogEntryType.TEXT,
                                phase,
                                print_to_console=False,
                            )
                    elif block_type == "ToolUseBlock" and hasattr(block, "name"):
                        tool_name = block.name
                        tool_input_display = None
                        tool_count += 1

                        # Safely extract tool input (handles None, non-dict, etc.)
                        inp = get_safe_tool_input(block)

                        # Extract meaningful tool input for display
                        if inp:
                            if "pattern" in inp:
                                tool_input_display = f"pattern: {inp['pattern']}"
                            elif "file_path" in inp:
                                fp = inp["file_path"]
                                if len(fp) > 50:
                                    fp = "..." + fp[-47:]
                                tool_input_display = fp
                            elif "command" in inp:
                                cmd = inp["command"]
                                if len(cmd) > 50:
                                    cmd = cmd[:47] + "..."
                                tool_input_display = cmd
                            elif "path" in inp:
                                tool_input_display = inp["path"]

                        debug(
                            "session",
                            f"Tool call #{tool_count}: {tool_name}",
                            tool_input=tool_input_display,
                            full_input=str(inp)[:500] if inp else None,
                        )

                        # Log tool start (handles printing too)
                        if task_logger:
                            task_logger.tool_start(
                                tool_name,
                                tool_input_display,
                                phase,
                                print_to_console=True,
                            )
                        else:
                            print(f"\n[Tool: {tool_name}]", flush=True)

                        if verbose and hasattr(block, "input"):
                            input_str = str(block.input)
                            if len(input_str) > 300:
                                print(f"   Input: {input_str[:300]}...", flush=True)
                            else:
                                print(f"   Input: {input_str}", flush=True)
                        current_tool = tool_name

            # Handle UserMessage (tool results)
            elif msg_type == "UserMessage" and hasattr(msg, "content"):
                for block in msg.content:
                    block_type = type(block).__name__

                    if block_type == "ToolResultBlock":
                        result_content = getattr(block, "content", "")
                        is_error = getattr(block, "is_error", False)

                        # Check if this is an error (not just content containing "blocked")
                        if is_error and "blocked" in str(result_content).lower():
                            # Actual blocked command by security hook
                            debug_error(
                                "session",
                                f"Tool BLOCKED: {current_tool}",
                                result=str(result_content)[:300],
                            )
                            print(f"   [BLOCKED] {result_content}", flush=True)
                            if task_logger and current_tool:
                                task_logger.tool_end(
                                    current_tool,
                                    success=False,
                                    result="BLOCKED",
                                    detail=str(result_content),
                                    phase=phase,
                                )
                        elif is_error:
                            # Show errors (truncated)
                            error_str = str(result_content)[:500]
                            debug_error(
                                "session",
                                f"Tool error: {current_tool}",
                                error=error_str[:200],
                            )
                            print(f"   [Error] {error_str}", flush=True)
                            if task_logger and current_tool:
                                # Store full error in detail for expandable view
                                task_logger.tool_end(
                                    current_tool,
                                    success=False,
                                    result=error_str[:100],
                                    detail=str(result_content),
                                    phase=phase,
                                )
                        else:
                            # Tool succeeded
                            debug_detailed(
                                "session",
                                f"Tool success: {current_tool}",
                                result_length=len(str(result_content)),
                            )
                            if verbose:
                                result_str = str(result_content)[:200]
                                print(f"   [Done] {result_str}", flush=True)
                            else:
                                print("   [Done]", flush=True)
                            if task_logger and current_tool:
                                # Store full result in detail for expandable view (only for certain tools)
                                # Skip storing for very large outputs like Glob results
                                detail_content = None
                                if current_tool in (
                                    "Read",
                                    "Grep",
                                    "Bash",
                                    "Edit",
                                    "Write",
                                ):
                                    result_str = str(result_content)
                                    # Only store if not too large (detail truncation happens in logger)
                                    if (
                                        len(result_str) < 50000
                                    ):  # 50KB max before truncation
                                        detail_content = result_str
                                task_logger.tool_end(
                                    current_tool,
                                    success=True,
                                    detail=detail_content,
                                    phase=phase,
                                )

                        current_tool = None

        print("\n" + "-" * 70 + "\n")

        # Calculate session duration and extract usage metrics
        session_duration = time.time() - session_start
        usage_data = _extract_usage_from_messages(collected_messages)

        usage_info = SessionUsageInfo(
            session_id=session_id,
            input_tokens=usage_data["input_tokens"],
            output_tokens=usage_data["output_tokens"],
            thinking_tokens=usage_data["thinking_tokens"],
            cache_hit_tokens=usage_data["cache_hit_tokens"],
            duration_seconds=session_duration,
            message_count=message_count,
            tool_count=tool_count,
        )

        debug(
            "session",
            "Usage metrics extracted",
            input_tokens=usage_info.input_tokens,
            output_tokens=usage_info.output_tokens,
            thinking_tokens=usage_info.thinking_tokens,
            cache_hit_tokens=usage_info.cache_hit_tokens,
            duration_seconds=f"{session_duration:.1f}",
        )

        # Check if build is complete
        if is_build_complete(spec_dir):
            debug_success(
                "session",
                "Session completed - build is complete",
                message_count=message_count,
                tool_count=tool_count,
                response_length=len(response_text),
            )
            return "complete", response_text, usage_info

        debug_success(
            "session",
            "Session completed - continuing",
            message_count=message_count,
            tool_count=tool_count,
            response_length=len(response_text),
        )
        return "continue", response_text, usage_info

    except Exception as e:
        debug_error(
            "session",
            f"Session error: {e}",
            exception_type=type(e).__name__,
            message_count=message_count,
            tool_count=tool_count,
        )
        print(f"Error during agent session: {e}")
        if task_logger:
            task_logger.log_error(f"Session error: {e}", phase)

        # Calculate partial usage for error case
        session_duration = time.time() - session_start
        usage_data = _extract_usage_from_messages(collected_messages)
        error_usage_info = SessionUsageInfo(
            session_id=session_id,
            input_tokens=usage_data["input_tokens"],
            output_tokens=usage_data["output_tokens"],
            thinking_tokens=usage_data["thinking_tokens"],
            cache_hit_tokens=usage_data["cache_hit_tokens"],
            duration_seconds=session_duration,
            message_count=message_count,
            tool_count=tool_count,
        )

        return "error", str(e), error_usage_info
