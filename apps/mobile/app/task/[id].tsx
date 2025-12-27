/**
 * Task Detail Screen
 * Displays detailed information about a specific task
 * Accessed via /task/{id} route
 * Full implementation with tabs will be done in Phase 5.2
 */

import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Surface, IconButton, Chip, Divider } from 'react-native-paper';
import { useLocalSearchParams, Stack } from 'expo-router';
import { colors, spacing } from '../../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * Mock task data for display until store integration
 */
const getMockTask = (id: string) => ({
  id,
  title: `Task ${id}`,
  description: 'This is a sample task description that explains what needs to be done. The full implementation will load this from the task store.',
  status: 'in_progress' as const,
  priority: 'high' as const,
  category: 'feature' as const,
  complexity: 7,
  impact: 8,
  executionState: 'running' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

/**
 * Get status color based on task status
 */
const getStatusColor = (status: string): string => {
  const statusColors: Record<string, string> = {
    backlog: colors.taskStatus.backlog,
    in_progress: colors.taskStatus.in_progress,
    ai_review: colors.taskStatus.ai_review,
    human_review: colors.taskStatus.human_review,
    done: colors.taskStatus.done,
  };
  return statusColors[status] || colors.taskStatus.backlog;
};

/**
 * Get priority color based on task priority
 */
const getPriorityColor = (priority: string): string => {
  const priorityColors: Record<string, string> = {
    low: colors.priority.low,
    medium: colors.priority.medium,
    high: colors.priority.high,
    critical: colors.priority.critical,
  };
  return priorityColors[priority] || colors.priority.low;
};

/**
 * Format status label for display
 */
const formatStatus = (status: string): string => {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Task detail screen component
 * Displays task information with tabs for Overview, Logs, Files, Plan
 */
export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = getMockTask(id || 'unknown');

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Task Details',
          headerStyle: { backgroundColor: colors.background.primary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { color: colors.text.primary },
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Task Header */}
        <Surface style={styles.headerCard} elevation={2}>
          <View style={styles.headerTop}>
            <MaterialCommunityIcons
              name="checkbox-marked-outline"
              size={32}
              color={colors.accent.primary}
              accessibilityLabel="Task icon"
            />
            <View style={styles.executionControls}>
              <IconButton
                icon="play"
                iconColor={colors.status.success}
                size={24}
                onPress={() => {}}
                accessibilityLabel="Start task execution"
              />
              <IconButton
                icon="pause"
                iconColor={colors.status.warning}
                size={24}
                onPress={() => {}}
                accessibilityLabel="Pause task execution"
              />
              <IconButton
                icon="stop"
                iconColor={colors.status.error}
                size={24}
                onPress={() => {}}
                accessibilityLabel="Stop task execution"
              />
            </View>
          </View>

          <Text variant="headlineSmall" style={styles.title}>
            {task.title}
          </Text>

          <View style={styles.chipRow}>
            <Chip
              style={[styles.chip, { backgroundColor: getStatusColor(task.status) }]}
              textStyle={styles.chipText}
              accessibilityLabel={`Status: ${formatStatus(task.status)}`}
            >
              {formatStatus(task.status)}
            </Chip>
            <Chip
              style={[styles.chip, { backgroundColor: getPriorityColor(task.priority) }]}
              textStyle={styles.chipText}
              accessibilityLabel={`Priority: ${task.priority}`}
            >
              {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
            </Chip>
            <Chip
              style={[styles.chip, { backgroundColor: colors.surface.secondary }]}
              textStyle={styles.chipText}
              accessibilityLabel={`Category: ${task.category}`}
            >
              {task.category.charAt(0).toUpperCase() + task.category.slice(1)}
            </Chip>
          </View>
        </Surface>

        {/* Task Description */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Description
          </Text>
          <Text variant="bodyMedium" style={styles.description}>
            {task.description}
          </Text>
        </Surface>

        {/* Metrics */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Metrics
          </Text>
          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text variant="labelMedium" style={styles.metricLabel}>
                Complexity
              </Text>
              <Text variant="headlineMedium" style={styles.metricValue}>
                {task.complexity}/10
              </Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <Text variant="labelMedium" style={styles.metricLabel}>
                Impact
              </Text>
              <Text variant="headlineMedium" style={styles.metricValue}>
                {task.impact}/10
              </Text>
            </View>
          </View>
        </Surface>

        {/* Tabs Placeholder */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Task Tabs
          </Text>
          <Divider style={styles.divider} />
          <View style={styles.tabsPlaceholder}>
            {['Overview', 'Logs', 'Files', 'Plan'].map((tab) => (
              <View key={tab} style={styles.tabItem}>
                <MaterialCommunityIcons
                  name={
                    tab === 'Overview'
                      ? 'information-outline'
                      : tab === 'Logs'
                      ? 'text-box-outline'
                      : tab === 'Files'
                      ? 'file-document-outline'
                      : 'format-list-bulleted'
                  }
                  size={24}
                  color={colors.text.secondary}
                />
                <Text variant="bodySmall" style={styles.tabLabel}>
                  {tab}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="bodySmall" style={styles.hint}>
            Swipeable tabs will be implemented in Phase 5.2
          </Text>
        </Surface>

        {/* Metadata */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Metadata
          </Text>
          <View style={styles.metadataRow}>
            <Text variant="bodySmall" style={styles.metadataLabel}>
              Task ID
            </Text>
            <Text variant="bodySmall" style={styles.metadataValue}>
              {task.id}
            </Text>
          </View>
          <View style={styles.metadataRow}>
            <Text variant="bodySmall" style={styles.metadataLabel}>
              Created
            </Text>
            <Text variant="bodySmall" style={styles.metadataValue}>
              {new Date(task.createdAt).toLocaleDateString()}
            </Text>
          </View>
          <View style={styles.metadataRow}>
            <Text variant="bodySmall" style={styles.metadataLabel}>
              Updated
            </Text>
            <Text variant="bodySmall" style={styles.metadataValue}>
              {new Date(task.updatedAt).toLocaleDateString()}
            </Text>
          </View>
        </Surface>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  headerCard: {
    backgroundColor: colors.background.secondary,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  executionControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    color: colors.text.primary,
    fontWeight: 'bold',
    marginBottom: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    marginRight: spacing.xs,
  },
  chipText: {
    color: colors.text.primary,
    fontSize: 12,
  },
  card: {
    backgroundColor: colors.background.secondary,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.text.primary,
    fontWeight: 'bold',
    marginBottom: spacing.sm,
  },
  description: {
    color: colors.text.secondary,
    lineHeight: 22,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
  },
  metric: {
    alignItems: 'center',
    flex: 1,
  },
  metricLabel: {
    color: colors.text.muted,
    marginBottom: spacing.xs,
  },
  metricValue: {
    color: colors.accent.primary,
    fontWeight: 'bold',
  },
  metricDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.surface.divider,
  },
  divider: {
    backgroundColor: colors.surface.divider,
    marginVertical: spacing.sm,
  },
  tabsPlaceholder: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
  },
  tabItem: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  tabLabel: {
    color: colors.text.secondary,
  },
  hint: {
    color: colors.text.muted,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  metadataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  metadataLabel: {
    color: colors.text.muted,
  },
  metadataValue: {
    color: colors.text.secondary,
  },
});
