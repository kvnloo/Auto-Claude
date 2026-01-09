import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';

interface TimeEstimateProps {
  estimatedDurationMinutes?: number;
  confidenceMin?: number;
  confidenceMax?: number;
  accuracyPercentage?: number;  // Historical estimate accuracy (0-100)
  className?: string;
  variant?: 'default' | 'compact';
}

/**
 * Get emoji indicator for accuracy level.
 * Matches backend AccuracyReporter logic.
 */
function getAccuracyEmoji(accuracy: number): string {
  if (accuracy >= 90) return '🎯'; // Bullseye - excellent
  if (accuracy >= 80) return '✨'; // Sparkles - very good
  if (accuracy >= 70) return '👍'; // Thumbs up - good
  if (accuracy >= 60) return '📊'; // Chart - fair
  return '📈'; // Trending up - needs improvement
}

/**
 * Get reliability level text for accuracy.
 * Matches backend AccuracyReporter logic.
 */
function getReliabilityLevel(accuracy: number): string {
  if (accuracy >= 90) return 'excellent';
  if (accuracy >= 80) return 'very good';
  if (accuracy >= 70) return 'good';
  if (accuracy >= 60) return 'fair';
  return 'needs improvement';
}

/**
 * Get badge variant based on accuracy level.
 */
function getAccuracyBadgeVariant(accuracy: number): 'success' | 'info' | 'warning' | 'muted' {
  if (accuracy >= 80) return 'success';
  if (accuracy >= 70) return 'info';
  if (accuracy >= 60) return 'warning';
  return 'muted';
}

/**
 * TimeEstimate component displays time estimates with confidence ranges.
 * Shows estimated completion time in a user-friendly format (e.g., '15-30 minutes').
 */
export function TimeEstimate({
  estimatedDurationMinutes,
  confidenceMin,
  confidenceMax,
  accuracyPercentage,
  className,
  variant = 'default'
}: TimeEstimateProps) {
  const { t } = useTranslation(['tasks']);

  // Format minutes into a readable time string
  const formatTime = (minutes: number): string => {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (mins === 0) {
      return `${hours}h`;
    }
    return `${hours}h ${mins}m`;
  };

  // Determine if we have time estimate data
  const hasEstimate = estimatedDurationMinutes !== undefined ||
                      (confidenceMin !== undefined && confidenceMax !== undefined);

  if (!hasEstimate) {
    return null;
  }

  // Build the display text
  let displayText: string;
  let tooltipText: string;

  if (confidenceMin !== undefined && confidenceMax !== undefined) {
    // Show confidence range
    displayText = `${formatTime(confidenceMin)} - ${formatTime(confidenceMax)}`;
    tooltipText = `Estimated time range: ${formatTime(confidenceMin)} to ${formatTime(confidenceMax)}`;
  } else if (estimatedDurationMinutes !== undefined) {
    // Show single estimate
    displayText = formatTime(estimatedDurationMinutes);
    tooltipText = `Estimated duration: ${formatTime(estimatedDurationMinutes)}`;
  } else {
    return null;
  }

  if (variant === 'compact') {
    return (
      <div className="inline-flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="secondary"
              className={cn('text-xs cursor-help', className)}
            >
              <Clock className="h-3 w-3 mr-1" />
              {displayText}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">{tooltipText}</p>
          </TooltipContent>
        </Tooltip>

        {/* Accuracy indicator */}
        {accuracyPercentage !== undefined && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant={getAccuracyBadgeVariant(accuracyPercentage)}
                className="text-xs cursor-help"
              >
                <span className="mr-1">{getAccuracyEmoji(accuracyPercentage)}</span>
                {Math.round(accuracyPercentage)}%
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">
                Historical accuracy: {getReliabilityLevel(accuracyPercentage)}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  }

  // Default variant: more prominent display
  return (
    <div className="inline-flex items-center gap-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'inline-flex items-center gap-2 text-sm text-muted-foreground cursor-help',
              className
            )}
          >
            <Clock className="h-4 w-4 text-info" />
            <span>{displayText}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{tooltipText}</p>
        </TooltipContent>
      </Tooltip>

      {/* Accuracy indicator */}
      {accuracyPercentage !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant={getAccuracyBadgeVariant(accuracyPercentage)}
              className="text-xs cursor-help"
            >
              <span className="mr-1">{getAccuracyEmoji(accuracyPercentage)}</span>
              {Math.round(accuracyPercentage)}%
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">
              Historical accuracy: {getReliabilityLevel(accuracyPercentage)}
            </p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
