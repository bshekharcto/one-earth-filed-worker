// Cortex Field Ops - Light Mode Design System Tokens

export const Colors = {
  bg: '#F8FAFC',
  bgCard: '#FFFFFF',
  bgSunken: '#F1F5F9',
  bgPanel: '#FFFFFF',
  primary: '#2563EB',
  primaryDark: '#1D4ED8',
  primaryLight: '#3B82F6',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  error: '#EF4444',   // alias: screens reference Colors.error
  info: '#6366F1',
  punchIn: '#10B981',
  punchOut: '#EF4444',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textDisabled: '#94A3B8',
  textInverse: '#FFFFFF',
  border: '#E2E8F0',
  divider: '#E2E8F0',
  markerWorker: '#10B981',
  markerVehicle: '#2563EB',
  markerOffline: '#94A3B8',
  markerD2DPending: '#F59E0B',
  markerD2DCollected: '#10B981',
  markerD2DMissed: '#EF4444',
  trackSlow: '#10B981',
  trackMedium: '#F59E0B',
  trackFast: '#2563EB',
  trackStationary: '#94A3B8',
  glass: 'rgba(255, 255, 255, 0.92)',
  glassBorder: 'rgba(0, 0, 0, 0.08)',
};

export const Typography = {
  size: { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36 },
  weight: {
    regular: '400' as const, medium: '500' as const,
    semibold: '600' as const, bold: '700' as const, extrabold: '800' as const, black: '900' as const,
  },
};

export const Spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, '3xl': 32, '4xl': 40,
};

export const Radius = {
  sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, full: 9999,
};

export const Shadow = {
  xs: { shadowColor: '#64748B', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  sm: { shadowColor: '#64748B', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  md: { shadowColor: '#64748B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 4 },
  lg: { shadowColor: '#2563EB', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 8 },
  glow: { shadowColor: '#10B981', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 },
};

export const SOLAPUR_CENTER = { lat: 17.6599, lng: 75.9064 };

// Clean Light Map Style
export const MapStyle: any[] = [];