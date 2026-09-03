import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Dimensions, StatusBar, FlatList,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, AnimatedRegion } from 'react-native-maps';
import { Colors, Typography, Spacing, Radius, Shadow, MapStyle, SOLAPUR_CENTER } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';
import { subscribeAllVehicles } from '../../services/socket';
import { getActiveVehicles } from '../../services/api';
import { extrapolate } from '../../components/map/DeadReckoningEngine';
import { VehiclePosition } from '../../types';

const { width, height } = Dimensions.get('window');

export const LiveVehiclesScreen: React.FC = () => {
  const lang = authStore.getLang();
  const t = strings[lang];

  const mapRef = useRef<MapView>(null);
  const [vehicles, setVehicles] = useState<Map<string, VehiclePosition>>(new Map());
  const [selectedVehicle, setSelectedVehicle] = useState<VehiclePosition | null>(null);
  const [followMode, setFollowMode] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'MOVING' | 'IDLE' | 'OFFLINE'>('ALL');
  const markerAnimations = useRef<Map<string, AnimatedRegion>>(new Map());
  const extrapolationTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load initial vehicles
  useEffect(() => {
    getActiveVehicles().then((list: any[]) => {
      const map = new Map<string, VehiclePosition>();
      list.forEach(v => {
        if (v.lat && v.lng) {
          const pos: VehiclePosition = {
            vehicleId: v.id,
            registrationNumber: v.registrationNumber || v.registration_number || v.id,
            makeModel: v.makeModel || v.make_model || 'Compactor Truck',
            zoneId: v.zoneId || v.zone_id || 'Zone-1',
            lat: Number(v.lat),
            lng: Number(v.lng),
            speed: Number(v.speed) || 0,
            heading: Number(v.heading) || 0,
            timestamp: v.timestamp || new Date().toISOString(),
            isOnline: true,
            lastSeenMs: 0,
          };
          map.set(v.id, pos);
          markerAnimations.current.set(v.id, new AnimatedRegion({
            latitude: pos.lat,
            longitude: pos.lng,
            latitudeDelta: 0,
            longitudeDelta: 0,
          }));
        }
      });
      setVehicles(new Map(map));
    }).catch((err) => {
      console.warn('[LiveVehicles] Failed to fetch active vehicles:', err.message);
    });
  }, []);

  // Subscribe to live socket updates
  useEffect(() => {
    const unsub = subscribeAllVehicles((data: any) => {
      const { vehicleId, lat, lng, speed, heading, timestamp, registrationNumber, makeModel, zoneId } = data;
      setVehicles(prev => {
        const updated = new Map(prev);
        const existing = updated.get(vehicleId);
        const newPos: VehiclePosition = {
          vehicleId,
          lat: Number(lat),
          lng: Number(lng),
          registrationNumber: registrationNumber || existing?.registrationNumber || vehicleId,
          makeModel: makeModel || existing?.makeModel || 'Waste Vehicle',
          zoneId: zoneId || existing?.zoneId || 'Zone-1',
          speed: Number(speed) || 0,
          heading: Number(heading) || 0,
          timestamp: timestamp || new Date().toISOString(),
          isOnline: true,
          lastSeenMs: 0,
        };
        updated.set(vehicleId, newPos);

        // Smooth animation like Uber
        if (!markerAnimations.current.has(vehicleId)) {
          markerAnimations.current.set(vehicleId, new AnimatedRegion({
            latitude: Number(lat),
            longitude: Number(lng),
            latitudeDelta: 0,
            longitudeDelta: 0,
          }));
        } else {
          markerAnimations.current.get(vehicleId)!.timing({
            latitude: Number(lat),
            longitude: Number(lng),
            latitudeDelta: 0,
            longitudeDelta: 0,
            duration: 1000,
            useNativeDriver: false,
          } as any).start();
        }

        // Camera follow
        if (followMode && selectedVehicle?.vehicleId === vehicleId) {
          mapRef.current?.animateToRegion({
            latitude: Number(lat),
            longitude: Number(lng),
            latitudeDelta: 0.006,
            longitudeDelta: 0.006,
          }, 800);
        }

        return updated;
      });
    });

    // Dead reckoning loop for vehicles with gap between 15s and 90s
    extrapolationTimer.current = setInterval(() => {
      const now = Date.now();
      setVehicles(prev => {
        let changed = false;
        const updated = new Map(prev);
        updated.forEach((v, id) => {
          const lastMs = new Date(v.timestamp).getTime();
          const gapMs = now - lastMs;

          if (gapMs > 15000 && gapMs <= 90000 && v.speed > 2) {
            const extrapolated = extrapolate(
              { lat: v.lat, lng: v.lng, speedKmh: v.speed, headingDeg: v.heading, lastTimestamp: v.timestamp },
              now
            );
            if (extrapolated && extrapolated.isExtrapolated) {
              updated.set(id, {
                ...v,
                lat: extrapolated.lat,
                lng: extrapolated.lng,
                lastSeenMs: gapMs,
              });
              markerAnimations.current.get(id)?.timing({
                latitude: extrapolated.lat,
                longitude: extrapolated.lng,
                latitudeDelta: 0,
                longitudeDelta: 0,
                duration: 2000,
                useNativeDriver: false,
              } as any).start();
              changed = true;
            }
          }

          if (gapMs > 300000 && v.isOnline) {
            updated.set(id, { ...v, isOnline: false, lastSeenMs: gapMs });
            changed = true;
          }
        });
        return changed ? updated : prev;
      });
    }, 2500);

    return () => {
      unsub();
      if (extrapolationTimer.current) clearInterval(extrapolationTimer.current);
    };
  }, [followMode, selectedVehicle]);

  const onMarkerPress = (v: VehiclePosition) => {
    setSelectedVehicle(v);
    mapRef.current?.animateToRegion({
      latitude: v.lat,
      longitude: v.lng,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    }, 600);
  };

  const getVehicleStatus = (v: VehiclePosition): 'MOVING' | 'IDLE' | 'OFFLINE' => {
    if (!v.isOnline) return 'OFFLINE';
    if (v.speed > 2) return 'MOVING';
    return 'IDLE';
  };

  const visibleVehicles = Array.from(vehicles.values()).filter(v => {
    if (filterStatus === 'ALL') return true;
    return getVehicleStatus(v) === filterStatus;
  });

  const getStatusBadgeColor = (status: 'MOVING' | 'IDLE' | 'OFFLINE') => {
    switch (status) {
      case 'MOVING': return Colors.primary;
      case 'IDLE': return Colors.warning;
      case 'OFFLINE': return Colors.textDisabled;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        customMapStyle={MapStyle}
        initialRegion={{
          latitude: SOLAPUR_CENTER.lat,
          longitude: SOLAPUR_CENTER.lng,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
        showsUserLocation={false}
        showsCompass={false}
      >
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
              rotation={v.heading || 0}
            >
              <View style={[styles.vehicleMarker, { borderColor: badgeColor }]}>
                <Text style={styles.markerIcon}>🚛</Text>
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
          <Text style={styles.countText}>🚛 {visibleVehicles.length} Vehicles</Text>
        </View>
        <TouchableOpacity
          style={[styles.followBtn, followMode && styles.followBtnActive]}
          onPress={() => setFollowMode(f => !f)}
        >
          <Text style={styles.followBtnText}>Follow {followMode ? '🔵' : '⚪'}</Text>
        </TouchableOpacity>
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {(['ALL', 'MOVING', 'IDLE', 'OFFLINE'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filterStatus === f && styles.filterChipActive]}
            onPress={() => setFilterStatus(f)}
          >
            <Text style={[styles.filterChipText, filterStatus === f && styles.filterChipTextActive]}>
              {f === 'ALL' ? 'All' : f === 'MOVING' ? '⚡ Moving' : f === 'IDLE' ? '⏳ Idle' : '💤 Offline'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Selected vehicle bottom drawer */}
      {selectedVehicle && (
        <View style={styles.vehiclePanel}>
          <View style={styles.vehiclePanelRow}>
            <View>
              <Text style={styles.vehicleTitle}>{selectedVehicle.registrationNumber}</Text>
              <Text style={styles.vehicleSubtitle}>{selectedVehicle.makeModel} • {selectedVehicle.zoneId}</Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedVehicle(null)}>
              <Text style={styles.panelClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Speed</Text>
              <Text style={styles.statVal}>{selectedVehicle.speed.toFixed(1)} km/h</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Heading</Text>
              <Text style={styles.statVal}>{Math.round(selectedVehicle.heading)}°</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Status</Text>
              <Text style={[styles.statVal, { color: getStatusBadgeColor(getVehicleStatus(selectedVehicle)) }]}>
                {getVehicleStatus(selectedVehicle)}
              </Text>
            </View>
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
  vehicleMarker: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, ...Shadow.md,
  },
  markerIcon: { fontSize: 20 },
  plateBadge: {
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
    marginTop: 2, alignSelf: 'center',
  },
  plateText: { color: '#fff', fontSize: 9, fontWeight: Typography.weight.bold },
  vehiclePanel: {
    position: 'absolute', bottom: 20, left: Spacing.lg, right: Spacing.lg,
    backgroundColor: Colors.glass, borderRadius: Radius.xl,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.glassBorder,
    ...Shadow.lg,
  },
  vehiclePanelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  vehicleTitle: { fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  vehicleSubtitle: { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2 },
  panelClose: { color: Colors.textSecondary, fontSize: 18, padding: 4 },
  statsGrid: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },
  statBox: {
    flex: 1, backgroundColor: Colors.bgSunken, borderRadius: Radius.md,
    padding: Spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
  },
  statLabel: { fontSize: 10, color: Colors.textDisabled, textTransform: 'uppercase' },
  statVal: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary, marginTop: 2 },
});

