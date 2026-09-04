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
import { DateFilterBar, toDateKey } from '../../components/common/DateFilterBar';
import { isPlaceholderVehicle } from './LiveVehiclesScreen';

const { width, height } = Dimensions.get('window');

// Wall-clock time of the point under the playhead, in the device's timezone --
// a scrub is only meaningful if it says when, not just how far along.
const pointClock = (track: PlaybackTrack | null, idx: number): string => {
  const p = track?.points?.[idx];
  if (!p?.timestamp) return '--:--';
  const d = new Date(p.timestamp);
  if (isNaN(d.getTime())) return '--:--';
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}:${`${d.getSeconds()}`.padStart(2, '0')}`;
};
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
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [track, setTrack] = useState<PlaybackTrack | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [currentPointIndex, setCurrentPointIndex] = useState(0);
  const [entities, setEntities] = useState<any[]>([]);

  const animFrameRef = useRef<number>(0);
  const playbackProgressRef = useRef<number>(0);
  const scrubbingRef = useRef(false);
  const resumeAfterScrubRef = useRef(false);
  const lastFrameTimeRef = useRef<number>(0);
  const playbackStartRealTimeRef = useRef<number>(0);
  const playbackStartTrackTimeRef = useRef<number>(0);

  useEffect(() => {
    if (entityType === 'worker') {
      getLiveRoster().then(setEntities).catch(() => {});
    } else {
      // Same RESET-<imei> placeholders the live map hides -- they have no real
      // route to play back, and 46 of them would bury the 47 real vehicles.
      getActiveVehicles()
        .then((list: any[]) => setEntities(
          (Array.isArray(list) ? list : []).filter(v => !isPlaceholderVehicle(v.registrationNumber))
        ))
        .catch(() => {});
    }
    setSelectedId('');
    setTrack(null);
    setError('');
  }, [entityType]);

  // A track belongs to one day. Changing the day must never leave the previous
  // day's polyline on screen -- reload straight away when someone is selected.
  const handleDateChange = (dateKey: string) => {
    setSelectedDate(dateKey);
    setTrack(null);
    setIsPlaying(false);
    setPlaybackProgress(0);
    playbackProgressRef.current = 0;
    setCurrentPointIndex(0);
    setError('');
    if (selectedId) fetchTrack(selectedId, dateKey);
  };

  const handleSelectEntity = (id: string) => {
    setSelectedId(id);
    setTrack(null);
    setIsPlaying(false);
    setPlaybackProgress(0);
    playbackProgressRef.current = 0;
    setCurrentPointIndex(0);
    setError('');
    fetchTrack(id, selectedDate);
  };

  const fetchTrack = async (idArg?: string, dateArg?: string) => {
    const id = idArg ?? selectedId;
    const date = dateArg ?? selectedDate;
    if (!id) {
      setError('Please select a worker or vehicle');
      return;
    }
    setIsLoading(true);
    setError('');
    setIsPlaying(false);
    setPlaybackProgress(0);
    playbackProgressRef.current = 0;
    setCurrentPointIndex(0);

    try {
      const data = await getPlaybackTrack(entityType, id, date);
      if (!data || data.points.length < 2) {
        setError(`No GPS track recorded on ${date}`);
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

  // Total wall-clock span of the track. 0 means the timestamps carry no usable
  // duration, which switches playback to the fixed-rate fallback below.
  const trackDurationMs = useCallback(() => {
    if (!track || !track.points || track.points.length < 2) return 0;
    const a = new Date(track.points[0].timestamp).getTime();
    const b = new Date(track.points[track.points.length - 1].timestamp).getTime();
    const d = b - a;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }, [track]);

  // Place the marker at an arbitrary progress. Shared by the animation loop and
  // the slider, so scrubbing lands exactly where playback would have been.
  const applyProgress = useCallback((progress: number) => {
    if (!track || !track.points || track.points.length < 2) return;
    const points = track.points;
    const totalMs = trackDurationMs();

    if (totalMs > 0) {
      const startMs = new Date(points[0].timestamp).getTime();
      const targetMs = startMs + progress * totalMs;
      let idx = 0;
      for (let i = 0; i < points.length - 1; i++) {
        if (new Date(points[i].timestamp).getTime() <= targetMs) idx = i;
      }
      const p1 = points[idx];
      const p2 = points[Math.min(idx + 1, points.length - 1)];
      if (p1 && p2 && p1 !== p2) {
        const t1 = new Date(p1.timestamp).getTime();
        const t2 = new Date(p2.timestamp).getTime();
        const frac = t2 > t1 ? (targetMs - t1) / (t2 - t1) : 0;
        // Interpolating every frame is already continuous, so the marker is
        // set directly. Easing toward each point would only add lag.
        const interp = lerpPosition(p1, p2, Math.min(1, Math.max(0, frac)));
        markerAnim.setValue({ latitude: interp.lat, longitude: interp.lng, latitudeDelta: 0, longitudeDelta: 0 });
      }
      setCurrentPointIndex(idx);
    } else {
      const idx = Math.min(points.length - 1, Math.floor(progress * (points.length - 1)));
      const cur = points[idx];
      if (cur) {
        (markerAnim as any).timing({
          latitude: cur.lat, longitude: cur.lng, duration: 300, useNativeDriver: false,
        }).start();
      }
      setCurrentPointIndex(idx);
    }
  }, [track, trackDurationMs]);

  // Re-anchor the clock to a given progress. Anything that changes the rate or
  // the position must call this, or the loop measures elapsed time against a
  // stale origin -- that is why changing speed used to snap back to the start.
  const rebaseClock = useCallback((progress: number) => {
    const now = performance.now();
    playbackStartTrackTimeRef.current = progress * trackDurationMs();
    playbackStartRealTimeRef.current = now;
    lastFrameTimeRef.current = now;
  }, [trackDurationMs]);

  // Single entry point for "put the playhead here".
  const seekTo = useCallback((progress: number) => {
    const p = Math.min(1, Math.max(0, progress));
    playbackProgressRef.current = p;
    setPlaybackProgress(p);
    applyProgress(p);
    rebaseClock(p);
  }, [applyProgress, rebaseClock]);

  const runPlaybackLoop = useCallback((nowTime: number) => {
    if (!track || !track.points || track.points.length < 2) return;

    // While a finger is on the slider the loop must not write progress, or it
    // fights the drag and the thumb springs back.
    if (scrubbingRef.current) {
      animFrameRef.current = requestAnimationFrame(runPlaybackLoop);
      return;
    }

    const totalMs = trackDurationMs();
    let progress: number;
    if (totalMs > 0) {
      const realElapsedMs = nowTime - playbackStartRealTimeRef.current;
      const trackElapsedMs = playbackStartTrackTimeRef.current + realElapsedMs * speedMultiplier;
      progress = Math.min(1, Math.max(0, trackElapsedMs / totalMs));
    } else {
      const elapsedSec = (nowTime - lastFrameTimeRef.current) / 1000;
      progress = Math.min(1, playbackProgressRef.current + elapsedSec * speedMultiplier * 0.15);
    }
    lastFrameTimeRef.current = nowTime;
    playbackProgressRef.current = progress;
    setPlaybackProgress(progress);
    applyProgress(progress);

    if (progress < 1) {
      animFrameRef.current = requestAnimationFrame(runPlaybackLoop);
    } else {
      setIsPlaying(false);
    }
  }, [track, speedMultiplier, trackDurationMs, applyProgress]);

  useEffect(() => {
    if (isPlaying && track) {
      // Re-anchor on every (re)start. The loop is recreated whenever speed or
      // track changes, so this is also what makes a mid-playback speed change
      // continue from the current position instead of restarting.
      rebaseClock(playbackProgressRef.current);
      animFrameRef.current = requestAnimationFrame(runPlaybackLoop);
    } else {
      cancelAnimationFrame(animFrameRef.current);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, runPlaybackLoop, rebaseClock, track]);

  const togglePlay = () => {
    if (!track) return;
    if (!isPlaying && playbackProgressRef.current >= 1) {
      // Play on a finished track restarts it rather than sitting at the end
      // and immediately stopping again.
      seekTo(0);
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

        <DateFilterBar value={selectedDate} onChange={handleDateChange} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.entityList}>
          {entities.map((e: any) => {
            const id = e.id;
            const label = e.name || e.registrationNumber || id;
            return (
              <TouchableOpacity
                key={id}
                style={[styles.entityChip, selectedId === id && styles.entityChipActive]}
                onPress={() => handleSelectEntity(id)}
              >
                <Text style={[styles.entityChipText, selectedId === id && styles.entityChipTextActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity style={styles.loadBtn} onPress={() => fetchTrack()} disabled={isLoading}>
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
            <Text style={styles.timeText}>{t.duration}: {track.totalDurationMin ?? 0} min</Text>
            <Text style={styles.timeText}>{t.distance}: {(track.totalDistanceKm ?? 0).toFixed(2)} km</Text>
          </View>

          <View style={styles.timeRow}>
            <Text style={styles.clockText}>{pointClock(track, currentPointIndex)}</Text>
            <Text style={styles.clockText}>{Math.round(playbackProgress * 100)}%</Text>
          </View>

          <Slider
            style={styles.slider}
            minimumValue={0} maximumValue={1}
            value={playbackProgress}
            onSlidingStart={() => {
              // Pause the loop's writes for the duration of the drag, and
              // remember whether to resume once the finger lifts.
              scrubbingRef.current = true;
              resumeAfterScrubRef.current = isPlaying;
            }}
            onValueChange={(v: number) => {
              // Live preview: the marker tracks the thumb as it is dragged.
              playbackProgressRef.current = v;
              setPlaybackProgress(v);
              applyProgress(v);
            }}
            onSlidingComplete={(v: number) => {
              scrubbingRef.current = false;
              seekTo(v);
              // Scrubbing to the very end would otherwise stop instantly.
              if (resumeAfterScrubRef.current && v < 1) setIsPlaying(true);
              resumeAfterScrubRef.current = false;
            }}
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
    position: 'absolute', bottom: Platform.OS === 'android' ? 36 : 20, left: 16, right: 16,
    backgroundColor: Colors.bgCard, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.lg,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  timeText: { fontSize: 12, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  clockText: { fontSize: 13, color: Colors.textPrimary, fontWeight: Typography.weight.bold, fontVariant: ['tabular-nums'] },
  slider: { width: '100%', height: 30 },
  playBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  playBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  speedRow: { flexDirection: 'row', gap: 6 },
  speedBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.md, backgroundColor: '#F1F5F9' },
  speedBtnActive: { backgroundColor: Colors.primary },
  speedText: { fontSize: 12, color: Colors.textSecondary },
  speedTextActive: { color: '#fff', fontWeight: Typography.weight.bold },
});