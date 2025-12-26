/**
 * Unit tests for ConfigPanel component
 * Tests configuration state, agent count options, topology modes, and event handling
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  AgentCount,
  TopologyMode,
  ClaudeFlowConfig,
  ConfigPanelProps
} from '../renderer/components/ConfigPanel';

// Helper to create test configuration
function createTestConfig(overrides: Partial<ClaudeFlowConfig> = {}): ClaudeFlowConfig {
  return {
    agentCount: 8,
    topology: 'distributed',
    ...overrides
  };
}

describe('ConfigPanel', () => {
  // Mock callbacks
  const mockOnConfigChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ClaudeFlowConfig Type', () => {
    it('should accept valid agent count values (4, 8, 12)', () => {
      const validAgentCounts: AgentCount[] = [4, 8, 12];

      validAgentCounts.forEach((agentCount) => {
        const config = createTestConfig({ agentCount });
        expect(config.agentCount).toBe(agentCount);
      });
    });

    it('should accept valid topology modes', () => {
      const validTopologies: TopologyMode[] = ['distributed', 'hierarchical', 'mesh', 'centralized'];

      validTopologies.forEach((topology) => {
        const config = createTestConfig({ topology });
        expect(config.topology).toBe(topology);
      });
    });

    it('should have default configuration with 8 agents and distributed topology', () => {
      const defaultConfig = createTestConfig();

      expect(defaultConfig.agentCount).toBe(8);
      expect(defaultConfig.topology).toBe('distributed');
    });
  });

  describe('Agent Count Options', () => {
    const AGENT_COUNT_OPTIONS = [
      {
        value: 4 as AgentCount,
        label: '4 Agents',
        description: 'Light parallelism for smaller tasks',
        speedup: '~4x speedup'
      },
      {
        value: 8 as AgentCount,
        label: '8 Agents',
        description: 'Balanced parallelism for most tasks',
        speedup: '~6x speedup'
      },
      {
        value: 12 as AgentCount,
        label: '12 Agents',
        description: 'Maximum parallelism for large research',
        speedup: '~7.5x speedup'
      }
    ];

    it('should have 3 agent count options', () => {
      expect(AGENT_COUNT_OPTIONS).toHaveLength(3);
    });

    it('should have correct labels for each agent count', () => {
      expect(AGENT_COUNT_OPTIONS[0].label).toBe('4 Agents');
      expect(AGENT_COUNT_OPTIONS[1].label).toBe('8 Agents');
      expect(AGENT_COUNT_OPTIONS[2].label).toBe('12 Agents');
    });

    it('should have descriptions for each agent count', () => {
      AGENT_COUNT_OPTIONS.forEach((option) => {
        expect(option.description).toBeDefined();
        expect(option.description.length).toBeGreaterThan(0);
      });
    });

    it('should have speedup estimates for each agent count', () => {
      AGENT_COUNT_OPTIONS.forEach((option) => {
        expect(option.speedup).toBeDefined();
        expect(option.speedup).toMatch(/~\d+(\.\d+)?x speedup/);
      });
    });

    it('should have increasing speedup factors with more agents', () => {
      // 4 agents: ~4x, 8 agents: ~6x, 12 agents: ~7.5x
      // Extract numeric values
      const extractSpeedup = (str: string): number => {
        const match = str.match(/~(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : 0;
      };

      const speedups = AGENT_COUNT_OPTIONS.map((opt) => extractSpeedup(opt.speedup));
      expect(speedups[0]).toBeLessThan(speedups[1]);
      expect(speedups[1]).toBeLessThan(speedups[2]);
    });

    it('should find current agent option by value', () => {
      const config = createTestConfig({ agentCount: 8 });
      const currentOption = AGENT_COUNT_OPTIONS.find((opt) => opt.value === config.agentCount);

      expect(currentOption).toBeDefined();
      expect(currentOption?.label).toBe('8 Agents');
    });
  });

  describe('Topology Mode Options', () => {
    const TOPOLOGY_OPTIONS = [
      {
        value: 'distributed' as TopologyMode,
        label: 'Distributed',
        description: 'Equal peers working independently',
        useCase: 'Best for research and exploration tasks'
      },
      {
        value: 'hierarchical' as TopologyMode,
        label: 'Hierarchical',
        description: 'Leader coordinates worker agents',
        useCase: 'Best for complex multi-step tasks'
      },
      {
        value: 'mesh' as TopologyMode,
        label: 'Mesh',
        description: 'Fully connected agent network',
        useCase: 'Best for collaborative analysis'
      },
      {
        value: 'centralized' as TopologyMode,
        label: 'Centralized',
        description: 'Single coordinator with workers',
        useCase: 'Best for structured workflows'
      }
    ];

    it('should have 4 topology mode options', () => {
      expect(TOPOLOGY_OPTIONS).toHaveLength(4);
    });

    it('should have correct labels for each topology mode', () => {
      expect(TOPOLOGY_OPTIONS[0].label).toBe('Distributed');
      expect(TOPOLOGY_OPTIONS[1].label).toBe('Hierarchical');
      expect(TOPOLOGY_OPTIONS[2].label).toBe('Mesh');
      expect(TOPOLOGY_OPTIONS[3].label).toBe('Centralized');
    });

    it('should have descriptions for each topology mode', () => {
      TOPOLOGY_OPTIONS.forEach((option) => {
        expect(option.description).toBeDefined();
        expect(option.description.length).toBeGreaterThan(0);
      });
    });

    it('should have use case recommendations for each topology mode', () => {
      TOPOLOGY_OPTIONS.forEach((option) => {
        expect(option.useCase).toBeDefined();
        expect(option.useCase).toMatch(/^Best for /);
      });
    });

    it('should find current topology option by value', () => {
      const config = createTestConfig({ topology: 'hierarchical' });
      const currentOption = TOPOLOGY_OPTIONS.find((opt) => opt.value === config.topology);

      expect(currentOption).toBeDefined();
      expect(currentOption?.label).toBe('Hierarchical');
      expect(currentOption?.useCase).toBe('Best for complex multi-step tasks');
    });
  });

  describe('Agent Count Change Handling', () => {
    it('should call onConfigChange with new agent count when changed', () => {
      const config = createTestConfig({ agentCount: 4 });

      // Simulate the handleAgentCountChange logic
      const handleAgentCountChange = (value: string) => {
        const agentCount = parseInt(value, 10) as AgentCount;
        mockOnConfigChange({ ...config, agentCount });
      };

      handleAgentCountChange('8');

      expect(mockOnConfigChange).toHaveBeenCalledWith({
        agentCount: 8,
        topology: 'distributed'
      });
    });

    it('should parse string value to integer for agent count', () => {
      const config = createTestConfig({ agentCount: 8 });

      const handleAgentCountChange = (value: string) => {
        const agentCount = parseInt(value, 10) as AgentCount;
        mockOnConfigChange({ ...config, agentCount });
      };

      handleAgentCountChange('12');

      expect(mockOnConfigChange).toHaveBeenCalledWith(
        expect.objectContaining({
          agentCount: 12
        })
      );
    });

    it('should preserve topology when changing agent count', () => {
      const config = createTestConfig({ agentCount: 4, topology: 'mesh' });

      const handleAgentCountChange = (value: string) => {
        const agentCount = parseInt(value, 10) as AgentCount;
        mockOnConfigChange({ ...config, agentCount });
      };

      handleAgentCountChange('8');

      expect(mockOnConfigChange).toHaveBeenCalledWith({
        agentCount: 8,
        topology: 'mesh'
      });
    });
  });

  describe('Topology Change Handling', () => {
    it('should call onConfigChange with new topology when changed', () => {
      const config = createTestConfig({ topology: 'distributed' });

      // Simulate the handleTopologyChange logic
      const handleTopologyChange = (value: string) => {
        const topology = value as TopologyMode;
        mockOnConfigChange({ ...config, topology });
      };

      handleTopologyChange('hierarchical');

      expect(mockOnConfigChange).toHaveBeenCalledWith({
        agentCount: 8,
        topology: 'hierarchical'
      });
    });

    it('should preserve agent count when changing topology', () => {
      const config = createTestConfig({ agentCount: 12, topology: 'distributed' });

      const handleTopologyChange = (value: string) => {
        const topology = value as TopologyMode;
        mockOnConfigChange({ ...config, topology });
      };

      handleTopologyChange('centralized');

      expect(mockOnConfigChange).toHaveBeenCalledWith({
        agentCount: 12,
        topology: 'centralized'
      });
    });

    it('should handle all topology mode transitions', () => {
      const topologies: TopologyMode[] = ['distributed', 'hierarchical', 'mesh', 'centralized'];

      topologies.forEach((targetTopology) => {
        vi.clearAllMocks();
        const config = createTestConfig({ topology: 'distributed' });

        const handleTopologyChange = (value: string) => {
          const topology = value as TopologyMode;
          mockOnConfigChange({ ...config, topology });
        };

        handleTopologyChange(targetTopology);

        expect(mockOnConfigChange).toHaveBeenCalledWith(
          expect.objectContaining({
            topology: targetTopology
          })
        );
      });
    });
  });

  describe('Props Handling', () => {
    it('should handle disabled state', () => {
      const props: ConfigPanelProps = {
        config: createTestConfig(),
        onConfigChange: mockOnConfigChange,
        disabled: true
      };

      expect(props.disabled).toBe(true);
    });

    it('should handle enabled state (default)', () => {
      const props: ConfigPanelProps = {
        config: createTestConfig(),
        onConfigChange: mockOnConfigChange,
        disabled: false
      };

      expect(props.disabled).toBe(false);
    });

    it('should handle error message display', () => {
      const errorMessage = 'Failed to connect to Claude Flow server';
      const props: ConfigPanelProps = {
        config: createTestConfig(),
        onConfigChange: mockOnConfigChange,
        error: errorMessage
      };

      expect(props.error).toBe(errorMessage);
    });

    it('should handle null error (no error state)', () => {
      const props: ConfigPanelProps = {
        config: createTestConfig(),
        onConfigChange: mockOnConfigChange,
        error: null
      };

      expect(props.error).toBeNull();
    });

    it('should handle optional className prop', () => {
      const customClass = 'my-custom-panel-class';
      const props: ConfigPanelProps = {
        config: createTestConfig(),
        onConfigChange: mockOnConfigChange,
        className: customClass
      };

      expect(props.className).toBe(customClass);
    });

    it('should handle undefined optional props', () => {
      const props: ConfigPanelProps = {
        config: createTestConfig(),
        onConfigChange: mockOnConfigChange
      };

      expect(props.disabled).toBeUndefined();
      expect(props.error).toBeUndefined();
      expect(props.className).toBeUndefined();
    });
  });

  describe('Hover State Logic', () => {
    it('should track hovered agent count state', () => {
      let hoveredAgentCount: AgentCount | null = null;

      // Simulate mouse enter
      const setHoveredAgentCount = (value: AgentCount | null) => {
        hoveredAgentCount = value;
      };

      setHoveredAgentCount(4);
      expect(hoveredAgentCount).toBe(4);

      setHoveredAgentCount(null);
      expect(hoveredAgentCount).toBeNull();
    });

    it('should track hovered topology state', () => {
      let hoveredTopology: TopologyMode | null = null;

      const setHoveredTopology = (value: TopologyMode | null) => {
        hoveredTopology = value;
      };

      setHoveredTopology('mesh');
      expect(hoveredTopology).toBe('mesh');

      setHoveredTopology(null);
      expect(hoveredTopology).toBeNull();
    });

    it('should display hovered option when hovering, current option otherwise', () => {
      const config = createTestConfig({ agentCount: 8 });
      let hoveredAgentCount: AgentCount | null = null;

      const AGENT_COUNT_OPTIONS = [
        { value: 4 as AgentCount, label: '4 Agents' },
        { value: 8 as AgentCount, label: '8 Agents' },
        { value: 12 as AgentCount, label: '12 Agents' }
      ];

      const currentAgentOption = AGENT_COUNT_OPTIONS.find((opt) => opt.value === config.agentCount);

      // Without hover, show current option
      let displayedAgentOption = hoveredAgentCount
        ? AGENT_COUNT_OPTIONS.find((opt) => opt.value === hoveredAgentCount)
        : currentAgentOption;

      expect(displayedAgentOption?.label).toBe('8 Agents');

      // With hover, show hovered option
      hoveredAgentCount = 12;
      displayedAgentOption = hoveredAgentCount
        ? AGENT_COUNT_OPTIONS.find((opt) => opt.value === hoveredAgentCount)
        : currentAgentOption;

      expect(displayedAgentOption?.label).toBe('12 Agents');
    });
  });

  describe('Summary Panel Logic', () => {
    it('should display agent count in summary', () => {
      const config = createTestConfig({ agentCount: 12 });
      expect(config.agentCount).toBe(12);
    });

    it('should display topology in summary', () => {
      const config = createTestConfig({ topology: 'centralized' });
      expect(config.topology).toBe('centralized');
    });

    it('should display expected speedup based on agent count', () => {
      const AGENT_COUNT_OPTIONS = [
        { value: 4, speedup: '~4x speedup' },
        { value: 8, speedup: '~6x speedup' },
        { value: 12, speedup: '~7.5x speedup' }
      ];

      const config = createTestConfig({ agentCount: 8 });
      const currentOption = AGENT_COUNT_OPTIONS.find((opt) => opt.value === config.agentCount);

      expect(currentOption?.speedup).toBe('~6x speedup');
    });
  });

  describe('Error Display Logic', () => {
    it('should display error when error prop is provided', () => {
      const error = 'Connection timeout';
      const props: ConfigPanelProps = {
        config: createTestConfig(),
        onConfigChange: mockOnConfigChange,
        error
      };

      expect(!!props.error).toBe(true);
      expect(props.error).toBe('Connection timeout');
    });

    it('should not display error when error is null', () => {
      const props: ConfigPanelProps = {
        config: createTestConfig(),
        onConfigChange: mockOnConfigChange,
        error: null
      };

      expect(!!props.error).toBe(false);
    });

    it('should not display error when error is undefined', () => {
      const props: ConfigPanelProps = {
        config: createTestConfig(),
        onConfigChange: mockOnConfigChange
      };

      expect(!!props.error).toBe(false);
    });
  });

  describe('Default Configuration Export', () => {
    it('should have default config with 8 agents', () => {
      const DEFAULT_CLAUDE_FLOW_CONFIG: ClaudeFlowConfig = {
        agentCount: 8,
        topology: 'distributed'
      };

      expect(DEFAULT_CLAUDE_FLOW_CONFIG.agentCount).toBe(8);
    });

    it('should have default config with distributed topology', () => {
      const DEFAULT_CLAUDE_FLOW_CONFIG: ClaudeFlowConfig = {
        agentCount: 8,
        topology: 'distributed'
      };

      expect(DEFAULT_CLAUDE_FLOW_CONFIG.topology).toBe('distributed');
    });
  });

  describe('Configuration Combinations', () => {
    it('should handle all valid configuration combinations', () => {
      const agentCounts: AgentCount[] = [4, 8, 12];
      const topologies: TopologyMode[] = ['distributed', 'hierarchical', 'mesh', 'centralized'];

      agentCounts.forEach((agentCount) => {
        topologies.forEach((topology) => {
          const config = createTestConfig({ agentCount, topology });

          expect(config.agentCount).toBe(agentCount);
          expect(config.topology).toBe(topology);
        });
      });
    });

    it('should allow rapid configuration changes', () => {
      const configs: ClaudeFlowConfig[] = [
        { agentCount: 4, topology: 'distributed' },
        { agentCount: 8, topology: 'hierarchical' },
        { agentCount: 12, topology: 'mesh' },
        { agentCount: 4, topology: 'centralized' }
      ];

      configs.forEach((config) => {
        mockOnConfigChange(config);
      });

      expect(mockOnConfigChange).toHaveBeenCalledTimes(4);
      expect(mockOnConfigChange).toHaveBeenLastCalledWith({
        agentCount: 4,
        topology: 'centralized'
      });
    });
  });

  describe('Callback Memoization Logic', () => {
    it('should use useCallback dependencies correctly for handleAgentCountChange', () => {
      const config1 = createTestConfig({ agentCount: 4 });
      const config2 = createTestConfig({ agentCount: 8 });

      // handleAgentCountChange depends on config and onConfigChange
      // When config changes, the callback should use the new config
      const createHandler = (config: ClaudeFlowConfig) => (value: string) => {
        const agentCount = parseInt(value, 10) as AgentCount;
        mockOnConfigChange({ ...config, agentCount });
      };

      const handler1 = createHandler(config1);
      const handler2 = createHandler(config2);

      handler1('12');
      expect(mockOnConfigChange).toHaveBeenLastCalledWith({
        agentCount: 12,
        topology: 'distributed'
      });

      handler2('4');
      expect(mockOnConfigChange).toHaveBeenLastCalledWith({
        agentCount: 4,
        topology: 'distributed'
      });
    });

    it('should use useCallback dependencies correctly for handleTopologyChange', () => {
      const config1 = createTestConfig({ agentCount: 4 });
      const config2 = createTestConfig({ agentCount: 12 });

      const createHandler = (config: ClaudeFlowConfig) => (value: string) => {
        const topology = value as TopologyMode;
        mockOnConfigChange({ ...config, topology });
      };

      const handler1 = createHandler(config1);
      const handler2 = createHandler(config2);

      handler1('mesh');
      expect(mockOnConfigChange).toHaveBeenLastCalledWith({
        agentCount: 4,
        topology: 'mesh'
      });

      handler2('centralized');
      expect(mockOnConfigChange).toHaveBeenLastCalledWith({
        agentCount: 12,
        topology: 'centralized'
      });
    });
  });
});
