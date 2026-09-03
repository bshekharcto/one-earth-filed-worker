/**
 * Auth Store — SecureStore + Fast Cache backed
 */
import { storage } from '../services/storage';
import { AuthUser, Lang } from '../types';

export const authStore = {
  getUser: (): AuthUser | null => {
    const raw = storage.getString('user');
    return raw ? JSON.parse(raw) : null;
  },
  setUser: (user: AuthUser) => {
    storage.set('user', JSON.stringify(user));
  },
  getToken: (): string | null => {
    return storage.getString('jwt_token') || null;
  },
  setToken: (token: string) => {
    storage.set('jwt_token', token);
  },
  getLang: (): Lang => {
    const l = storage.getString('lang');
    return (l === 'mr' ? 'mr' : 'en');
  },
  setLang: (lang: Lang) => {
    storage.set('lang', lang);
  },
  isLoggedIn: (): boolean => {
    return !!storage.getString('jwt_token') && !!storage.getString('user');
  },
  isShiftActive: (): boolean => {
    return storage.getBoolean('shift_active') || false;
  },
  setShiftActive: (active: boolean) => {
    storage.set('shift_active', active);
    if (active) {
      storage.set('shift_start_time', new Date().toISOString());
    }
  },
  getShiftStartTime: (): string | null => {
    return storage.getString('shift_start_time') || null;
  },
  logout: () => {
    storage.remove('jwt_token');
    storage.remove('user');
    storage.remove('shift_active');
    storage.remove('shift_start_time');
  },
};