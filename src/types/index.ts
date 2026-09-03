// Core TypeScript types for Cortex Mobile

export type UserRole = 'WORKER' | 'SUPERVISOR';
export type Lang = 'en' | 'mr';

export interface AuthUser {
  id: string;
  employeeCode: string;
  name: string;
  role: UserRole;
  staffRole: string; // SWEEPER | SANITATION_INSPECTOR | D2D_VERIFIER etc.
  zoneId: string;
  wardId: string;
  phone: string;
  status: string;
  assignedVehicle?: { id: string; registrationNumber: string; makeModel: string };
}

export interface GPSPoint {
  lat: number;
  lng: number;
  speed: number;        // km/h
  heading: number;      // degrees 0-360
  accuracy: number;     // meters
  battery: number;      // 0-100
  timestamp: string;    // ISO string
  syncStatus?: 'PENDING' | 'SYNCED';
}

export interface WorkerPosition {
  staffId: string;
  name: string;
  employeeCode: string;
  role: string;
  wardId: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  battery: number;
  timestamp: string;
  isOnline: boolean;
  lastSeenMs: number;   // ms since last update
  isExtrapolated?: boolean;
}

export interface VehiclePosition {
  vehicleId: string;
  registrationNumber: string;
  makeModel: string;
  zoneId: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  timestamp: string;
  isOnline: boolean;
  lastSeenMs: number;
}

export interface PlaybackPoint {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  timestamp: string;
  isInterpolated?: boolean;
}

export interface PlaybackTrack {
  entityId: string;
  entityType: 'worker' | 'vehicle';
  date: string;
  points: PlaybackPoint[];
  punchInTime?: string;
  punchInLat?: number;
  punchInLng?: number;
  punchOutTime?: string;
  punchOutLat?: number;
  punchOutLng?: number;
  distanceKm?: number;
  durationMinutes?: number;
  d2dEvents?: D2DEvent[];
}

export interface D2DEvent {
  propertyId: string;
  ownerName: string;
  address: string;
  locality: string;
  propertyTaxNumber: string;
  qrCode: string;
  lat: number;
  lng: number;
  status: 'PENDING' | 'COLLECTED' | 'MISSED';
  wasteCategory?: 'SEGREGATED' | 'MIXED' | 'NONE';
  collectionTimestamp?: string;
  photoProofUrl?: string;
}

export interface AttendanceRow {
  staffId: string;
  employeeCode: string;
  name: string;
  role: string;
  wardId: string;
  status: string;
  batteryPercent: number;
  punchInTime: string;
  punchInLat?: number;
  punchInLng?: number;
  punchOutTime: string;
  punchOutLat?: number;
  punchOutLng?: number;
  durationHours: number;
  geofenceStatus: string;
}

export interface OfflineQueueItem {
  id: string;
  type: 'GPS' | 'D2D' | 'PUNCH';
  payload: any;
  createdAt: string;
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED';
  retryCount: number;
}
