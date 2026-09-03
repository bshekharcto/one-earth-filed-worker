import axios from 'axios';
import { TrackPoint } from '../components/map/PlaybackEngine';

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || '';

export const snapTrackToRoads = async (points: TrackPoint[]): Promise<TrackPoint[]> => {
  if (!points || points.length < 2) return points;

  // Filter out any invalid coordinates
  const validPoints = points.filter(p => p.lat > 16.0 && p.lat < 19.0 && p.lng > 74.0 && p.lng < 77.0);
  if (validPoints.length < 2) return points;

  if (!GOOGLE_MAPS_KEY) {
    console.log('[RoadsAPI] No Google Maps Key found, using raw points');
    return validPoints;
  }

  try {
    // Process in chunks of 90 points (Google Roads API max limit per request)
    const chunkSize = 90;
    const snappedResults: TrackPoint[] = [];

    for (let i = 0; i < validPoints.length; i += chunkSize) {
      const chunk = validPoints.slice(i, i + chunkSize);
      const pathStr = chunk.map(p => `${p.lat},${p.lng}`).join('|');

      const url = `https://roads.googleapis.com/v1/snapToRoads?interpolate=true&path=${encodeURIComponent(pathStr)}&key=${GOOGLE_MAPS_KEY}`;
      
      const res = await axios.get(url, { timeout: 8000 });

      if (res.data && Array.isArray(res.data.snappedPoints)) {
        res.data.snappedPoints.forEach((sp: any, idx: number) => {
          const origRef = chunk[Math.min(sp.originalIndex ?? idx, chunk.length - 1)] || chunk[0];
          snappedResults.push({
            lat: sp.location.latitude,
            lng: sp.location.longitude,
            speed: origRef.speed || 15,
            timestamp: origRef.timestamp,
            isSnapped: true,
          });
        });
      } else {
        snappedResults.push(...chunk);
      }
    }

    return snappedResults.length > 0 ? snappedResults : validPoints;
  } catch (err: any) {
    console.log('[RoadsAPI] Snap error, falling back to raw:', err?.message || err);
    return validPoints;
  }
};