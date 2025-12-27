/**
 * Terminal List Screen (Stub)
 * Full implementation in Phase 5.10
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Surface, Text, Avatar } from 'react-native-paper';
import { Stack } from 'expo-router';
import { colors, spacing } from '../../theme';

/**
 * Terminal list screen
 * Displays list of active terminal sessions
 */
export default function TerminalListScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Terminals',
          headerStyle: { backgroundColor: colors.background.secondary },
          headerTintColor: colors.text.primary,
          headerShadowVisible: false,
        }}
      />
      <View style={styles.container}>
        <Surface style={styles.card} elevation={1}>
          <Avatar.Icon
            size={64}
            icon="console"
            style={styles.icon}
            color={colors.accent.primary}
          />
          <Text variant="headlineSmall" style={styles.title}>
            Terminal Sessions
          </Text>
          <Text variant="bodyMedium" style={styles.description}>
            Terminal list view will be implemented in Phase 5.10
          </Text>
          <Text variant="bodySmall" style={styles.hint}>
            This screen will show active terminal sessions with output preview
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
