/**
 * GitHub PR Detail Screen (Stub)
 * Full implementation in Phase 5.5
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Surface, Text, Avatar } from 'react-native-paper';
import { useLocalSearchParams, Stack } from 'expo-router';
import { colors, spacing } from '../../../theme';

/**
 * GitHub PR detail screen
 * Displays detailed information about a specific pull request
 */
export default function PRDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen
        options={{
          title: `PR #${id}`,
          headerStyle: { backgroundColor: colors.background.secondary },
          headerTintColor: colors.text.primary,
          headerShadowVisible: false,
        }}
      />
      <View style={styles.container}>
        <Surface style={styles.card} elevation={1}>
          <Avatar.Icon
            size={64}
            icon="source-pull"
            style={styles.icon}
            color={colors.status.success}
          />
          <Text variant="headlineSmall" style={styles.title}>
            Pull Request #{id}
          </Text>
          <Text variant="bodyMedium" style={styles.description}>
            PR detail view will be implemented in Phase 5.5
          </Text>
          <Text variant="bodySmall" style={styles.hint}>
            This screen will show PR description, reviews, checks, diff stats, and action buttons
          </Text>
        </Surface>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
    padding: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.background.secondary,
    borderRadius: 16,
    padding: spacing.xl,
    alignItems: 'center',
    maxWidth: 400,
  },
  icon: {
    backgroundColor: colors.status.success + '20',
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text.primary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  description: {
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  hint: {
    color: colors.text.muted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
