import React, { useState, useEffect } from 'react';
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

  if (initializing) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {user ? (
          <NavigationContainer>
            <AppNavigator user={user} />
          </NavigationContainer>
        ) : (
          <LoginScreen onLoginSuccess={(u) => setUser(u)} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

