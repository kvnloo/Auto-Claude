/**
 * Projects Screen
 * Project list and management view
 * This stub will be fully implemented in Phase 5.6
 */

import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { colors, spacing } from '../../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * Projects tab screen component
 * Displays placeholder content until project list is implemented
 */
export default function ProjectsScreen() {
  return (
    <View style={styles.container}>
      <Surface style={styles.card} elevation={2}>
        <MaterialCommunityIcons
          name="folder-multiple"
          size={64}
          color={colors.accent.primary}
          accessibilityLabel="Projects icon"
        />
        <Text variant="headlineMedium" style={styles.title}>
          Projects
        </Text>
        <Text variant="bodyMedium" style={styles.description}>
          Project list and management will be displayed here
        </Text>
        <Text variant="bodySmall" style={styles.hint}>
          View and manage your AutoClaude projects
        </Text>
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.background.secondary,
    borderRadius: 16,
    padding: spacing.xl,
    alignItems: 'center',
    maxWidth: 320,
    width: '100%',
  },
  title: {
    color: colors.text.primary,
    marginTop: spacing.md,
    fontWeight: 'bold',
  },
  description: {
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  hint: {
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
});
