import { lazy, Suspense, Component, ReactNode } from 'react';
import { RefreshCw, AlertCircle, Network } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import type { DependencyGraph } from './DependencyGraphVisualization';

// Lazy-load the DependencyGraphVisualization component
// This delays loading D3 (~80KB) until the Dependencies tab is accessed
const DependencyGraphVisualization = lazy(
  () => import('./DependencyGraphVisualization').then((module) => ({
    default: module.DependencyGraphVisualization
  }))
);

// ============================================
// Error Boundary
// ============================================

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

class DependencyGraphErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('DependencyGraph rendering error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full p-6">
          <Card className="max-w-md">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 text-destructive">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">Graph Rendering Error</p>
                  <p className="text-sm opacity-80 mt-1">
                    {this.state.error?.message || 'Failed to render the dependency graph'}
                  </p>
                </div>
              </div>
              <Button onClick={this.handleReset} variant="outline" className="mt-4 w-full">
                Try Again
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================
// Loading Fallback
// ============================================

function LoadingFallback() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
      <p className="text-sm text-muted-foreground">Loading dependency graph...</p>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

interface DependencyGraphTabProps {
  dependencyGraph: DependencyGraph | null;
  graphLoading: boolean;
  graphError: string | null;
  onRefresh: () => void;
}

export function DependencyGraphTab({
  dependencyGraph,
  graphLoading,
  graphError,
  onRefresh
}: DependencyGraphTabProps) {
  // Show loading state while fetching data
  if (graphLoading && !dependencyGraph) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Analyzing project dependencies...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (graphError) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">Failed to Load Dependencies</p>
                <p className="text-sm opacity-80 mt-1">{graphError}</p>
              </div>
            </div>
            <Button onClick={onRefresh} variant="outline" className="mt-4 w-full">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show empty state
  if (!dependencyGraph) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <Network className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground">No Dependency Data</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          Click the button below to analyze your project's dependencies and generate a
          visualization.
        </p>
        <Button onClick={onRefresh} className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          Analyze Dependencies
        </Button>
      </div>
    );
  }

  // Render the lazy-loaded graph with Suspense and Error Boundary
  return (
    <DependencyGraphErrorBoundary onReset={onRefresh}>
      <Suspense fallback={<LoadingFallback />}>
        <DependencyGraphVisualization
          data={dependencyGraph}
          isLoading={graphLoading}
          error={graphError}
          onReset={onRefresh}
        />
      </Suspense>
    </DependencyGraphErrorBoundary>
  );
}
