import React, { useState, useEffect, useCallback } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { authStore } from './src/stores/authStore';
import { LoginScreen } from './src/screens/auth/LoginScreen';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AuthUser } from './src/types';
import { Colors } from './src/constants/theme';
import { PermissionGate } from './src/components/common/PermissionGate';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Check if user is already logged in (persisted across restarts)
    if (authStore.isLoggedIn()) {
      const savedUser = authStore.getUser();
      if (savedUser) setUser(savedUser);
    }
    setInitializing(false);
  }, []);

  // Stable identity. As an inline arrow this was a new function on every
  // render, which propagated into AppNavigator's memoised screen callbacks and
  // remounted every tab screen -- losing the selected vehicle and the map
  // camera each time you switched tabs.
  const handleLogout = useCallback(() => { authStore.logout(); setUser(null); }, []);

  if (initializing) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {user ? (
          // Gated after login so the requirement can match the role: a worker
          // is tracked and must grant "Allow all the time", a supervisor only
          // needs foreground location for the map.
          <PermissionGate
            requireBackground={user.role === 'WORKER'}
            onLogout={handleLogout}
          >
            <NavigationContainer>
              <AppNavigator user={user} onLogout={handleLogout} />
            </NavigationContainer>
          </PermissionGate>
        ) : (
          <LoginScreen onLoginSuccess={(u) => setUser(u)} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

