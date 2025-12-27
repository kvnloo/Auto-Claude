/**
 * Terminal Detail Screen (Stub)
 * Full implementation in Phase 5.10
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Surface, Text, Avatar } from 'react-native-paper';
import { useLocalSearchParams, Stack } from 'expo-router';
import { colors, spacing } from '../../theme';

/**
 * Terminal detail screen
 * Displays terminal output for a specific session
 */
export default function TerminalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen
        options={{
          title: `Terminal ${id}`,
          headerStyle: { backgroundColor: colors.background.secondary },
          headerTintColor: colors.text.primary,
          headerShadowVisible: false,
        }}
      />
      <View style={styles.container}>
        <Surface style={styles.card} elevation={1}>
          <Avatar.Icon
            size={64}
            icon="console-line"
            style={styles.icon}
            color={colors.accent.primary}
          />
          <Text variant="headlineSmall" style={styles.title}>
            Terminal Session
          </Text>
          <Text variant="bodyMedium" style={styles.description}>
            Terminal output viewer will be implemented in Phase 5.10
          </Text>
          <Text variant="bodySmall" style={styles.hint}>
            This screen will show real-time terminal output with auto-scroll
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
    backgroundColor: colors.accent.primary + '20',
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
