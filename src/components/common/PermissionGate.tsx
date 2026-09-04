import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  AppState, AppStateStatus, Linking, Platform, ScrollView,
} from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../constants/theme';

/**
 * Blocking permission gate.
 *
 * Nothing in the app is usable until location access is granted: a field
 * worker who is not trackable is the one thing this product cannot ship
 * around. The gate re-checks whenever the app returns to the foreground, so
 * granting in system Settings drops the user straight through without a
 * restart.
 *
 * Android 11+ (API 30) will NOT grant "Allow all the time" from an in-app
 * dialog. The only route is Settings -> Permissions -> Location -> Allow all
 * the time, so that path is spelled out rather than hidden behind a retry
 * that can never succeed.
 */

type Status = 'checking' | 'blocked' | 'granted';

interface PermState {
  servicesEnabled: boolean;
  foreground: boolean;
  background: boolean;
  /** false once Android stops showing the system dialog -- Settings only. */
  canAskForeground: boolean;
  canAskBackground: boolean;
}

const EMPTY: PermState = {
  servicesEnabled: false, foreground: false, background: false,
  canAskForeground: true, canAskBackground: true,
};

interface Props {
  /** Workers are tracked, so "Allow all the time" is mandatory for them. */
  requireBackground: boolean;
  /** Escape hatch: without it a user who cannot grant is stuck on this screen
   *  with no way back to the login form (wrong account, shared handset). */
  onLogout?: () => void;
  children: React.ReactNode;
}

export const PermissionGate: React.FC<Props> = ({ requireBackground, onLogout, children }) => {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>('checking');
  const [perms, setPerms] = useState<PermState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [askedOnce, setAskedOnce] = useState(false);
  const mounted = useRef(true);

  const read = useCallback(async (): Promise<PermState> => {
    const [servicesEnabled, fg, bg] = await Promise.all([
      Location.hasServicesEnabledAsync().catch(() => false),
      Location.getForegroundPermissionsAsync().catch(() => null),
      Location.getBackgroundPermissionsAsync().catch(() => null),
    ]);
    return {
      servicesEnabled: !!servicesEnabled,
      foreground: fg?.status === 'granted',
      background: bg?.status === 'granted',
      canAskForeground: fg?.canAskAgain !== false,
      canAskBackground: bg?.canAskAgain !== false,
    };
  }, []);

  const satisfied = useCallback((p: PermState) =>
    p.servicesEnabled && p.foreground && (!requireBackground || p.background),
    [requireBackground]);

  const refresh = useCallback(async () => {
    const p = await read();
    if (!mounted.current) return p;
    setPerms(p);
    setStatus(satisfied(p) ? 'granted' : 'blocked');
    return p;
  }, [read, satisfied]);

  useEffect(() => {
    mounted.current = true;
    refresh();

    // Coming back from system Settings is the main way background access gets
    // granted, and it fires no callback -- so re-check on every foreground.
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refresh();
    });
    return () => { mounted.current = false; sub.remove(); };
  }, [refresh]);

  const requestAll = async () => {
    setBusy(true);
    try {
      // Android refuses to even consider background access until foreground
      // is held, so asking in the other order silently fails.
      const fg = perms.foreground
        ? { status: 'granted' as const }
        : await Location.requestForegroundPermissionsAsync();
      if (fg.status === 'granted' && requireBackground) {
        await Location.requestBackgroundPermissionsAsync().catch(() => {});
      }
      setAskedOnce(true);
      await refresh();
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const openAppSettings = () => Linking.openSettings().catch(() => {});

  const openLocationSettings = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(openAppSettings);
    } else {
      openAppSettings();
    }
  };

  if (status === 'checking') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (status === 'granted') return <>{children}</>;

  // Once Android has stopped showing the dialog, retrying is a dead end --
  // send the user to Settings instead of a button that does nothing.
  const bgNeedsSettings =
    requireBackground && perms.foreground && !perms.background &&
    (askedOnce || !perms.canAskBackground || Platform.OS === 'ios' ||
     (Platform.OS === 'android' && Platform.Version >= 30));
  const fgNeedsSettings = !perms.foreground && !perms.canAskForeground;
  const needsSettings = fgNeedsSettings || bgNeedsSettings;

  // Whatever is still missing, exactly one route forward has to be on screen.
  // Keying the in-app button off `!perms.foreground` alone left a dead end on
  // Android 10: foreground already held, background still missing and not yet
  // asked, so neither button rendered and the only control was "Check again".
  const missingSomething =
    !perms.foreground || (requireBackground && !perms.background);
  const canRequestInApp = perms.servicesEnabled && missingSomething && !needsSettings;
  const requestLabel = perms.foreground ? 'Allow all the time' : 'Allow location access';

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.lg }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.iconWrap}>
          <Feather name="map-pin" size={30} color={Colors.primary} />
        </View>

        <Text style={styles.title}>Permissions required</Text>
        <Text style={styles.subtitle}>
          Cortex Field Ops records your location during your shift. The app cannot
          be used until location access is granted.
        </Text>

        <View style={styles.card}>
          <PermRow
            label="Location services"
            hint="Device GPS must be switched on"
            granted={perms.servicesEnabled}
          />
          <PermRow
            label="Location while using the app"
            hint="Required to record your position on duty"
            granted={perms.foreground}
          />
          {requireBackground && (
            <PermRow
              label={'Location "Allow all the time"'}
              hint="Keeps tracking when the screen is off or the app is in the background"
              granted={perms.background}
              last
            />
          )}
        </View>

        {!perms.servicesEnabled && (
          <TouchableOpacity style={styles.primaryBtn} onPress={openLocationSettings}>
            <Feather name="navigation" size={16} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.primaryBtnText}>Turn on location</Text>
          </TouchableOpacity>
        )}

        {canRequestInApp && (
          <TouchableOpacity style={styles.primaryBtn} onPress={requestAll} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" size="small" /> : (
              <>
                <Feather name="unlock" size={16} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryBtnText}>{requestLabel}</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {perms.servicesEnabled && needsSettings && (
          <>
            <View style={styles.steps}>
              <Text style={styles.stepsTitle}>
                {fgNeedsSettings ? 'Grant access in Settings' : 'Set "Allow all the time"'}
              </Text>
              <Text style={styles.stepLine}>1.  Tap <Text style={styles.stepBold}>Open Settings</Text> below</Text>
              <Text style={styles.stepLine}>2.  Open <Text style={styles.stepBold}>Permissions</Text></Text>
              <Text style={styles.stepLine}>3.  Open <Text style={styles.stepBold}>Location</Text></Text>
              <Text style={styles.stepLine}>
                4.  Choose <Text style={styles.stepBold}>
                  {fgNeedsSettings ? 'Allow only while using the app' : 'Allow all the time'}
                </Text>
              </Text>
              <Text style={styles.stepNote}>
                Android does not let an app grant this from a pop-up, so it has to be set here.
                Come straight back — the app picks it up on its own.
              </Text>
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={openAppSettings}>
              <Feather name="settings" size={16} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.primaryBtnText}>Open Settings</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.secondaryBtn} onPress={refresh} disabled={busy}>
          <Feather name="refresh-cw" size={14} color={Colors.textSecondary} style={{ marginRight: 6 }} />
          <Text style={styles.secondaryBtnText}>Check again</Text>
        </TouchableOpacity>

        {onLogout && (
          <TouchableOpacity style={styles.linkBtn} onPress={onLogout}>
            <Text style={styles.linkBtnText}>Sign out</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

const PermRow: React.FC<{ label: string; hint: string; granted: boolean; last?: boolean }> =
  ({ label, hint, granted, last }) => (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={[styles.rowIcon, granted ? styles.rowIconOk : styles.rowIconPending]}>
        <Feather name={granted ? 'check' : 'alert-circle'} size={14} color={granted ? Colors.success : Colors.warning} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Text style={[styles.rowState, granted ? styles.rowStateOk : styles.rowStatePending]}>
        {granted ? 'Granted' : 'Needed'}
      </Text>
    </View>
  );

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  container: { flex: 1, backgroundColor: Colors.bg, paddingHorizontal: Spacing.lg },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: Spacing.lg },

  iconWrap: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: Spacing.lg,
  },
  title: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary, textAlign: 'center' },
  subtitle: {
    fontSize: Typography.size.sm, color: Colors.textSecondary, textAlign: 'center',
    marginTop: Spacing.sm, marginBottom: Spacing.lg, lineHeight: 20,
  },

  card: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: Spacing.md, ...Shadow.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.divider,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
  rowIconOk: { backgroundColor: '#ECFDF5' },
  rowIconPending: { backgroundColor: '#FFFBEB' },
  rowLabel: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary },
  rowHint: { fontSize: Typography.size.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 15 },
  rowState: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, marginLeft: Spacing.sm },
  rowStateOk: { color: Colors.success },
  rowStatePending: { color: Colors.warning },

  steps: {
    backgroundColor: '#FFFBEB', borderRadius: Radius.lg, borderWidth: 1,
    borderColor: '#FDE68A', padding: Spacing.md, marginTop: Spacing.lg,
  },
  stepsTitle: { fontSize: Typography.size.sm, fontWeight: Typography.weight.bold, color: '#92400E', marginBottom: Spacing.sm },
  stepLine: { fontSize: Typography.size.sm, color: '#92400E', lineHeight: 22 },
  stepBold: { fontWeight: Typography.weight.bold },
  stepNote: { fontSize: Typography.size.xs, color: '#B45309', marginTop: Spacing.sm, lineHeight: 16 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 14, marginTop: Spacing.lg, ...Shadow.sm,
  },
  primaryBtnText: { color: '#fff', fontSize: Typography.size.md, fontWeight: Typography.weight.bold },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md, marginTop: Spacing.xs },
  secondaryBtnText: { color: Colors.textSecondary, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold },
  linkBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  linkBtnText: { color: Colors.textDisabled, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold, textDecorationLine: 'underline' },
});
