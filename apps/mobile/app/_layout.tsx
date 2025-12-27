/**
 * Root Layout
 * Wraps the entire app with necessary providers:
 * - QueryClientProvider (TanStack Query)
 * - PaperProvider (React Native Paper)
 *
 * Note: The queryClient is imported from api/client.ts which sets up
 * AppState and NetInfo integrations for proper React Native support.
 */

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { PaperProvider } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

import { darkTheme, colors } from '../theme';
import { queryClient } from '../api/client';

/**
 * Stack screen options with dark theme styling
 */
const screenOptions = {
  headerStyle: {
    backgroundColor: colors.background.secondary,
  },
  headerTintColor: colors.text.primary,
  headerTitleStyle: {
    fontWeight: 'bold' as const,
  },
  contentStyle: {
    backgroundColor: colors.background.primary,
  },
  headerShadowVisible: false,
  animation: 'default' as const,
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <QueryClientProvider client={queryClient}>
        <PaperProvider theme={darkTheme}>
          <StatusBar style="light" />
          <Stack screenOptions={screenOptions}>
            {/* Tab Navigator - hides header since tabs have their own */}
            <Stack.Screen
              name="(tabs)"
              options={{ headerShown: false }}
            />

            {/* Task Detail Screen */}
            <Stack.Screen
              name="task/[id]"
              options={{
                title: 'Task Details',
                presentation: 'card',
              }}
            />

            {/* Task Creation Wizard */}
            <Stack.Screen
              name="task/create"
              options={{
                title: 'Create Task',
                presentation: 'modal',
              }}
            />

            {/* Project Detail Screen */}
            <Stack.Screen
              name="project/[id]"
              options={{
                title: 'Project Details',
                presentation: 'card',
              }}
            />

            {/* GitHub Issue Detail */}
            <Stack.Screen
              name="github/issue/[id]"
              options={{
                title: 'Issue Details',
                presentation: 'card',
              }}
            />

            {/* GitHub PR Detail */}
            <Stack.Screen
              name="github/pr/[id]"
              options={{
                title: 'Pull Request',
                presentation: 'card',
              }}
            />

            {/* Terminal List */}
            <Stack.Screen
              name="terminal/index"
              options={{
                title: 'Terminals',
                presentation: 'card',
              }}
            />

            {/* Terminal Detail */}
            <Stack.Screen
              name="terminal/[id]"
              options={{
                title: 'Terminal',
                presentation: 'card',
              }}
            />

            {/* Roadmap Screen */}
            <Stack.Screen
              name="roadmap"
              options={{
                title: 'Roadmap',
                presentation: 'card',
              }}
            />

            {/* Ideation Screen */}
            <Stack.Screen
              name="ideation"
              options={{
                title: 'Ideas',
                presentation: 'card',
              }}
            />

            {/* Context Screen */}
            <Stack.Screen
              name="context"
              options={{
                title: 'Context',
                presentation: 'card',
              }}
            />

            {/* Onboarding Wizard - Full screen, no header */}
            <Stack.Screen
              name="onboarding"
              options={{
                headerShown: false,
                presentation: 'fullScreenModal',
              }}
            />

            {/* Index redirect screen */}
            <Stack.Screen
              name="index"
              options={{
                headerShown: false,
              }}
            />
          </Stack>
        </PaperProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
});
