/**
 * Task Creation Wizard
 * Multi-step form to create new tasks
 * Full implementation in Phase 5.3
 */

import { View, StyleSheet } from 'react-native';
import { Text, Surface, Button } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { colors, spacing } from '../../theme';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * Task creation wizard screen component
 * Displays placeholder content until wizard is implemented
 */
export default function TaskCreateScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Surface style={styles.card} elevation={2}>
        <MaterialCommunityIcons
          name="plus-circle-outline"
          size={64}
          color={colors.accent.primary}
          accessibilityLabel="Create task icon"
        />
        <Text variant="headlineMedium" style={styles.title}>
          Create Task
        </Text>
        <Text variant="bodyMedium" style={styles.description}>
          Multi-step task creation wizard will be displayed here
        </Text>
        <Text variant="bodySmall" style={styles.hint}>
          Title, description, category, priority, complexity, impact
        </Text>
        <Button
          mode="outlined"
          onPress={() => router.back()}
          style={styles.button}
          accessibilityLabel="Go back"
        >
          Go Back
        </Button>
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
  button: {
    marginTop: spacing.lg,
  },
});
