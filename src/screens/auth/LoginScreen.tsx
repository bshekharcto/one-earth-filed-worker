import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  StatusBar, Dimensions, Alert,
} from 'react-native';
import { workerLogin } from '../../services/api';
import { authStore } from '../../stores/authStore';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../constants/theme';
import { strings } from '../../i18n/strings';
import { AuthUser } from '../../types';

const { width } = Dimensions.get('window');

interface Props {
  onLoginSuccess: (user: AuthUser) => void;
}

export const LoginScreen: React.FC<Props> = ({ onLoginSuccess }) => {
  const lang = authStore.getLang();
  const t = strings[lang];

  const [employeeCode, setEmployeeCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLang, setSelectedLang] = useState(lang);

  const handleLogin = async () => {
    if (!employeeCode.trim() || !pin.trim()) {
      setError('Please enter Employee Code and PIN');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await workerLogin(employeeCode.trim(), pin.trim());
      if (res.success && res.staff) {
        // Determine role: SANITATION_INSPECTOR / MUKADAM_SUPERVISOR = SUPERVISOR
        // Others = WORKER
        const supervisorRoles = ['SANITATION_INSPECTOR', 'MUKADAM_SUPERVISOR'];
        const appRole = supervisorRoles.includes(res.staff.role) ? 'SUPERVISOR' : 'WORKER';
        const user: AuthUser = { ...res.staff, role: appRole, staffRole: res.staff.role };
        authStore.setUser(user);
        authStore.setToken(res.token || 'demo-token');
        onLoginSuccess(user);
      } else {
        setError(t.loginError);
      }
    } catch (e: any) {
      setError(t.loginError);
    } finally {
      setLoading(false);
    }
  };

  const toggleLang = () => {
    const next = selectedLang === 'en' ? 'mr' : 'en';
    setSelectedLang(next);
    authStore.setLang(next);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />

      {/* Language Toggle */}
      <TouchableOpacity style={styles.langToggle} onPress={toggleLang}>
        <Text style={styles.langText}>{selectedLang === 'en' ? 'मराठी' : 'English'}</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        {/* Logo / Brand */}
        <View style={styles.brandArea}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoIcon}>🌍</Text>
          </View>
          <Text style={styles.appName}>Cortex Field Ops</Text>
          <Text style={styles.tagline}>Solapur Municipal Corporation</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{strings[selectedLang].login}</Text>

          {/* Employee Code */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{strings[selectedLang].employeeCode}</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.inputIcon}>🪪</Text>
              <TextInput
                style={styles.input}
                value={employeeCode}
                onChangeText={setEmployeeCode}
                placeholder="e.g. SMC-SW-1001"
                placeholderTextColor={Colors.textDisabled}
                autoCapitalize="characters"
                autoCorrect={false}
                keyboardType="default"
              />
            </View>
          </View>

          {/* PIN */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>{strings[selectedLang].pin}</Text>
            <View style={styles.inputWrapper}>
              <Text style={styles.inputIcon}>🔒</Text>
              <TextInput
                style={styles.input}
                value={pin}
                onChangeText={setPin}
                placeholder="• • • •"
                placeholderTextColor={Colors.textDisabled}
                secureTextEntry
                keyboardType="numeric"
                maxLength={4}
              />
            </View>
          </View>

          {/* Error */}
          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          )}

          {/* Login Button */}
          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.loginBtnText}>{strings[selectedLang].loginBtn}</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>SMC · Cortex v1.0 · Secure GPS Attendance</Text>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  langToggle: {
    position: 'absolute', top: 52, right: 20, zIndex: 10,
    backgroundColor: Colors.bgCard, paddingHorizontal: 14,
    paddingVertical: 6, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  langText: { color: Colors.primary, fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing['2xl'] },
  brandArea: { alignItems: 'center', marginBottom: Spacing['3xl'] },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.primary, marginBottom: Spacing.lg,
    ...Shadow.lg,
  },
  logoIcon: { fontSize: 40 },
  appName: {
    fontSize: Typography.size['2xl'], fontWeight: Typography.weight.extrabold,
    color: Colors.textPrimary, letterSpacing: 0.5,
  },
  tagline: { fontSize: Typography.size.sm, color: Colors.textSecondary, marginTop: 4 },
  card: {
    backgroundColor: Colors.bgCard, borderRadius: Radius['2xl'],
    padding: Spacing['2xl'], borderWidth: 1, borderColor: Colors.border,
    ...Shadow.md,
  },
  cardTitle: {
    fontSize: Typography.size.xl, fontWeight: Typography.weight.bold,
    color: Colors.textPrimary, marginBottom: Spacing['2xl'],
  },
  inputGroup: { marginBottom: Spacing.lg },
  label: {
    fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold,
    color: Colors.textSecondary, marginBottom: Spacing.xs,
  },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.bgSunken, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md,
  },
  inputIcon: { fontSize: 18, marginRight: Spacing.sm },
  input: {
    flex: 1, paddingVertical: 14,
    fontSize: Typography.size.md, color: Colors.textPrimary,
    fontWeight: Typography.weight.medium,
  },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.lg,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: { color: Colors.danger, fontSize: Typography.size.sm },
  loginBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.lg,
    paddingVertical: 16, alignItems: 'center',
    ...Shadow.lg,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: {
    color: '#fff', fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold, letterSpacing: 0.3,
  },
  footer: {
    textAlign: 'center', color: Colors.textDisabled,
    fontSize: Typography.size.xs, marginTop: Spacing['2xl'],
  },
});
