import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  StatusBar, Alert, Vibration, Platform,
} from 'react-native';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';
import { punchAttendance } from '../../services/api';
import { startTracking, stopTracking, getDistanceTodayKm, getLastPosition } from '../../services/gpsTracker';
import { enqueuePunch, getGPSQueueCount, runSync } from '../../services/offlineQueue';

export const WorkerDashboardScreen: React.FC = () => {
  const user = authStore.getUser()!;
  const lang = authStore.getLang();
  const t = strings[lang];

  const [isShiftActive, setIsShiftActive] = useState(authStore.isShiftActive());
  const [shiftSeconds, setShiftSeconds] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [distanceKm, setDistanceKm] = useState(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [battery, setBattery] = useState(85);
  const [lastLocation, setLastLocation] = useState<string>('Acquiring...');
  const [isSyncing, setIsSyncing] = useState(false);
  const [punchLoading, setPunchLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Shift timer
  useEffect(() => {
    if (isShiftActive) {
      const startTime = authStore.getShiftStartTime();
      if (startTime) {
        const elapsed = Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
        setShiftSeconds(elapsed);
      }
      timerRef.current = setInterval(() => setShiftSeconds(s => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setShiftSeconds(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isShiftActive]);

  // Network monitor + auto-sync
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => setIsOnline(!!state.isConnected));
    syncRef.current = setInterval(async () => {
      const net = await NetInfo.fetch();
      if (net.isConnected && isShiftActive && !isSyncing) {
        setIsSyncing(true);
        await runSync(user.id);
        setQueueCount(getGPSQueueCount());
        setIsSyncing(false);
      }
      setDistanceKm(getDistanceTodayKm());
      setQueueCount(getGPSQueueCount());
    }, 30000);
    return () => {
      unsub();
      if (syncRef.current) clearInterval(syncRef.current);
    };
  }, [isShiftActive, isSyncing]);

  // GPS accuracy display update
  useEffect(() => {
    let watcher: Location.LocationSubscription | null = null;
    if (isShiftActive) {
      Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 15000 }, loc => {
        setGpsAccuracy(Math.round(loc.coords.accuracy || 0));
        const pos = loc.coords;
        setLastLocation(`${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}`);
      }).then(w => { watcher = w; });
    }
    return () => { watcher?.remove(); };
  }, [isShiftActive]);

  const formatTime = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const handlePunchIn = async () => {
    setPunchLoading(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude, accuracy } = loc.coords;
      const punchPayload = {
        staffId: user.id, employeeCode: user.employeeCode,
        staffName: user.name, punchType: 'PUNCH_IN' as const,
        latitude, longitude, accuracy: accuracy || 10,
        wardId: user.wardId, zoneId: user.zoneId, batteryPercent: battery,
      };
      const net = await NetInfo.fetch();
      if (net.isConnected) {
        await punchAttendance(punchPayload);
      } else {
        enqueuePunch({ ...punchPayload, timestamp: new Date().toISOString() });
      }
      await startTracking(user.id);
      authStore.setShiftActive(true);
      setIsShiftActive(true);
      Vibration.vibrate([0, 100, 50, 100]);
      Alert.alert('✅', t.punchInSuccess);
    } catch (e) {
      Alert.alert('Error', t.noGPS);
    } finally {
      setPunchLoading(false);
    }
  };

  const handlePunchOut = async () => {
    Alert.alert(
      t.punchOut,
      'Are you sure you want to end your shift?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: t.punchOut, style: 'destructive',
          onPress: async () => {
            setPunchLoading(true);
            try {
              const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
              const { latitude, longitude, accuracy } = loc.coords;
              const punchPayload = {
                staffId: user.id, employeeCode: user.employeeCode,
                staffName: user.name, punchType: 'PUNCH_OUT' as const,
                latitude, longitude, accuracy: accuracy || 10,
                wardId: user.wardId, zoneId: user.zoneId, batteryPercent: battery,
              };
              const net = await NetInfo.fetch();
              if (net.isConnected) {
                await punchAttendance(punchPayload);
              } else {
                enqueuePunch({ ...punchPayload, timestamp: new Date().toISOString() });
              }
              await stopTracking();
              // Final sync
              setIsSyncing(true);
              await runSync(user.id);
              setIsSyncing(false);
              authStore.setShiftActive(false);
              setIsShiftActive(false);
              Vibration.vibrate([0, 200, 100, 200]);
              Alert.alert('✅', t.punchOutSuccess);
            } catch (e) {
              Alert.alert('Error', t.noGPS);
            } finally {
              setPunchLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>नमस्कार 👋</Text>
            <Text style={styles.workerName}>{user.name}</Text>
            <Text style={styles.workerMeta}>{user.employeeCode} · {user.wardId.toUpperCase()}</Text>
          </View>
          {/* Sync / Network Status */}
          <View style={[styles.statusPill, isOnline ? styles.statusOnline : styles.statusOffline]}>
            <View style={[styles.statusDot, { backgroundColor: isOnline ? Colors.success : Colors.warning }]} />
            <Text style={styles.statusText}>
              {isSyncing ? t.syncing : (isOnline ? t.online : `${t.offline} · ${queueCount} ${t.queued}`)}
            </Text>
          </View>
        </View>

        {/* Shift Timer Card */}
        <View style={[styles.timerCard, isShiftActive ? styles.timerCardActive : styles.timerCardInactive]}>
          <Text style={styles.timerLabel}>{t.shiftTimer}</Text>
          <Text style={styles.timerValue}>{formatTime(shiftSeconds)}</Text>
          {isShiftActive && (
            <View style={styles.timerPulse}>
              <View style={styles.timerPulseDot} />
              <Text style={styles.timerPulseText}>GPS ACTIVE</Text>
            </View>
          )}
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>🛣️</Text>
            <Text style={styles.statValue}>{distanceKm.toFixed(2)}</Text>
            <Text style={styles.statLabel}>{t.distanceToday} (km)</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>🔋</Text>
            <Text style={styles.statValue}>{battery}%</Text>
            <Text style={styles.statLabel}>{t.batteryLevel}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>📡</Text>
            <Text style={styles.statValue}>{gpsAccuracy != null ? `±${gpsAccuracy}m` : '--'}</Text>
            <Text style={styles.statLabel}>{t.gpsAccuracy}</Text>
          </View>
        </View>

        {/* Location Display */}
        {isShiftActive && (
          <View style={styles.locationCard}>
            <Text style={styles.locationIcon}>📍</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.locationLabel}>Current GPS</Text>
              <Text style={styles.locationValue}>{lastLocation}</Text>
            </View>
          </View>
        )}

        {/* Punch Button */}
        <TouchableOpacity
          style={[
            styles.punchBtn,
            isShiftActive ? styles.punchBtnOut : styles.punchBtnIn,
            punchLoading && styles.punchBtnDisabled,
          ]}
          onPress={isShiftActive ? handlePunchOut : handlePunchIn}
          disabled={punchLoading}
          activeOpacity={0.85}
        >
          <Text style={styles.punchIcon}>{isShiftActive ? '⏹️' : '▶️'}</Text>
          <Text style={styles.punchText}>
            {punchLoading ? 'Please wait...' : (isShiftActive ? t.punchOut : t.punchIn)}
          </Text>
        </TouchableOpacity>

        {/* Offline queue banner */}
        {queueCount > 0 && !isOnline && (
          <View style={styles.queueBanner}>
            <Text style={styles.queueText}>
              📦 {queueCount} GPS points queued — will sync when online
            </Text>
          </View>
        )}

      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.lg, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing['2xl'] },
  greeting: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  workerName: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  workerMeta: { fontSize: Typography.size.xs, color: Colors.primary, fontWeight: Typography.weight.medium, marginTop: 2 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full, borderWidth: 1,
  },
  statusOnline: { backgroundColor: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.3)' },
  statusOffline: { backgroundColor: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)' },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  timerCard: {
    borderRadius: Radius['2xl'], padding: Spacing['2xl'], marginBottom: Spacing.lg,
    alignItems: 'center', borderWidth: 1, ...Shadow.md,
  },
  timerCardActive: { backgroundColor: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)' },
  timerCardInactive: { backgroundColor: Colors.bgCard, borderColor: Colors.border },
  timerLabel: { fontSize: Typography.size.sm, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  timerValue: { fontSize: 52, fontWeight: Typography.weight.extrabold, color: Colors.textPrimary, fontVariant: ['tabular-nums'], marginVertical: 8 },
  timerPulse: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timerPulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  timerPulseText: { fontSize: Typography.size.xs, color: Colors.success, fontWeight: Typography.weight.bold, letterSpacing: 1 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  statCard: {
    flex: 1, backgroundColor: Colors.bgCard, borderRadius: Radius.lg,
    padding: Spacing.md, alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
  },
  statIcon: { fontSize: 20, marginBottom: 4 },
  statValue: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  statLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary, textAlign: 'center', marginTop: 2 },
  locationCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg,
    padding: Spacing.md, marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.border,
  },
  locationIcon: { fontSize: 20, marginRight: Spacing.md },
  locationLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  locationValue: { fontSize: Typography.size.sm, color: Colors.primary, fontFamily: 'monospace', marginTop: 2 },
  punchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius['2xl'], paddingVertical: 20, marginBottom: Spacing.lg,
    gap: Spacing.md, ...Shadow.glow,
  },
  punchBtnIn: { backgroundColor: Colors.punchIn },
  punchBtnOut: { backgroundColor: Colors.punchOut },
  punchBtnDisabled: { opacity: 0.6 },
  punchIcon: { fontSize: 24 },
  punchText: { fontSize: Typography.size.xl, fontWeight: Typography.weight.extrabold, color: '#fff' },
  queueBanner: {
    backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
  },
  queueText: { color: Colors.warning, fontSize: Typography.size.sm, textAlign: 'center' },
});
