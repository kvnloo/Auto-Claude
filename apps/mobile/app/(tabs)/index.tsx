/**
 * Home Screen (Dashboard)
 * Main dashboard with Kanban task board
 * This stub will be fully implemented in Phase 5.1
 */

import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { colors, spacing } from '../../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * Home tab screen component
 * Displays placeholder content until Kanban board is implemented
 */
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Surface style={styles.card} elevation={2}>
        <MaterialCommunityIcons
          name="view-dashboard"
          size={64}
          color={colors.accent.primary}
          accessibilityLabel="Dashboard icon"
        />
        <Text variant="headlineMedium" style={styles.title}>
          Home
        </Text>
        <Text variant="bodyMedium" style={styles.description}>
          Task Kanban board will be displayed here
        </Text>
        <Text variant="bodySmall" style={styles.hint}>
          Drag and drop tasks between columns
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
