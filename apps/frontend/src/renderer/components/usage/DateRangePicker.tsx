/**
 * Date Range Picker Component
 *
 * A dropdown component for selecting date ranges with preset options
 * (Today, Last 7 days, Last 30 days, etc.) and custom date range selection.
 */

import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Calendar,
  ChevronDown,
  Check,
  CalendarDays
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../../lib/utils';
import type { DateRangeFilter, DateRangePreset } from '../../../shared/types/usage';

// ============================================
// Types
// ============================================

interface DateRangePickerProps {
  /** Current date range filter value */
  value: DateRangeFilter;
  /** Callback when date range changes */
  onChange: (value: DateRangeFilter) => void;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Size variant */
  size?: 'default' | 'sm' | 'lg';
  /** Whether to show the calendar icon */
  showIcon?: boolean;
}

interface PresetOption {
  value: DateRangePreset;
  label: string;
  getRange: () => { startDate: string; endDate: string };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Format a date to ISO string (YYYY-MM-DD)
 */
function formatDateToISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get the start of today
 */
function getToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Get date range for a preset
 */
function getPresetDateRange(preset: DateRangePreset): { startDate: string; endDate: string } {
  const today = getToday();
  const endDate = formatDateToISO(today);

  switch (preset) {
    case 'today': {
      return { startDate: endDate, endDate };
    }
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = formatDateToISO(yesterday);
      return { startDate: yesterdayStr, endDate: yesterdayStr };
    }
    case 'last7days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { startDate: formatDateToISO(start), endDate };
    }
    case 'last30days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { startDate: formatDateToISO(start), endDate };
    }
    case 'thisMonth': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: formatDateToISO(start), endDate };
    }
    case 'lastMonth': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { startDate: formatDateToISO(start), endDate: formatDateToISO(end) };
    }
    case 'thisYear': {
      const start = new Date(today.getFullYear(), 0, 1);
      return { startDate: formatDateToISO(start), endDate };
    }
    case 'custom':
    default: {
      // Default to last 30 days for custom
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { startDate: formatDateToISO(start), endDate };
    }
  }
}

/**
 * Format date range for display
 */
function formatDateRangeDisplay(
  preset: DateRangePreset,
  startDate?: string,
  endDate?: string,
  presetLabel?: string
): string {
  if (preset === 'custom' && startDate && endDate) {
    // Format dates nicely
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

      // If same year as current, omit year; otherwise include it
      const currentYear = new Date().getFullYear();
      if (start.getFullYear() !== currentYear || end.getFullYear() !== currentYear) {
        options.year = 'numeric';
      }

      const startStr = start.toLocaleDateString('en-US', options);
      const endStr = end.toLocaleDateString('en-US', options);

      if (startDate === endDate) {
        return startStr;
      }
      return `${startStr} - ${endStr}`;
    } catch {
      return `${startDate} - ${endDate}`;
    }
  }
  return presetLabel || preset;
}

// ============================================
// Main Component
// ============================================

export function DateRangePicker({
  value,
  onChange,
  disabled = false,
  className,
  size = 'default',
  showIcon = true
}: DateRangePickerProps) {
  const { t } = useTranslation('usage');
  const [isOpen, setIsOpen] = useState(false);
  const [customStartDate, setCustomStartDate] = useState<string>(
    value.startDate || formatDateToISO(new Date())
  );
  const [customEndDate, setCustomEndDate] = useState<string>(
    value.endDate || formatDateToISO(new Date())
  );
  const [showCustomInputs, setShowCustomInputs] = useState(value.preset === 'custom');

  // Preset options with their labels and date range functions
  const presetOptions: PresetOption[] = useMemo(
    () => [
      {
        value: 'today',
        label: t('dateRange.today'),
        getRange: () => getPresetDateRange('today')
      },
      {
        value: 'yesterday',
        label: t('dateRange.yesterday'),
        getRange: () => getPresetDateRange('yesterday')
      },
      {
        value: 'last7days',
        label: t('dateRange.last7days'),
        getRange: () => getPresetDateRange('last7days')
      },
      {
        value: 'last30days',
        label: t('dateRange.last30days'),
        getRange: () => getPresetDateRange('last30days')
      },
      {
        value: 'thisMonth',
        label: t('dateRange.thisMonth'),
        getRange: () => getPresetDateRange('thisMonth')
      },
      {
        value: 'lastMonth',
        label: t('dateRange.lastMonth'),
        getRange: () => getPresetDateRange('lastMonth')
      },
      {
        value: 'thisYear',
        label: t('dateRange.thisYear'),
        getRange: () => getPresetDateRange('thisYear')
      },
      {
        value: 'custom',
        label: t('dateRange.custom'),
        getRange: () => ({ startDate: customStartDate, endDate: customEndDate })
      }
    ],
    [t, customStartDate, customEndDate]
  );

  // Get label for current preset
  const currentPresetLabel = useMemo(() => {
    const option = presetOptions.find((opt) => opt.value === value.preset);
    return option?.label || value.preset;
  }, [presetOptions, value.preset]);

  // Display text for the button
  const displayText = useMemo(
    () =>
      formatDateRangeDisplay(
        value.preset,
        value.startDate,
        value.endDate,
        currentPresetLabel
      ),
    [value.preset, value.startDate, value.endDate, currentPresetLabel]
  );

  // Handle preset selection
  const handlePresetSelect = useCallback(
    (preset: DateRangePreset) => {
      if (preset === 'custom') {
        setShowCustomInputs(true);
        // Don't close the popover yet - let user pick dates
      } else {
        const { startDate, endDate } = getPresetDateRange(preset);
        onChange({
          preset,
          startDate,
          endDate
        });
        setShowCustomInputs(false);
        setIsOpen(false);
      }
    },
    [onChange]
  );

  // Handle custom date range apply
  const handleCustomApply = useCallback(() => {
    // Validate dates
    if (!customStartDate || !customEndDate) {
      return;
    }

    // Ensure start date is before or equal to end date
    let start = customStartDate;
    let end = customEndDate;
    if (new Date(start) > new Date(end)) {
      // Swap if start is after end
      [start, end] = [end, start];
      setCustomStartDate(start);
      setCustomEndDate(end);
    }

    onChange({
      preset: 'custom',
      startDate: start,
      endDate: end
    });
    setIsOpen(false);
  }, [customStartDate, customEndDate, onChange]);

  // Handle cancel custom selection
  const handleCustomCancel = useCallback(() => {
    setShowCustomInputs(false);
    // Reset to current value if it was custom, otherwise just hide
    if (value.preset === 'custom') {
      setCustomStartDate(value.startDate || formatDateToISO(new Date()));
      setCustomEndDate(value.endDate || formatDateToISO(new Date()));
    }
  }, [value]);

  // Get button size classes
  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'h-8 px-3 text-xs';
      case 'lg':
        return 'h-12 px-4 text-base';
      default:
        return 'h-10 px-4 text-sm';
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'justify-between gap-2 font-normal',
            getSizeClasses(),
            disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
          disabled={disabled}
          aria-label={t('dateRange.ariaLabel', { defaultValue: 'Select date range' })}
        >
          <span className="flex items-center gap-2">
            {showIcon && <Calendar className="h-4 w-4 text-muted-foreground" />}
            <span className="truncate">{displayText}</span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0"
        align="start"
        sideOffset={4}
      >
        <div className="flex flex-col">
          {/* Preset options */}
          {!showCustomInputs && (
            <div className="p-1">
              {presetOptions.map((option) => (
                <button
                  key={option.value}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm',
                    'hover:bg-accent hover:text-accent-foreground',
                    'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                    'transition-colors duration-150',
                    value.preset === option.value && 'bg-accent'
                  )}
                  onClick={() => handlePresetSelect(option.value)}
                  type="button"
                >
                  <span className="flex items-center gap-2">
                    {option.value === 'custom' && (
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    )}
                    {option.label}
                  </span>
                  {value.preset === option.value && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Custom date inputs */}
          {showCustomInputs && (
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {t('dateRange.customRange', { defaultValue: 'Custom Range' })}
                </span>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleCustomCancel}
                  type="button"
                >
                  {t('dateRange.cancel', { defaultValue: 'Cancel' })}
                </button>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="date-range-start"
                    className="text-xs text-muted-foreground"
                  >
                    {t('dateRange.startDate', { defaultValue: 'Start Date' })}
                  </label>
                  <Input
                    id="date-range-start"
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    max={formatDateToISO(new Date())}
                    className="h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="date-range-end"
                    className="text-xs text-muted-foreground"
                  >
                    {t('dateRange.endDate', { defaultValue: 'End Date' })}
                  </label>
                  <Input
                    id="date-range-end"
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    max={formatDateToISO(new Date())}
                    className="h-9"
                  />
                </div>
              </div>

              <Button
                className="w-full"
                size="sm"
                onClick={handleCustomApply}
                disabled={!customStartDate || !customEndDate}
              >
                {t('dateRange.apply', { defaultValue: 'Apply' })}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default DateRangePicker;
