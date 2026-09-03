import { WorkerPosition, VehiclePosition } from '../../types';

export interface TrackPoint {
  lat: number;
  lng: number;
  speed: number;
  heading?: number;
  timestamp: string;
  isSnapped?: boolean;
}

export const computeBearing = (startLat: number, startLng: number, endLat: number, endLng: number): number => {
  const rad = Math.PI / 180;
  const lat1 = startLat * rad;
  const lat2 = endLat * rad;
  const dLng = (endLng - startLng) * rad;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
};

export const interpolateTrackPoint = (p1: TrackPoint, p2: TrackPoint, fraction: number): TrackPoint => {
  const lat = p1.lat + (p2.lat - p1.lat) * fraction;
  const lng = p1.lng + (p2.lng - p1.lng) * fraction;
  const speed = p1.speed + (p2.speed - p1.speed) * fraction;
  const heading = computeBearing(p1.lat, p1.lng, p2.lat, p2.lng);

  return {
    lat,
    lng,
    speed,
    heading,
    timestamp: p1.timestamp,
  };
};

export const getSpeedColor = (speedKmh: number): string => {
  if (speedKmh > 20) return '#10B981'; // Fast moving (Green)
  if (speedKmh > 5) return '#F59E0B';  // Slow moving (Orange)
  return '#EF4444';                    // Stopped / Idle (Red)
};