/**
 * Index Screen
 * Placeholder screen shown while navigation initializes
 * This will be replaced by tabs navigation once set up in Phase 2
 */

import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { colors } from '../theme';

/**
 * Main index route - shows loading state during initialization
 */
export default function IndexScreen() {
  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>
        AutoClaude Mobile
      </Text>
      <Text variant="bodyMedium" style={styles.subtitle}>
        Mobile companion app for AutoClaude
      </Text>
      <ActivityIndicator
        animating={true}
        color={colors.accent.primary}
        size="large"
        style={styles.loader}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    color: colors.text.primary,
    marginBottom: 10,
    fontWeight: 'bold',
  },
  subtitle: {
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: 30,
  },
  loader: {
    marginTop: 20,
  },
});
