/**
 * Context Screen
 * File tree navigation and memory search
 * Full implementation in Phase 5.7
 */

import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { colors, spacing } from '../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * Context screen component
 * Displays placeholder content until context browser is implemented
 */
export default function ContextScreen() {
  return (
    <View style={styles.container}>
      <Surface style={styles.card} elevation={2}>
        <MaterialCommunityIcons
          name="file-tree"
          size={64}
          color={colors.accent.primary}
          accessibilityLabel="Context icon"
        />
        <Text variant="headlineMedium" style={styles.title}>
          Context
        </Text>
        <Text variant="bodyMedium" style={styles.description}>
          File tree and memory search will be displayed here
        </Text>
        <Text variant="bodySmall" style={styles.hint}>
          Browse project files and search memories
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
