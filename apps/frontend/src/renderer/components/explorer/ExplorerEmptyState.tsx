import {
  FolderTree,
  Network,
  GitBranch,
  FileWarning,
  FolderSearch,
  FileCode2,
  Code2,
  RefreshCw
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

/**
 * Props for the initial empty state (no graph generated yet)
 */
interface InitialEmptyStateProps {
  onParse: () => void;
}

/**
 * Props for the empty repo state (graph generated but no parseable files)
 */
interface EmptyRepoStateProps {
  totalFilesScanned?: number;
  onRetry: () => void;
}

/**
 * Props for the ExplorerEmptyState component
 * Uses discriminated union to handle different empty state scenarios
 */
export type ExplorerEmptyStateProps =
  | ({ variant: 'initial'; projectId?: string } & InitialEmptyStateProps)
  | ({ variant: 'no-parseable-files' } & EmptyRepoStateProps);

/**
 * ExplorerEmptyState - Displays appropriate empty state based on scenario
 *
 * Variants:
 * - 'initial': No graph has been generated yet, prompt user to parse
 * - 'no-parseable-files': Graph was generated but no parseable files found
 */
export function ExplorerEmptyState(props: ExplorerEmptyStateProps) {
  if (props.variant === 'no-parseable-files') {
    return <NoParseableFilesState {...props} />;
  }

  return <InitialEmptyState onParse={props.onParse} />;
}

/**
 * Initial empty state - shown when no graph has been generated yet
 */
function InitialEmptyState({ onParse }: InitialEmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-4">
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
  );
}

/**
 * Empty state for repos with no parseable files
 * Shown when the graph was generated but no Python/TypeScript/JavaScript files were found
 */
function NoParseableFilesState({ totalFilesScanned, onRetry }: EmptyRepoStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-4">
      <Card className="max-w-lg border-warning/50 bg-warning/5">
        <CardContent className="flex flex-col items-center p-8">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
            <FileWarning className="h-8 w-8 text-warning" />
          </div>
          <h3 className="mb-2 text-xl font-semibold text-foreground">
            No Parseable Files Found
          </h3>
          <p className="mb-4 text-muted-foreground">
            This repository doesn't appear to contain any Python, TypeScript, or JavaScript
            files that can be visualized.
            {totalFilesScanned !== undefined && totalFilesScanned > 0 && (
              <span className="block mt-2 text-sm">
                Scanned {totalFilesScanned} file{totalFilesScanned !== 1 ? 's' : ''} in total.
              </span>
            )}
          </p>

          {/* Supported languages info */}
          <div className="mb-6 w-full rounded-lg bg-muted/50 p-4">
            <h4 className="mb-3 flex items-center justify-center gap-2 text-sm font-medium text-foreground">
              <Code2 className="h-4 w-4" />
              Supported File Types
            </h4>
            <div className="flex flex-wrap justify-center gap-2">
              <LanguageBadge extension=".py" language="Python" />
              <LanguageBadge extension=".ts" language="TypeScript" />
              <LanguageBadge extension=".tsx" language="React TSX" />
              <LanguageBadge extension=".js" language="JavaScript" />
              <LanguageBadge extension=".jsx" language="React JSX" />
            </div>
          </div>

          {/* Suggestions */}
          <div className="mb-6 w-full text-left text-sm text-muted-foreground">
            <h4 className="mb-2 font-medium text-foreground">Suggestions:</h4>
            <ul className="space-y-1">
              <li className="flex items-start gap-2">
                <FolderSearch className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span>Ensure the project root contains source code files</span>
              </li>
              <li className="flex items-start gap-2">
                <FileCode2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span>Check that files aren't in an ignored directory (e.g., node_modules)</span>
              </li>
            </ul>
          </div>

          <Button onClick={onRetry} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Feature highlight card for initial empty state
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

/**
 * Language badge for supported file types
 */
interface LanguageBadgeProps {
  extension: string;
  language: string;
}

function LanguageBadge({ extension, language }: LanguageBadgeProps) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full bg-background px-3 py-1.5 text-xs border border-border"
      title={language}
    >
      <FileCode2 className="h-3 w-3 text-muted-foreground" />
      <span className="font-mono text-foreground">{extension}</span>
    </div>
  );
}

/**
 * Simpler version of empty state for inline use (e.g., in filtered results)
 */
export interface ExplorerEmptyStateInlineProps {
  title: string;
  description: string;
  icon?: React.ElementType;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function ExplorerEmptyStateInline({
  title,
  description,
  icon: Icon = FolderTree,
  action
}: ExplorerEmptyStateInlineProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="mb-4 h-12 w-12 text-muted-foreground/50" />
      <h3 className="mb-2 text-lg font-medium text-foreground">{title}</h3>
      <p className="mb-4 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && (
        <Button variant="outline" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
