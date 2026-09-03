import axios from 'axios';
import { createMMKV } from 'react-native-mmkv';

// Base URL — update this to your deployed backend
const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://oneearth-one.vercel.app/api/v1');
// For local dev: set EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3000/api/v1 in .env

const storage = createMMKV({ id: 'auth-store' });

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
  const res = await api.get('/vehicles/active');
  return res.data;
};

// --- Playback ---
export const getPlaybackTrack = async (
  type: 'worker' | 'vehicle',
  id: string,
  date: string
) => {
  const res = await api.get('/track/playback', { params: { type, id, date } });
  return res.data;
};

export default api;


