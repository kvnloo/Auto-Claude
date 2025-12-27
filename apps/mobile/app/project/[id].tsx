/**
 * Project Detail Screen
 * Displays detailed information about a specific project
 * Accessed via /project/{id} route
 * Full implementation will be done in Phase 5.6
 */

import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Surface, ProgressBar, Chip, Divider, Button } from 'react-native-paper';
import { useLocalSearchParams, Stack } from 'expo-router';
import { colors, spacing } from '../../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * Mock project data for display until store integration
 */
const getMockProject = (id: string) => ({
  id,
  name: `Project ${id}`,
  description: 'This is a sample project description explaining the project goals and scope. The full implementation will load this from the project store.',
  status: 'active' as const,
  repositoryUrl: 'https://github.com/example/project',
  stats: {
    totalTasks: 24,
    completedTasks: 12,
    inProgressTasks: 5,
    backlogTasks: 4,
    aiReviewTasks: 2,
    humanReviewTasks: 1,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastOpenedAt: new Date().toISOString(),
});

/**
 * Get status color based on project status
 */
const getStatusColor = (status: string): string => {
  const statusColors: Record<string, string> = {
    active: colors.status.success,
    paused: colors.status.warning,
    completed: colors.status.info,
    archived: colors.text.muted,
  };
  return statusColors[status] || colors.text.muted;
};

/**
 * Format status label for display
 */
const formatStatus = (status: string): string => {
  return status.charAt(0).toUpperCase() + status.slice(1);
};

/**
 * Project detail screen component
 * Displays project information with stats and quick links
 */
export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = getMockProject(id || 'unknown');

  const progress = project.stats.completedTasks / project.stats.totalTasks;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Project Details',
          headerStyle: { backgroundColor: colors.background.primary },
          headerTintColor: colors.text.primary,
          headerTitleStyle: { color: colors.text.primary },
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Project Header */}
        <Surface style={styles.headerCard} elevation={2}>
          <View style={styles.headerTop}>
            <MaterialCommunityIcons
              name="folder-multiple"
              size={48}
              color={colors.accent.primary}
              accessibilityLabel="Project icon"
            />
            <Chip
              style={[styles.statusChip, { backgroundColor: getStatusColor(project.status) }]}
              textStyle={styles.chipText}
              accessibilityLabel={`Status: ${formatStatus(project.status)}`}
            >
              {formatStatus(project.status)}
            </Chip>
          </View>

          <Text variant="headlineMedium" style={styles.title}>
            {project.name}
          </Text>

          <Text variant="bodyMedium" style={styles.description}>
            {project.description}
          </Text>
        </Surface>

        {/* Progress Card */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Progress
          </Text>
          <View style={styles.progressContainer}>
            <ProgressBar
              progress={progress}
              color={colors.accent.primary}
              style={styles.progressBar}
              accessibilityLabel={`Progress: ${Math.round(progress * 100)}%`}
            />
            <Text variant="bodyMedium" style={styles.progressText}>
              {project.stats.completedTasks} / {project.stats.totalTasks} tasks completed ({Math.round(progress * 100)}%)
            </Text>
          </View>
        </Surface>

        {/* Task Statistics */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Task Statistics
          </Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <View style={[styles.statIndicator, { backgroundColor: colors.taskStatus.backlog }]} />
              <Text variant="bodyMedium" style={styles.statLabel}>Backlog</Text>
              <Text variant="titleLarge" style={styles.statValue}>{project.stats.backlogTasks}</Text>
            </View>
            <View style={styles.statItem}>
              <View style={[styles.statIndicator, { backgroundColor: colors.taskStatus.in_progress }]} />
              <Text variant="bodyMedium" style={styles.statLabel}>In Progress</Text>
              <Text variant="titleLarge" style={styles.statValue}>{project.stats.inProgressTasks}</Text>
            </View>
            <View style={styles.statItem}>
              <View style={[styles.statIndicator, { backgroundColor: colors.taskStatus.ai_review }]} />
              <Text variant="bodyMedium" style={styles.statLabel}>AI Review</Text>
              <Text variant="titleLarge" style={styles.statValue}>{project.stats.aiReviewTasks}</Text>
            </View>
            <View style={styles.statItem}>
              <View style={[styles.statIndicator, { backgroundColor: colors.taskStatus.human_review }]} />
              <Text variant="bodyMedium" style={styles.statLabel}>Human Review</Text>
              <Text variant="titleLarge" style={styles.statValue}>{project.stats.humanReviewTasks}</Text>
            </View>
            <View style={styles.statItem}>
              <View style={[styles.statIndicator, { backgroundColor: colors.taskStatus.done }]} />
              <Text variant="bodyMedium" style={styles.statLabel}>Done</Text>
              <Text variant="titleLarge" style={styles.statValue}>{project.stats.completedTasks}</Text>
            </View>
          </View>
        </Surface>

        {/* Quick Actions */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Quick Actions
          </Text>
          <View style={styles.actionsRow}>
            <Button
              mode="contained"
              icon="plus"
              onPress={() => {
                // Navigation to /task/create will be implemented in Phase 5.3
              }}
              style={styles.actionButton}
              buttonColor={colors.accent.primary}
              textColor={colors.text.inverse}
              accessibilityLabel="Create new task"
            >
              New Task
            </Button>
            <Button
              mode="outlined"
              icon="map-marker-path"
              onPress={() => {
                // Navigation to /roadmap will be implemented in Phase 5.7
              }}
              style={styles.actionButton}
              textColor={colors.text.secondary}
              accessibilityLabel="View roadmap"
            >
              Roadmap
            </Button>
          </View>
          <View style={styles.actionsRow}>
            <Button
              mode="outlined"
              icon="lightbulb-outline"
              onPress={() => {
                // Navigation to /ideation will be implemented in Phase 5.7
              }}
              style={styles.actionButton}
              textColor={colors.text.secondary}
              accessibilityLabel="View ideation"
            >
              Ideation
            </Button>
            <Button
              mode="outlined"
              icon="file-tree"
              onPress={() => {
                // Navigation to /context will be implemented in Phase 5.7
              }}
              style={styles.actionButton}
              textColor={colors.text.secondary}
              accessibilityLabel="View context"
            >
              Context
            </Button>
          </View>
        </Surface>

        {/* Repository */}
        {project.repositoryUrl && (
          <Surface style={styles.card} elevation={1}>
            <View style={styles.repoRow}>
              <MaterialCommunityIcons
                name="github"
                size={24}
                color={colors.text.secondary}
              />
              <Text variant="bodyMedium" style={styles.repoUrl} numberOfLines={1}>
                {project.repositoryUrl}
              </Text>
              <MaterialCommunityIcons
                name="open-in-new"
                size={20}
                color={colors.text.muted}
              />
            </View>
          </Surface>
        )}

        {/* Metadata */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Metadata
          </Text>
          <View style={styles.metadataRow}>
            <Text variant="bodySmall" style={styles.metadataLabel}>
              Project ID
            </Text>
            <Text variant="bodySmall" style={styles.metadataValue}>
              {project.id}
            </Text>
          </View>
          <View style={styles.metadataRow}>
            <Text variant="bodySmall" style={styles.metadataLabel}>
              Created
            </Text>
            <Text variant="bodySmall" style={styles.metadataValue}>
              {new Date(project.createdAt).toLocaleDateString()}
            </Text>
          </View>
          <View style={styles.metadataRow}>
            <Text variant="bodySmall" style={styles.metadataLabel}>
              Last Opened
            </Text>
            <Text variant="bodySmall" style={styles.metadataValue}>
              {new Date(project.lastOpenedAt).toLocaleDateString()}
            </Text>
          </View>
        </Surface>

        {/* Placeholder Hint */}
        <Text variant="bodySmall" style={styles.hint}>
          Full project details with roadmap preview will be implemented in Phase 5.6
        </Text>
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
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  statusChip: {
    marginRight: 0,
  },
  chipText: {
    color: colors.text.primary,
    fontSize: 12,
  },
  title: {
    color: colors.text.primary,
    fontWeight: 'bold',
    marginBottom: spacing.sm,
  },
  description: {
    color: colors.text.secondary,
    lineHeight: 22,
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
    marginBottom: spacing.md,
  },
  progressContainer: {
    alignItems: 'stretch',
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surface.secondary,
    marginBottom: spacing.sm,
  },
  progressText: {
    color: colors.text.secondary,
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statItem: {
    alignItems: 'center',
    width: '30%',
    paddingVertical: spacing.sm,
  },
  statIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginBottom: spacing.xs,
  },
  statLabel: {
    color: colors.text.muted,
    fontSize: 11,
    textAlign: 'center',
  },
  statValue: {
    color: colors.text.primary,
    fontWeight: 'bold',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  actionButton: {
    flex: 1,
    borderColor: colors.surface.border,
  },
  repoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  repoUrl: {
    flex: 1,
    color: colors.text.secondary,
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
  hint: {
    color: colors.text.muted,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
});
