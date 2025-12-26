import { useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Progress } from '../ui/progress';
import { cn } from '../../lib/utils';
import { useReasoningStore, getPhaseColor, formatEta } from '../../stores/reasoning-store';
import type { ReasoningPhase, ReasoningProgress } from '../../../shared/types/reasoning';
import { PHASE_WEIGHTS } from '../../../shared/types/reasoning';

interface ProgressTrackerProps {
  /** Optional CSS class name */
  className?: string;
  /** Whether to show phase segment bar */
  showPhaseSegments?: boolean;
  /** Whether to show stats summary */
  showStats?: boolean;
}

/**
 * Phase configuration for progress bar segments
 */
const PHASE_SEGMENTS: { phase: ReasoningPhase; width: number; color: string; label: string }[] = [
  { phase: 'planning', width: 15, color: 'bg-amber-500', label: 'Planning' },
  { phase: 'coding', width: 60, color: 'bg-info', label: 'Coding' },
  { phase: 'qa_review', width: 15, color: 'bg-purple-500', label: 'QA Review' },
  { phase: 'complete', width: 10, color: 'bg-success', label: 'Complete' },
];

/**
 * Animation variants for ETA and progress text
 */
const fadeVariants = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
};

/**
 * ProgressTracker - Progress bar component with ETA display
 *
 * Displays agent execution progress with:
 * - Radix UI Progress bar showing 0-100% completion
 * - Human-readable ETA (e.g., "~3 min remaining")
 * - Phase labels showing current execution phase
 * - Phase segment bar showing progress across phases
 * - Optional stats summary (decisions, tool calls, elapsed time)
 */
export function ProgressTracker({
  className,
  showPhaseSegments = true,
  showStats = false,
}: ProgressTrackerProps) {
  const { t } = useTranslation('tasks');

  // Get state from reasoning store
  const progress = useReasoningStore((state) => state.progress);
  const agentStatus = useReasoningStore((state) => state.agentStatus);
  const stats = useReasoningStore((state) => state.stats);

  // Determine if the agent is actively running
  const isRunning = agentStatus === 'running' || agentStatus === 'paused';
  const isComplete = progress.phase === 'complete' || agentStatus === 'completed';
  const isFailed = progress.phase === 'failed' || agentStatus === 'error';

  // Get phase-specific styling
  const phaseColorClass = getPhaseColor(progress.phase);

  // Memoize phase segment determination
  const activePhaseIndex = useMemo(() => {
    return PHASE_SEGMENTS.findIndex((seg) =>
      seg.phase === progress.phase ||
      (seg.phase === 'qa_review' && progress.phase === 'qa_fixing')
    );
  }, [progress.phase]);

  // Format elapsed time
  const formattedElapsedTime = useMemo(() => {
    return formatElapsedTime(stats.elapsedMs);
  }, [stats.elapsedMs]);

  // Get progress status message
  const getStatusMessage = useCallback((): string => {
    if (isFailed) {
      return t('progress.failed', 'Execution failed');
    }
    if (isComplete) {
      return t('progress.completed', 'Completed successfully');
    }
    if (progress.message) {
      return progress.message;
    }
    if (progress.currentSubtask) {
      return t('progress.workingOnSubtask', 'Working on: {{subtask}}', {
        subtask: progress.currentSubtask,
      });
    }
    if (!isRunning && agentStatus === 'idle') {
      return t('progress.notStarted', 'Not started');
    }
    return progress.phaseLabel || t('progress.processing', 'Processing...');
  }, [t, isFailed, isComplete, progress, isRunning, agentStatus]);

  return (
    <div className={cn('flex flex-col rounded-lg border bg-card', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <ProgressIcon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">
            {t('progress.title', 'Progress')}
          </h3>
          {/* Running indicator */}
          {isRunning && !isComplete && !isFailed && (
            <motion.div
              className={cn('h-1.5 w-1.5 rounded-full', getPhaseColorBg(progress.phase))}
              animate={{
                scale: [1, 1.5, 1],
                opacity: [1, 0.5, 1],
              }}
              transition={{
                duration: 1,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
          )}
        </div>
        {/* Phase badge */}
        <AnimatePresence mode="wait">
          <motion.span
            key={progress.phase}
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.2 }}
            className={cn(
              'text-xs font-medium px-2 py-0.5 rounded-full',
              getPhaseBackgroundColor(progress.phase)
            )}
          >
            {progress.phaseLabel}
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Progress content */}
      <div className="p-4 space-y-3">
        {/* Progress percentage and ETA row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-2xl font-bold tabular-nums',
              isComplete && 'text-success',
              isFailed && 'text-destructive'
            )}>
              {Math.round(progress.overallProgress)}%
            </span>
            {isRunning && !isComplete && !isFailed && formattedElapsedTime && (
              <span className="text-xs text-muted-foreground">
                ({formattedElapsedTime})
              </span>
            )}
          </div>
          {/* ETA display */}
          <AnimatePresence mode="wait">
            {progress.etaFormatted && isRunning && !isComplete && !isFailed && (
              <motion.span
                key="eta"
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="text-sm font-medium text-primary"
              >
                <ClockIcon className="inline-block h-3.5 w-3.5 mr-1" />
                {progress.etaFormatted}
              </motion.span>
            )}
            {isComplete && (
              <motion.span
                key="complete"
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="text-sm font-medium text-success"
              >
                <CheckCircleIcon className="inline-block h-3.5 w-3.5 mr-1" />
                {t('progress.done', 'Done!')}
              </motion.span>
            )}
            {isFailed && (
              <motion.span
                key="failed"
                variants={fadeVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2 }}
                className="text-sm font-medium text-destructive"
              >
                <XCircleIcon className="inline-block h-3.5 w-3.5 mr-1" />
                {t('progress.failedShort', 'Failed')}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Main progress bar */}
        <div className={cn(
          'rounded-full',
          isRunning && !isComplete && !isFailed && 'progress-working'
        )}>
          <Progress
            value={progress.overallProgress}
            className={cn(
              'h-3',
              isComplete && '[&>div]:bg-success',
              isFailed && '[&>div]:bg-destructive',
              isRunning && !isComplete && !isFailed && '[&>div]:bg-primary'
            )}
            animated={isRunning && !isComplete && !isFailed}
          />
        </div>

        {/* Phase segments indicator */}
        {showPhaseSegments && (
          <div className="mt-2 flex gap-0.5 h-1.5 rounded-full overflow-hidden bg-muted/30">
            {PHASE_SEGMENTS.map((segment, index) => (
              <motion.div
                key={segment.phase}
                className={cn(
                  'transition-all duration-300',
                  activePhaseIndex === index
                    ? segment.color
                    : index < activePhaseIndex
                      ? `${segment.color}`
                      : `${segment.color}/30`
                )}
                style={{ width: `${segment.width}%` }}
                title={`${segment.label} (${PHASE_WEIGHTS[segment.phase]?.start || 0}-${PHASE_WEIGHTS[segment.phase]?.end || 0}%)`}
                animate={{
                  opacity: activePhaseIndex === index && isRunning
                    ? [0.6, 1, 0.6]
                    : 1,
                }}
                transition={
                  activePhaseIndex === index && isRunning
                    ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Status message */}
        <p className="text-xs text-muted-foreground truncate">
          {getStatusMessage()}
        </p>

        {/* Phase progress bar */}
        <PhaseProgressBar progress={progress} isRunning={isRunning} />

        {/* Stats summary (optional) */}
        {showStats && stats.totalDecisions > 0 && (
          <StatsBar stats={stats} />
        )}
      </div>
    </div>
  );
}

/**
 * Phase progress bar showing individual phase completion
 */
function PhaseProgressBar({
  progress,
  isRunning
}: {
  progress: ReasoningProgress;
  isRunning: boolean;
}) {
  const { t } = useTranslation('tasks');

  const phases: { key: ReasoningPhase; label: string; widthPercent: number }[] = [
    { key: 'planning', label: t('progress.phases.planning', 'Plan'), widthPercent: 20 },
    { key: 'coding', label: t('progress.phases.coding', 'Code'), widthPercent: 60 },
    { key: 'qa_review', label: t('progress.phases.qa', 'QA'), widthPercent: 15 },
    { key: 'complete', label: t('progress.phases.done', 'Done'), widthPercent: 5 },
  ];

  const getPhaseState = (phaseKey: ReasoningPhase): 'pending' | 'active' | 'complete' | 'failed' => {
    const phaseOrder: ReasoningPhase[] = ['initializing', 'planning', 'coding', 'qa_review', 'qa_fixing', 'complete'];
    const currentIndex = phaseOrder.indexOf(progress.phase);
    const phaseIndex = phaseOrder.indexOf(phaseKey);

    if (progress.phase === 'failed') return 'failed';
    if (progress.phase === 'complete') return 'complete';
    if (phaseKey === progress.phase || (phaseKey === 'qa_review' && progress.phase === 'qa_fixing')) {
      return 'active';
    }
    if (phaseIndex < currentIndex) return 'complete';
    return 'pending';
  };

  return (
    <div className="flex items-center gap-1 mt-1">
      {phases.map((phase, index) => {
        const state = getPhaseState(phase.key);
        return (
          <div key={phase.key} className="flex items-center">
            <motion.div
              className={cn(
                'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium',
                state === 'complete' && 'bg-success/10 text-success',
                state === 'active' && 'bg-primary/10 text-primary',
                state === 'failed' && 'bg-destructive/10 text-destructive',
                state === 'pending' && 'bg-muted text-muted-foreground'
              )}
              animate={
                state === 'active' && isRunning
                  ? { opacity: [1, 0.6, 1] }
                  : { opacity: 1 }
              }
              transition={
                state === 'active' && isRunning
                  ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
                  : undefined
              }
            >
              {state === 'complete' && (
                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {phase.label}
            </motion.div>
            {index < phases.length - 1 && (
              <div
                className={cn(
                  'w-2 h-px mx-0.5',
                  getPhaseState(phases[index + 1].key) !== 'pending' ? 'bg-success/50' : 'bg-border'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Stats summary bar showing decision and tool call counts
 */
function StatsBar({ stats }: { stats: { totalDecisions: number; toolCalls: number; elapsedMs: number } }) {
  const { t } = useTranslation('tasks');

  return (
    <div className="flex items-center gap-4 pt-2 border-t mt-2">
      <div className="flex items-center gap-1.5">
        <DecisionIcon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">
          {t('progress.stats.decisions', '{{count}} decisions', { count: stats.totalDecisions })}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <ToolIcon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground">
          {t('progress.stats.toolCalls', '{{count}} tool calls', { count: stats.toolCalls })}
        </span>
      </div>
    </div>
  );
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get phase background color for badge
 */
function getPhaseBackgroundColor(phase: ReasoningPhase): string {
  const colors: Record<ReasoningPhase, string> = {
    idle: 'bg-muted text-muted-foreground',
    initializing: 'bg-blue-500/10 text-blue-500',
    planning: 'bg-amber-500/10 text-amber-500',
    coding: 'bg-info/10 text-info',
    qa_review: 'bg-purple-500/10 text-purple-500',
    qa_fixing: 'bg-orange-500/10 text-orange-500',
    complete: 'bg-success/10 text-success',
    failed: 'bg-destructive/10 text-destructive',
  };
  return colors[phase] || colors.idle;
}

/**
 * Get phase background color class (solid)
 */
function getPhaseColorBg(phase: ReasoningPhase): string {
  const colors: Record<ReasoningPhase, string> = {
    idle: 'bg-muted-foreground',
    initializing: 'bg-blue-500',
    planning: 'bg-amber-500',
    coding: 'bg-info',
    qa_review: 'bg-purple-500',
    qa_fixing: 'bg-orange-500',
    complete: 'bg-success',
    failed: 'bg-destructive',
  };
  return colors[phase] || colors.idle;
}

/**
 * Format elapsed time in human-readable format
 */
function formatElapsedTime(ms: number): string {
  if (ms <= 0) return '';

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

// ============================================
// Icon Components
// ============================================

function ProgressIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
      />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function DecisionIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
      />
    </svg>
  );
}

function ToolIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
      />
    </svg>
  );
}

export default ProgressTracker;
