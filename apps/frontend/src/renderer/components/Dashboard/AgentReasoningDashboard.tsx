import { useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import {
  useReasoningStore,
  getPhaseColor,
  startMonitoringTask,
  stopMonitoringTask,
  handleAgentCompleted,
  handleAgentError
} from '../../stores/reasoning-store';
import type {
  AgentStatus,
  ReasoningProgress,
  ReasoningStats,
  ReasoningEvent,
  ReasoningPhase,
  DecisionType
} from '../../../shared/types/reasoning';

interface AgentReasoningDashboardProps {
  /** Optional CSS class name */
  className?: string;
  /** Task ID to monitor for reasoning events. If provided, listens to IPC events for this task. */
  taskId?: string | null;
}

// Status display configuration
const STATUS_CONFIG: Record<AgentStatus, { colorClass: string; bgClass: string; labelKey: string; fallback: string }> = {
  idle: { colorClass: 'text-muted-foreground', bgClass: 'bg-muted', labelKey: 'reasoning.status.idle', fallback: 'Idle' },
  running: { colorClass: 'text-info', bgClass: 'bg-info/20', labelKey: 'reasoning.status.running', fallback: 'Running' },
  paused: { colorClass: 'text-warning', bgClass: 'bg-warning/20', labelKey: 'reasoning.status.paused', fallback: 'Paused' },
  stopped: { colorClass: 'text-muted-foreground', bgClass: 'bg-muted', labelKey: 'reasoning.status.stopped', fallback: 'Stopped' },
  completed: { colorClass: 'text-success', bgClass: 'bg-success/20', labelKey: 'reasoning.status.completed', fallback: 'Completed' },
  error: { colorClass: 'text-destructive', bgClass: 'bg-destructive/20', labelKey: 'reasoning.status.error', fallback: 'Error' },
};

// Throttle interval for log updates (max 10 updates/sec = 100ms)
const THROTTLE_INTERVAL_MS = 100;

/**
 * Agent Reasoning Dashboard - Main container component
 *
 * Displays real-time agent reasoning, progress tracking, decision tree visualization,
 * and decision inspection capabilities. Provides transparent visibility into the
 * autonomous agent's reasoning process and decision-making flow.
 *
 * Layout:
 * - Top row: Live reasoning display (left) + Progress tracker (right)
 * - Bottom: Decision tree visualization (full width)
 * - Inspector panel (conditional overlay/sidebar)
 */
export function AgentReasoningDashboard({ className, taskId }: AgentReasoningDashboardProps) {
  const { t } = useTranslation('tasks');

  // Get state from reasoning store
  const agentStatus = useReasoningStore((state) => state.agentStatus);
  const progress = useReasoningStore((state) => state.progress);
  const nodes = useReasoningStore((state) => state.nodes);
  const currentReasoning = useReasoningStore((state) => state.currentReasoning);
  const isInspectorOpen = useReasoningStore((state) => state.isInspectorOpen);
  const selectedDecision = useReasoningStore((state) => state.selectedDecision);
  const hasError = useReasoningStore((state) => state.hasError);
  const lastError = useReasoningStore((state) => state.lastError);
  const stats = useReasoningStore((state) => state.stats);
  const storeTaskId = useReasoningStore((state) => state.taskId);

  // Get store actions
  const addNode = useReasoningStore((state) => state.addNode);
  const updateNodeStatus = useReasoningStore((state) => state.updateNodeStatus);
  const updateReasoning = useReasoningStore((state) => state.updateReasoning);
  const updateProgress = useReasoningStore((state) => state.updateProgress);
  const setAgentStatus = useReasoningStore((state) => state.setAgentStatus);
  const setError = useReasoningStore((state) => state.setError);

  // Throttling refs for batching updates
  const lastUpdateTimeRef = useRef<number>(0);
  const pendingUpdatesRef = useRef<ReasoningEvent[]>([]);
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const statusConfig = STATUS_CONFIG[agentStatus] || STATUS_CONFIG.idle;
  const isActive = agentStatus === 'running' || agentStatus === 'paused';
  const hasDecisions = nodes.length > 0;

  /**
   * Process a batch of reasoning events
   * Handles different event types and updates the store accordingly
   */
  const processReasoningEvents = useCallback((events: ReasoningEvent[]) => {
    for (const event of events) {
      switch (event.type) {
        case 'reasoning_start':
          // Agent started reasoning - reset and prepare for new session
          if (event.taskId) {
            startMonitoringTask(event.taskId);
          }
          break;

        case 'reasoning_update':
          // Live reasoning text update
          if (event.reasoning) {
            updateReasoning(event.reasoning);
          }
          break;

        case 'decision_made':
          // A new decision was made - add node to tree
          if (event.decision) {
            addNode({
              id: event.decision.id || `decision-${Date.now()}`,
              label: event.decision.label || 'Decision',
              type: (event.decision.type as DecisionType) || 'reasoning',
              reasoning: event.decision.reasoning || '',
              parentId: event.decision.parentId,
              context: event.decision.context,
              toolName: event.decision.toolName,
              toolInput: event.decision.toolInput,
              subtaskId: event.decision.subtaskId,
            });
          }
          break;

        case 'decision_completed':
          // A decision completed successfully
          if (event.decision?.id) {
            updateNodeStatus({
              nodeId: event.decision.id,
              status: 'completed',
              result: event.decision.result,
            });
          }
          break;

        case 'decision_failed':
          // A decision failed
          if (event.decision?.id) {
            updateNodeStatus({
              nodeId: event.decision.id,
              status: 'failed',
              error: event.error || event.decision.error,
            });
          }
          break;

        case 'progress_update':
          // Progress changed
          if (event.progress) {
            updateProgress({
              phase: (event.progress.phase as ReasoningPhase) || 'idle',
              phaseProgress: event.progress.phaseProgress || 0,
              message: event.progress.message,
              currentSubtask: event.progress.currentSubtask,
            });
          }
          break;

        case 'agent_stopped':
          // Agent stopped/crashed
          stopMonitoringTask();
          if (event.error) {
            setError(event.error);
          }
          break;

        case 'agent_completed':
          // Agent completed successfully
          handleAgentCompleted();
          break;
      }
    }
  }, [addNode, updateNodeStatus, updateReasoning, updateProgress, setError]);

  /**
   * Throttled handler for reasoning events
   * Batches rapid updates to max 10/sec to prevent UI lag
   */
  const handleReasoningEvent = useCallback((eventTaskId: string, event: ReasoningEvent) => {
    // Only process events for the monitored task
    if (taskId && eventTaskId !== taskId) {
      return;
    }

    // Add to pending updates
    pendingUpdatesRef.current.push(event);

    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

    // If enough time has passed, process immediately
    if (timeSinceLastUpdate >= THROTTLE_INTERVAL_MS) {
      const events = pendingUpdatesRef.current;
      pendingUpdatesRef.current = [];
      lastUpdateTimeRef.current = now;
      processReasoningEvents(events);
    } else if (!throttleTimerRef.current) {
      // Otherwise, schedule a batch update
      throttleTimerRef.current = setTimeout(() => {
        const events = pendingUpdatesRef.current;
        pendingUpdatesRef.current = [];
        lastUpdateTimeRef.current = Date.now();
        throttleTimerRef.current = null;
        processReasoningEvents(events);
      }, THROTTLE_INTERVAL_MS - timeSinceLastUpdate);
    }
  }, [taskId, processReasoningEvents]);

  /**
   * Handle execution progress events (maps to reasoning phase updates)
   */
  const handleExecutionProgress = useCallback((eventTaskId: string, executionProgress: {
    phase: string;
    phaseProgress: number;
    overallProgress: number;
    message?: string;
  }) => {
    // Only process events for the monitored task
    if (taskId && eventTaskId !== taskId) {
      return;
    }

    // Map execution phase to reasoning phase
    const phaseMap: Record<string, ReasoningPhase> = {
      idle: 'idle',
      planning: 'planning',
      coding: 'coding',
      qa_review: 'qa_review',
      qa_fixing: 'qa_fixing',
      complete: 'complete',
      failed: 'failed',
    };

    const reasoningPhase = phaseMap[executionProgress.phase] || 'idle';

    updateProgress({
      phase: reasoningPhase,
      phaseProgress: executionProgress.phaseProgress,
      message: executionProgress.message,
    });

    // Update agent status based on phase
    if (executionProgress.phase === 'complete') {
      setAgentStatus('completed');
    } else if (executionProgress.phase === 'failed') {
      setAgentStatus('error');
    } else if (executionProgress.phase !== 'idle') {
      setAgentStatus('running');
    }
  }, [taskId, updateProgress, setAgentStatus]);

  // Set up IPC event listeners when taskId changes
  useEffect(() => {
    if (!taskId) {
      return;
    }

    // Initialize monitoring for this task
    if (storeTaskId !== taskId) {
      startMonitoringTask(taskId);
    }

    // Set up reasoning event listener
    const cleanupReasoning = window.electronAPI.onTaskReasoningEvent(handleReasoningEvent);

    // Set up execution progress listener
    const cleanupProgress = window.electronAPI.onTaskExecutionProgress(handleExecutionProgress);

    // Cleanup on unmount or taskId change
    return () => {
      cleanupReasoning();
      cleanupProgress();

      // Clear any pending throttled updates
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      pendingUpdatesRef.current = [];
    };
  }, [taskId, storeTaskId, handleReasoningEvent, handleExecutionProgress]);

  return (
    <div className={cn('flex h-full flex-col overflow-hidden', className)}>
      {/* Dashboard Header */}
      <DashboardHeader
        agentStatus={agentStatus}
        statusConfig={statusConfig}
        progress={progress}
        stats={stats}
        isActive={isActive}
      />

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {agentStatus === 'idle' && !hasDecisions ? (
            // Empty state - No agent running
            <EmptyState key="empty" />
          ) : hasError ? (
            // Error state
            <ErrorState key="error" error={lastError} />
          ) : (
            // Active dashboard
            <motion.div
              key="dashboard"
              className="grid h-full gap-4 p-4"
              style={{
                gridTemplateRows: 'auto 1fr',
                gridTemplateColumns: isInspectorOpen ? '1fr 320px' : '1fr',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Top Row: Reasoning Display + Progress Tracker */}
              <div className="grid gap-4" style={{ gridTemplateColumns: '2fr 1fr' }}>
                {/* Live Reasoning Display - Placeholder for ReasoningDisplay component */}
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                    {t('reasoning.liveReasoning', 'Live Reasoning')}
                  </h3>
                  <div className="min-h-[120px] max-h-[200px] overflow-y-auto">
                    {currentReasoning ? (
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {currentReasoning.text}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        {t('reasoning.waitingForReasoning', 'Waiting for agent reasoning...')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Progress Tracker - Placeholder for ProgressTracker component */}
                <div className="rounded-lg border bg-card p-4">
                  <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                    {t('reasoning.progress', 'Progress')}
                  </h3>
                  <div className="space-y-3">
                    {/* Phase indicator */}
                    <div className="flex items-center justify-between">
                      <span className={cn('text-xs font-medium', getPhaseColor(progress.phase))}>
                        {progress.phaseLabel}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {progress.overallProgress}%
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-border">
                      <motion.div
                        className="h-full rounded-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress.overallProgress}%` }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      />
                    </div>

                    {/* ETA */}
                    {progress.etaFormatted && (
                      <p className="text-xs text-muted-foreground">
                        {progress.etaFormatted}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom: Decision Tree - Placeholder for DecisionTree component */}
              <div
                className={cn(
                  'rounded-lg border bg-card',
                  isInspectorOpen ? 'col-span-1' : 'col-span-full'
                )}
              >
                <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      {t('reasoning.decisionTree', 'Decision Tree')}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {nodes.length} {nodes.length === 1 ? t('reasoning.node', 'node') : t('reasoning.nodes', 'nodes')}
                    </span>
                  </div>
                  <div className="flex-1 p-4">
                    {hasDecisions ? (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        {/* DecisionTree component will be rendered here */}
                        <p className="text-sm">
                          {t('reasoning.decisionTreePlaceholder', 'Decision tree visualization will appear here')}
                        </p>
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <p className="text-sm text-muted-foreground italic">
                          {t('reasoning.noDecisionsYet', 'No decisions made yet')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Inspector Panel - Placeholder for DecisionInspector component */}
              {isInspectorOpen && selectedDecision && (
                <div className="row-span-2 rounded-lg border bg-card">
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b px-4 py-2">
                      <h3 className="text-sm font-medium text-muted-foreground">
                        {t('reasoning.decisionDetails', 'Decision Details')}
                      </h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                      {/* DecisionInspector component will be rendered here */}
                      <p className="text-sm text-muted-foreground">
                        {selectedDecision.label}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * Dashboard header with status indicator and stats
 */
function DashboardHeader({
  agentStatus,
  statusConfig,
  progress,
  stats,
  isActive,
}: {
  agentStatus: AgentStatus;
  statusConfig: { colorClass: string; bgClass: string; labelKey: string; fallback: string };
  progress: ReasoningProgress;
  stats: ReasoningStats;
  isActive: boolean;
}) {
  const { t } = useTranslation('tasks');

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">
          {t('reasoning.title', 'Agent Reasoning')}
        </h2>

        {/* Status badge */}
        <motion.div
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
            statusConfig.bgClass,
            statusConfig.colorClass
          )}
          animate={
            isActive
              ? { opacity: [1, 0.7, 1] }
              : { opacity: 1 }
          }
          transition={
            isActive
              ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
              : undefined
          }
        >
          {/* Status indicator dot */}
          {isActive && (
            <motion.span
              className={cn('h-1.5 w-1.5 rounded-full', statusConfig.colorClass.replace('text-', 'bg-'))}
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          )}
          {t(statusConfig.labelKey, statusConfig.fallback)}
        </motion.div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          {stats.totalDecisions} {t('reasoning.decisions', 'decisions')}
        </span>
        <span>
          {stats.toolCalls} {t('reasoning.toolCalls', 'tool calls')}
        </span>
        <span>
          {progress.completedPhases}/{progress.totalPhases} {t('reasoning.phases', 'phases')}
        </span>
      </div>
    </div>
  );
}

/**
 * Empty state when no agent is running
 */
function EmptyState() {
  const { t } = useTranslation('tasks');

  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center gap-4 p-8"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      <div className="rounded-full bg-muted p-6">
        <svg
          className="h-12 w-12 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>
      <div className="text-center">
        <h3 className="text-lg font-medium text-foreground">
          {t('reasoning.noAgentRunning', 'No Agent Running')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('reasoning.noAgentDescription', 'Start a task to see the agent\'s reasoning process in real-time.')}
        </p>
      </div>
    </motion.div>
  );
}

/**
 * Error state display
 */
function ErrorState({ error }: { error: string | null }) {
  const { t } = useTranslation('tasks');

  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center gap-4 p-8"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <div className="rounded-full bg-destructive/20 p-6">
        <svg
          className="h-12 w-12 text-destructive"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <div className="text-center">
        <h3 className="text-lg font-medium text-foreground">
          {t('reasoning.agentError', 'Agent Error')}
        </h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {error || t('reasoning.unknownError', 'An unknown error occurred.')}
        </p>
      </div>
    </motion.div>
  );
}

export default AgentReasoningDashboard;
