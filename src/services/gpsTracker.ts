/**
 * GPS Tracker Service
 * Manages continuous background location tracking with:
 * - Adaptive polling (15s moving, 60s stationary)
 * - Direct socket emit when online
 * - MMKV queue when offline
 */
import * as Location from 'expo-location';
import { emitWorkerPosition } from './socket';
import { enqueueGPS } from './offlineQueue';
import { createMMKV } from 'react-native-mmkv';
import NetInfo from '@react-native-community/netinfo';

const storage = createMMKV({ id: 'gps-state' });
let watchSubscription: Location.LocationSubscription | null = null;
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
  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  return bg === 'granted';
};

export const startTracking = async (sid: string): Promise<boolean> => {
  staffId = sid;

  const hasPermission = await requestPermissions();
  if (!hasPermission) return false;

  // Start foreground service notification
  await Location.startLocationUpdatesAsync('background-location-task', {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 15000,       // minimum 15 seconds
    distanceInterval: 20,      // or every 20 meters moved
    deferredUpdatesInterval: 60000,
    deferredUpdatesDistance: 50,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Cortex Field Ops',
      notificationBody: 'GPS tracking active — shift in progress',
      notificationColor: '#10B981',
    },
  }).catch(() => {
    // Fallback: foreground-only tracking (no bare workflow native module yet)
    console.warn('[GPS] Background task failed, using foreground watch');
  });

  // Also start foreground watcher for immediate UI updates
  watchSubscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 20 },
    (loc) => handleNewLocation(loc)
  );

  return true;
};

export const stopTracking = async () => {
  if (watchSubscription) {
    watchSubscription.remove();
    watchSubscription = null;
  }
  try {
    await Location.stopLocationUpdatesAsync('background-location-task');
  } catch {}
  staffId = '';
  lastPosition = null;
};

const handleNewLocation = async (loc: Location.LocationObject) => {
  const { latitude: lat, longitude: lng, speed, heading, accuracy } = loc.coords;

  // Calculate distance moved for adaptive logic
  if (lastPosition) {
    const dist = haversineMeters(lastPosition.lat, lastPosition.lng, lat, lng);
    // Store last position distance for dashboard
    storage.set('distance_today_km',
      (storage.getNumber('distance_today_km') || 0) + dist / 1000
    );
  }
  lastPosition = { lat, lng };

  const battery = 85; // expo-battery not in deps yet — placeholder
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

  // Try socket first (no network overhead), fall back to queue
  const net = await NetInfo.fetch();
  if (net.isConnected && emitWorkerPosition(point)) {
    return; // sent via WebSocket
  }

  // Offline: queue for later sync
  enqueueGPS(point);
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

