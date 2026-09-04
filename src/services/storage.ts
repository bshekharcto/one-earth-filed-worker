import * as SecureStore from 'expo-secure-store';

class SyncSecureStorage {
  private cache: Map<string, string> = new Map();

  constructor() {
    this.preload();
  }

  private preload() {
    const keys = ['user', 'jwt_token', 'lang', 'shift_active', 'shift_start_time', 'gps-state', 'offline-queue', 'distance_today_km', 'last_position'];
    for (const key of keys) {
      SecureStore.getItemAsync(key)
        .then(val => {
          if (val !== null && val !== undefined) {
            this.cache.set(key, val);
          }
        })
        .catch(() => {});
    }
  }

  getString(key: string): string | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: string | boolean | number) {
    const strVal = String(value);
    this.cache.set(key, strVal);
    SecureStore.setItemAsync(key, strVal).catch(() => {});
  }

  getBoolean(key: string): boolean {
    return this.cache.get(key) === 'true';
  }

  // gpsTracker stores cumulative shift distance here. Without this method the
  // call threw "storage.getNumber is not a function" on every GPS fix after
  // the first, aborting handleNewLocation before it could emit the position.
  getNumber(key: string): number | undefined {
    const raw = this.cache.get(key);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  remove(key: string) {
    this.cache.delete(key);
    SecureStore.deleteItemAsync(key).catch(() => {});
  }
}

export const storage = new SyncSecureStorage();