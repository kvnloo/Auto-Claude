import React, { Component, ErrorInfo, ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

interface DashboardErrorBoundaryProps {
  /** Child components to render */
  children: ReactNode;
  /** Optional CSS class name */
  className?: string;
  /** Optional fallback UI to show on error */
  fallback?: ReactNode;
  /** Optional callback when error occurs */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Optional reset key - when this changes, error state is reset */
  resetKey?: string | number;
}

interface DashboardErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error boundary component for dashboard components.
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs them, and displays a fallback UI instead of crashing the whole app.
 *
 * Features:
 * - Graceful error display with retry option
 * - Error details (collapsible in development)
 * - Auto-reset when resetKey prop changes
 * - Optional custom fallback UI
 */
export class DashboardErrorBoundary extends Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  constructor(props: DashboardErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<DashboardErrorBoundaryState> {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error details
    this.setState({ errorInfo });

    // Call optional error callback
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  componentDidUpdate(prevProps: DashboardErrorBoundaryProps): void {
    // Reset error state when resetKey changes
    if (this.props.resetKey !== prevProps.resetKey && this.state.hasError) {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
      });
    }
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const { children, className, fallback } = this.props;

    if (hasError) {
      // If custom fallback provided, use it
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <div className={cn('flex h-full flex-col', className)}>
          <ErrorFallbackUI
            error={error}
            errorInfo={errorInfo}
            onRetry={this.handleRetry}
          />
        </div>
      );
    }

    return children;
  }
}

/**
 * Default error fallback UI component
 */
function ErrorFallbackUI({
  error,
  errorInfo,
  onRetry,
}: {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  onRetry: () => void;
}) {
  const [showDetails, setShowDetails] = React.useState(false);
  const isDevelopment = process.env.NODE_ENV !== 'production';

  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center gap-4 p-8"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Error icon */}
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

      {/* Error message */}
      <div className="text-center max-w-md">
        <h3 className="text-lg font-medium text-foreground">
          Something went wrong
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          An error occurred while rendering this component. Please try again.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <motion.button
          onClick={onRetry}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'transition-colors duration-150'
          )}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <RefreshIcon className="h-4 w-4" />
          Try Again
        </motion.button>

        {isDevelopment && error && (
          <motion.button
            onClick={() => setShowDetails(!showDetails)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
              'border border-border bg-background hover:bg-muted',
              'transition-colors duration-150'
            )}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <InfoIcon className="h-4 w-4" />
            {showDetails ? 'Hide Details' : 'Show Details'}
          </motion.button>
        )}
      </div>

      {/* Error details (development only) */}
      {isDevelopment && showDetails && error && (
        <motion.div
          className="mt-4 w-full max-w-2xl rounded-lg border bg-card p-4"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.2 }}
        >
          <div className="space-y-3">
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Error Message
              </h4>
              <p className="mt-1 text-sm font-mono text-destructive">
                {error.message}
              </p>
            </div>

            {errorInfo?.componentStack && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Component Stack
                </h4>
                <pre className="mt-1 text-xs font-mono text-muted-foreground overflow-x-auto max-h-40 overflow-y-auto rounded bg-muted p-2">
                  {errorInfo.componentStack}
                </pre>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

/**
 * Refresh icon component
 */
function RefreshIcon({ className }: { className?: string }) {
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
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

/**
 * Info icon component
 */
function InfoIcon({ className }: { className?: string }) {
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
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

export default DashboardErrorBoundary;
