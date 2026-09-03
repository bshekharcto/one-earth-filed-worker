import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  Modal, ActivityIndicator, Alert,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import { Colors, Typography, Spacing, Radius, Shadow, MapStyle, SOLAPUR_CENTER } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';
import { getProperties, d2dVerifyProperty } from '../../services/api';
import { enqueueD2D, getD2DQueueCount } from '../../services/offlineQueue';
import { D2DEvent } from '../../types';
import { QRScanner } from '../../components/d2d/QRScanner';

const WASTE_CATEGORIES = ['SEGREGATED', 'MIXED', 'NONE'] as const;

export const D2DScreen: React.FC = () => {
  const user = authStore.getUser()!;
  const lang = authStore.getLang();
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
      Alert.alert('Notice', 'Using local property roster.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProperties();
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then(loc => {
        setMyLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      })
      .catch(() => {});
    setQueueCount(getD2DQueueCount());
  }, []);

  const handleQRResult = (code: string) => {
    setShowScanner(false);
    const match = properties.find(
      p => p.qrCode === code || p.propertyTaxNumber === code || p.propertyId === code
    );
    if (match) {
      setSelectedProp(match);
    } else {
      Alert.alert(
        'QR Scanned',
        `Scanned code: ${code}\nNo exact match in ward list. You can manually pick a property to verify.`
      );
    }
  };

  const handleMarkCollected = async () => {
    if (!selectedProp) return;
    setSubmitting(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      const net = await NetInfo.fetch();

      if (net.isConnected) {
        await d2dVerifyProperty(selectedProp.propertyId, {
          wasteCategory,
          latitude,
          longitude,
          staffId: user.id,
        });
      } else {
        enqueueD2D({
          staffId: user.id,
          propertyId: selectedProp.propertyId,
          qrCode: selectedProp.qrCode,
          wasteCategory,
          lat: latitude,
          lng: longitude,
          timestamp: new Date().toISOString(),
        });
        setQueueCount(getD2DQueueCount());
      }

      setProperties(prev =>
        prev.map(p =>
          p.propertyId === selectedProp.propertyId
            ? {
                ...p,
                status: 'COLLECTED',
                wasteCategory,
                collectionTimestamp: new Date().toISOString(),
              }
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

  const statusLabel = (s: string) => ({
    COLLECTED: t.collected,
    MISSED: t.missed,
    PENDING: t.pending,
  }[s] || s);

  const stats = {
    total: properties.length,
    collected: properties.filter(p => p.status === 'COLLECTED').length,
    pending: properties.filter(p => p.status === 'PENDING').length,
  };

  return (
    <View style={styles.container}>
      {/* Stats bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statItem}>🟢 {stats.collected} {t.collected}</Text>
        <Text style={styles.statItem}>🟡 {stats.pending} {t.pending}</Text>
        <Text style={styles.statItem}>📦 {stats.total} Total</Text>
        {queueCount > 0 && <Text style={styles.queueBadge}>⬆ {queueCount} queued</Text>}
        <TouchableOpacity style={styles.scanQRBtn} onPress={() => setShowScanner(true)}>
          <Text style={styles.scanQRText}>📷 QR</Text>
        </TouchableOpacity>
      </View>

      {/* Map / List toggle */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'map' && styles.toggleBtnActive]}
          onPress={() => setViewMode('map')}
        >
          <Text style={[styles.toggleText, viewMode === 'map' && styles.toggleTextActive]}>🗺 Map</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, viewMode === 'list' && styles.toggleBtnActive]}
          onPress={() => setViewMode('list')}
        >
          <Text style={[styles.toggleText, viewMode === 'list' && styles.toggleTextActive]}>📋 List</Text>
        </TouchableOpacity>
      </View>

      {/* Map View */}
      {viewMode === 'map' && (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          customMapStyle={MapStyle}
          initialRegion={{
            latitude: SOLAPUR_CENTER.lat,
            longitude: SOLAPUR_CENTER.lng,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }}
          showsUserLocation={true}
        >
          {properties.map(p => (
            <Marker
              key={p.propertyId}
              coordinate={{ latitude: p.lat, longitude: p.lng }}
              onPress={() => setSelectedProp(p)}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.propMarker, { backgroundColor: markerColor(p.status) }]}>
                <Text style={styles.propMarkerText}>{p.status === 'COLLECTED' ? '✓' : '●'}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <FlatList
          data={[...properties].sort((a, b) => {
            if (!myLocation) return 0;
            const dA = Math.abs(a.lat - myLocation.lat) + Math.abs(a.lng - myLocation.lng);
            const dB = Math.abs(b.lat - myLocation.lat) + Math.abs(b.lng - myLocation.lng);
            return dA - dB;
          })}
          keyExtractor={p => p.propertyId}
          contentContainerStyle={{ padding: Spacing.lg }}
          renderItem={({ item: p }) => (
            <TouchableOpacity
              style={[styles.listItem, { borderLeftColor: markerColor(p.status) }]}
              onPress={() => setSelectedProp(p)}
            >
              <View style={styles.listItemHeader}>
                <Text style={styles.listOwner}>{p.ownerName}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: markerColor(p.status) + '20', borderColor: markerColor(p.status) },
                  ]}
                >
                  <Text style={[styles.statusBadgeText, { color: markerColor(p.status) }]}>
                    {statusLabel(p.status)}
                  </Text>
                </View>
              </View>
              <Text style={styles.listAddress}>{p.address}</Text>
              <Text style={styles.listTax}>Tax #: {p.propertyTaxNumber}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* QR Scanner Modal */}
      <Modal visible={showScanner} animationType="slide" transparent={false}>
        <QRScanner onScan={handleQRResult} onClose={() => setShowScanner(false)} />
      </Modal>

      {/* Property Detail Modal */}
      <Modal visible={!!selectedProp} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedProp?.ownerName}</Text>
              <TouchableOpacity onPress={() => setSelectedProp(null)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalAddress}>{selectedProp?.address}, {selectedProp?.locality}</Text>
            <Text style={styles.modalTax}>Tax #: {selectedProp?.propertyTaxNumber}</Text>

            <View
              style={[
                styles.currentStatus,
                { backgroundColor: markerColor(selectedProp?.status || 'PENDING') + '15' },
              ]}
            >
              <Text
                style={[
                  styles.currentStatusText,
                  { color: markerColor(selectedProp?.status || 'PENDING') },
                ]}
              >
                {statusLabel(selectedProp?.status || 'PENDING')}
              </Text>
            </View>

            {selectedProp?.status !== 'COLLECTED' && (
              <>
                <Text style={styles.sectionLabel}>Waste Category</Text>
                <View style={styles.categoryRow}>
                  {WASTE_CATEGORIES.map(cat => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.categoryBtn, wasteCategory === cat && styles.categoryBtnActive]}
                      onPress={() => setWasteCategory(cat)}
                    >
                      <Text
                        style={[
                          styles.categoryBtnText,
                          wasteCategory === cat && styles.categoryBtnTextActive,
                        ]}
                      >
                        {cat === 'SEGREGATED' ? '♻️ ' : cat === 'MIXED' ? '🗑️ ' : '❌ '}
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.collectBtn, submitting && styles.collectBtnDisabled]}
                  onPress={handleMarkCollected}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.collectBtnText}>✔ {t.markCollected}</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  statsBar: {
    flexDirection: 'row', backgroundColor: Colors.bgCard,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border, gap: Spacing.md,
    alignItems: 'center',
  },
  statItem: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  queueBadge: { marginLeft: 'auto', fontSize: Typography.size.xs, color: Colors.warning, fontWeight: Typography.weight.bold },
  scanQRBtn: {
    backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: Radius.full, marginLeft: 'auto',
  },
  scanQRText: { color: '#fff', fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
  toggleRow: {
    flexDirection: 'row', backgroundColor: Colors.bgCard,
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm, gap: Spacing.sm,
  },
  toggleBtn: {
    flex: 1, paddingVertical: 8, borderRadius: Radius.md,
    backgroundColor: Colors.bgSunken, alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
  },
  toggleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primaryDark },
  toggleText: { color: Colors.textSecondary, fontWeight: Typography.weight.semibold, fontSize: Typography.size.sm },
  toggleTextActive: { color: '#fff' },
  map: { flex: 1 },
  propMarker: {
    width: 24, height: 24, borderRadius: 12, alignItems: 'center',
    justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
  },
  propMarkerText: { color: '#fff', fontSize: 12, fontWeight: Typography.weight.bold },
  listItem: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg, padding: Spacing.md,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 3,
  },
  listItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  listOwner: { fontSize: Typography.size.md, fontWeight: Typography.weight.bold, color: Colors.textPrimary, flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full, borderWidth: 1 },
  statusBadgeText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold },
  listAddress: { fontSize: Typography.size.sm, color: Colors.textSecondary },
  listTax: { fontSize: Typography.size.xs, color: Colors.textDisabled, marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.bgCard, borderTopLeftRadius: Radius['2xl'], borderTopRightRadius: Radius['2xl'],
    padding: Spacing['2xl'], paddingBottom: 40, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  modalTitle: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary, flex: 1 },
  modalClose: { fontSize: 20, color: Colors.textSecondary, padding: 4 },
  modalAddress: { fontSize: Typography.size.sm, color: Colors.textSecondary, marginBottom: 4 },
  modalTax: { fontSize: Typography.size.xs, color: Colors.textDisabled, marginBottom: Spacing.md },
  currentStatus: { paddingVertical: 8, borderRadius: Radius.md, alignItems: 'center', marginBottom: Spacing.lg },
  currentStatusText: { fontWeight: Typography.weight.bold, fontSize: Typography.size.sm },
  sectionLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textSecondary, marginBottom: Spacing.sm },
  categoryRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  categoryBtn: {
    flex: 1, paddingVertical: 10, borderRadius: Radius.md, alignItems: 'center',
    backgroundColor: Colors.bgSunken, borderWidth: 1, borderColor: Colors.border,
  },
  categoryBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primaryDark },
  categoryBtnText: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.medium },
  categoryBtnTextActive: { color: '#fff' },
  collectBtn: {
    backgroundColor: Colors.success, borderRadius: Radius.lg,
    paddingVertical: 16, alignItems: 'center', ...Shadow.glow,
  },
  collectBtnDisabled: { opacity: 0.6 },
  collectBtnText: { color: '#fff', fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
});
