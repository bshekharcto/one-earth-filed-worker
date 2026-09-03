/**
 * Dead Reckoning Engine
 * Extrapolates position when GPS signal is lost (gap < 90 seconds)
 */

export interface DeadReckonInput {
  lat: number;
  lng: number;
  speedKmh: number;
  headingDeg: number;
  lastTimestamp: string; // ISO
}

const DEG_TO_RAD = Math.PI / 180;
const MAX_EXTRAPOLATION_MS = 90_000; // 90 seconds cap
const EARTH_RADIUS = 6371000; // meters

/**
 * Calculate extrapolated position for a given current time
 * Returns null if gap exceeds 90 seconds or speed is effectively 0
 */
export const extrapolate = (
  input: DeadReckonInput,
  currentTimeMs: number
): { lat: number; lng: number; isExtrapolated: boolean } | null => {
  const lastMs = new Date(input.lastTimestamp).getTime();
  const gapMs = currentTimeMs - lastMs;

  if (gapMs <= 0) return { lat: input.lat, lng: input.lng, isExtrapolated: false };
  if (gapMs > MAX_EXTRAPOLATION_MS) return null; // too stale

  const speedMs = (input.speedKmh / 3.6); // km/h → m/s
  if (speedMs < 0.5) {
    // Effectively stationary — don't move marker
    return { lat: input.lat, lng: input.lng, isExtrapolated: false };
  }

  const distanceM = speedMs * (gapMs / 1000);
  const bearingRad = input.headingDeg * DEG_TO_RAD;

  const latRad = input.lat * DEG_TO_RAD;
  const lngRad = input.lng * DEG_TO_RAD;

  const angDist = distanceM / EARTH_RADIUS;

  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angDist) +
    Math.cos(latRad) * Math.sin(angDist) * Math.cos(bearingRad)
  );
  const newLngRad = lngRad + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angDist) * Math.cos(latRad),
    Math.cos(angDist) - Math.sin(latRad) * Math.sin(newLatRad)
  );

  return {
    lat: newLatRad / DEG_TO_RAD,
    lng: newLngRad / DEG_TO_RAD,
    isExtrapolated: true,
  };
};

/**
 * Shortest rotation angle between two bearings
 * Prevents 350° → 10° taking the long way around (−340° vs +20°)
 */
export const shortestBearingDelta = (from: number, to: number): number => {
  let delta = ((to - from) % 360 + 360) % 360;
  if (delta > 180) delta -= 360;
  return delta;
};

/**
 * Linear interpolation between two lat/lng points
 * Used for smooth playback animation between consecutive points
 */
export const lerpPosition = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  t: number // 0..1
): { lat: number; lng: number } => {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  };
};

/**
 * Compute bearing between two points
 */
export const computeBearing = (
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number => {
  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const Δλ = (lng2 - lng1) * DEG_TO_RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / DEG_TO_RAD) + 360) % 360;
};
