import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  InsightsChatMessage,
  InsightsChatStatus,
  InsightsStreamChunk,
  InsightsToolUsage,
  Task,
  WorktreeDiff,
  WorktreeStatus
} from '../../shared/types';

/**
 * Tool usage during chat response
 */
interface ToolUsage {
  name: string;
  input?: string;
}

/**
 * Context passed to the AI for review chat
 */
interface ReviewChatContext {
  task: Task;
  worktreeDiff?: WorktreeDiff | null;
  worktreeStatus?: WorktreeStatus | null;
}

/**
 * Return type for useReviewChat hook
 */
interface UseReviewChatReturn {
  // State
  messages: InsightsChatMessage[];
  status: InsightsChatStatus;
  streamingContent: string;
  currentTool: ToolUsage | null;

  // Actions
  sendMessage: (message: string) => void;
  clearChat: () => void;
}

/**
 * Initial status state
 */
const initialStatus: InsightsChatStatus = {
  phase: 'idle',
  message: ''
};

/**
 * Build context prefix for the AI from task and worktree info
 */
function buildContextPrefix(context: ReviewChatContext): string {
  const { task, worktreeDiff, worktreeStatus } = context;

  const parts: string[] = [
    '=== TASK REVIEW CONTEXT ===',
    '',
    `Task: ${task.title}`,
    `Status: ${task.status}`,
    `Description: ${task.description}`,
  ];

  // Add metadata if available
  if (task.metadata) {
    if (task.metadata.category) {
      parts.push(`Category: ${task.metadata.category}`);
    }
    if (task.metadata.complexity) {
      parts.push(`Complexity: ${task.metadata.complexity}`);
    }
  }

  // Add subtask summary
  if (task.subtasks && task.subtasks.length > 0) {
    const completed = task.subtasks.filter(s => s.status === 'completed').length;
    const total = task.subtasks.length;
    parts.push('');
    parts.push(`Subtasks: ${completed}/${total} completed`);
    task.subtasks.forEach(subtask => {
      const statusIcon = subtask.status === 'completed' ? '✓' : subtask.status === 'failed' ? '✗' : '○';
      parts.push(`  ${statusIcon} ${subtask.title || subtask.description}`);
    });
  }

  // Add worktree status if available
  if (worktreeStatus?.exists) {
    parts.push('');
    parts.push('=== WORKTREE STATUS ===');
    parts.push(`Branch: ${worktreeStatus.branch}`);
    parts.push(`Base Branch: ${worktreeStatus.baseBranch}`);
    if (worktreeStatus.commitCount !== undefined) {
      parts.push(`Commits: ${worktreeStatus.commitCount}`);
    }
    if (worktreeStatus.filesChanged !== undefined) {
      parts.push(`Files Changed: ${worktreeStatus.filesChanged}`);
    }
    if (worktreeStatus.additions !== undefined || worktreeStatus.deletions !== undefined) {
      parts.push(`Lines: +${worktreeStatus.additions || 0} / -${worktreeStatus.deletions || 0}`);
    }
  }

  // Add diff summary if available
  if (worktreeDiff?.files && worktreeDiff.files.length > 0) {
    parts.push('');
    parts.push('=== FILES CHANGED ===');
    worktreeDiff.files.forEach(file => {
      const statusLabel = file.status === 'added' ? '[A]' :
                          file.status === 'modified' ? '[M]' :
                          file.status === 'deleted' ? '[D]' :
                          file.status === 'renamed' ? '[R]' : '[?]';
      parts.push(`${statusLabel} ${file.path} (+${file.additions}/-${file.deletions})`);
    });
    if (worktreeDiff.summary) {
      parts.push('');
      parts.push(`Summary: ${worktreeDiff.summary}`);
    }
  }

  // Add QA report if available
  if (task.qaReport) {
    parts.push('');
    parts.push('=== QA REPORT ===');
    parts.push(`Status: ${task.qaReport.status}`);
    if (task.qaReport.issues && task.qaReport.issues.length > 0) {
      parts.push('Issues:');
      task.qaReport.issues.forEach(issue => {
        parts.push(`  [${issue.severity}] ${issue.description}`);
        if (issue.file) {
          parts.push(`    File: ${issue.file}${issue.line ? `:${issue.line}` : ''}`);
        }
      });
    }
  }

  parts.push('');
  parts.push('=== USER QUESTION ===');
  parts.push('');

  return parts.join('\n');
}

/**
 * Hook for managing review chat state and interactions.
 * Uses local state since chat is ephemeral and not persisted.
 *
 * @param projectId - The project ID for API calls
 * @param context - Task and worktree context for the AI
 * @returns Chat state and actions
 */
export function useReviewChat(
  projectId: string,
  context: ReviewChatContext
): UseReviewChatReturn {
  // Local state for chat
  const [messages, setMessages] = useState<InsightsChatMessage[]>([]);
  const [status, setStatus] = useState<InsightsChatStatus>(initialStatus);
  const [streamingContent, setStreamingContent] = useState('');
  const [currentTool, setCurrentTool] = useState<ToolUsage | null>(null);
  const [_toolsUsed, setToolsUsed] = useState<InsightsToolUsage[]>([]);

  // Ref to track if we have an active listener
  const isListeningRef = useRef(false);

  // Finalize streaming content into a message
  const finalizeStreamingMessage = useCallback(() => {
    setStreamingContent(prevContent => {
      setToolsUsed(prevTools => {
        if (!prevContent && prevTools.length === 0) {
          return [];
        }

        const newMessage: InsightsChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: prevContent,
          timestamp: new Date(),
          toolsUsed: prevTools.length > 0 ? [...prevTools] : undefined
        };

        setMessages(prev => [...prev, newMessage]);
        return [];
      });
      return '';
    });
  }, []);

  // Set up IPC listeners for streaming
  useEffect(() => {
    if (isListeningRef.current) return;
    isListeningRef.current = true;

    // Listen for streaming chunks
    const unsubStreamChunk = window.electronAPI.onInsightsStreamChunk(
      (_eventProjectId, chunk: InsightsStreamChunk) => {
        // Only process chunks for our project
        if (_eventProjectId !== projectId) return;

        switch (chunk.type) {
          case 'text':
            if (chunk.content) {
              setStreamingContent(prev => prev + chunk.content);
              setCurrentTool(null);
              setStatus({
                phase: 'streaming',
                message: 'Receiving response...'
              });
            }
            break;
          case 'tool_start':
            if (chunk.tool) {
              const tool: ToolUsage = {
                name: chunk.tool.name,
                input: chunk.tool.input
              };
              setCurrentTool(tool);
              setToolsUsed(prev => [
                ...prev,
                {
                  name: chunk.tool!.name,
                  input: chunk.tool!.input,
                  timestamp: new Date()
                }
              ]);
              setStatus({
                phase: 'streaming',
                message: `Using ${chunk.tool.name}...`
              });
            }
            break;
          case 'tool_end':
            setCurrentTool(null);
            break;
          case 'done':
            setCurrentTool(null);
            finalizeStreamingMessage();
            setStatus({
              phase: 'complete',
              message: ''
            });
            break;
          case 'error':
            setCurrentTool(null);
            setStatus({
              phase: 'error',
              error: chunk.error
            });
            break;
        }
      }
    );

    // Listen for status updates
    const unsubStatus = window.electronAPI.onInsightsStatus(
      (_eventProjectId, newStatus) => {
        if (_eventProjectId !== projectId) return;
        setStatus(newStatus);
      }
    );

    // Listen for errors
    const unsubError = window.electronAPI.onInsightsError(
      (_eventProjectId, error) => {
        if (_eventProjectId !== projectId) return;
        setStatus({
          phase: 'error',
          error
        });
      }
    );

    // Cleanup on unmount
    return () => {
      isListeningRef.current = false;
      unsubStreamChunk();
      unsubStatus();
      unsubError();
    };
  }, [projectId, finalizeStreamingMessage]);

  /**
   * Send a message to the AI with task context
   */
  const sendMessage = useCallback((message: string) => {
    if (!message.trim()) return;
    if (status.phase === 'thinking' || status.phase === 'streaming') return;

    // Add user message to local state
    const userMessage: InsightsChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);

    // Clear streaming state
    setStreamingContent('');
    setToolsUsed([]);
    setCurrentTool(null);
    setStatus({
      phase: 'thinking',
      message: 'Processing your message...'
    });

    // Build context-prefixed message for the AI
    const contextPrefix = buildContextPrefix(context);
    const fullMessage = contextPrefix + message;

    // Send to main process via insights API
    // Note: This reuses the insights infrastructure but with task context
    window.electronAPI.sendInsightsMessage(projectId, fullMessage);
  }, [projectId, context, status.phase]);

  /**
   * Clear all chat messages and reset state
   */
  const clearChat = useCallback(() => {
    setMessages([]);
    setStatus(initialStatus);
    setStreamingContent('');
    setCurrentTool(null);
    setToolsUsed([]);
  }, []);

  return {
    messages,
    status,
    streamingContent,
    currentTool,
    sendMessage,
    clearChat
  };
}
