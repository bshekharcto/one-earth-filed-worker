import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Typography } from '../constants/theme';
import { AuthUser } from '../types';
import { strings } from '../i18n/strings';
import { authStore } from '../stores/authStore';

// Worker screens
import { WorkerDashboardScreen } from '../screens/worker/WorkerDashboardScreen';
import { D2DScreen } from '../screens/worker/D2DScreen';

// Supervisor screens
import { LiveWorkersScreen } from '../screens/supervisor/LiveWorkersScreen';
import { LiveVehiclesScreen } from '../screens/supervisor/LiveVehiclesScreen';
import { PlaybackScreen } from '../screens/supervisor/PlaybackScreen';

const Tab = createBottomTabNavigator();

interface Props {
  user: AuthUser;
  onLogout: () => void;
}

const TabLabel = ({ label, focused }: { label: string; focused: boolean }) => (
  <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
);

export const AppNavigator: React.FC<Props> = ({ user, onLogout }) => {
  const insets = useSafeAreaInsets();
  const lang = authStore.getLang();
  const t = strings[lang];

  // Elevate bottom padding on Android so tabs sit safely ABOVE 3-button bar (||| O <)
  const bottomPadding = Platform.OS === 'android' ? Math.max(insets.bottom + 22, 30) : Math.max(insets.bottom, 14);
  const tabHeight = 62 + bottomPadding;

  const getTabOptions = () => ({
    headerShown: false,
    tabBarStyle: {
      backgroundColor: Colors.bgCard,
      borderTopColor: Colors.border,
      borderTopWidth: 1,
      height: tabHeight,
      paddingBottom: bottomPadding,
      paddingTop: 8,
      elevation: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
    },
    tabBarActiveTintColor: Colors.primary,
    tabBarInactiveTintColor: Colors.textDisabled,
  });

  if (user.role === 'WORKER') {
    return (
      <Tab.Navigator screenOptions={getTabOptions()}>
        <Tab.Screen
          name="Home"
          children={() => <WorkerDashboardScreen onLogout={onLogout} />}
          options={{
            title: t.home,
            tabBarIcon: ({ focused, color }) => (
              <Feather name="home" size={22} color={focused ? Colors.primary : Colors.textDisabled} />
            ),
            tabBarLabel: ({ focused }) => <TabLabel label={t.home} focused={focused} />,
          }}
        />
        <Tab.Screen
          name="D2D"
          children={() => <D2DScreen onLogout={onLogout} />}
          options={{
            title: t.d2d,
            tabBarIcon: ({ focused }) => (
              <Feather name="grid" size={22} color={focused ? Colors.primary : Colors.textDisabled} />
            ),
            tabBarLabel: ({ focused }) => <TabLabel label={t.d2d} focused={focused} />,
          }}
        />
      </Tab.Navigator>
    );
  }

  // Supervisor tabs
  return (
    <Tab.Navigator screenOptions={getTabOptions()}>
      <Tab.Screen
        name="Workers"
        children={() => <LiveWorkersScreen onLogout={onLogout} />}
        options={{
          title: t.workers,
          tabBarIcon: ({ focused }) => (
            <Feather name="users" size={22} color={focused ? Colors.primary : Colors.textDisabled} />
          ),
          tabBarLabel: ({ focused }) => <TabLabel label={t.workers} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Vehicles"
        children={() => <LiveVehiclesScreen onLogout={onLogout} />}
        options={{
          title: t.vehicles,
          tabBarIcon: ({ focused }) => (
            <MaterialCommunityIcons name="truck-outline" size={24} color={focused ? Colors.primary : Colors.textDisabled} />
          ),
          tabBarLabel: ({ focused }) => <TabLabel label={t.vehicles} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Playback"
        children={() => <PlaybackScreen onLogout={onLogout} />}
        options={{
          title: t.playback,
          tabBarIcon: ({ focused }) => (
            <Feather name="play-circle" size={22} color={focused ? Colors.primary : Colors.textDisabled} />
          ),
          tabBarLabel: ({ focused }) => <TabLabel label={t.playback} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="D2D"
        children={() => <D2DScreen onLogout={onLogout} />}
        options={{
          title: t.d2d,
          tabBarIcon: ({ focused }) => (
            <Feather name="grid" size={22} color={focused ? Colors.primary : Colors.textDisabled} />
          ),
          tabBarLabel: ({ focused }) => <TabLabel label={t.d2d} focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabLabel: { fontSize: 11, color: Colors.textDisabled, marginTop: 2 },
  tabLabelActive: { color: Colors.primary, fontWeight: Typography.weight.semibold },
});