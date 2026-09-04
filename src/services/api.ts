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

// --- Vehicle trail (for the live map's movement line) ---
// Raw points, no road-snapping: the line shows the positions the tracker
// actually reported. Snapping happens in playback, where the extra Google
// calls are worth it; on the live map they would cost a request every refresh.
export const getVehicleTrail = async (vehicleId: string, date?: string) => {
  const now = new Date();
  const day = date || `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
  const [y, m, d] = day.split('-').map(Number);
  const res = await api.get('/telemetry/history', {
    params: {
      vehicleId,
      startDate: new Date(y, m - 1, d, 0, 0, 0, 0).toISOString(),
      endDate: new Date(y, m - 1, d, 23, 59, 59, 999).toISOString(),
      limit: 500,
    },
  });
  const rows: any[] = Array.isArray(res.data) ? res.data : [];
  return rows
    // `t` is carried so the live breadcrumb can be joined to this without
    // overlapping it -- without a time to compare, the two segments replay the
    // same stretch and the line doubles back on itself.
    .map(p => ({ lat: Number(p.lat), lng: Number(p.lng), t: Date.parse(p.timestamp) }))
    // The fleet gateway defaults unregistered IMEIs onto real vehicles, so a
    // trail can contain points from a device 1400km away. Keep Solapur only.
    .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.t)
              && p.lat >= 17.2 && p.lat <= 18.1 && p.lng >= 75.2 && p.lng <= 76.4)
    .sort((a, b) => a.t - b.t);
};

// --- Playback ---
import { snapTrackToRoads } from './roadsApi';

export const getPlaybackTrack = async (
  type: 'worker' | 'vehicle',
  id: string,
  date: string
) => {
  try {
    // Only one physical tracker is fitted (IMEI 864022089453483), and the
    // fleet table records it as veh-01. Supervisors can reach it under the
    // A-01-DEMO label or the bare IMEI, so both resolve to the same row.
    const VEHICLE_ALIASES: Record<string, string> = {
      'A-01-DEMO': 'veh-01',
      '864022089453483': 'veh-01',
    };
    const targetId = type === 'vehicle' ? (VEHICLE_ALIASES[id] || id) : id;

    // `date` used to be accepted and then never sent, so playback ignored the
    // date picker entirely and returned whatever the server had on hand.
    const params: Record<string, string> = type === 'vehicle'
      ? { vehicleId: targetId }
      : { staffId: targetId };
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
    let rawList: any[] = res.data;

    // No synthetic fallback. This used to fabricate a Solapur track whenever
    // real data was missing, so an empty day looked identical to a working
    // one and playback could never be trusted. PlaybackScreen already shows
    // "No GPS track recorded on <date>" for a short track.
    if (!Array.isArray(rawList) || rawList.length < 2) {
      return { entityId: id, entityType: type, date, points: [], totalDistanceKm: 0, totalDurationMin: 0 };
    }

    // Oldest first. GPS fixes arrive in bursts and can land out of order, and
    // the playback loop walks timestamps forward -- one row out of sequence
    // makes the marker jump backwards mid-run.
    rawList.sort((a, b) =>
      new Date(a.timestamp || a.receivedAt).getTime() - new Date(b.timestamp || b.receivedAt).getTime());

    // Cap the point count before road-snapping. snapTrackToRoads issues one
    // Google request per 90 points, sequentially, so an unthinned day would
    // be ~23 chained calls -- slow, and billed per call. Sampling evenly
    // keeps the shape of the whole route rather than clipping the tail.
    const MAX_PLAYBACK_POINTS = 300;
    if (rawList.length > MAX_PLAYBACK_POINTS) {
      const step = Math.ceil(rawList.length / MAX_PLAYBACK_POINTS);
      const last = rawList[rawList.length - 1];
      const sampled = rawList.filter((_, idx) => idx % step === 0);
      // `idx % step` lands on the final point only when the length divides
      // evenly, so the tail of the route was being clipped and the duration
      // came up short. Keep the true last fix.
      if (sampled[sampled.length - 1] !== last) sampled.push(last);
      rawList = sampled;
    }

    // Coordinates are passed through as recorded. An earlier revision rebased
    // out-of-area points onto Solapur centre, which drew a route the vehicle
    // never drove; roadsApi already drops points outside the region.
    const trackPoints = rawList.map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      speed: Number(p.speed) || 0,
      heading: Number(p.heading) || 0,
      timestamp: p.timestamp || p.receivedAt,
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !!p.timestamp);

    if (trackPoints.length < 2) {
      return { entityId: id, entityType: type, date, points: [], totalDistanceKm: 0, totalDurationMin: 0 };
    }

    // Snap vehicles to the road network; leave workers exactly where they were.
    //
    // Google's snapToRoads moves a point onto the nearest DRIVABLE road. That
    // is right for a compactor, and wrong for a sweeper: someone working a
    // footpath, a back lane or inside a property gets dragged onto the nearest
    // carriageway, drawing a route they never walked. The live map's trail
    // already shows raw points, so snapping worker playback also made the two
    // views disagree about the same walk.
    const snapped = type === 'vehicle' ? await snapTrackToRoads(trackPoints) : trackPoints;

    // Calculate total distance
    let distKm = 0;
    for (let i = 1; i < snapped.length; i++) {
      const dLat = (snapped[i].lat - snapped[i - 1].lat) * 111.32;
      const dLng = (snapped[i].lng - snapped[i - 1].lng) * 111.32 * Math.cos(snapped[i].lat * Math.PI / 180);
      distKm += Math.sqrt(dLat * dLat + dLng * dLng);
    }

    // Duration comes from the timestamps, not the point count. Deriving it
    // from length reported the same figure for a 20-minute round and an
    // 8-hour shift whenever the sampling rate differed.
    const firstMs = new Date(trackPoints[0].timestamp).getTime();
    const lastMs = new Date(trackPoints[trackPoints.length - 1].timestamp).getTime();
    const durationMin = lastMs > firstMs ? Math.round((lastMs - firstMs) / 60000) : 0;

    return {
      entityId: id,
      entityType: type,
      date,
      points: snapped,
      totalDistanceKm: Number(distKm.toFixed(2)),
      totalDurationMin: durationMin,
    };
  } catch (err) {
    // Surface the failure instead of returning an invented track.
    console.warn('[Playback] track fetch failed:', err);
    return { entityId: id, entityType: type, date, points: [], totalDistanceKm: 0, totalDurationMin: 0 };
  }
};


export default api;


