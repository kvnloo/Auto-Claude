import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';

interface TimeEstimateProps {
  estimatedDurationMinutes?: number;
  confidenceMin?: number;
  confidenceMax?: number;
  className?: string;
  variant?: 'default' | 'compact';
}

/**
 * TimeEstimate component displays time estimates with confidence ranges.
 * Shows estimated completion time in a user-friendly format (e.g., '15-30 minutes').
 */
export function TimeEstimate({
  estimatedDurationMinutes,
  confidenceMin,
  confidenceMax,
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
    );
  }

  // Default variant: more prominent display
  return (
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
  );
}
