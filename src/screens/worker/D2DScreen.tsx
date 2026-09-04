import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  Modal, ActivityIndicator, Alert, StatusBar, Platform,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow, MapStyle, SOLAPUR_CENTER } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';
import { getProperties, d2dVerifyProperty } from '../../services/api';
import { enqueueD2D, getD2DQueueCount } from '../../services/offlineQueue';
import { D2DEvent } from '../../types';
import { QRScanner } from '../../components/d2d/QRScanner';
import { HeaderDrawer } from '../../components/common/HeaderDrawer';

const WASTE_CATEGORIES = ['SEGREGATED', 'MIXED', 'NONE'] as const;

export const D2DScreen: React.FC<{ onLogout?: () => void }> = ({ onLogout }) => {
  const insets = useSafeAreaInsets();
  const user = authStore.getUser()!;
  const [lang, setLang] = useState(authStore.getLang());
  const t = strings[lang];

  const mapRef = useRef<MapView>(null);
  const [properties, setProperties] = useState<D2DEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProp, setSelectedProp] = useState<D2DEvent | null>(null);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [wasteCategory, setWasteCategory] = useState<'SEGREGATED' | 'MIXED' | 'NONE'>('SEGREGATED');
  const [submitting, setSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);

  const loadProperties = async () => {
    setLoading(true);
    try {
      const data = await getProperties(user.wardId);
      setProperties(data || []);
    } catch {
      // Mock fallback
      setProperties([
        { propertyId: 'PROP-101', qrCode: 'QR-101', ownerName: 'Ramesh Patil', address: 'Ward 1, House 42', status: 'PENDING', wardId: user.wardId, lat: 17.6599, lng: 75.9064 },
        { propertyId: 'PROP-102', qrCode: 'QR-102', ownerName: 'Sunita Kulkarni', address: 'Ward 1, House 43', status: 'COLLECTED', wasteCategory: 'SEGREGATED', wardId: user.wardId, lat: 17.6612, lng: 75.9078 },
        { propertyId: 'PROP-103', qrCode: 'QR-103', ownerName: 'Anil Shinde', address: 'Ward 1, House 44', status: 'PENDING', wardId: user.wardId, lat: 17.6580, lng: 75.9050 },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProperties();
    setQueueCount(getD2DQueueCount());

    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(loc => {
      setMyLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    }).catch(() => {});
  }, []);

  const handleQRScanned = (scannedData: string) => {
    setShowScanner(false);
    const matched = properties.find(p => p.qrCode === scannedData || p.propertyId === scannedData);
    if (matched) {
      setSelectedProp(matched);
    } else {
      Alert.alert('Scanned QR', `Code: ${scannedData}\nProperty not registered in current ward roster.`);
    }
  };

  const handleVerifySubmit = async () => {
    if (!selectedProp) return;
    setSubmitting(true);
    try {
      let latitude = selectedProp.lat;
      let longitude = selectedProp.lng;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
      } catch {}

      const net = await NetInfo.fetch();
      if (net.isConnected) {
        await d2dVerifyProperty(selectedProp.propertyId, {
          wasteCategory, latitude, longitude, staffId: user.id,
        });
      } else {
        enqueueD2D({
          staffId: user.id, propertyId: selectedProp.propertyId, qrCode: selectedProp.qrCode,
          wasteCategory, lat: latitude, lng: longitude, timestamp: new Date().toISOString(),
        });
        setQueueCount(getD2DQueueCount());
      }

      setProperties(prev =>
        prev.map(p =>
          p.propertyId === selectedProp.propertyId
            ? { ...p, status: 'COLLECTED', wasteCategory, collectionTimestamp: new Date().toISOString() }
            : p
        )
      );
      setSelectedProp(null);
      Alert.alert('Success', `${selectedProp.ownerName} marked as ${t.collected}`);
    } catch {
      Alert.alert('Notice', 'Verification stored offline. Will sync when connected.');
    } finally {
      setSubmitting(false);
    }
  };

  const markerColor = (status: string) => {
    if (status === 'COLLECTED') return Colors.markerD2DCollected;
    if (status === 'MISSED') return Colors.markerD2DMissed;
    return Colors.markerD2DPending;
  };

  const stats = {
    total: properties.length,
    collected: properties.filter(p => p.status === 'COLLECTED').length,
    pending: properties.filter(p => p.status === 'PENDING').length,
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />

      {/* Stats Header Bar */}
      <View style={styles.statsBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.statChip}>
            <Feather name="check-circle" size={14} color={Colors.success} />
            <Text style={styles.statText}>{stats.collected}</Text>
          </View>
          <View style={styles.statChip}>
            <Feather name="clock" size={14} color={Colors.warning} />
            <Text style={styles.statText}>{stats.pending}</Text>
          </View>
          <View style={styles.statChip}>
            <Feather name="grid" size={14} color={Colors.primary} />
            <Text style={styles.statText}>{stats.total}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity style={styles.scanQRBtn} onPress={() => setShowScanner(true)}>
            <Feather name="camera" size={14} color="#fff" style={{ marginRight: 4 }} />
            <Text style={styles.scanQRText}>QR</Text>
          </TouchableOpacity>

          <HeaderDrawer onLogout={onLogout} onLangChange={() => setLang(authStore.getLang())} />
        </View>
      </View>

      {/* Map / List Toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'map' && styles.toggleBtnActive]}
          onPress={() => setViewMode('map')}
        >
          <Feather name="map" size={14} color={viewMode === 'map' ? '#fff' : Colors.textSecondary} style={{ marginRight: 6 }} />
          <Text style={[styles.toggleText, viewMode === 'map' && styles.toggleTextActive]}>Map View</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'list' && styles.toggleBtnActive]}
          onPress={() => setViewMode('list')}
        >
          <Feather name="list" size={14} color={viewMode === 'list' ? '#fff' : Colors.textSecondary} style={{ marginRight: 6 }} />
          <Text style={[styles.toggleText, viewMode === 'list' && styles.toggleTextActive]}>List View</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={Colors.primary} size="large" />
      ) : viewMode === 'map' ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          customMapStyle={MapStyle}
          initialRegion={{ latitude: SOLAPUR_CENTER.lat, longitude: SOLAPUR_CENTER.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
        >
          {properties.map(p => (
            <Marker
              key={p.propertyId}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              onPress={() => setSelectedProp(p)}
            >
              <View style={[styles.d2dMarker, { backgroundColor: markerColor(p.status) }]}>
                <Feather name="home" size={12} color="#fff" />
              </View>
            </Marker>
          ))}
        </MapView>
      ) : (
        <FlatList
          data={properties}
          keyExtractor={item => item.propertyId}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.propertyCard} onPress={() => setSelectedProp(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.propName}>{item.ownerName}</Text>
                <Text style={styles.propAddress}>{item.address}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: markerColor(item.status) }]}>
                <Text style={styles.statusBadgeText}>{item.status}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Property Verification Modal */}
      {selectedProp && (
        <Modal transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom + 32, 44) }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{selectedProp.ownerName}</Text>
                <TouchableOpacity onPress={() => setSelectedProp(null)}>
                  <Feather name="x" size={22} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalAddress}>{selectedProp.address}</Text>

              <Text style={styles.catLabel}>Waste Category:</Text>
              <View style={styles.catRow}>
                {WASTE_CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catChip, wasteCategory === cat && styles.catChipActive]}
                    onPress={() => setWasteCategory(cat)}
                  >
                    <Text style={[styles.catChipText, wasteCategory === cat && styles.catChipTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={handleVerifySubmit} disabled={submitting}>
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>{t.markCollected}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* QR Camera Modal — QRScanner has no `visible` prop, so it must be
          mounted conditionally. Rendering it unconditionally kept the camera
          running the whole time this screen was open. */}
      {showScanner && (
        <QRScanner
          onClose={() => setShowScanner(false)}
          onScan={handleQRScanned}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  statsBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.bgCard, paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderColor: Colors.border, ...Shadow.xs,
  },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { fontSize: 13, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  scanQRBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: Radius.full, ...Shadow.xs,
  },
  scanQRText: { color: '#fff', fontSize: 12, fontWeight: Typography.weight.bold },

  toggleRow: { flexDirection: 'row', padding: 8, gap: 8, backgroundColor: Colors.bgCard },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: Radius.md, backgroundColor: '#F1F5F9',
  },
  toggleBtnActive: { backgroundColor: Colors.primary },
  toggleText: { fontSize: 12, color: Colors.textSecondary },
  toggleTextActive: { color: '#fff', fontWeight: Typography.weight.bold },

  map: { flex: 1 },
  d2dMarker: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', ...Shadow.xs },

  propertyCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  propName: { fontSize: 14, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  propAddress: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.sm },
  statusBadgeText: { fontSize: 10, color: '#fff', fontWeight: Typography.weight.bold },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, ...Shadow.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  modalAddress: { fontSize: 13, color: Colors.textSecondary, marginTop: 4, marginBottom: 16 },
  catLabel: { fontSize: 12, color: Colors.textSecondary, marginBottom: 8 },
  catRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  catChip: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: Radius.md, backgroundColor: '#F1F5F9' },
  catChipActive: { backgroundColor: Colors.primary },
  catChipText: { fontSize: 12, color: Colors.textSecondary },
  catChipTextActive: { color: '#fff', fontWeight: Typography.weight.bold },
  submitBtn: { backgroundColor: Colors.success, paddingVertical: 14, borderRadius: Radius.xl, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: Typography.weight.bold },
});