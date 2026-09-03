// Cortex Field Ops — Design System Tokens

export const Colors = {
  bg: '#0A0E1A',
  bgCard: '#111827',
  bgSunken: '#080C17',
  bgPanel: '#161D2F',
  primary: '#3B82F6',
  primaryDark: '#1D4ED8',
  primaryLight: '#60A5FA',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#6366F1',
  punchIn: '#10B981',
  punchOut: '#EF4444',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textDisabled: '#475569',
  textInverse: '#0A0E1A',
  border: '#1E2A40',
  divider: '#1A2235',
  markerWorker: '#10B981',
  markerVehicle: '#3B82F6',
  markerOffline: '#475569',
  markerD2DPending: '#F59E0B',
  markerD2DCollected: '#10B981',
  markerD2DMissed: '#EF4444',
  trackSlow: '#10B981',
  trackMedium: '#F59E0B',
  trackFast: '#3B82F6',
  trackStationary: '#475569',
  glass: 'rgba(17, 24, 39, 0.85)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
};

export const Typography = {
  size: { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36 },
  weight: {
    regular: '400' as const, medium: '500' as const,
    semibold: '600' as const, bold: '700' as const, extrabold: '800' as const,
  },
};

export const Spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, '3xl': 32, '4xl': 40,
};

export const Radius = {
  sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, full: 9999,
};

export const Shadow = {
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 2 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  lg: { shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 12 },
  glow: { shadowColor: '#10B981', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12, elevation: 8 },
};

export const SOLAPUR_CENTER = { lat: 17.6599, lng: 75.9064 };

export const MapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0d1117' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d1117' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a2035' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1e3a5f' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1f2d' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0a1a0a' }] },
];
