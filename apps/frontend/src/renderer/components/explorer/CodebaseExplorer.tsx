import { useState, useCallback } from 'react';
import {
  Network,
  Loader2,
  RefreshCw,
  AlertCircle,
  FolderTree,
  GitBranch,
  PanelRightClose,
  PanelRight,
  Search,
  X
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { DependencyGraph } from './DependencyGraph';
import { DepthSlider, DepthSliderCompact } from './DepthSlider';
import { InfoPanel } from './InfoPanel';
import { GraphLegend, GraphLegendInline } from './GraphLegend';
import { ExplorerLoadingState, ExplorerLoadingStateCompact } from './ExplorerLoadingState';
import { useExplorer } from './hooks/useExplorer';
import type { DepthLevel, GraphNode } from '../../../shared/types/explorer';

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
  const {
    // Graph data
    graph,
    graphError,
    filteredNodes,
    graphStats,
    hasGraph,
    isFilteredEmpty,

    // Selection state
    selectedNodeId,
    selectedNodeInfo,
    isInfoPanelOpen,

    // Depth and filtering
    depthLevel,
    searchQuery,

    // Loading state
    isLoading,
    loadingStatus,

    // UI state
    showLegend,

    // Actions
    loadGraph,
    refreshGraph,
    selectNode,
    handleNodeClick,
    handleEdgeClick,
    handleDepthChange,
    closeInfoPanel,
    setSearchQuery
  } = useExplorer(projectId);

  // Local UI state
  const [showSearch, setShowSearch] = useState(false);

  // Handle node hover (optional callback)
  const handleNodeHover = useCallback((_node: GraphNode | null) => {
    // Could update UI state here if needed
  }, []);

  // Loading state
  if (isLoading && !hasGraph) {
    return <ExplorerLoadingState status={loadingStatus} />;
  }

  // Error state
  if (graphError && !hasGraph) {
    return (
      <ExplorerErrorState
        error={graphError}
        onRetry={() => loadGraph()}
      />
    );
  }

  // Empty state - no graph data yet
  if (!hasGraph) {
    return <ExplorerEmptyState projectId={projectId} onParse={() => loadGraph()} />;
  }

  // Main explorer view with graph
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
              {graphStats
                ? `${graphStats.visibleNodes} nodes · ${graphStats.visibleEdges} edges`
                : 'Visualize and understand your codebase'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShowSearch(!showSearch)}
              >
                <Search className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search nodes</TooltipContent>
          </Tooltip>

          {/* Depth slider compact */}
          <DepthSliderCompact
            depthLevel={depthLevel}
            onChange={handleDepthChange}
            disabled={isLoading}
            className="hidden md:flex"
          />

          {/* Refresh button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshGraph()}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>
            </TooltipTrigger>
            <TooltipContent>Re-parse codebase</TooltipContent>
          </Tooltip>

          {/* Info Panel Toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (isInfoPanelOpen) {
                    closeInfoPanel();
                  } else if (selectedNodeId) {
                    // Re-open panel if node is selected
                    selectNode(selectedNodeId);
                  }
                }}
                disabled={!selectedNodeId}
              >
                {isInfoPanelOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRight className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isInfoPanelOpen ? 'Hide info panel' : 'Show info panel'}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Search bar (collapsible) */}
      {showSearch && (
        <div className="flex items-center gap-2 border-b border-border px-6 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search nodes by name or path..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 h-8 border-0 bg-transparent focus-visible:ring-0"
            autoFocus
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setSearchQuery('')}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {filteredNodes.length} results
          </span>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Graph Container */}
        <div className="relative flex-1 flex flex-col">
          {/* Filtered empty state */}
          {isFilteredEmpty ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <Search className="mx-auto h-12 w-12 text-muted-foreground/50" />
                <h3 className="mt-4 text-lg font-medium">No nodes match your filters</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Try adjusting the depth level or search query
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setSearchQuery('');
                    handleDepthChange(3 as DepthLevel);
                  }}
                >
                  Reset Filters
                </Button>
              </div>
            </div>
          ) : (
            <DependencyGraph
              graph={graph}
              depthLevel={depthLevel}
              selectedNodeId={selectedNodeId}
              onSelectNode={(node) => {
                if (node) {
                  handleNodeClick(node);
                } else {
                  selectNode(null);
                }
              }}
              onHoverNode={handleNodeHover}
              className="flex-1"
            />
          )}

          {/* Legend (bottom left) */}
          {showLegend && !isFilteredEmpty && (
            <GraphLegend
              showNodeTypes
              className="absolute bottom-4 left-4 w-48 z-10"
            />
          )}

          {/* Stats overlay (bottom center) - on mobile */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 md:hidden">
            <GraphLegendInline />
          </div>

          {/* Depth slider (mobile - bottom) */}
          <div className="md:hidden p-4 border-t border-border bg-background">
            <DepthSlider
              depthLevel={depthLevel}
              onChange={handleDepthChange}
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Info Panel (right side) */}
        {isInfoPanelOpen && selectedNodeInfo && (
          <div className="border-l border-border">
            <InfoPanel
              selectedNodeInfo={selectedNodeInfo}
              onClose={closeInfoPanel}
              onNodeClick={handleEdgeClick}
            />
          </div>
        )}
      </div>

      {/* Loading overlay */}
      {isLoading && hasGraph && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
          <ExplorerLoadingStateCompact status={loadingStatus} />
        </div>
      )}
    </div>
  );
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
