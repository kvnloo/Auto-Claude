import { useState, useEffect } from 'react';
import {
  Network,
  Loader2,
  RefreshCw,
  AlertCircle,
  FolderTree,
  GitBranch
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { cn } from '../../lib/utils';
import type { ExplorerLoadingStatus } from '../../../shared/types/explorer';

interface CodebaseExplorerProps {
  projectId: string;
}

/**
 * CodebaseExplorer - Educational visualization for understanding codebases
 *
 * This component provides an interactive dependency graph view that helps
 * developers rapidly understand unfamiliar codebases through visualization
 * and progressive disclosure of code relationships.
 */
export function CodebaseExplorer({ projectId }: CodebaseExplorerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState<ExplorerLoadingStatus>({
    phase: 'idle',
    progress: 0,
    message: 'Initializing...'
  });
  const [error, setError] = useState<string | null>(null);

  // Simulate initial load - will be replaced with actual graph loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
      setLoadingStatus({
        phase: 'complete',
        progress: 100,
        message: 'Ready'
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [projectId]);

  // Loading state
  if (isLoading) {
    return <ExplorerLoadingState status={loadingStatus} />;
  }

  // Error state
  if (error) {
    return (
      <ExplorerErrorState
        error={error}
        onRetry={() => {
          setError(null);
          setIsLoading(true);
        }}
      />
    );
  }

  // Empty state - no graph data yet
  return <ExplorerEmptyState projectId={projectId} onParse={() => setIsLoading(true)} />;
}

/**
 * Loading state component shown while parsing codebase
 */
interface ExplorerLoadingStateProps {
  status: ExplorerLoadingStatus;
}

function ExplorerLoadingState({ status }: ExplorerLoadingStateProps) {
  return (
    <div className="flex h-full flex-col">
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
      </div>

      {/* Loading Content */}
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          </div>
          <div className="text-center">
            <h3 className="text-lg font-medium text-foreground">
              {getPhaseTitle(status.phase)}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {status.message}
            </p>
            {status.totalFiles && status.filesParsed !== undefined && (
              <p className="mt-2 text-xs text-muted-foreground">
                {status.filesParsed} / {status.totalFiles} files
              </p>
            )}
          </div>
          {/* Progress bar */}
          <div className="w-64">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${status.progress}%` }}
              />
            </div>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              {status.progress}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Get a user-friendly title for each loading phase
 */
function getPhaseTitle(phase: ExplorerLoadingStatus['phase']): string {
  switch (phase) {
    case 'idle':
      return 'Preparing...';
    case 'loading-cache':
      return 'Loading cached data...';
    case 'scanning-files':
      return 'Scanning files...';
    case 'parsing':
      return 'Parsing codebase...';
    case 'building-graph':
      return 'Building dependency graph...';
    case 'complete':
      return 'Complete';
    case 'error':
      return 'Error';
    default:
      return 'Loading...';
  }
}

/**
 * Error state component
 */
interface ExplorerErrorStateProps {
  error: string;
  onRetry: () => void;
}

function ExplorerErrorState({ error, onRetry }: ExplorerErrorStateProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
            <Network className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">Codebase Explorer</h2>
            <p className="text-sm text-muted-foreground">
              Visualize and understand your codebase
            </p>
          </div>
        </div>
      </div>

      {/* Error Content */}
      <div className="flex flex-1 flex-col items-center justify-center">
        <Card className="max-w-md border-destructive/50 bg-destructive/5">
          <CardContent className="flex flex-col items-center p-6 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-foreground">
              Failed to load graph
            </h3>
            <p className="mb-4 text-sm text-muted-foreground">{error}</p>
            <Button onClick={onRetry} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Empty state component shown when no graph has been generated
 */
interface ExplorerEmptyStateProps {
  projectId: string;
  onParse: () => void;
}

function ExplorerEmptyState({ projectId, onParse }: ExplorerEmptyStateProps) {
  return (
    <div className="flex h-full flex-col">
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
        <Button onClick={onParse}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Parse Codebase
        </Button>
      </div>

      {/* Empty State Content */}
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
          <FolderTree className="h-10 w-10 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-xl font-semibold text-foreground">
          Explore Your Codebase
        </h3>
        <p className="mb-6 max-w-md text-muted-foreground">
          Generate an interactive dependency graph to visualize how your code is
          structured. Understand relationships between files, classes, and functions.
        </p>

        {/* Feature highlights */}
        <div className="mb-8 grid max-w-lg grid-cols-2 gap-4">
          <FeatureCard
            icon={GitBranch}
            title="Dependency Graph"
            description="See how files and modules connect"
          />
          <FeatureCard
            icon={Network}
            title="5 Depth Levels"
            description="From directories to individual symbols"
          />
        </div>

        <Button onClick={onParse} size="lg">
          <Network className="mr-2 h-5 w-5" />
          Generate Graph
        </Button>

        <p className="mt-4 text-xs text-muted-foreground">
          Supports Python, TypeScript, and JavaScript
        </p>
      </div>
    </div>
  );
}

/**
 * Feature highlight card for empty state
 */
interface FeatureCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
}

function FeatureCard({ icon: Icon, title, description }: FeatureCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-left">
      <Icon className="mb-2 h-5 w-5 text-primary" />
      <h4 className="font-medium text-foreground">{title}</h4>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
