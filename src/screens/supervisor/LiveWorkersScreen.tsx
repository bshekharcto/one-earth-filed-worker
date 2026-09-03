import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Dimensions, StatusBar, FlatList,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, AnimatedRegion } from 'react-native-maps';
import { Colors, Typography, Spacing, Radius, Shadow, MapStyle, SOLAPUR_CENTER } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';
import { subscribeAllWorkers } from '../../services/socket';
import { getLiveRoster } from '../../services/api';
import { extrapolate, shortestBearingDelta, computeBearing } from '../../components/map/DeadReckoningEngine';
import { WorkerPosition } from '../../types';

const { width, height } = Dimensions.get('window');

export const LiveWorkersScreen: React.FC = () => {
  const lang = authStore.getLang();
  const t = strings[lang];

  const mapRef = useRef<MapView>(null);
  const [workers, setWorkers] = useState<Map<string, WorkerPosition>>(new Map());
  const [selectedWorker, setSelectedWorker] = useState<WorkerPosition | null>(null);
  const [followMode, setFollowMode] = useState(false);
  const [filterRole, setFilterRole] = useState('ALL');
  const markerAnimations = useRef<Map<string, AnimatedRegion>>(new Map());
  const extrapolationTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial roster
  useEffect(() => {
    getLiveRoster().then((roster: any[]) => {
      const map = new Map<string, WorkerPosition>();
      roster.forEach(s => {
        if (s.status === 'ON_DUTY' && s.currentLat && s.currentLng) {
          const pos: WorkerPosition = {
            staffId: s.id, name: s.name, employeeCode: s.employeeCode,
            role: s.role, wardId: s.wardId,
            lat: Number(s.currentLat), lng: Number(s.currentLng),
            speed: 0, heading: 0, battery: s.batteryPercent || 85,
            timestamp: new Date().toISOString(),
            isOnline: true, lastSeenMs: 0,
          };
          map.set(s.id, pos);
          markerAnimations.current.set(s.id, new AnimatedRegion({
            latitude: pos.lat, longitude: pos.lng,
            latitudeDelta: 0, longitudeDelta: 0,
          }));
        }
      });
      setWorkers(new Map(map));
    }).catch(() => {});
  }, []);

  // Subscribe to live socket updates
  useEffect(() => {
    const unsub = subscribeAllWorkers((data: any) => {
      const { staffId, lat, lng, speed, heading, battery, timestamp, name, role, wardId } = data;
      setWorkers(prev => {
        const updated = new Map(prev);
        const existing = updated.get(staffId);
        const newPos: WorkerPosition = {
          staffId, lat: Number(lat), lng: Number(lng),
          name: name || existing?.name || staffId,
          employeeCode: existing?.employeeCode || staffId,
          role: role || existing?.role || '',
          wardId: wardId || existing?.wardId || '',
          speed: Number(speed) || 0, heading: Number(heading) || 0,
          battery: Number(battery) || 85,
          timestamp, isOnline: true, lastSeenMs: 0,
        };
        updated.set(staffId, newPos);

        // Animate marker smoothly (Uber-style)
        if (!markerAnimations.current.has(staffId)) {
          markerAnimations.current.set(staffId, new AnimatedRegion({
            latitude: Number(lat), longitude: Number(lng),
            latitudeDelta: 0, longitudeDelta: 0,
          }));
        } else {
          markerAnimations.current.get(staffId)!.timing({
            latitude: Number(lat), longitude: Number(lng),
            latitudeDelta: 0, longitudeDelta: 0,
            duration: 900, useNativeDriver: false,
          } as any).start();
        }

        // Follow selected worker
        if (followMode && selectedWorker?.staffId === staffId) {
          mapRef.current?.animateToRegion({
            latitude: Number(lat), longitude: Number(lng),
            latitudeDelta: 0.005, longitudeDelta: 0.005,
          }, 800);
        }
        return updated;
      });
    });

    // Dead reckoning: extrapolate every 2s for workers with gaps
    extrapolationTimer.current = setInterval(() => {
      const now = Date.now();
      setWorkers(prev => {
        let changed = false;
        const updated = new Map(prev);
        updated.forEach((w, id) => {
          const lastMs = new Date(w.timestamp).getTime();
          const gapMs = now - lastMs;
          if (gapMs > 15000 && gapMs <= 90000 && w.speed > 1) {
            const extrapolated = extrapolate(
              { lat: w.lat, lng: w.lng, speedKmh: w.speed, headingDeg: w.heading, lastTimestamp: w.timestamp },
              now
            );
            if (extrapolated && extrapolated.isExtrapolated) {
              updated.set(id, { ...w, lat: extrapolated.lat, lng: extrapolated.lng, isExtrapolated: true, lastSeenMs: gapMs });
              markerAnimations.current.get(id)?.timing({
                latitude: extrapolated.lat, longitude: extrapolated.lng,
                latitudeDelta: 0, longitudeDelta: 0,
                duration: 2000, useNativeDriver: false,
              } as any).start();
              changed = true;
            }
          }
          // Mark offline if > 5 minutes
          if (gapMs > 300000 && w.isOnline) {
            updated.set(id, { ...w, isOnline: false, lastSeenMs: gapMs });
            changed = true;
          }
        });
        return changed ? updated : prev;
      });
    }, 2000);

    return () => {
      unsub();
      if (extrapolationTimer.current) clearInterval(extrapolationTimer.current);
    };
  }, [followMode, selectedWorker]);

  const roles = ['ALL', 'SWEEPER', 'D2D_VERIFIER', 'MUKADAM_SUPERVISOR', 'SANITATION_INSPECTOR'];
  const roleLabel = (r: string) => ({ ALL: 'All', SWEEPER: 'Sweeper', D2D_VERIFIER: 'D2D', MUKADAM_SUPERVISOR: 'Mukadam', SANITATION_INSPECTOR: 'Inspector' }[r] || r);

  const visibleWorkers = Array.from(workers.values()).filter(w =>
    filterRole === 'ALL' || w.role === filterRole
  );

  const onMarkerPress = (w: WorkerPosition) => {
    setSelectedWorker(w);
    mapRef.current?.animateToRegion({
      latitude: w.lat, longitude: w.lng,
      latitudeDelta: 0.004, longitudeDelta: 0.004,
    }, 700);
  };

  const markerColor = (w: WorkerPosition) => {
    if (!w.isOnline) return Colors.markerOffline;
    if (w.isExtrapolated) return Colors.warning;
    return Colors.markerWorker;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        customMapStyle={MapStyle}
        initialRegion={{ latitude: SOLAPUR_CENTER.lat, longitude: SOLAPUR_CENTER.lng, latitudeDelta: 0.06, longitudeDelta: 0.06 }}
        showsUserLocation={false}
        showsCompass={false}
        showsScale={false}
      >
        {visibleWorkers.map(w => {
          const anim = markerAnimations.current.get(w.staffId);
          if (!anim) return null;
          return (
            <Marker.Animated
              key={w.staffId}
              coordinate={anim as any}
              onPress={() => onMarkerPress(w)}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.marker, { borderColor: markerColor(w) }]}>
                <Text style={styles.markerIcon}>👷</Text>
                {w.isExtrapolated && <View style={styles.estimatedDot} />}
              </View>
              <View style={[styles.markerLabel, { backgroundColor: markerColor(w) }]}>
                <Text style={styles.markerLabelText}>{w.name.split(' ')[0]}</Text>
              </View>
            </Marker.Animated>
          );
        })}
      </MapView>

      {/* Top controls */}
      <View style={styles.topBar}>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>👷 {visibleWorkers.filter(w => w.isOnline).length} Live</Text>
        </View>
        <TouchableOpacity
          style={[styles.followBtn, followMode && styles.followBtnActive]}
          onPress={() => setFollowMode(f => !f)}
        >
          <Text style={styles.followBtnText}>{t.followMode} {followMode ? '🔵' : '⚫'}</Text>
        </TouchableOpacity>
      </View>

      {/* Role filter chips */}
      <View style={styles.filterRow}>
        {roles.map(r => (
          <TouchableOpacity
            key={r}
            style={[styles.filterChip, filterRole === r && styles.filterChipActive]}
            onPress={() => setFilterRole(r)}
          >
            <Text style={[styles.filterChipText, filterRole === r && styles.filterChipTextActive]}>
              {roleLabel(r)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Selected worker panel */}
      {selectedWorker && (
        <View style={styles.workerPanel}>
          <View style={styles.workerPanelRow}>
            <Text style={styles.workerPanelName}>{selectedWorker.name}</Text>
            <TouchableOpacity onPress={() => setSelectedWorker(null)}>
              <Text style={styles.panelClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.workerPanelMeta}>{selectedWorker.employeeCode} · {selectedWorker.wardId.toUpperCase()}</Text>
          <View style={styles.workerPanelStats}>
            <Text style={styles.workerStat}>🔋 {selectedWorker.battery}%</Text>
            <Text style={styles.workerStat}>⚡ {selectedWorker.speed.toFixed(1)} km/h</Text>
            <Text style={[styles.workerStat, !selectedWorker.isOnline && { color: Colors.warning }]}>
              {selectedWorker.isOnline ? '🟢 Online' : `🟡 ${t.signalLost}`}
            </Text>
          </View>
          {selectedWorker.isExtrapolated && (
            <Text style={styles.extrapolatedNote}>📍 Estimated position (extrapolated)</Text>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  map: { flex: 1 },
  topBar: {
    position: 'absolute', top: 50, left: Spacing.lg, right: Spacing.lg,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  countBadge: {
    backgroundColor: Colors.glass, borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: Colors.glassBorder,
  },
  countText: { color: Colors.textPrimary, fontSize: Typography.size.sm, fontWeight: Typography.weight.bold },
  followBtn: {
    backgroundColor: Colors.glass, borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: Colors.glassBorder,
  },
  followBtnActive: { backgroundColor: 'rgba(59,130,246,0.3)', borderColor: Colors.primary },
  followBtnText: { color: Colors.textPrimary, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold },
  filterRow: {
    position: 'absolute', top: 100, left: 0, right: 0,
    flexDirection: 'row', paddingHorizontal: Spacing.lg, gap: Spacing.xs,
  },
  filterChip: {
    backgroundColor: Colors.glass, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: Colors.glassBorder,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primaryDark },
  filterChipText: { color: Colors.textSecondary, fontSize: Typography.size.xs, fontWeight: Typography.weight.medium },
  filterChipTextActive: { color: '#fff' },
  marker: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, ...Shadow.md,
  },
  markerIcon: { fontSize: 18 },
  estimatedDot: {
    position: 'absolute', top: -2, right: -2,
    width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.warning,
  },
  markerLabel: {
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
    marginTop: 2, alignSelf: 'center',
  },
  markerLabelText: { color: '#fff', fontSize: 9, fontWeight: Typography.weight.bold },
  workerPanel: {
    position: 'absolute', bottom: 20, left: Spacing.lg, right: Spacing.lg,
    backgroundColor: Colors.glass, borderRadius: Radius.xl,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.glassBorder,
    ...Shadow.lg,
  },
  workerPanelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  workerPanelName: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  panelClose: { color: Colors.textSecondary, fontSize: 18, padding: 4 },
  workerPanelMeta: { fontSize: Typography.size.sm, color: Colors.textSecondary, marginTop: 2, marginBottom: Spacing.sm },
  workerPanelStats: { flexDirection: 'row', gap: Spacing.lg },
  workerStat: { fontSize: Typography.size.sm, color: Colors.textPrimary },
  extrapolatedNote: { fontSize: Typography.size.xs, color: Colors.warning, marginTop: Spacing.xs },
});

