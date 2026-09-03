import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
  ScrollView, ActivityIndicator, Platform,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, AnimatedRegion } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import { Colors, Typography, Spacing, Radius, Shadow, MapStyle, SOLAPUR_CENTER } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';
import { getPlaybackTrack, getLiveRoster, getActiveVehicles } from '../../services/api';
import { lerpPosition, computeBearing } from '../../components/map/DeadReckoningEngine';
import { PlaybackTrack, PlaybackPoint } from '../../types';

const { width, height } = Dimensions.get('window');
const SPEEDS = [1, 2, 4, 8];

export const PlaybackScreen: React.FC = () => {
  const lang = authStore.getLang();
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
  const [playbackProgress, setPlaybackProgress] = useState(0); // 0..1
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [currentPointIndex, setCurrentPointIndex] = useState(0);
  const [entities, setEntities] = useState<any[]>([]);

  const animFrameRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const playbackStartRealTimeRef = useRef<number>(0);
  const playbackStartTrackTimeRef = useRef<number>(0);

  // Load workers or vehicles for selection
  useEffect(() => {
    if (entityType === 'worker') {
      getLiveRoster().then(roster => setEntities(roster || [])).catch(() => {});
    } else {
      getActiveVehicles().then(v => setEntities(v || [])).catch(() => {});
    }
    setTrack(null);
    setSelectedId('');
  }, [entityType]);

  const loadTrack = async () => {
    if (!selectedId) return;
    setIsLoading(true);
    setError('');
    setIsPlaying(false);
    setPlaybackProgress(0);
    setCurrentPointIndex(0);
    try {
      const data = await getPlaybackTrack(entityType, selectedId, selectedDate);
      setTrack(data);
      if (data?.points?.length > 0) {
        const first = data.points[0];
        mapRef.current?.animateToRegion({
          latitude: first.lat, longitude: first.lng,
          latitudeDelta: 0.02, longitudeDelta: 0.02,
        }, 800);
        markerAnim.setValue({ latitude: first.lat, longitude: first.lng, latitudeDelta: 0, longitudeDelta: 0 });
      }
    } catch (e) {
      setError('Failed to load track. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Playback animation loop
  const runPlaybackLoop = useCallback((timestamp: number) => {
    if (!track || !isPlaying) return;
    const points = track.points;
    if (points.length < 2) return;

    const totalDurationMs = new Date(points[points.length - 1].timestamp).getTime()
                          - new Date(points[0].timestamp).getTime();

    const realElapsed = (timestamp - playbackStartRealTimeRef.current) * speedMultiplier;
    const trackElapsed = playbackStartTrackTimeRef.current + realElapsed;
    const progress = Math.min(trackElapsed / totalDurationMs, 1);
    setPlaybackProgress(progress);

    // Find which segment we're in
    const trackTime = new Date(points[0].timestamp).getTime() + trackElapsed;
    let idx = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const t0 = new Date(points[i].timestamp).getTime();
      const t1 = new Date(points[i + 1].timestamp).getTime();
      if (trackTime >= t0 && trackTime <= t1) { idx = i; break; }
    }
    const pt0 = points[idx];
    const pt1 = points[Math.min(idx + 1, points.length - 1)];

    const segDuration = new Date(pt1.timestamp).getTime() - new Date(pt0.timestamp).getTime();
    const segElapsed = trackTime - new Date(pt0.timestamp).getTime();
    const t = segDuration > 0 ? Math.min(segElapsed / segDuration, 1) : 0;

    const pos = lerpPosition({ lat: pt0.lat, lng: pt0.lng }, { lat: pt1.lat, lng: pt1.lng }, t);
    markerAnim.timing({
      latitude: pos.lat, longitude: pos.lng,
      latitudeDelta: 0, longitudeDelta: 0,
      duration: 50, useNativeDriver: false,
    } as any).start();
    setCurrentPointIndex(idx);

    if (progress < 1) {
      animFrameRef.current = requestAnimationFrame(runPlaybackLoop);
    } else {
      setIsPlaying(false);
    }
  }, [track, isPlaying, speedMultiplier]);

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

  const seekTo = (progress: number) => {
    if (!track) return;
    cancelAnimationFrame(animFrameRef.current);
    setIsPlaying(false);
    setPlaybackProgress(progress);
    const points = track.points;
    const totalMs = new Date(points[points.length - 1].timestamp).getTime() - new Date(points[0].timestamp).getTime();
    const targetMs = new Date(points[0].timestamp).getTime() + progress * totalMs;
    let idx = 0;
    for (let i = 0; i < points.length - 1; i++) {
      if (new Date(points[i].timestamp).getTime() <= targetMs) idx = i;
    }
    const pt = points[idx];
    markerAnim.setValue({ latitude: pt.lat, longitude: pt.lng, latitudeDelta: 0, longitudeDelta: 0 });
    mapRef.current?.animateToRegion({ latitude: pt.lat, longitude: pt.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
  };

  const currentPt: PlaybackPoint | null = track && track.points.length > 0
    ? track.points[Math.min(currentPointIndex, track.points.length - 1)]
    : null;

  const formatTime = (iso?: string) => {
    if (!iso) return '--';
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  // Color polyline by speed
  const getSpeedColor = (speed: number) => {
    if (speed < 3) return Colors.trackStationary;
    if (speed < 8) return Colors.trackSlow;
    if (speed < 20) return Colors.trackMedium;
    return Colors.trackFast;
  };

  return (
    <View style={styles.container}>
      {/* Entity & Date Selector */}
      <View style={styles.selectorPanel}>
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
                <Text style={[styles.entityChipText, selectedId === id && styles.entityChipTextActive]}>
                  {label.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity
          style={[styles.loadBtn, (!selectedId || isLoading) && styles.loadBtnDisabled]}
          onPress={loadTrack}
          disabled={!selectedId || isLoading}
        >
          {isLoading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.loadBtnText}>Load Track →</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        customMapStyle={MapStyle}
        initialRegion={{ latitude: SOLAPUR_CENTER.lat, longitude: SOLAPUR_CENTER.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      >
        {/* Track polyline */}
        {track?.points && track.points.length > 1 && (
          <Polyline
            coordinates={track.points.map(p => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={Colors.primary}
            strokeWidth={3}
            lineDashPattern={[1]}
          />
        )}
        {/* Punch in marker */}
        {track?.punchInLat && track?.punchInLng && (
          <Marker coordinate={{ latitude: track.punchInLat, longitude: track.punchInLng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.punchInMarker}><Text>▶</Text></View>
          </Marker>
        )}
        {/* Animated playback marker */}
        {track && (
          <Marker.Animated coordinate={markerAnim as any} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.playbackMarker}>
              <Text style={styles.playbackMarkerIcon}>{entityType === 'worker' ? '👷' : '🚛'}</Text>
            </View>
          </Marker.Animated>
        )}
      </MapView>

      {/* Playback Controls */}
      {track && (
        <View style={styles.controls}>
          {/* Info row */}
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Punch In</Text>
              <Text style={styles.infoValue}>{track.punchInTime || formatTime(track.points[0]?.timestamp)}</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Distance</Text>
              <Text style={styles.infoValue}>{track.distanceKm?.toFixed(1) || '--'} km</Text>
            </View>
            <View style={styles.infoItem}>
              <Text style={styles.infoLabel}>Punch Out</Text>
              <Text style={styles.infoValue}>{track.punchOutTime || formatTime(track.points[track.points.length-1]?.timestamp)}</Text>
            </View>
          </View>

          {/* Slider */}
          <Slider
            style={styles.slider}
            minimumValue={0} maximumValue={1}
            value={playbackProgress}
            onValueChange={seekTo}
            minimumTrackTintColor={Colors.primary}
            maximumTrackTintColor={Colors.border}
            thumbTintColor={Colors.primary}
          />
          <View style={styles.timeLabels}>
            <Text style={styles.timeLabel}>{formatTime(track.points[0]?.timestamp)}</Text>
            <Text style={styles.timeLabel}>{currentPt ? formatTime(currentPt.timestamp) : ''}</Text>
            <Text style={styles.timeLabel}>{formatTime(track.points[track.points.length - 1]?.timestamp)}</Text>
          </View>

          {/* Playback buttons */}
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.seekBtn} onPress={() => seekTo(0)}><Text style={styles.seekBtnText}>⏮</Text></TouchableOpacity>
            <TouchableOpacity style={styles.seekBtn} onPress={() => seekTo(Math.max(0, playbackProgress - 0.05))}><Text style={styles.seekBtnText}>⏪</Text></TouchableOpacity>
            <TouchableOpacity style={styles.playBtn} onPress={togglePlay}>
              <Text style={styles.playBtnText}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.seekBtn} onPress={() => seekTo(Math.min(1, playbackProgress + 0.05))}><Text style={styles.seekBtnText}>⏩</Text></TouchableOpacity>
            <TouchableOpacity style={styles.seekBtn} onPress={() => seekTo(1)}><Text style={styles.seekBtnText}>⏭</Text></TouchableOpacity>

            {/* Speed selector */}
            <View style={styles.speedRow}>
              {SPEEDS.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.speedBtn, speedMultiplier === s && styles.speedBtnActive]}
                  onPress={() => setSpeedMultiplier(s)}
                >
                  <Text style={[styles.speedBtnText, speedMultiplier === s && styles.speedBtnTextActive]}>{s}×</Text>
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
  selectorPanel: {
    backgroundColor: Colors.bgCard, padding: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  typeRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  typeBtn: {
    flex: 1, paddingVertical: 8, borderRadius: Radius.md,
    backgroundColor: Colors.bgSunken, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  typeBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primaryDark },
  typeBtnText: { color: Colors.textSecondary, fontWeight: Typography.weight.semibold, fontSize: Typography.size.sm },
  typeBtnTextActive: { color: '#fff' },
  entityList: { marginBottom: Spacing.sm },
  entityChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full,
    backgroundColor: Colors.bgSunken, marginRight: Spacing.xs,
    borderWidth: 1, borderColor: Colors.border,
  },
  entityChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primaryDark },
  entityChipText: { color: Colors.textSecondary, fontSize: Typography.size.xs },
  entityChipTextActive: { color: '#fff' },
  loadBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 10, alignItems: 'center',
  },
  loadBtnDisabled: { opacity: 0.4 },
  loadBtnText: { color: '#fff', fontWeight: Typography.weight.bold },
  map: { flex: 1 },
  punchInMarker: {
    backgroundColor: Colors.success, width: 28, height: 28,
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  playbackMarker: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.primary, ...Shadow.md,
  },
  playbackMarkerIcon: { fontSize: 22 },
  controls: {
    backgroundColor: Colors.glass, borderTopWidth: 1, borderTopColor: Colors.glassBorder,
    padding: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 30 : Spacing.lg,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  infoItem: { alignItems: 'center' },
  infoLabel: { fontSize: Typography.size.xs, color: Colors.textSecondary },
  infoValue: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: Colors.textPrimary },
  slider: { width: '100%', height: 30 },
  timeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6, marginBottom: Spacing.sm },
  timeLabel: { fontSize: Typography.size.xs, color: Colors.textDisabled },
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  seekBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  seekBtnText: { fontSize: 16 },
  playBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    ...Shadow.lg,
  },
  playBtnText: { fontSize: 22, color: '#fff' },
  speedRow: { flexDirection: 'row', gap: 4, marginLeft: Spacing.sm },
  speedBtn: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.sm,
    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
  },
  speedBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primaryDark },
  speedBtnText: { fontSize: Typography.size.xs, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  speedBtnTextActive: { color: '#fff' },
});

