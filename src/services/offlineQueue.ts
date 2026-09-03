/**
 * Offline Queue Service — MMKV-backed, batch-sync with retry
 * Handles GPS points, D2D events, and Punch actions when device is offline
 */
import { createMMKV } from 'react-native-mmkv';
import { sendHeartbeat, punchAttendance, d2dScan } from './api';
import NetInfo from '@react-native-community/netinfo';

const storage = createMMKV({ id: 'offline-queue' });

const GPS_KEY = 'gps_queue';
const D2D_KEY = 'd2d_queue';
const PUNCH_KEY = 'punch_queue';
const BATCH_SIZE = 50;
const MAX_RETRY = 5;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------- GPS Queue ----------
export const enqueueGPS = (point: {
  staffId: string; lat: number; lng: number; speed: number;
  heading: number; accuracy: number; battery: number; timestamp: string;
}) => {
  const raw = storage.getString(GPS_KEY);
  const queue: any[] = raw ? JSON.parse(raw) : [];
  queue.push({ ...point, id: `gps-${Date.now()}`, syncStatus: 'PENDING' });
  // Trim points older than 24h
  const cutoff = Date.now() - MAX_AGE_MS;
  const fresh = queue.filter(p => new Date(p.timestamp).getTime() > cutoff);
  storage.set(GPS_KEY, JSON.stringify(fresh));
};

export const getGPSQueueCount = (): number => {
  const raw = storage.getString(GPS_KEY);
  const queue: any[] = raw ? JSON.parse(raw) : [];
  return queue.filter(p => p.syncStatus === 'PENDING').length;
};

// ---------- D2D Queue ----------
export const enqueueD2D = (event: {
  staffId: string; propertyId: string; qrCode: string;
  wasteCategory: string; photoBase64?: string;
  lat: number; lng: number; timestamp: string;
}) => {
  const raw = storage.getString(D2D_KEY);
  const queue: any[] = raw ? JSON.parse(raw) : [];
  queue.push({ ...event, id: `d2d-${Date.now()}`, syncStatus: 'PENDING', retryCount: 0 });
  storage.set(D2D_KEY, JSON.stringify(queue));
};

export const getD2DQueueCount = (): number => {
  const raw = storage.getString(D2D_KEY);
  const queue: any[] = raw ? JSON.parse(raw) : [];
  return queue.filter(e => e.syncStatus === 'PENDING').length;
};

// ---------- Punch Queue ----------
export const enqueuePunch = (punch: {
  staffId: string; employeeCode: string; staffName: string;
  punchType: 'PUNCH_IN' | 'PUNCH_OUT';
  latitude: number; longitude: number; accuracy: number;
  wardId: string; zoneId: string; batteryPercent: number; timestamp: string;
}) => {
  const raw = storage.getString(PUNCH_KEY);
  const queue: any[] = raw ? JSON.parse(raw) : [];
  queue.push({ ...punch, id: `punch-${Date.now()}`, syncStatus: 'PENDING', retryCount: 0 });
  storage.set(PUNCH_KEY, JSON.stringify(queue));
};

// ---------- Sync Engine ----------
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const runSync = async (staffId: string): Promise<{ gpsSynced: number; d2dSynced: number; punchesSynced: number }> => {
  const net = await NetInfo.fetch();
  if (!net.isConnected) return { gpsSynced: 0, d2dSynced: 0, punchesSynced: 0 };

  let gpsSynced = 0, d2dSynced = 0, punchesSynced = 0;

  // 1. Sync punch queue first (most critical)
  try {
    const raw = storage.getString(PUNCH_KEY);
    const queue: any[] = raw ? JSON.parse(raw) : [];
    const pending = queue.filter(p => p.syncStatus === 'PENDING' && p.retryCount < MAX_RETRY);
    for (const punch of pending) {
      try {
        await punchAttendance(punch);
        punch.syncStatus = 'SYNCED';
        punchesSynced++;
      } catch {
        punch.retryCount = (punch.retryCount || 0) + 1;
      }
      await sleep(300);
    }
    storage.set(PUNCH_KEY, JSON.stringify(queue));
  } catch (e) { console.warn('[Sync] Punch sync error:', e); }

  // 2. Sync GPS telemetry in batches of BATCH_SIZE
  try {
    const raw = storage.getString(GPS_KEY);
    const queue: any[] = raw ? JSON.parse(raw) : [];
    const pending = queue.filter(p => p.syncStatus === 'PENDING');
    const batches = [];
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      batches.push(pending.slice(i, i + BATCH_SIZE));
    }
    for (const batch of batches) {
      try {
        await sendHeartbeat(staffId, batch);
        batch.forEach(p => { p.syncStatus = 'SYNCED'; gpsSynced += batch.length; });
      } catch {
        // Will retry next sync cycle
      }
      await sleep(500);
    }
    // Update queue, remove synced items older than 1h
    const oneHourAgo = Date.now() - 3600000;
    const updated = queue.filter(p =>
      p.syncStatus !== 'SYNCED' || new Date(p.timestamp).getTime() > oneHourAgo
    );
    storage.set(GPS_KEY, JSON.stringify(updated));
  } catch (e) { console.warn('[Sync] GPS sync error:', e); }

  // 3. Sync D2D events
  try {
    const raw = storage.getString(D2D_KEY);
    const queue: any[] = raw ? JSON.parse(raw) : [];
    const pending = queue.filter(e => e.syncStatus === 'PENDING' && e.retryCount < MAX_RETRY);
    for (const event of pending) {
      try {
        await d2dScan({
          code: event.qrCode || event.propertyId,
          wasteCategory: event.wasteCategory,
          latitude: event.lat,
          longitude: event.lng,
          staffId: event.staffId,
        });
        event.syncStatus = 'SYNCED';
        d2dSynced++;
      } catch {
        event.retryCount = (event.retryCount || 0) + 1;
      }
      await sleep(400);
    }
    storage.set(D2D_KEY, JSON.stringify(queue));
  } catch (e) { console.warn('[Sync] D2D sync error:', e); }

  return { gpsSynced, d2dSynced, punchesSynced };
};

export const getTotalQueueCount = (): number => {
  return getGPSQueueCount() + getD2DQueueCount();
};

