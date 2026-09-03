import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Alert, SafeAreaView, Platform, TouchableWithoutFeedback,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Typography, Radius, Shadow } from '../../constants/theme';
import { authStore } from '../../stores/authStore';
import { strings } from '../../i18n/strings';

interface Props {
  onLogout?: () => void;
  onLangChange?: () => void;
}

export const HeaderDrawer: React.FC<Props> = ({ onLogout, onLangChange }) => {
  const [modalVisible, setModalVisible] = useState(false);
  const user = authStore.getUser();
  const lang = authStore.getLang();
  const t = strings[lang];

  const handleLogoutPress = () => {
    setModalVisible(false);
    setTimeout(() => {
      Alert.alert(
        t.logout || 'Logout',
        t.logoutConfirm || 'Are you sure you want to log out?',
        [
          { text: t.cancel || 'Cancel', style: 'cancel' },
          {
            text: t.logout || 'Logout',
            style: 'destructive',
            onPress: () => {
              if (onLogout) onLogout();
              else authStore.logout();
            },
          },
        ]
      );
    }, 300);
  };

  const handleToggleLang = () => {
    const nextLang = lang === 'en' ? 'mr' : 'en';
    authStore.setLang(nextLang);
    if (onLangChange) onLangChange();
    setModalVisible(false);
  };

  if (!user) return null;

  return (
    <>
      {/* Hamburger Trigger Icon */}
      <TouchableOpacity
        style={styles.hamburgerBtn}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
      >
        <Feather name="menu" size={24} color={Colors.textPrimary} />
      </TouchableOpacity>

      {/* Slide-out Modal Drawer */}
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.backdrop}>
            <TouchableWithoutFeedback>
              <View style={styles.drawerContent}>
                
                {/* User Profile Header */}
                <View style={styles.profileHeader}>
                  <View style={styles.avatarCircle}>
                    <Feather name="user" size={28} color={Colors.primary} />
                  </View>
                  <View style={styles.profileInfo}>
                    <Text style={styles.userName}>{user.name}</Text>
                    <Text style={styles.userCode}>{user.employeeCode}</Text>
                    <View style={styles.roleBadge}>
                      <Text style={styles.roleBadgeText}>
                        {user.role === 'WORKER' ? 'Field Worker' : 'Supervisor'} · {user.wardId.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
                    <Feather name="x" size={22} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.divider} />

                {/* Menu Items */}
                <View style={styles.menuList}>
                  {/* Language Switcher */}
                  <TouchableOpacity style={styles.menuItem} onPress={handleToggleLang}>
                    <View style={styles.menuIconBox}>
                      <Feather name="globe" size={20} color={Colors.primary} />
                    </View>
                    <Text style={styles.menuItemText}>
                      Language: {lang === 'en' ? 'English (मराठी)' : 'मराठी (English)'}
                    </Text>
                    <Feather name="chevron-right" size={18} color={Colors.textDisabled} />
                  </TouchableOpacity>

                  {/* App Roster Info */}
                  <View style={styles.menuItem}>
                    <View style={styles.menuIconBox}>
                      <Feather name="shield" size={20} color={Colors.success} />
                    </View>
                    <Text style={styles.menuItemText}>Solapur Municipal Corp</Text>
                    <Text style={styles.versionTag}>v1.0</Text>
                  </View>

                  <View style={styles.divider} />

                  {/* Logout Item */}
                  <TouchableOpacity
                    style={[styles.menuItem, styles.logoutMenuItem]}
                    onPress={handleLogoutPress}
                  >
                    <View style={[styles.menuIconBox, styles.logoutIconBox]}>
                      <Feather name="log-out" size={20} color={Colors.error} />
                    </View>
                    <Text style={styles.logoutText}>{t.logout || 'Logout'}</Text>
                  </TouchableOpacity>
                </View>

                {/* Footer */}
                <View style={styles.drawerFooter}>
                  <Text style={styles.footerText}>SMC Cortex Field Ops · Powered by BOSON</Text>
                </View>

              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  hamburgerBtn: {
    padding: 8,
    borderRadius: Radius.md,
    backgroundColor: '#F1F5F9',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  drawerContent: {
    width: '80%',
    maxWidth: 320,
    height: '100%',
    backgroundColor: Colors.bgCard,
    paddingTop: Platform.OS === 'ios' ? 50 : 40,
    paddingHorizontal: 20,
    paddingBottom: 24,
    ...Shadow.lg,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  profileInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: Typography.weight.bold,
    color: Colors.textPrimary,
  },
  userCode: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    marginTop: 4,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: Typography.weight.semibold,
    color: Colors.primary,
  },
  closeBtn: {
    padding: 6,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
  },
  menuList: {
    flex: 1,
    gap: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: Radius.md,
  },
  menuIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  menuItemText: {
    flex: 1,
    fontSize: 14,
    fontWeight: Typography.weight.medium,
    color: Colors.textPrimary,
  },
  versionTag: {
    fontSize: 11,
    color: Colors.textDisabled,
    fontWeight: Typography.weight.semibold,
  },
  logoutMenuItem: {
    backgroundColor: '#FEF2F2',
    marginTop: 10,
  },
  logoutIconBox: {
    backgroundColor: '#FEE2E2',
  },
  logoutText: {
    fontSize: 14,
    fontWeight: Typography.weight.bold,
    color: Colors.error,
  },
  drawerFooter: {
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  footerText: {
    fontSize: 10,
    color: Colors.textDisabled,
    textAlign: 'center',
  },
});