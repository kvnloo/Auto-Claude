/**
 * Autonomous Mode Settings Component
 *
 * Settings form for configuring autonomous mode:
 * - Enable/disable toggle
 * - Max concurrent tasks (1-3)
 * - Max consecutive failures (1-5)
 * - Session time limit (1-8 hours)
 * - Poll interval (30+ seconds)
 * - Token budget (optional)
 */

import { useState, useEffect, useCallback } from 'react';
import { Bot, Clock, AlertTriangle, Zap, RefreshCw, Coins } from 'lucide-react';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { SettingsSection } from './SettingsSection';
import { useAutonomousStore } from '../../stores/autonomous-store';
import type { AutonomousModeSettings as AutonomousModeSettingsType } from '../../../shared/types/settings';

interface AutonomousModeSettingsProps {
  projectId: string;
}

// Options for concurrent tasks
const CONCURRENT_TASKS_OPTIONS = [
  { value: '1', label: '1 task', description: 'Sequential processing' },
  { value: '2', label: '2 tasks', description: 'Light parallelism' },
  { value: '3', label: '3 tasks', description: 'Maximum parallelism' }
];

// Options for max consecutive failures
const MAX_FAILURES_OPTIONS = [
  { value: '1', label: '1 failure', description: 'Stop immediately' },
  { value: '2', label: '2 failures', description: 'Low tolerance' },
  { value: '3', label: '3 failures', description: 'Default' },
  { value: '4', label: '4 failures', description: 'Higher tolerance' },
  { value: '5', label: '5 failures', description: 'Maximum tolerance' }
];

// Options for session time limit (in minutes)
const SESSION_TIME_OPTIONS = [
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '180', label: '3 hours' },
  { value: '240', label: '4 hours (default)' },
  { value: '300', label: '5 hours' },
  { value: '360', label: '6 hours' },
  { value: '420', label: '7 hours' },
  { value: '480', label: '8 hours' }
];

// Default settings
const DEFAULT_SETTINGS: AutonomousModeSettingsType = {
  enabled: false,
  maxConcurrentTasks: 1,
  maxConsecutiveFailures: 3,
  sessionTimeLimitMinutes: 240,
  pollIntervalSeconds: 60,
  tokenBudget: undefined
};

export function AutonomousModeSettings({ projectId }: AutonomousModeSettingsProps) {
  const { settings: storedSettings, loadSettings, saveSettings, isLoading } = useAutonomousStore();

  // Local state for form
  const [localSettings, setLocalSettings] = useState<AutonomousModeSettingsType>(DEFAULT_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pollIntervalError, setPollIntervalError] = useState<string | null>(null);

  // Load settings on mount
  useEffect(() => {
    loadSettings(projectId);
  }, [projectId, loadSettings]);

  // Sync local state with stored settings
  useEffect(() => {
    if (storedSettings) {
      setLocalSettings(storedSettings);
      setHasChanges(false);
    }
  }, [storedSettings]);

  // Update local settings
  const updateSettings = useCallback(
    (updates: Partial<AutonomousModeSettingsType>) => {
      setLocalSettings((prev) => ({ ...prev, ...updates }));
      setHasChanges(true);
      setSaveError(null);
    },
    []
  );

  // Validate poll interval
  const validatePollInterval = useCallback((value: number): boolean => {
    if (value < 30) {
      setPollIntervalError('Minimum poll interval is 30 seconds');
      return false;
    }
    if (value > 600) {
      setPollIntervalError('Maximum poll interval is 600 seconds (10 minutes)');
      return false;
    }
    setPollIntervalError(null);
    return true;
  }, []);

  // Handle poll interval change
  const handlePollIntervalChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      if (!isNaN(value)) {
        validatePollInterval(value);
        updateSettings({ pollIntervalSeconds: value });
      }
    },
    [updateSettings, validatePollInterval]
  );

  // Handle token budget change
  const handleTokenBudgetChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value ? parseInt(e.target.value, 10) : undefined;
      updateSettings({ tokenBudget: value && !isNaN(value) ? value : undefined });
    },
    [updateSettings]
  );

  // Save settings
  const handleSave = useCallback(async () => {
    if (!validatePollInterval(localSettings.pollIntervalSeconds)) {
      return;
    }

    setSaveError(null);
    const success = await saveSettings(projectId, localSettings);

    if (success) {
      setHasChanges(false);
    } else {
      setSaveError('Failed to save settings');
    }
  }, [projectId, localSettings, saveSettings, validatePollInterval]);

  // Reset to stored settings
  const handleReset = useCallback(() => {
    if (storedSettings) {
      setLocalSettings(storedSettings);
      setHasChanges(false);
      setSaveError(null);
      setPollIntervalError(null);
    }
  }, [storedSettings]);

  return (
    <SettingsSection
      title="Autonomous Mode"
      description="Configure automatic task processing from GitHub issues and roadmap features"
    >
      <div className="space-y-6">
        {/* Enable Toggle */}
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-primary" />
            <div>
              <Label htmlFor="autonomous-enabled" className="text-sm font-medium">
                Enable Autonomous Mode
              </Label>
              <p className="text-sm text-muted-foreground">
                Automatically process tasks without manual intervention
              </p>
            </div>
          </div>
          <Switch
            id="autonomous-enabled"
            checked={localSettings.enabled}
            onCheckedChange={(checked) => updateSettings({ enabled: checked })}
          />
        </div>

        {/* Settings Grid - only show when enabled */}
        {localSettings.enabled && (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Max Concurrent Tasks */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="max-concurrent" className="text-sm font-medium">
                  Concurrent Tasks
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Number of tasks to process simultaneously
              </p>
              <Select
                value={String(localSettings.maxConcurrentTasks)}
                onValueChange={(value) =>
                  updateSettings({ maxConcurrentTasks: parseInt(value, 10) })
                }
              >
                <SelectTrigger id="max-concurrent" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONCURRENT_TASKS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center justify-between gap-2">
                        <span>{option.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Max Consecutive Failures */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="max-failures" className="text-sm font-medium">
                  Failure Tolerance
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Pause queue after this many consecutive failures
              </p>
              <Select
                value={String(localSettings.maxConsecutiveFailures)}
                onValueChange={(value) =>
                  updateSettings({ maxConsecutiveFailures: parseInt(value, 10) })
                }
              >
                <SelectTrigger id="max-failures" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAX_FAILURES_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center justify-between gap-2">
                        <span>{option.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Session Time Limit */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="session-limit" className="text-sm font-medium">
                  Session Time Limit
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Maximum duration for autonomous session
              </p>
              <Select
                value={String(localSettings.sessionTimeLimitMinutes)}
                onValueChange={(value) =>
                  updateSettings({ sessionTimeLimitMinutes: parseInt(value, 10) })
                }
              >
                <SelectTrigger id="session-limit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_TIME_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Poll Interval */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="poll-interval" className="text-sm font-medium">
                  Poll Interval
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                How often to check for new tasks (in seconds)
              </p>
              <Input
                id="poll-interval"
                type="number"
                min={30}
                max={600}
                value={localSettings.pollIntervalSeconds}
                onChange={handlePollIntervalChange}
                className={pollIntervalError ? 'border-destructive' : ''}
              />
              {pollIntervalError && (
                <p className="text-xs text-destructive">{pollIntervalError}</p>
              )}
            </div>

            {/* Token Budget (Optional) */}
            <div className="space-y-3 md:col-span-2">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="token-budget" className="text-sm font-medium">
                  Token Budget
                </Label>
                <Badge variant="outline" className="text-xs">
                  Optional
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Maximum tokens to use per session (leave empty for unlimited)
              </p>
              <Input
                id="token-budget"
                type="number"
                min={0}
                placeholder="Unlimited"
                value={localSettings.tokenBudget ?? ''}
                onChange={handleTokenBudgetChange}
                className="max-w-xs"
              />
            </div>
          </div>
        )}

        {/* Error Message */}
        {saveError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
            {saveError}
          </div>
        )}

        {/* Action Buttons */}
        {hasChanges && (
          <div className="flex items-center gap-3 pt-4 border-t">
            <Button onClick={handleSave} disabled={isLoading || !!pollIntervalError}>
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={isLoading}>
              Reset
            </Button>
            <span className="text-sm text-muted-foreground">
              You have unsaved changes
            </span>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

export default AutonomousModeSettings;
