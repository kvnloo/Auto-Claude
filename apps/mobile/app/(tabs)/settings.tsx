/**
 * Settings Screen
 * App configuration and preferences
 * This stub will be fully implemented in Phase 5.8
 */

import { View, StyleSheet } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { colors, spacing } from '../../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * Settings tab screen component
 * Displays placeholder content until settings interface is implemented
 */
export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Surface style={styles.card} elevation={2}>
        <MaterialCommunityIcons
          name="cog"
          size={64}
          color={colors.accent.primary}
          accessibilityLabel="Settings icon"
        />
        <Text variant="headlineMedium" style={styles.title}>
          Settings
        </Text>
        <Text variant="bodyMedium" style={styles.description}>
          App settings will be displayed here
        </Text>
        <Text variant="bodySmall" style={styles.hint}>
          Configure connection, theme, and notifications
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
