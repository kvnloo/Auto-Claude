import { memo, useCallback } from 'react';
import {
  Folder,
  FileCode2,
  Boxes,
  FunctionSquare,
  Hash
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '../ui/tooltip';
import { cn } from '../../lib/utils';
import type { DepthLevel, NodeType } from '../../../shared/types/explorer';

// ============================================
// Types
// ============================================

interface DepthSliderProps {
  /** Current depth level (1-5) */
  depthLevel: DepthLevel;
  /** Callback when depth level changes */
  onChange: (level: DepthLevel) => void;
  /** Whether the slider is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

interface DepthLevelInfo {
  level: DepthLevel;
  label: string;
  description: string;
  icon: typeof Folder;
  nodeTypes: NodeType[];
}

// ============================================
// Constants
// ============================================

/**
 * Information about each depth level
 */
const DEPTH_LEVELS: DepthLevelInfo[] = [
  {
    level: 1,
    label: 'Directories',
    description: 'Show only directories',
    icon: Folder,
    nodeTypes: ['directory']
  },
  {
    level: 2,
    label: 'Files',
    description: 'Show directories and files',
    icon: FileCode2,
    nodeTypes: ['directory', 'file']
  },
  {
    level: 3,
    label: 'Classes',
    description: 'Show directories, files, and classes',
    icon: Boxes,
    nodeTypes: ['directory', 'file', 'class']
  },
  {
    level: 4,
    label: 'Functions',
    description: 'Show directories, files, classes, and functions',
    icon: FunctionSquare,
    nodeTypes: ['directory', 'file', 'class', 'function']
  },
  {
    level: 5,
    label: 'All Symbols',
    description: 'Show all symbols including variables and constants',
    icon: Hash,
    nodeTypes: ['directory', 'file', 'class', 'function', 'symbol']
  }
];

/**
 * Get information about a specific depth level
 */
function getDepthLevelInfo(level: DepthLevel): DepthLevelInfo {
  return DEPTH_LEVELS[level - 1];
}

// ============================================
// Sub-Components
// ============================================

/**
 * Individual depth level button/indicator
 */
interface DepthLevelButtonProps {
  info: DepthLevelInfo;
  isActive: boolean;
  isReached: boolean;
  onClick: () => void;
  disabled?: boolean;
}

const DepthLevelButton = memo(function DepthLevelButton({
  info,
  isActive,
  isReached,
  onClick,
  disabled
}: DepthLevelButtonProps) {
  const Icon = info.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            'flex flex-col items-center gap-1 p-2 rounded-lg transition-all',
            'hover:bg-accent hover:text-accent-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent',
            isActive && 'bg-primary text-primary-foreground',
            !isActive && isReached && 'text-foreground',
            !isActive && !isReached && 'text-muted-foreground'
          )}
          aria-label={`Set depth level to ${info.level}: ${info.label}`}
          aria-pressed={isActive}
        >
          <Icon
            className={cn(
              'h-4 w-4 transition-transform',
              isActive && 'scale-110'
            )}
          />
          <span className="text-[10px] font-medium">{info.level}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px]">
        <div className="font-medium">{info.label}</div>
        <div className="text-xs text-muted-foreground">{info.description}</div>
      </TooltipContent>
    </Tooltip>
  );
});

// ============================================
// Main Component
// ============================================

/**
 * DepthSlider - Controls graph granularity with 5 depth levels
 *
 * Levels:
 * 1 = Directories only
 * 2 = Directories + Files
 * 3 = + Classes
 * 4 = + Functions
 * 5 = All symbols (variables, constants, etc.)
 */
export function DepthSlider({
  depthLevel,
  onChange,
  disabled = false,
  className
}: DepthSliderProps) {
  const currentLevelInfo = getDepthLevelInfo(depthLevel);

  // Handle slider change
  const handleSliderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newLevel = parseInt(event.target.value, 10) as DepthLevel;
      onChange(newLevel);
    },
    [onChange]
  );

  // Handle direct level click
  const handleLevelClick = useCallback(
    (level: DepthLevel) => {
      if (!disabled) {
        onChange(level);
      }
    },
    [onChange, disabled]
  );

  return (
    <div
      className={cn(
        'flex flex-col gap-3 p-4 bg-background/50 border border-border rounded-lg',
        className
      )}
      role="group"
      aria-label="Graph depth level control"
    >
      {/* Header with current level info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Depth Level</span>
          <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-medium rounded-full">
            {depthLevel} / 5
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {currentLevelInfo.label}
        </div>
      </div>

      {/* Slider track */}
      <div className="relative">
        {/* Background track */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 bg-muted rounded-full" />

        {/* Filled track */}
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-2 bg-primary rounded-full transition-all duration-150"
          style={{ width: `${((depthLevel - 1) / 4) * 100}%` }}
        />

        {/* Step markers */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-0.5">
          {DEPTH_LEVELS.map((info) => (
            <div
              key={info.level}
              className={cn(
                'w-3 h-3 rounded-full border-2 transition-all',
                info.level <= depthLevel
                  ? 'bg-primary border-primary'
                  : 'bg-muted border-muted-foreground/30'
              )}
            />
          ))}
        </div>

        {/* Native range input (invisible but functional) */}
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={depthLevel}
          onChange={handleSliderChange}
          disabled={disabled}
          className={cn(
            'absolute inset-0 w-full h-6 opacity-0 cursor-pointer',
            'disabled:cursor-not-allowed'
          )}
          aria-label="Depth level slider"
          aria-valuemin={1}
          aria-valuemax={5}
          aria-valuenow={depthLevel}
          aria-valuetext={currentLevelInfo.label}
        />
      </div>

      {/* Level buttons */}
      <div className="flex justify-between">
        {DEPTH_LEVELS.map((info) => (
          <DepthLevelButton
            key={info.level}
            info={info}
            isActive={info.level === depthLevel}
            isReached={info.level <= depthLevel}
            onClick={() => handleLevelClick(info.level)}
            disabled={disabled}
          />
        ))}
      </div>

      {/* Description */}
      <div className="text-xs text-muted-foreground text-center">
        {currentLevelInfo.description}
      </div>
    </div>
  );
}

/**
 * Compact version of the depth slider for use in toolbars
 */
export function DepthSliderCompact({
  depthLevel,
  onChange,
  disabled = false,
  className
}: DepthSliderProps) {
  const currentLevelInfo = getDepthLevelInfo(depthLevel);

  const handleSliderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newLevel = parseInt(event.target.value, 10) as DepthLevel;
      onChange(newLevel);
    },
    [onChange]
  );

  return (
    <div
      className={cn('flex items-center gap-3', className)}
      role="group"
      aria-label="Graph depth level control"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <currentLevelInfo.icon className="h-4 w-4" />
            <span className="font-medium">{depthLevel}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <div className="font-medium">{currentLevelInfo.label}</div>
          <div className="text-xs text-muted-foreground">
            {currentLevelInfo.description}
          </div>
        </TooltipContent>
      </Tooltip>

      <div className="relative flex-1 min-w-[120px]">
        {/* Background track */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 bg-muted rounded-full" />

        {/* Filled track */}
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 bg-primary rounded-full transition-all duration-150"
          style={{ width: `${((depthLevel - 1) / 4) * 100}%` }}
        />

        {/* Native range input */}
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={depthLevel}
          onChange={handleSliderChange}
          disabled={disabled}
          className={cn(
            'absolute inset-0 w-full h-4 opacity-0 cursor-pointer',
            'disabled:cursor-not-allowed'
          )}
          aria-label="Depth level slider"
          aria-valuemin={1}
          aria-valuemax={5}
          aria-valuenow={depthLevel}
          aria-valuetext={currentLevelInfo.label}
        />
      </div>

      <span className="text-xs text-muted-foreground min-w-[60px]">
        {currentLevelInfo.label}
      </span>
    </div>
  );
}

export default DepthSlider;
