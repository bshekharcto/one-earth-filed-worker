import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Dimensions, StatusBar, FlatList, Alert, Platform,
} from 'react-native';
import MapView, { Marker, Polyline, AnimatedRegion } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow, MapStyle, SOLAPUR_CENTER } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';
import { subscribeAllWorkers } from '../../services/socket';
import { getLiveRoster, getWorkerTrail } from '../../services/api';
import { extrapolate } from '../../components/map/DeadReckoningEngine';
import { WorkerPosition } from '../../types';
import { HeaderDrawer } from '../../components/common/HeaderDrawer';

const { width, height } = Dimensions.get('window');

// Solapur geographical boundary check
const sanitizeCoords = (lat: number, lng: number, index: number) => {
  // Only substitute when the fix is genuinely unusable. This previously
  // replaced ANY coordinate outside a Solapur bounding box with a constant
  // from the table below -- and the socket handler passes index 0, so every
  // worker outside that box was pinned to 17.6610/75.9250 and never moved,
  // which made live tracking look frozen when testing from anywhere else.
  const valid =
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) > 0.0001 && Math.abs(lng) > 0.0001 &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (valid) return { lat, lng };

  // Seeded/demo rows with no real position get spread around Solapur so they
  // do not all stack on null island.
  const offsets = [
    { lat: 17.6610, lng: 75.9250 },
    { lat: 17.6410, lng: 75.9030 },
    { lat: 17.6692, lng: 75.9136 },
    { lat: 17.6639, lng: 75.9151 },
    { lat: 17.6581, lng: 75.9099 },
    { lat: 17.6520, lng: 75.9010 },
    { lat: 17.6650, lng: 75.8950 },
    { lat: 17.6720, lng: 75.9180 },
    { lat: 17.6480, lng: 75.9120 },
  ];
  return offsets[index % offsets.length];
};

export const LiveWorkersScreen: React.FC<{ onLogout?: () => void }> = ({ onLogout }) => {
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState(authStore.getLang());
  const t = strings[lang];

  const mapRef = useRef<MapView>(null);
  const [workers, setWorkers] = useState<Map<string, WorkerPosition>>(new Map());
  const [selectedWorker, setSelectedWorker] = useState<WorkerPosition | null>(null);
  // Live breadcrumb per worker, appended on every socket update. Capped so a
  // long shift cannot grow the array without bound.
  const trails = useRef<Map<string, { lat: number; lng: number }[]>>(new Map());
  const MAX_TRAIL_POINTS = 2000;
  // Earlier path for the selected worker, fetched from telemetry history so the
  // line shows where they came from -- not just since this screen was opened.
  const [historyTrail, setHistoryTrail] = useState<{ lat: number; lng: number }[]>([]);
  const [trailVersion, setTrailVersion] = useState(0);
  const [followMode, setFollowMode] = useState(false);
  const [filterRole, setFilterRole] = useState('ALL');
  const markerAnimations = useRef<Map<string, AnimatedRegion>>(new Map());
  const extrapolationTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial roster from Neon DB
  // A worker counts as live while their last fix is inside this window.
  // Matches the server's `isLive` in /field/live-roster so both agree.
  const LIVE_WINDOW_MS = 3 * 60 * 1000;
  // GPS only fires every 15s AND after 20m of movement, so a slow or
  // stationary worker legitimately goes quiet for a while. Only treat them as
  // "extrapolated" once they are well past that, and only if actually moving.
  const STALE_MS = 90 * 1000;

  const ageMs = (w: WorkerPosition) => Date.now() - new Date(w.timestamp).getTime();
  const isLive = (w: WorkerPosition) => ageMs(w) < LIVE_WINDOW_MS;

  useEffect(() => {
    getLiveRoster().then((roster: any[]) => {
      const map = new Map<string, WorkerPosition>();

      roster.forEach((s, idx) => {
        if (s.currentLat && s.currentLng) {
          const rawLat = Number(s.currentLat);
          const rawLng = Number(s.currentLng);
          const { lat, lng } = sanitizeCoords(rawLat, rawLng, idx);

          const pos: WorkerPosition = {
            staffId: s.id, name: s.name || 'Worker', employeeCode: s.employeeCode || 'SMC-001',
            role: s.role || 'SWEEPER', wardId: s.wardId || 'ward-01',
            lat, lng,
            speed: 0, heading: 0, battery: s.batteryPercent ?? -1,
            // Was `new Date()` + `status === 'ON_DUTY'`: every worker looked
            // freshly seen at load (green) and the staleness timer then flipped
            // them orange 30s later, regardless of whether they had ever sent
            // GPS. Use the server's real last_seen_at instead.
            timestamp: s.lastSeenAt || new Date(0).toISOString(),
            isOnline: !!s.isLive, lastSeenMs: 0,
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

    // WebSocket real-time updates
    const unsub = subscribeAllWorkers((pos: WorkerPosition) => {
      setWorkers(prev => {
        const updated = new Map(prev);
        const { lat, lng } = sanitizeCoords(pos.lat, pos.lng, 0);
        const cleanPos = { ...pos, lat, lng, isOnline: true, lastSeenMs: 0 };
        updated.set(pos.staffId, cleanPos);

        // Append to the movement trail. Skip points that have not actually
        // moved so a stationary worker does not pile up duplicates.
        const trail = trails.current.get(pos.staffId) || [];
        const last = trail[trail.length - 1];
        if (!last || Math.abs(last.lat - lat) > 1e-7 || Math.abs(last.lng - lng) > 1e-7) {
          trail.push({ lat, lng });
          if (trail.length > MAX_TRAIL_POINTS) trail.shift();
          trails.current.set(pos.staffId, trail);
          // Trails live in a ref (mutating it will not re-render), so bump a
          // counter to redraw the polyline for the selected worker.
          setTrailVersion(v => v + 1);
        }

        let anim = markerAnimations.current.get(pos.staffId);
        if (!anim) {
          anim = new AnimatedRegion({ latitude: lat, longitude: lng, latitudeDelta: 0, longitudeDelta: 0 });
          markerAnimations.current.set(pos.staffId, anim);
        } else {
          // Match the ~2s GPS cadence so the marker glides continuously
          // instead of finishing early and sitting still.
          (anim as any).timing({ latitude: lat, longitude: lng, duration: 2000, useNativeDriver: false }).start();

        if (followMode && mapRef.current) {
          mapRef.current.animateCamera(
            { center: { latitude: lat, longitude: lng } },
            { duration: 800 }
          );
        }
        }
        return updated;
      });
    });

    // Dead-Reckoning Extrapolation Engine
    extrapolationTimer.current = setInterval(() => {
      setWorkers(prev => {
        const updated = new Map(prev);
        let changed = false;
        const now = Date.now();
        updated.forEach((w, id) => {
          const elapsedSec = (now - new Date(w.timestamp).getTime()) / 1000;
          if (isLive(w) && elapsedSec > STALE_MS / 1000 && (w.speed || 0) > 1) {
            const extInput = {
              lat: w.lat, lng: w.lng,
              speedKmh: w.speed || 0, headingDeg: w.heading || 0,
              lastTimestamp: w.timestamp,
            };
            const ext = extrapolate(extInput, now);
            if (ext) {
              updated.set(id, { ...w, lat: ext.lat, lng: ext.lng, isExtrapolated: true });
              changed = true;
            }
          }
        });
        return changed ? new Map(updated) : prev;
      });
    }, 5000);

    return () => {
      unsub();
      if (extrapolationTimer.current) clearInterval(extrapolationTimer.current);
    };
  }, []);

  const roles = ['ALL', 'SWEEPER', 'D2D_VERIFIER', 'MUKADAM_SUPERVISOR', 'SANITATION_INSPECTOR'];
  const roleLabel = (r: string) => ({ ALL: 'All', SWEEPER: 'Sweeper', D2D_VERIFIER: 'D2D', MUKADAM_SUPERVISOR: 'Mukadam', SANITATION_INSPECTOR: 'Inspector' }[r] || r);

  const visibleWorkers = Array.from(workers.values()).filter(w =>
    filterRole === 'ALL' || w.role === filterRole
  );

  useEffect(() => {
    if (visibleWorkers.length > 0 && mapRef.current) {
      const coords = visibleWorkers.map(w => ({ latitude: w.lat, longitude: w.lng }));
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 140, right: 60, bottom: 140, left: 60 },
        animated: true,
      });
    }
  }, [filterRole]);

  const onMarkerPress = (w: WorkerPosition) => {
    setSelectedWorker(w);
    mapRef.current?.animateToRegion({
      latitude: w.lat, longitude: w.lng,
      latitudeDelta: 0.004, longitudeDelta: 0.004,
    }, 700);

    // Pull today's recorded path so the line shows where this worker came
    // from, not merely what has arrived since this screen was opened.
    setHistoryTrail([]);
    getWorkerTrail(w.staffId)
      .then(setHistoryTrail)
      .catch(() => setHistoryTrail([]));
  };

  // History (already walked) + live breadcrumb (since screen open), de-duped
  // at the join so the two segments form one continuous line.
  const selectedTrail = React.useMemo(() => {
    if (!selectedWorker) return [];
    const live = trails.current.get(selectedWorker.staffId) || [];
    const merged = [...historyTrail, ...live];
    const out: { lat: number; lng: number }[] = [];
    for (const p of merged) {
      const prev = out[out.length - 1];
      if (!prev || Math.abs(prev.lat - p.lat) > 1e-7 || Math.abs(prev.lng - p.lng) > 1e-7) out.push(p);
    }
    return out;
  }, [selectedWorker, historyTrail, trailVersion]);

  const markerColor = (w: WorkerPosition) => {
    if (!isLive(w)) return Colors.markerOffline;
    // Amber only while dead-reckoning a MOVING worker; a stationary worker
    // simply has nothing to send and should stay green.
    if (w.isExtrapolated && ageMs(w) > STALE_MS && (w.speed || 0) > 1) return Colors.warning;
    return Colors.markerWorker;
  };

  const getFirstName = (name?: string) => {
    if (!name) return 'Worker';
    const parts = name.split(' ');
    return parts[0] || 'Worker';
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />

      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={MapStyle}
        initialRegion={{
          latitude: SOLAPUR_CENTER.lat,
          longitude: SOLAPUR_CENTER.lng,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        }}
        showsUserLocation={false}
        showsCompass={false}
        showsScale={false}
      >
        {/* Movement line for the tapped worker: where they have walked today.
            Drawn before the markers so the pins stay on top of the line. */}
        {selectedWorker && selectedTrail.length > 1 && (
          <>
            <Polyline
              coordinates={selectedTrail.map(p => ({ latitude: p.lat, longitude: p.lng }))}
              strokeColor={Colors.primary}
              strokeWidth={5}
              lineCap="round"
              lineJoin="round"
              geodesic
            />
            <Marker
              coordinate={{ latitude: selectedTrail[0].lat, longitude: selectedTrail[0].lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              title="Shift start"
            >
              <View style={styles.trailStartDot} />
            </Marker>
          </>
        )}

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
                <Feather name="user" size={14} color={Colors.primary} />
                {w.isExtrapolated && <View style={styles.estimatedDot} />}
              </View>
              <View style={[styles.markerLabel, { backgroundColor: markerColor(w) }]}>
                <Text style={styles.markerLabelText}>{getFirstName(w.name)}</Text>
              </View>
            </Marker.Animated>
          );
        })}
      </MapView>

      {/* Top controls */}
      <View style={styles.topBar}>
        <View style={styles.countBadge}>
          <Feather name="users" size={14} color={Colors.primary} style={{ marginRight: 6 }} />
          <Text style={styles.countText}>{visibleWorkers.filter(w => isLive(w)).length} Live</Text>
        </View>

        <TouchableOpacity
          style={[styles.followBtn, followMode && styles.followBtnActive]}
          onPress={() => setFollowMode(f => !f)}
        >
          <Feather name="crosshair" size={14} color={followMode ? Colors.primary : Colors.textPrimary} style={{ marginRight: 4 }} />
          <Text style={styles.followBtnText}>{t.followMode}</Text>
        </TouchableOpacity>

        {/* Hamburger Side Drawer Menu */}
        <HeaderDrawer onLogout={onLogout} onLangChange={() => setLang(authStore.getLang())} />
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
            <Text style={styles.workerPanelName}>{selectedWorker.name || 'Worker'}</Text>
            <TouchableOpacity onPress={() => setSelectedWorker(null)}>
              <Feather name="x" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.workerPanelRole}>{selectedWorker.employeeCode} · {selectedWorker.role}</Text>
          <View style={styles.workerPanelStats}>
            <Text style={styles.workerPanelStat}>
              🔋 {selectedWorker.battery >= 0 ? `${selectedWorker.battery}%` : '--'}
            </Text>
            <Text style={styles.workerPanelStat}>
              {isLive(selectedWorker) ? '🟢 Live' : '🔴 Offline'}
            </Text>
          </View>
        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  trailStartDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: Colors.success, borderWidth: 3, borderColor: '#fff',
  },
  container: { flex: 1, backgroundColor: Colors.bg },
  map: { flex: 1 },
  topBar: {
    position: 'absolute', top: 50, left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    gap: 8,
  },
  countBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgCard, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Radius.full, ...Shadow.sm, borderWidth: 1, borderColor: Colors.border,
  },
  countText: { fontSize: 12, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  followBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgCard, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Radius.full, ...Shadow.sm, borderWidth: 1, borderColor: Colors.border,
  },
  followBtnActive: { borderColor: Colors.primary, backgroundColor: '#EFF6FF' },
  followBtnText: { fontSize: 12, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },

  filterRow: {
    position: 'absolute', top: 100, left: 16, right: 16,
    flexDirection: 'row', gap: 6, flexWrap: 'wrap',
  },
  filterChip: {
    backgroundColor: Colors.bgCard, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, ...Shadow.xs,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 11, color: Colors.textSecondary },
  filterChipTextActive: { color: '#fff', fontWeight: Typography.weight.bold },

  marker: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.bgCard,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, ...Shadow.sm,
  },
  estimatedDot: { position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.warning },
  markerLabel: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, marginTop: 2 },
  markerLabelText: { fontSize: 9, color: '#fff', fontWeight: Typography.weight.bold },

  workerPanel: {
    position: 'absolute', bottom: 20, left: 16, right: 16,
    backgroundColor: Colors.bgCard, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.lg,
  },
  workerPanelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  workerPanelName: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  workerPanelRole: { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2 },
  workerPanelStats: { flexDirection: 'row', gap: 12, marginTop: 8 },
  workerPanelStat: { fontSize: Typography.size.xs, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
});