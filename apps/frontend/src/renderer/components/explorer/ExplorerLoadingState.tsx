import {
  Network,
  Loader2,
  CheckCircle2,
  Circle,
  FolderSearch,
  FileCode2,
  GitGraph,
  Database,
  XCircle,
  RefreshCw
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Progress } from '../ui/progress';
import type { ExplorerLoadingStatus, ExplorerLoadingPhase } from '../../../shared/types/explorer';
import { cn } from '../../lib/utils';

/**
 * Props for the ExplorerLoadingState component
 */
export interface ExplorerLoadingStateProps {
  /** Current loading status from the explorer store */
  status: ExplorerLoadingStatus;
  /** Optional callback to cancel the loading operation */
  onCancel?: () => void;
  /** Custom class name */
  className?: string;
}

/**
 * Phase metadata for display
 */
interface PhaseInfo {
  label: string;
  description: string;
  icon: React.ElementType;
}

const PHASE_INFO: Record<ExplorerLoadingPhase, PhaseInfo> = {
  idle: {
    label: 'Preparing',
    description: 'Getting ready to parse your codebase...',
    icon: Circle
  },
  'loading-cache': {
    label: 'Checking Cache',
    description: 'Looking for existing graph data...',
    icon: Database
  },
  'scanning-files': {
    label: 'Scanning Files',
    description: 'Discovering source files in your project...',
    icon: FolderSearch
  },
  parsing: {
    label: 'Parsing Code',
    description: 'Analyzing source files with Tree-sitter...',
    icon: FileCode2
  },
  'building-graph': {
    label: 'Building Graph',
    description: 'Creating the dependency graph...',
    icon: GitGraph
  },
  complete: {
    label: 'Complete',
    description: 'Graph is ready!',
    icon: CheckCircle2
  },
  error: {
    label: 'Error',
    description: 'Something went wrong',
    icon: XCircle
  }
};

/**
 * Ordered phases for the step indicator
 */
const PHASE_ORDER: ExplorerLoadingPhase[] = [
  'loading-cache',
  'scanning-files',
  'parsing',
  'building-graph',
  'complete'
];

/**
 * ExplorerLoadingState - Loading indicator with parsing progress
 *
 * Shows a visual progress indicator while the codebase is being parsed.
 * Displays current phase, progress bar, file counts, and step indicators.
 */
export function ExplorerLoadingState({
  status,
  onCancel,
  className
}: ExplorerLoadingStateProps) {
  const phaseInfo = PHASE_INFO[status.phase] || PHASE_INFO.idle;
  const PhaseIcon = phaseInfo.icon;
  const currentPhaseIndex = PHASE_ORDER.indexOf(status.phase);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Network className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Codebase Explorer</h2>
            <p className="text-sm text-muted-foreground">
              Visualize and understand your codebase
            </p>
          </div>
        </div>
        {onCancel && status.phase !== 'complete' && status.phase !== 'error' && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {/* Loading Content */}
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="flex flex-col items-center gap-6 max-w-md w-full">
          {/* Animated Icon */}
          <div className="relative">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
              {status.phase === 'error' ? (
                <XCircle className="h-12 w-12 text-destructive" />
              ) : status.phase === 'complete' ? (
                <CheckCircle2 className="h-12 w-12 text-green-500" />
              ) : (
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              )}
            </div>
            {/* Phase icon badge */}
            {status.phase !== 'complete' && status.phase !== 'error' && (
              <div className="absolute -right-1 -bottom-1 flex h-8 w-8 items-center justify-center rounded-full bg-background border border-border shadow-sm">
                <PhaseIcon className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* Phase Title and Message */}
          <div className="text-center">
            <h3 className="text-xl font-semibold text-foreground">
              {phaseInfo.label}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {status.message || phaseInfo.description}
            </p>
          </div>

          {/* Current File (during parsing phase) */}
          {status.currentFile && status.phase === 'parsing' && (
            <div className="w-full rounded-lg bg-muted/50 px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileCode2 className="h-3 w-3 flex-shrink-0" />
                <span className="truncate font-mono">{status.currentFile}</span>
              </div>
            </div>
          )}

          {/* Progress Bar */}
          {status.phase !== 'error' && (
            <div className="w-full space-y-2">
              <Progress value={status.progress} className="h-2" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{Math.round(status.progress)}% complete</span>
                {status.totalFiles !== undefined && status.filesParsed !== undefined && (
                  <span>
                    {status.filesParsed} / {status.totalFiles} files
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Step Indicators */}
          <div className="w-full">
            <StepIndicator
              phases={PHASE_ORDER.slice(0, -1)} // Exclude 'complete' from steps
              currentPhase={status.phase}
              currentPhaseIndex={currentPhaseIndex}
            />
          </div>

          {/* Error retry button */}
          {status.phase === 'error' && status.error && (
            <Card className="w-full border-destructive/50 bg-destructive/5">
              <CardContent className="p-4 text-center">
                <p className="text-sm text-destructive mb-3">{status.error}</p>
                {onCancel && (
                  <Button variant="outline" size="sm" onClick={onCancel}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Try Again
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Step indicator showing progress through phases
 */
interface StepIndicatorProps {
  phases: ExplorerLoadingPhase[];
  currentPhase: ExplorerLoadingPhase;
  currentPhaseIndex: number;
}

function StepIndicator({ phases, currentPhase, currentPhaseIndex }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-between">
      {phases.map((phase, index) => {
        const phaseInfo = PHASE_INFO[phase];
        const PhaseIcon = phaseInfo.icon;
        const isComplete = currentPhase === 'complete' || currentPhaseIndex > index;
        const isCurrent = phase === currentPhase;
        const isError = currentPhase === 'error' && isCurrent;

        return (
          <div key={phase} className="flex items-center">
            {/* Step Circle */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors',
                  isError
                    ? 'border-destructive bg-destructive/10'
                    : isComplete
                      ? 'border-green-500 bg-green-500/10'
                      : isCurrent
                        ? 'border-primary bg-primary/10'
                        : 'border-muted-foreground/30 bg-muted'
                )}
              >
                {isComplete && !isError ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : isError ? (
                  <XCircle className="h-4 w-4 text-destructive" />
                ) : isCurrent ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <PhaseIcon className="h-4 w-4 text-muted-foreground/50" />
                )}
              </div>
              <span
                className={cn(
                  'mt-1 text-xs',
                  isComplete || isCurrent ? 'text-foreground' : 'text-muted-foreground/50'
                )}
              >
                {phaseInfo.label.split(' ')[0]}
              </span>
            </div>

            {/* Connector Line */}
            {index < phases.length - 1 && (
              <div
                className={cn(
                  'h-0.5 w-8 sm:w-12 mx-1',
                  currentPhaseIndex > index ? 'bg-green-500' : 'bg-muted-foreground/30'
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
 * Compact loading state for overlay use
 */
export interface ExplorerLoadingStateCompactProps {
  status: ExplorerLoadingStatus;
  className?: string;
}

export function ExplorerLoadingStateCompact({
  status,
  className
}: ExplorerLoadingStateCompactProps) {
  return (
    <div className={cn('flex items-center gap-3 rounded-lg bg-card px-4 py-3 shadow-lg', className)}>
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {PHASE_INFO[status.phase]?.label || 'Loading...'}
        </p>
        {status.totalFiles !== undefined && status.filesParsed !== undefined && (
          <p className="text-xs text-muted-foreground">
            {status.filesParsed} / {status.totalFiles} files · {Math.round(status.progress)}%
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Inline loading indicator for minimal contexts
 */
export interface ExplorerLoadingStateInlineProps {
  message?: string;
  className?: string;
}

export function ExplorerLoadingStateInline({
  message = 'Loading...',
  className
}: ExplorerLoadingStateInlineProps) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-8', className)}>
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <span className="text-sm text-muted-foreground">{message}</span>
    </div>
  );
}
