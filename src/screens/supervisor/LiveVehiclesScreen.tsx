import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Dimensions, StatusBar, FlatList, Alert, Platform,
} from 'react-native';
import MapView, { Marker, Polyline, AnimatedRegion } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow, MapStyle, SOLAPUR_CENTER } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';
import { subscribeAllVehicles } from '../../services/socket';
import { getActiveVehicles } from '../../services/api';
import { extrapolate, computeBearing } from '../../components/map/DeadReckoningEngine';
import { VehiclePosition } from '../../types';
import { HeaderDrawer } from '../../components/common/HeaderDrawer';

const { width, height } = Dimensions.get('window');

// Solapur geographical boundary check
const sanitizeVehicleCoords = (lat: number, lng: number, index: number) => {
  if (lat >= 17.2 && lat <= 18.1 && lng >= 75.2 && lng <= 76.4) {
    return { lat, lng };
  }
  const baseLat = 17.6599 + ((index * 13) % 40 - 20) * 0.003;
  const baseLng = 75.9064 + ((index * 17) % 40 - 20) * 0.003;
  return { lat: baseLat, lng: baseLng };
};

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

  useEffect(() => {
    getActiveVehicles().then((list: any[]) => {
      if (!Array.isArray(list)) return;
      const map = new Map<string, VehiclePosition>();

      list.forEach((v, idx) => {
        if (v.currentLat && v.currentLng) {
          const rawLat = Number(v.currentLat);
          const rawLng = Number(v.currentLng);
          const { lat, lng } = sanitizeVehicleCoords(rawLat, rawLng, idx);
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
          markerAnimations.current.set(v.id, new AnimatedRegion({
            latitude: pos.lat, longitude: pos.lng,
            latitudeDelta: 0, longitudeDelta: 0,
          }));
        }
      });
      setVehicles(new Map(map));
    }).catch(() => {});

    const unsub = subscribeAllVehicles((pos: VehiclePosition) => {
      setVehicles(prev => {
        const updated = new Map(prev);
        const { lat, lng } = sanitizeVehicleCoords(pos.lat, pos.lng, 0);
        const cleanPos = { ...pos, lat, lng };
        updated.set(pos.vehicleId, cleanPos);

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

  const getVehicleStatus = (v: VehiclePosition): 'MOVING' | 'IDLE' | 'OFFLINE' => {
    if (!v.isOnline) return 'OFFLINE';
    if (v.speed > 2) return 'MOVING';
    return 'IDLE';
  };

  const onMarkerPress = (v: VehiclePosition) => {
    setSelectedVehicle(v);
    mapRef.current?.animateToRegion({
      latitude: v.lat, longitude: v.lng,
      latitudeDelta: 0.005, longitudeDelta: 0.005,
    }, 700);
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
            <TouchableOpacity onPress={() => setSelectedVehicle(null)}>
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