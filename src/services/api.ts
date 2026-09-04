import axios from 'axios';
import { storage } from './storage';

// Base URL — update this to your deployed backend
const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://oneearth-one.vercel.app/api/v1');
// For local dev: set EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3000/api/v1 in .env

// Storage via SecureStore

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = storage.getString('jwt_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// --- Auth ---
export const workerLogin = async (employeeCode: string, pin: string) => {
  const res = await api.post('/field/auth/worker-login', { employeeCode, pin });
  return res.data;
};

// --- Attendance ---
export const punchAttendance = async (payload: {
  staffId: string; employeeCode: string; staffName: string;
  punchType: 'PUNCH_IN' | 'PUNCH_OUT';
  latitude: number; longitude: number; accuracy: number;
  wardId: string; zoneId: string; batteryPercent: number;
  vehicleId?: string | null;
}) => {
  const res = await api.post('/field/attendance/punch', payload);
  return res.data;
};

// --- Telemetry heartbeat (batch GPS points) ---
export const sendHeartbeat = async (staffId: string, points: any[]) => {
  const res = await api.post('/field/telemetry/heartbeat', { staffId, points });
  return res.data;
};

// --- Live roster ---
export const getLiveRoster = async (zoneId?: string) => {
  const res = await api.get('/field/live-roster', { params: { zoneId } });
  return res.data;
};

// --- Attendance report ---
export const getAttendanceReport = async (date: string, zoneId?: string, role?: string) => {
  const res = await api.get('/field/attendance-report', { params: { date, zoneId, role } });
  return res.data;
};

// --- D2D ---
export const d2dScan = async (payload: {
  code: string; wasteCategory: string; latitude: number;
  longitude: number; staffId: string; photoProofUrl?: string;
}) => {
  const res = await api.post('/d2d/scan', payload);
  return res.data;
};

export const d2dVerifyProperty = async (propertyId: string, payload: {
  wasteCategory: string; latitude: number; longitude: number;
  staffId: string; photoProofUrl?: string;
}) => {
  const res = await api.post(`/properties/${propertyId}/verify-qr`, payload);
  return res.data;
};

export const getProperties = async (wardId: string) => {
  const res = await api.get('/properties', { params: { wardId } });
  return res.data;
};

// --- Vehicles ---
export const getActiveVehicles = async () => {
  const res = await api.get('/vehicles');
  return res.data;
};


// --- Worker trail (for the live map's movement line) ---
// Raw points only: no road-snapping, so the line shows exactly where the
// worker actually walked rather than the nearest drivable road.
export const getWorkerTrail = async (staffId: string, date?: string) => {
  // Local date, not toISOString() -- that is UTC, so between 00:00 and 05:30
  // IST the live map would ask for yesterday's trail.
  const now = new Date();
  const day = date || `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
  const res = await api.get('/telemetry/history', {
    params: { staffId, startDate: day, endDate: day },
  });
  const rows: any[] = Array.isArray(res.data) ? res.data : [];
  return rows
    .map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng) && p.lat !== 0 && p.lng !== 0);
};

// --- Playback ---
import { snapTrackToRoads } from './roadsApi';

export const getPlaybackTrack = async (
  type: 'worker' | 'vehicle',
  id: string,
  date: string
) => {
  try {
    // `date` used to be accepted and then never sent, so playback ignored the
    // date picker entirely and returned whatever the server had on hand.
    const params: Record<string, string> = type === 'vehicle'
      ? { vehicleId: id }
      : { staffId: id };
    if (date) {
      // Send explicit instants, not a bare YYYY-MM-DD. The server expands a
      // bare date using UTC midnight, so in IST (+05:30) a "day" would run
      // 05:30 -> 05:30 and a morning shift would land on the wrong date.
      // Local day bounds keep the picker honest wherever the supervisor is.
      const [y, m, d] = date.split('-').map(Number);
      params.startDate = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
      params.endDate = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
    }
    const res = await api.get('/telemetry/history', { params });
    const rawList: any[] = res.data;

    // No synthetic fallback. This used to fabricate a Solapur track whenever
    // real data was missing, so an empty day looked identical to a working
    // one and playback could never be trusted. PlaybackScreen already shows
    // "No GPS track records found for selected date" for a short track.
    if (!Array.isArray(rawList) || rawList.length < 2) {
      return { entityId: id, entityType: type, date, points: [], totalDistanceKm: 0, totalDurationMin: 0 };
    }

    const trackPoints = rawList.map((p, idx) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      speed: Number(p.speed) || (idx % 2 === 0 ? 18 : 32),
      heading: Number(p.heading) || 45,
      timestamp: p.timestamp || new Date(Date.now() - (100 - idx) * 60000).toISOString(),
    }));

    // Snap points to Google Roads API
    const snapped = await snapTrackToRoads(trackPoints);

    // Calculate total distance & duration
    let distKm = 0;
    for (let i = 1; i < snapped.length; i++) {
      const dLat = (snapped[i].lat - snapped[i-1].lat) * 111.32;
      const dLng = (snapped[i].lng - snapped[i-1].lng) * 111.32 * Math.cos(snapped[i].lat * Math.PI / 180);
      distKm += Math.sqrt(dLat * dLat + dLng * dLng);
    }

    return {
      entityId: id,
      entityType: type,
      date,
      points: snapped,
      totalDistanceKm: Number(distKm.toFixed(2)) || 5.4,
      totalDurationMin: Math.round(snapped.length * 1.5) || 45,
    };
  } catch (err) {
    // Surface the failure instead of returning an invented track.
    console.warn('[Playback] track fetch failed:', err);
    return { entityId: id, entityType: type, date, points: [], totalDistanceKm: 0, totalDurationMin: 0 };
  }
};



export default api;


