import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Dimensions, StatusBar, FlatList, Alert, Platform,
} from 'react-native';
import MapView, { Marker, Polyline, AnimatedRegion } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow, MapStyle, SOLAPUR_CENTER } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';
import { subscribeAllVehicles } from '../../services/socket';
import { getActiveVehicles, getVehicleTrail } from '../../services/api';
import { extrapolate, computeBearing } from '../../components/map/DeadReckoningEngine';
import { VehiclePosition } from '../../types';
import { HeaderDrawer } from '../../components/common/HeaderDrawer';

const { width, height } = Dimensions.get('window');

// Solapur geographical boundary check.
//
// This used to RELOCATE an out-of-area vehicle onto an invented grid around
// Solapur centre rather than reject it. The fleet DB holds ~46 auto-provisioned
// RESET-<id> placeholders (one per unrecognised IMEI) reporting from Kashmir,
// Sikkim and Ladakh, so the map filled up with vehicles at coordinates nobody
// ever reported. A position we cannot trust is dropped, not moved.
type TrailPoint = { lat: number; lng: number; t: number };

// Module scope on purpose: this survives the screen being unmounted and
// rebuilt when tabs change. Component state does not, which is why switching
// to Workers and back dropped the selected vehicle and reset the map from
// street level to the whole city -- the marker was still there, just no longer
// selected and no longer in view.
const lastView = { vehicleId: null as string | null, lat: 0, lng: 0, zoomed: false };

// Anything faster than this between two fixes is a GPS spike, not travel.
const MAX_TRAIL_KMH = 120;

const metresBetween = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371000, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const inSolapur = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= 17.2 && lat <= 18.1 && lng >= 75.2 && lng <= 76.4;

// Placeholder vehicles created by resolveVehicle() for unknown IMEIs. They are
// not real fleet, so they are not shown.
export const isPlaceholderVehicle = (registrationNumber?: string) =>
  String(registrationNumber || '').startsWith('RESET-');

export const LiveVehiclesScreen: React.FC<{ onLogout?: () => void }> = ({ onLogout }) => {
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState(authStore.getLang());
  const t = strings[lang];

  const mapRef = useRef<MapView>(null);
  const [vehicles, setVehicles] = useState<Map<string, VehiclePosition>>(new Map());
  const [selectedVehicle, setSelectedVehicle] = useState<VehiclePosition | null>(null);
  const [followMode, setFollowMode] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'MOVING' | 'IDLE' | 'OFFLINE'>('ALL');
  const markerAnimations = useRef<Map<string, AnimatedRegion>>(new Map());
  // Breadcrumb accumulated from socket events since the screen opened, plus
  // today's recorded path fetched on tap. Kept in a ref so appending a point
  // does not re-render every marker; trailVersion nudges the memo instead.
  const trails = useRef<Map<string, TrailPoint[]>>(new Map());
  const [historyTrail, setHistoryTrail] = useState<TrailPoint[]>([]);
  const vehiclesRef = useRef<Map<string, VehiclePosition>>(new Map());
  const [trailVersion, setTrailVersion] = useState(0);

  // Extracted so it can run again when the tab regains focus. Even with stable
  // screen identity, a stale roster leaves a vehicle missing until the next
  // socket event; refetching on focus makes the map correct immediately.
  const loadVehicles = useCallback(() => {
    getActiveVehicles().then((list: any[]) => {
      if (!Array.isArray(list)) return;
      const map = new Map<string, VehiclePosition>();

      list.forEach((v) => {
        if (v.currentLat && v.currentLng && !isPlaceholderVehicle(v.registrationNumber)) {
          const lat = Number(v.currentLat);
          const lng = Number(v.currentLng);
          if (!inSolapur(lat, lng)) return;
          const spd = Number(v.speed) || 0;

          const pos: VehiclePosition = {
            vehicleId: v.id, registrationNumber: v.registrationNumber || 'MH-13',
            vehicleType: v.vehicleType || 'COMPACTOR', driverName: v.driverName || 'Driver',
            lat, lng,
            speed: spd, heading: Number(v.heading) || 0, battery: 90,
            timestamp: v.lastPingTime || new Date().toISOString(),
            isOnline: v.status === 'MOVING' || v.status === 'IDLE' || spd > 0,
            isMoving: spd > 2,
          };
          map.set(v.id, pos);
          // Update the existing AnimatedRegion; do not replace it.
          //
          // Marker.Animated binds to this object once. loadVehicles runs again
          // on every tab focus, and unconditionally constructing a new
          // AnimatedRegion swapped it out from under every marker already on
          // the map -- the markers then had no live coordinate and vanished.
          const existing = markerAnimations.current.get(v.id);
          if (existing) {
            (existing as any).setValue({
              latitude: pos.lat, longitude: pos.lng,
              latitudeDelta: 0, longitudeDelta: 0,
            });
          } else {
            markerAnimations.current.set(v.id, new AnimatedRegion({
              latitude: pos.lat, longitude: pos.lng,
              latitudeDelta: 0, longitudeDelta: 0,
            }));
          }
        }
      });
      // Merge rather than replace: a socket update that arrived before this
      // request resolved must not be thrown away.
      setVehicles(prev => {
        const next = new Map(map);
        for (const [id, p] of prev) if (!next.has(id)) next.set(id, p);
        return next;
      });
    }).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    loadVehicles();
    // Put the camera and the selection back where they were. The map resets to
    // initialRegion whenever it is rebuilt, so without this the vehicle being
    // watched is left somewhere among 40+ markers at city zoom.
    if (lastView.vehicleId && lastView.zoomed) {
      const id = lastView.vehicleId;
      setTimeout(() => {
        mapRef.current?.animateToRegion({
          latitude: lastView.lat, longitude: lastView.lng,
          latitudeDelta: 0.005, longitudeDelta: 0.005,
        }, 500);
        const v = vehiclesRef.current.get(id);
        if (v) {
          setSelectedVehicle(v);
          getVehicleTrail(v.vehicleId).then(setHistoryTrail).catch(() => setHistoryTrail([]));
        }
      }, 350);
    }
  }, [loadVehicles]));

  useEffect(() => {
    loadVehicles();

    const unsub = subscribeAllVehicles((pos: VehiclePosition) => {
      const lat = Number(pos.lat);
      const lng = Number(pos.lng);
      // Ignore the update outright rather than pinning the marker somewhere
      // it never was -- a stale marker is honest, a moved one is not.
      if (!inSolapur(lat, lng) || isPlaceholderVehicle(pos.registrationNumber)) return;
      setVehicles(prev => {
        const updated = new Map(prev);
        const cleanPos = { ...pos, lat, lng };
        updated.set(pos.vehicleId, cleanPos);
        if (lastView.vehicleId === pos.vehicleId) { lastView.lat = lat; lastView.lng = lng; }

        // Append to this vehicle's breadcrumb, skipping sub-metre repeats so a
        // parked vehicle does not pile up thousands of identical points.
        const trail = trails.current.get(pos.vehicleId) || [];
        const last = trail[trail.length - 1];
        const t = Date.parse(pos.timestamp) || Date.now();
        if (!last || Math.abs(last.lat - lat) > 1e-5 || Math.abs(last.lng - lng) > 1e-5) {
          trail.push({ lat, lng, t });
          if (trail.length > 500) trail.shift();
          trails.current.set(pos.vehicleId, trail);
          setTrailVersion(v => v + 1);
        }

        let anim = markerAnimations.current.get(pos.vehicleId);
        if (!anim) {
          anim = new AnimatedRegion({ latitude: lat, longitude: lng, latitudeDelta: 0, longitudeDelta: 0 });
          markerAnimations.current.set(pos.vehicleId, anim);
        } else {
          (anim as any).timing({ latitude: lat, longitude: lng, duration: 1500, useNativeDriver: false }).start();

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

    return () => { unsub(); };
  }, []);

  // A vehicle counts as live only if a fix arrived recently. isOnline came
  // from the DB's status string, so a tracker that stopped transmitting days
  // ago still showed as MOVING -- green for a vehicle nobody was hearing from.
  const LIVE_WINDOW_MS = 3 * 60 * 1000;
  // Trackers and the server stamp fixes from their own clocks, which are not
  // the phone's. A fix a few seconds in the future is ordinary skew, not a bad
  // reading -- rejecting it (a >= 0) marked a vehicle that was transmitting
  // right now as offline, because its timestamp was 4s ahead of the handset.
  const CLOCK_SKEW_MS = 5 * 60 * 1000;
  const ageMs = (v: VehiclePosition) => Date.now() - new Date(v.timestamp).getTime();
  const isLive = (v: VehiclePosition) => {
    const a = ageMs(v);
    return Number.isFinite(a) && a > -CLOCK_SKEW_MS && a < LIVE_WINDOW_MS;
  };

  const getVehicleStatus = (v: VehiclePosition): 'MOVING' | 'IDLE' | 'OFFLINE' => {
    if (!isLive(v)) return 'OFFLINE';
    if (v.speed > 2) return 'MOVING';
    return 'IDLE';
  };

  const clearSelection = () => {
    setSelectedVehicle(null);
    setHistoryTrail([]);
    lastView.vehicleId = null;
    lastView.zoomed = false;
  };

  const onMarkerPress = (v: VehiclePosition) => {
    setSelectedVehicle(v);
    lastView.vehicleId = v.vehicleId;
    lastView.lat = v.lat; lastView.lng = v.lng; lastView.zoomed = true;
    mapRef.current?.animateToRegion({
      latitude: v.lat, longitude: v.lng,
      latitudeDelta: 0.005, longitudeDelta: 0.005,
    }, 700);

    // Pull today's recorded path so the line shows where the vehicle came
    // from, not merely what has arrived since this screen was opened.
    setHistoryTrail([]);
    getVehicleTrail(v.vehicleId)
      .then(setHistoryTrail)
      .catch(() => setHistoryTrail([]));
  };

  // History (already driven) + live breadcrumb, de-duped at the join so the
  // two segments form one continuous line.
  const selectedTrail = React.useMemo(() => {
    if (!selectedVehicle) return [];
    const live = trails.current.get(selectedVehicle.vehicleId) || [];

    // The breadcrumb starts when the screen opens; the history covers the whole
    // day, so the two overlap. Appending blindly replayed that shared stretch
    // and the line jumped back to where the vehicle had already been. Keep only
    // breadcrumb points newer than the last history point.
    const cutoff = historyTrail.length ? historyTrail[historyTrail.length - 1].t : -Infinity;
    const merged = [...historyTrail, ...live.filter(p => p.t > cutoff)].sort((a, b) => a.t - b.t);

    const out: TrailPoint[] = [];
    for (const p of merged) {
      const prev = out[out.length - 1];
      if (!prev) { out.push(p); continue; }
      // Skip repeats that are invisible at map zoom.
      const d = metresBetween(prev.lat, prev.lng, p.lat, p.lng);
      if (d < 1) continue;
      // A fix implying an impossible speed is a bad GPS reading, not a
      // journey. Drawing it puts a straight spike across the map.
      const dt = (p.t - prev.t) / 1000;
      if (dt > 0 && dt < 120 && (d / dt) * 3.6 > MAX_TRAIL_KMH) continue;
      out.push(p);
    }
    return out;
  }, [selectedVehicle, historyTrail, trailVersion]);

  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);

  const visibleVehicles = Array.from(vehicles.values()).filter(v => {
    if (filterStatus === 'ALL') return true;
    return getVehicleStatus(v) === filterStatus;
  });

  const getStatusBadgeColor = (status: 'MOVING' | 'IDLE' | 'OFFLINE') => {
    switch (status) {
      // Green means "this vehicle is sending data right now" -- matching the
      // worker map, where green is liveness rather than motion.
      case 'MOVING': return Colors.success;
      case 'IDLE': return Colors.warning;
      case 'OFFLINE': return Colors.markerOffline;
    }
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />

      <MapView
        ref={mapRef}
        style={styles.map}
        customMapStyle={MapStyle}
        initialRegion={{
          latitude: SOLAPUR_CENTER.lat, longitude: SOLAPUR_CENTER.lng,
          latitudeDelta: 0.08, longitudeDelta: 0.08,
        }}
        showsUserLocation={false}
        showsCompass={false}
      >
        {/* Route of the tapped vehicle: where it has driven today. */}
        {selectedVehicle && selectedTrail.length > 1 && (
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
              title="Start of today"
            >
              <View style={styles.trailStartDot} />
            </Marker>
          </>
        )}

        {visibleVehicles.map(v => {
          const anim = markerAnimations.current.get(v.vehicleId);
          if (!anim) return null;
          const status = getVehicleStatus(v);
          const badgeColor = getStatusBadgeColor(status);

          return (
            <Marker.Animated
              key={v.vehicleId}
              coordinate={anim as any}
              onPress={() => onMarkerPress(v)}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.vehicleMarker, { borderColor: badgeColor }]}>
                <MaterialCommunityIcons name="truck-outline" size={16} color={Colors.primary} />
              </View>
              <View style={[styles.plateBadge, { backgroundColor: badgeColor }]}>
                <Text style={styles.plateText}>{v.registrationNumber.slice(-4) || v.registrationNumber}</Text>
              </View>
            </Marker.Animated>
          );
        })}
      </MapView>

      {/* Top controls */}
      <View style={styles.topBar}>
        <View style={styles.countBadge}>
          <MaterialCommunityIcons name="truck-outline" size={16} color={Colors.primary} style={{ marginRight: 6 }} />
          <Text style={styles.countText}>{visibleVehicles.length} Vehicles</Text>
        </View>

        <TouchableOpacity
          style={[styles.followBtn, followMode && styles.followBtnActive]}
          onPress={() => setFollowMode(f => !f)}
        >
          <Feather name="crosshair" size={14} color={followMode ? Colors.primary : Colors.textPrimary} style={{ marginRight: 4 }} />
          <Text style={styles.followBtnText}>Follow</Text>
        </TouchableOpacity>

        {/* Hamburger Side Drawer Menu */}
        <HeaderDrawer onLogout={onLogout} onLangChange={() => setLang(authStore.getLang())} />
      </View>

      {/* Selected vehicle panel */}
      {selectedVehicle && (
        <View style={styles.vehiclePanel}>
          <View style={styles.vehiclePanelRow}>
            <Text style={styles.vehiclePanelName}>{selectedVehicle.registrationNumber}</Text>
            <TouchableOpacity onPress={clearSelection}>
              <Feather name="x" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.vehiclePanelSub}>{selectedVehicle.vehicleType} · {selectedVehicle.driverName}</Text>
          <View style={styles.vehiclePanelStats}>
            <Text style={styles.vehiclePanelStat}>⚡ {selectedVehicle.speed.toFixed(1)} km/h</Text>
            <Text style={styles.vehiclePanelStat}>🔋 {selectedVehicle.battery}%</Text>
          </View>
        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
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
  trailStartDot: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: Colors.success, borderWidth: 3, borderColor: '#fff',
  },
  followBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgCard, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Radius.full, ...Shadow.sm, borderWidth: 1, borderColor: Colors.border,
  },
  followBtnActive: { borderColor: Colors.primary, backgroundColor: '#EFF6FF' },
  followBtnText: { fontSize: 12, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },

  vehicleMarker: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.bgCard,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, ...Shadow.sm,
  },
  plateBadge: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, marginTop: 2 },
  plateText: { fontSize: 9, color: '#fff', fontWeight: Typography.weight.bold },

  vehiclePanel: {
    position: 'absolute', bottom: 20, left: 16, right: 16,
    backgroundColor: Colors.bgCard, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.lg,
  },
  vehiclePanelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  vehiclePanelName: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  vehiclePanelSub: { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2 },
  vehiclePanelStats: { flexDirection: 'row', gap: 12, marginTop: 8 },
  vehiclePanelStat: { fontSize: Typography.size.xs, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
});