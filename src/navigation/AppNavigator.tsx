import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet } from 'react-native';
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

interface Props { user: AuthUser; }

const TabIcon = ({ icon, focused }: { icon: string; focused: boolean }) => (
  <Text style={{ fontSize: focused ? 22 : 18, opacity: focused ? 1 : 0.6 }}>{icon}</Text>
);

const TabLabel = ({ label, focused }: { label: string; focused: boolean }) => (
  <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
);

export const AppNavigator: React.FC<Props> = ({ user }) => {
  const lang = authStore.getLang();
  const t = strings[lang];

  if (user.role === 'WORKER') {
    return (
      <Tab.Navigator screenOptions={tabScreenOptions}>
        <Tab.Screen
          name="Home"
          component={WorkerDashboardScreen}
          options={{
            title: t.home,
            tabBarIcon: ({ focused }) => <TabIcon icon="🏠" focused={focused} />,
            tabBarLabel: ({ focused }) => <TabLabel label={t.home} focused={focused} />,
          }}
        />
        <Tab.Screen
          name="D2D"
          component={D2DScreen}
          options={{
            title: t.d2d,
            tabBarIcon: ({ focused }) => <TabIcon icon="🚪" focused={focused} />,
            tabBarLabel: ({ focused }) => <TabLabel label={t.d2d} focused={focused} />,
          }}
        />
      </Tab.Navigator>
    );
  }

  // Supervisor tabs
  return (
    <Tab.Navigator screenOptions={tabScreenOptions}>
      <Tab.Screen
        name="Workers"
        component={LiveWorkersScreen}
        options={{
          title: t.workers,
          tabBarIcon: ({ focused }) => <TabIcon icon="👷" focused={focused} />,
          tabBarLabel: ({ focused }) => <TabLabel label={t.workers} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Vehicles"
        component={LiveVehiclesScreen}
        options={{
          title: t.vehicles,
          tabBarIcon: ({ focused }) => <TabIcon icon="🚛" focused={focused} />,
          tabBarLabel: ({ focused }) => <TabLabel label={t.vehicles} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Playback"
        component={PlaybackScreen}
        options={{
          title: t.playback,
          tabBarIcon: ({ focused }) => <TabIcon icon="▶️" focused={focused} />,
          tabBarLabel: ({ focused }) => <TabLabel label={t.playback} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="D2D"
        component={D2DScreen}
        options={{
          title: t.d2d,
          tabBarIcon: ({ focused }) => <TabIcon icon="🚪" focused={focused} />,
          tabBarLabel: ({ focused }) => <TabLabel label={t.d2d} focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
};

const tabScreenOptions = {
  headerShown: false,
  tabBarStyle: {
    backgroundColor: Colors.bgCard,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: 64,
    paddingBottom: 8,
    paddingTop: 6,
  },
  tabBarActiveTintColor: Colors.primary,
  tabBarInactiveTintColor: Colors.textDisabled,
};

const styles = StyleSheet.create({
  tabLabel: { fontSize: 11, color: Colors.textDisabled, marginTop: 2 },
  tabLabelActive: { color: Colors.primary, fontWeight: Typography.weight.semibold },
});
