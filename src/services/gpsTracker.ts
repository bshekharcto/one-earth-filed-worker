/**
 * GPS Tracker Service
 * Manages continuous background location tracking with:
 * - Adaptive polling (15s moving, 60s stationary)
 * - Direct socket emit when online
 * - MMKV queue when offline
 */
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { emitWorkerPosition } from './socket';
import { enqueueGPS } from './offlineQueue';
import { sendHeartbeat } from './api';
import { storage } from './storage';
import NetInfo from '@react-native-community/netinfo';

// Storage via SecureStore
let watchSubscription: Location.LocationSubscription | null = null;
let backgroundActive = false;

// Battery was hardcoded to 85 with a "expo-battery not in deps yet" note, so
// supervisors saw a constant for every worker. Read it for real, but cache it:
// getBatteryLevelAsync() on every GPS fix would be a native call every 2s.
let batteryPercent = 100;
let batterySub: { remove: () => void } | null = null;
let lastBatteryPoll = 0;

const refreshBattery = async () => {
  try {
    const lvl = await Battery.getBatteryLevelAsync();   // 0..1, -1 if unknown
    if (lvl >= 0) batteryPercent = Math.round(lvl * 100);
  } catch { /* keep last known value */ }
};

const startBatteryWatch = async () => {
  await refreshBattery();
  if (batterySub) return;
  // Android reports in ~1% steps, so this fires rarely and is cheap.
  batterySub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
    if (batteryLevel >= 0) batteryPercent = Math.round(batteryLevel * 100);
  });
};

const stopBatteryWatch = () => {
  batterySub?.remove();
  batterySub = null;
};
export const LOCATION_TASK = 'background-location-task';
let staffId = '';
let lastPosition: { lat: number; lng: number } | null = null;

// Haversine distance in meters
const haversineMeters = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

export const requestPermissions = async (): Promise<boolean> => {
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') return false;

  // Background permission is requested but NOT required. On Android 11+ the
  // in-app dialog cannot grant "Allow all the time" at all -- the user has to
  // set it in system Settings. Treating that as total failure meant
  // startTracking() bailed and no GPS was ever recorded, even in foreground.
  // watchPositionAsync() only needs foreground permission, so proceed on fg.
  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  if (bg !== 'granted') {
    console.warn('[GPS] Background location denied - foreground tracking only');
  }
  return true;
};

export const startTracking = async (sid: string): Promise<boolean> => {
  staffId = sid;
  // The OS can spin up the background task in a fresh JS context where module
  // state is empty, so the id has to be readable from storage there.
  storage.set('tracking_staff_id', sid);

  const hasPermission = await requestPermissions();
  if (!hasPermission) return false;

  await startBatteryWatch();

  // Background updates need the "Allow all the time" grant. Attempting them
  // without it just throws, so check first and say so plainly.
  const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
  backgroundActive = false;

  if (bgStatus === 'granted') {
    try {
      const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (already) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      await startBackgroundUpdates();
      backgroundActive = true;
      console.log('[GPS] Background tracking active - continues when app is closed');
    } catch (e: any) {
      console.warn('[GPS] Background updates failed, foreground only:', e?.message);
    }
  } else {
    console.warn('[GPS] No background permission - tracking stops when app is backgrounded');
  }

  // Foreground watcher. When the background task is running it already
  // delivers fixes, so this would double every point; handleNewLocation
  // de-dupes on timestamp to keep the trail clean either way.
  watchSubscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 1 },
    (loc) => handleNewLocation(loc)
  );

  return true;
};

export const isBackgroundTrackingActive = () => backgroundActive;

const startBackgroundUpdates = () =>
  Location.startLocationUpdatesAsync(LOCATION_TASK, {
    // Balanced/20m only produced a fix every 20 metres, so a walking worker
    // jumped between sparse points and looked frozen in between. High accuracy
    // at 1m/2s gives a continuous trail fine enough to see someone stepping.
    accuracy: Location.Accuracy.High,
    timeInterval: 2000,        // at most every 2 seconds
    distanceInterval: 1,       // or every 1 metre moved
    deferredUpdatesInterval: 5000,
    deferredUpdatesDistance: 5,
    showsBackgroundLocationIndicator: true,
    // Keeps the process alive and is mandatory on Android 10+ for
    // background location; the user sees a persistent shift notification.
    foregroundService: {
      notificationTitle: 'Cortex Field Ops',
      notificationBody: 'GPS tracking active - shift in progress',
      notificationColor: '#10B981',
    },
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Fitness,
  });

export const stopTracking = async () => {
  if (watchSubscription) {
    watchSubscription.remove();
    watchSubscription = null;
  }
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
    backgroundActive = false;
  } catch {}
  stopBatteryWatch();
  await flushPendingTelemetry();
  storage.remove('tracking_staff_id');
  staffId = '';
  lastPosition = null;
  lastAcceptedAt = 0;
  consecutiveRejects = 0;
};

export const setStaffId = (sid: string) => { staffId = sid; };

let lastProcessedTs = 0;

/**
 * Quality gates for incoming fixes.
 *
 * Nothing rejected here is stored, sent, or drawn -- a bad fix is the main
 * reason a trail wanders off the road and the reason distance_today_km used to
 * drift upward while a worker stood still.
 */
// Worst horizontal error still worth keeping. Indoors and under heavy cloud a
// phone routinely reports 30-60m; beyond ~50m the point can sit on a parallel
// street, which is worse than having no point at all.
const MAX_ACCURACY_M = 50;
// No municipal vehicle, let alone someone on foot, does 150 km/h. Anything
// faster is a GPS spike, not movement.
const MAX_SPEED_KMH = 150;
// Below this the implied speed is dominated by jitter rather than travel:
// 3m of noise across 0.5s reads as 21 km/h and would trip nothing useful.
const MIN_JUMP_M = 10;
// After a signal gap the previous fix is too old to compare against -- someone
// can legitimately be far away, so the jump gate is skipped.
const MAX_JUMP_GAP_MS = 60000;
// If the gate rejects this many in a row we are almost certainly anchored to a
// stale position (device moved with GPS off). Re-anchor rather than reject
// every fix for the rest of the shift.
const MAX_CONSECUTIVE_REJECTS = 4;

let lastAcceptedAt = 0;
let consecutiveRejects = 0;

export const handleNewLocation = async (loc: Location.LocationObject) => {
  // The foreground watcher and the background task can both deliver the same
  // fix while the app is open, which would double every trail point and every
  // heartbeat. Ignore anything not newer than the last one processed.
  if (loc.timestamp && loc.timestamp <= lastProcessedTs) return;
  lastProcessedTs = loc.timestamp || Date.now();

  const { latitude: lat, longitude: lng, speed, heading, accuracy } = loc.coords;

  // --- Quality gates ---------------------------------------------------
  // A rejected fix must not advance lastPosition, or the next one is measured
  // from a point we already decided was wrong.
  const reject = (why: string) => {
    consecutiveRejects++;
    if (consecutiveRejects <= MAX_CONSECUTIVE_REJECTS) {
      console.log(`[GPS] dropped fix (${why}), ${consecutiveRejects} in a row`);
      return true;
    }
    // Give up gating and re-anchor: staying locked to a stale position would
    // silently end tracking for the rest of the shift.
    console.warn(`[GPS] ${consecutiveRejects} consecutive rejects (${why}) - re-anchoring`);
    consecutiveRejects = 0;
    lastPosition = null;
    return false;
  };

  // accuracy is null on some devices; unknown is not the same as bad, so it
  // is allowed through rather than blocking tracking on those handsets.
  if (typeof accuracy === 'number' && accuracy > MAX_ACCURACY_M) {
    if (reject(`accuracy ${Math.round(accuracy)}m`)) return;
  }

  const nowTs = loc.timestamp || Date.now();
  if (lastPosition && lastAcceptedAt) {
    const gapMs = nowTs - lastAcceptedAt;
    const jumpM = haversineMeters(lastPosition.lat, lastPosition.lng, lat, lng);
    if (gapMs > 0 && gapMs <= MAX_JUMP_GAP_MS && jumpM >= MIN_JUMP_M) {
      const impliedKmh = (jumpM / (gapMs / 1000)) * 3.6;
      if (impliedKmh > MAX_SPEED_KMH) {
        if (reject(`${Math.round(impliedKmh)} km/h jump over ${Math.round(jumpM)}m`)) return;
      }
    }
  }
  consecutiveRejects = 0;
  lastAcceptedAt = nowTs;
  // ---------------------------------------------------------------------

  // Calculate distance moved for adaptive logic
  if (lastPosition) {
    const dist = haversineMeters(lastPosition.lat, lastPosition.lng, lat, lng);
    // Store last position distance for dashboard
    storage.set('distance_today_km',
      (storage.getNumber('distance_today_km') || 0) + dist / 1000
    );
  }
  lastPosition = { lat, lng };

  // In the background task the OS may have started a fresh JS context where
  // startBatteryWatch() never ran, so there is no listener keeping this
  // current. Refresh on a slow timer in that case rather than every fix.
  if (!batterySub && Date.now() - lastBatteryPoll > 60000) {
    lastBatteryPoll = Date.now();
    await refreshBattery();
  }
  const battery = batteryPercent;
  const point = {
    staffId,
    lat, lng,
    speed: Math.max(0, speed || 0) * 3.6, // m/s → km/h
    heading: heading || 0,
    accuracy: accuracy || 10,
    battery,
    timestamp: new Date(loc.timestamp).toISOString(),
  };

  // Store last known position for dead reckoning
  storage.set('last_position', JSON.stringify({
    lat, lng,
    speed: point.speed,
    heading: point.heading,
    timestamp: point.timestamp,
  }));

  // Socket goes out on EVERY fix -- it is an in-memory fanout, so it is cheap
  // and it is what makes the supervisor map move smoothly.
  const net = await NetInfo.fetch();
  if (net.isConnected) {
    emitWorkerPosition(point);
    // The REST heartbeat is a database write. At a 2s cadence that would be
    // ~30 writes/min per worker, so buffer the points and flush them as one
    // batch instead -- /field/telemetry/heartbeat already accepts an array.
    restBuffer.push(point);
    flushRestBuffer();
    return;
  }

  // Offline: queue for later sync
  enqueueGPS(point);
};

// --- batched persistence -----------------------------------------------
const REST_FLUSH_MS = 15000;
let restBuffer: any[] = [];
let lastRestFlush = 0;

const flushRestBuffer = () => {
  const now = Date.now();
  if (now - lastRestFlush < REST_FLUSH_MS || !restBuffer.length) return;
  lastRestFlush = now;
  const batch = restBuffer;
  restBuffer = [];
  sendHeartbeat(staffId, batch).catch(() => {
    // Nothing is lost on failure: fall back to the offline queue, which
    // runSync() retries on its own schedule.
    batch.forEach(p => enqueueGPS(p));
  });
};

// Flush whatever is buffered when the shift ends, so the tail of the
// trail is not dropped.
export const flushPendingTelemetry = () => {
  if (!restBuffer.length) return;
  const batch = restBuffer;
  restBuffer = [];
  lastRestFlush = Date.now();
  return sendHeartbeat(staffId, batch).catch(() => {
    batch.forEach(p => enqueueGPS(p));
  });
};

export const getLastPosition = () => {
  const raw = storage.getString('last_position');
  return raw ? JSON.parse(raw) : null;
};

export const getDistanceTodayKm = (): number => {
  return storage.getNumber('distance_today_km') || 0;
};

export const resetDailyDistance = () => {
  storage.set('distance_today_km', 0);
};

