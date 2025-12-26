/**
 * ConfigPanel - Configuration component for Claude Flow parallel agent orchestration
 *
 * Provides UI controls for:
 * - Agent count selection (4, 8, or 12 parallel agents)
 * - Topology mode selection (distributed, hierarchical, mesh, centralized)
 *
 * Used in Claude Flow settings page for configuring parallel task execution.
 */
import { useState, useCallback } from 'react';
import { Users, Network, Info, Zap, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import { cn } from '../lib/utils';
import styles from './ConfigPanel.module.css';

/** Valid agent count options */
export type AgentCount = 4 | 8 | 12;

/** Valid topology modes for parallel execution */
export type TopologyMode = 'distributed' | 'hierarchical' | 'mesh' | 'centralized';

/** Claude Flow configuration state */
export interface ClaudeFlowConfig {
  agentCount: AgentCount;
  topology: TopologyMode;
}

/** Props for the ConfigPanel component */
export interface ConfigPanelProps {
  /** Current configuration */
  config: ClaudeFlowConfig;
  /** Called when configuration changes */
  onConfigChange: (config: ClaudeFlowConfig) => void;
  /** Whether the panel is disabled */
  disabled?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Additional CSS class name */
  className?: string;
}

/** Agent count option configuration */
interface AgentCountOption {
  value: AgentCount;
  label: string;
  description: string;
  speedup: string;
}

/** Topology mode option configuration */
interface TopologyOption {
  value: TopologyMode;
  label: string;
  description: string;
  useCase: string;
}

/** Available agent count options with descriptions */
const AGENT_COUNT_OPTIONS: AgentCountOption[] = [
  {
    value: 4,
    label: '4 Agents',
    description: 'Light parallelism for smaller tasks',
    speedup: '~4x speedup'
  },
  {
    value: 8,
    label: '8 Agents',
    description: 'Balanced parallelism for most tasks',
    speedup: '~6x speedup'
  },
  {
    value: 12,
    label: '12 Agents',
    description: 'Maximum parallelism for large research',
    speedup: '~7.5x speedup'
  }
];

/** Available topology modes with descriptions */
const TOPOLOGY_OPTIONS: TopologyOption[] = [
  {
    value: 'distributed',
    label: 'Distributed',
    description: 'Equal peers working independently',
    useCase: 'Best for research and exploration tasks'
  },
  {
    value: 'hierarchical',
    label: 'Hierarchical',
    description: 'Leader coordinates worker agents',
    useCase: 'Best for complex multi-step tasks'
  },
  {
    value: 'mesh',
    label: 'Mesh',
    description: 'Fully connected agent network',
    useCase: 'Best for collaborative analysis'
  },
  {
    value: 'centralized',
    label: 'Centralized',
    description: 'Single coordinator with workers',
    useCase: 'Best for structured workflows'
  }
];

/**
 * ConfigPanel component for Claude Flow parallel agent configuration
 */
export function ConfigPanel({
  config,
  onConfigChange,
  disabled = false,
  error = null,
  className
}: ConfigPanelProps) {
  const [hoveredAgentCount, setHoveredAgentCount] = useState<AgentCount | null>(null);
  const [hoveredTopology, setHoveredTopology] = useState<TopologyMode | null>(null);

  const handleAgentCountChange = useCallback(
    (value: string) => {
      const agentCount = parseInt(value, 10) as AgentCount;
      onConfigChange({ ...config, agentCount });
    },
    [config, onConfigChange]
  );

  const handleTopologyChange = useCallback(
    (value: string) => {
      const topology = value as TopologyMode;
      onConfigChange({ ...config, topology });
    },
    [config, onConfigChange]
  );

  // Get the current option details for display
  const currentAgentOption = AGENT_COUNT_OPTIONS.find((opt) => opt.value === config.agentCount);
  const currentTopologyOption = TOPOLOGY_OPTIONS.find((opt) => opt.value === config.topology);

  // Get hovered option details for tooltips
  const displayedAgentOption = hoveredAgentCount
    ? AGENT_COUNT_OPTIONS.find((opt) => opt.value === hoveredAgentCount)
    : currentAgentOption;
  const displayedTopologyOption = hoveredTopology
    ? TOPOLOGY_OPTIONS.find((opt) => opt.value === hoveredTopology)
    : currentTopologyOption;

  return (
    <Card className={cn(styles.configPanel, className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Claude Flow Configuration</CardTitle>
        </div>
        <CardDescription>
          Configure parallel agent execution for research and exploration tasks
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Agent Count Selection */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="agent-count" className="text-sm font-medium">
              Agent Count
            </Label>
          </div>

          <Select
            value={config.agentCount.toString()}
            onValueChange={handleAgentCountChange}
            disabled={disabled}
          >
            <SelectTrigger id="agent-count" className="h-10">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  <span>{currentAgentOption?.label}</span>
                  <span className="text-xs text-muted-foreground ml-1">
                    ({currentAgentOption?.speedup})
                  </span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {AGENT_COUNT_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value.toString()}
                  onMouseEnter={() => setHoveredAgentCount(option.value)}
                  onMouseLeave={() => setHoveredAgentCount(null)}
                >
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-xs text-primary">{option.speedup}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Agent count info panel */}
          {displayedAgentOption && (
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <span className="font-medium text-foreground">{displayedAgentOption.label}:</span>{' '}
                <span className="text-muted-foreground">{displayedAgentOption.description}</span>
              </div>
            </div>
          )}
        </div>

        {/* Topology Mode Selection */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="topology-mode" className="text-sm font-medium">
              Topology Mode
            </Label>
          </div>

          <Select
            value={config.topology}
            onValueChange={handleTopologyChange}
            disabled={disabled}
          >
            <SelectTrigger id="topology-mode" className="h-10">
              <SelectValue>
                <div className="flex items-center gap-2">
                  <Network className="h-4 w-4" />
                  <span>{currentTopologyOption?.label}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TOPOLOGY_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  onMouseEnter={() => setHoveredTopology(option.value)}
                  onMouseLeave={() => setHoveredTopology(null)}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Topology info panel */}
          {displayedTopologyOption && (
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <span className="font-medium text-foreground">{displayedTopologyOption.label}:</span>{' '}
                <span className="text-muted-foreground">{displayedTopologyOption.useCase}</span>
              </div>
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <span className="text-destructive">{error}</span>
          </div>
        )}

        {/* Summary Panel */}
        <div className={cn(styles.summaryPanel, 'rounded-lg border border-border bg-card p-4')}>
          <div className="text-sm font-medium text-foreground mb-2">Current Configuration</div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Agents:</span>{' '}
              <span className="font-medium text-foreground">{config.agentCount}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Topology:</span>{' '}
              <span className="font-medium text-foreground capitalize">{config.topology}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Expected Speedup:</span>{' '}
              <span className="font-medium text-primary">{currentAgentOption?.speedup}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Default configuration for Claude Flow */
export const DEFAULT_CLAUDE_FLOW_CONFIG: ClaudeFlowConfig = {
  agentCount: 8,
  topology: 'distributed'
};

export default ConfigPanel;
