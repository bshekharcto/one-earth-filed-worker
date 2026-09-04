/**
 * Background location task.
 *
 * Location.startLocationUpdatesAsync('background-location-task', ...) in
 * gpsTracker.ts referenced this task name, but nothing ever registered it and
 * expo-task-manager was not even installed. The call therefore threw on every
 * shift and was swallowed by its .catch(), silently leaving the app with
 * foreground-only tracking: GPS stopped the moment the screen locked.
 *
 * TaskManager.defineTask must run at module scope, before any React code, so
 * the task exists when the OS hands work back to the app. index.ts imports
 * this file first for that reason -- do not move the import into a component.
 */
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { storage } from './storage';
import { handleNewLocation, setStaffId } from './gpsTracker';

export const LOCATION_TASK_NAME = 'background-location-task';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.warn('[BGTask] error:', error.message);
    return;
  }
  const locations: Location.LocationObject[] = data?.locations || [];
  if (!locations.length) return;

  // The OS may start this task in a fresh JS context, so module state in
  // gpsTracker can be empty here. Restore the staff id from storage.
  const sid = storage.getString('tracking_staff_id');
  if (!sid) return;          // shift ended -- nothing to report
  setStaffId(sid);

  // Reuse the foreground path so background fixes get identical treatment:
  // socket emit for the live map, batched REST for persistence, offline queue
  // when there is no connectivity.
  for (const loc of locations) {
    try {
      await handleNewLocation(loc);
    } catch (e: any) {
      console.warn('[BGTask] handleNewLocation failed:', e?.message);
    }
  }
});
