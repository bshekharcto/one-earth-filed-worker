import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions, StatusBar,
  ScrollView, ActivityIndicator, Platform, Alert,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, AnimatedRegion } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow, MapStyle, SOLAPUR_CENTER } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';
import { getPlaybackTrack, getLiveRoster, getActiveVehicles } from '../../services/api';
import { lerpPosition, computeBearing } from '../../components/map/DeadReckoningEngine';
import { PlaybackTrack, PlaybackPoint } from '../../types';
import { HeaderDrawer } from '../../components/common/HeaderDrawer';

const { width, height } = Dimensions.get('window');
const SPEEDS = [1, 2, 4, 8];

export const PlaybackScreen: React.FC<{ onLogout?: () => void }> = ({ onLogout }) => {
  const insets = useSafeAreaInsets();
  const [lang, setLang] = useState(authStore.getLang());
  const t = strings[lang];

  const mapRef = useRef<MapView>(null);
  const markerAnim = useRef(new AnimatedRegion({
    latitude: SOLAPUR_CENTER.lat, longitude: SOLAPUR_CENTER.lng,
    latitudeDelta: 0, longitudeDelta: 0,
  })).current;

  const [entityType, setEntityType] = useState<'worker' | 'vehicle'>('worker');
  const [selectedId, setSelectedId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [track, setTrack] = useState<PlaybackTrack | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [currentPointIndex, setCurrentPointIndex] = useState(0);
  const [entities, setEntities] = useState<any[]>([]);

  const animFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const playbackStartRealTimeRef = useRef<number>(0);
  const playbackStartTrackTimeRef = useRef<number>(0);

  useEffect(() => {
    if (entityType === 'worker') {
      getLiveRoster().then(setEntities).catch(() => {});
    } else {
      getActiveVehicles().then(setEntities).catch(() => {});
    }
    setSelectedId('');
    setTrack(null);
  }, [entityType]);

  const fetchTrack = async () => {
    if (!selectedId) {
      setError('Please select a worker or vehicle');
      return;
    }
    setIsLoading(true);
    setError('');
    setIsPlaying(false);
    setPlaybackProgress(0);
    setCurrentPointIndex(0);

    try {
      const data = await getPlaybackTrack(entityType, selectedId, selectedDate);
      if (!data || data.points.length < 2) {
        setError('No GPS track records found for selected date');
        setTrack(null);
      } else {
        setTrack(data);
      if (data && data.points && data.points.length > 0) {
        setTimeout(() => {
          mapRef.current?.fitToCoordinates(
            data.points.map((p: any) => ({ latitude: p.lat, longitude: p.lng })),
            { edgePadding: { top: 180, right: 60, bottom: 220, left: 60 }, animated: true }
          );
        }, 400);
      }
        const first = data.points[0];
        markerAnim.setValue({ latitude: first.lat, longitude: first.lng, latitudeDelta: 0, longitudeDelta: 0 });
        mapRef.current?.animateToRegion({
          latitude: first.lat, longitude: first.lng,
          latitudeDelta: 0.015, longitudeDelta: 0.015,
        }, 500);
      }
    } catch {
      setError('Failed to fetch playback track');
    } finally {
      setIsLoading(false);
    }
  };

  const runPlaybackLoop = useCallback((timestamp: number) => {
    if (!track || track.points.length < 2) return;
    const points = track.points;
    const totalTrackMs = new Date(points[points.length - 1].timestamp).getTime()
                        - new Date(points[0].timestamp).getTime();

    const realElapsedMs = timestamp - playbackStartRealTimeRef.current;
    const trackElapsedMs = playbackStartTrackTimeRef.current + realElapsedMs * speedMultiplier;
    const progress = Math.min(1, Math.max(0, trackElapsedMs / totalTrackMs));

    setPlaybackProgress(progress);

    const targetTimeMs = new Date(points[0].timestamp).getTime() + trackElapsedMs;
    let idx = 0;
    for (let i = 0; i < points.length - 1; i++) {
      if (new Date(points[i].timestamp).getTime() <= targetTimeMs) idx = i;
    }
    setCurrentPointIndex(idx);

    const p1 = points[idx];
    const p2 = points[Math.min(idx + 1, points.length - 1)];

    if (p1 && p2 && p1 !== p2) {
      const t1 = new Date(p1.timestamp).getTime();
      const t2 = new Date(p2.timestamp).getTime();
      const segmentFraction = t2 > t1 ? (targetTimeMs - t1) / (t2 - t1) : 0;
      const interpolated = lerpPosition(p1, p2, Math.min(1, Math.max(0, segmentFraction)));

      markerAnim.setValue({ latitude: interpolated.lat, longitude: interpolated.lng, latitudeDelta: 0, longitudeDelta: 0 });
    }

    if (progress < 1) {
      animFrameRef.current = requestAnimationFrame(runPlaybackLoop);
    } else {
      setIsPlaying(false);
    }
  }, [track, speedMultiplier]);

  useEffect(() => {
    if (isPlaying && track) {
      lastFrameTimeRef.current = performance.now();
      playbackStartRealTimeRef.current = performance.now();
      animFrameRef.current = requestAnimationFrame(runPlaybackLoop);
    } else {
      cancelAnimationFrame(animFrameRef.current);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, runPlaybackLoop]);

  const togglePlay = () => {
    if (!track) return;
    if (!isPlaying) {
      const points = track.points;
      const totalDurationMs = new Date(points[points.length - 1].timestamp).getTime()
                            - new Date(points[0].timestamp).getTime();
      playbackStartTrackTimeRef.current = playbackProgress * totalDurationMs;
      playbackStartRealTimeRef.current = performance.now();
    }
    setIsPlaying(p => !p);
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />

      {/* Entity & Date Selector Bar */}
      <View style={styles.selectorPanel}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={styles.typeRow}>
            {(['worker', 'vehicle'] as const).map(type => (
              <TouchableOpacity
                key={type}
                style={[styles.typeBtn, entityType === type && styles.typeBtnActive]}
                onPress={() => setEntityType(type)}
              >
                <Text style={[styles.typeBtnText, entityType === type && styles.typeBtnTextActive]}>
                  {type === 'worker' ? '👷 Worker' : '🚛 Vehicle'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <HeaderDrawer onLogout={onLogout} onLangChange={() => setLang(authStore.getLang())} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.entityList}>
          {entities.map((e: any) => {
            const id = e.id;
            const label = e.name || e.registrationNumber || id;
            return (
              <TouchableOpacity
                key={id}
                style={[styles.entityChip, selectedId === id && styles.entityChipActive]}
                onPress={() => setSelectedId(id)}
              >
                <Text style={[styles.entityChipText, selectedId === id && styles.entityChipTextActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity style={styles.loadBtn} onPress={fetchTrack} disabled={isLoading}>
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Feather name="play" size={16} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.loadBtnText}>{t.loadTrack}</Text>
            </>
          )}
        </TouchableOpacity>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      {/* Map Display */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        customMapStyle={MapStyle}
        initialRegion={{ latitude: SOLAPUR_CENTER.lat, longitude: SOLAPUR_CENTER.lng, latitudeDelta: 0.04, longitudeDelta: 0.04 }}
      >
        {track && track.points.length > 1 && (
          <Polyline
            coordinates={track.points.map(p => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={Colors.primary} strokeWidth={4}
          />
        )}
        {track && (
          <Marker.Animated coordinate={markerAnim as any} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.playbackMarker}>
              <Feather name="navigation" size={18} color={Colors.primary} />
            </View>
          </Marker.Animated>
        )}
      </MapView>

      {/* Playback Controls */}
      {track && (
        <View style={styles.controlsCard}>
          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{t.duration}: {track.totalDurationMin} min</Text>
            <Text style={styles.timeText}>{t.distance}: {track.totalDistanceKm.toFixed(2)} km</Text>
          </View>

          <Slider
            style={styles.slider}
            minimumValue={0} maximumValue={1}
            value={playbackProgress}
            minimumTrackTintColor={Colors.primary}
            maximumTrackTintColor={Colors.border}
            thumbTintColor={Colors.primary}
          />

          <View style={styles.playBar}>
            <TouchableOpacity style={styles.playBtn} onPress={togglePlay}>
              <Feather name={isPlaying ? "pause" : "play"} size={22} color="#fff" />
            </TouchableOpacity>

            <View style={styles.speedRow}>
              {SPEEDS.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.speedBtn, speedMultiplier === s && styles.speedBtnActive]}
                  onPress={() => setSpeedMultiplier(s)}
                >
                  <Text style={[styles.speedText, speedMultiplier === s && styles.speedTextActive]}>{s}x</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  selectorPanel: { backgroundColor: Colors.bgCard, padding: 12, borderBottomWidth: 1, borderColor: Colors.border, ...Shadow.sm },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  typeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border },
  typeBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeBtnText: { fontSize: 12, color: Colors.textSecondary },
  typeBtnTextActive: { color: '#fff', fontWeight: Typography.weight.bold },
  entityList: { flexDirection: 'row', marginBottom: 8 },
  entityChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: '#F1F5F9', marginRight: 6 },
  entityChipActive: { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: Colors.primary },
  entityChipText: { fontSize: 12, color: Colors.textPrimary },
  entityChipTextActive: { color: Colors.primary, fontWeight: Typography.weight.bold },
  loadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 8, ...Shadow.xs,
  },
  loadBtnText: { color: '#fff', fontWeight: Typography.weight.bold, fontSize: 13 },
  errorText: { color: Colors.error, fontSize: 11, textAlign: 'center', marginTop: 4 },

  map: { flex: 1 },
  playbackMarker: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.bgCard,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.primary, ...Shadow.md,
  },

  controlsCard: {
    bottom: Platform.OS === "android" ? 36 : 20,
    position: 'absolute', bottom: 20, left: 16, right: 16,
    backgroundColor: Colors.bgCard, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.lg,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  timeText: { fontSize: 12, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  slider: { width: '100%', height: 30 },
  playBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  playBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  speedRow: { flexDirection: 'row', gap: 6 },
  speedBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.md, backgroundColor: '#F1F5F9' },
  speedBtnActive: { backgroundColor: Colors.primary },
  speedText: { fontSize: 12, color: Colors.textSecondary },
  speedTextActive: { color: '#fff', fontWeight: Typography.weight.bold },
});