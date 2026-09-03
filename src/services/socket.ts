import { io, Socket } from 'socket.io-client';
import { createMMKV } from 'react-native-mmkv';

const BASE_URL = (process.env.EXPO_PUBLIC_WS_BASE_URL || 'https://cortex-swm-oneearth.vercel.app');
const storage = createMMKV({ id: 'auth-store' });

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    const token = storage.getString('jwt_token') || '';
    socket = io(`${BASE_URL}/tracking`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket?.id);
    });
    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });
    socket.on('connect_error', (err) => {
      console.warn('[Socket] Connection error:', err.message);
    });
  }
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

// Subscribe to all live workers (supervisor map)
export const subscribeAllWorkers = (cb: (data: any) => void) => {
  const s = getSocket();
  s.emit('join:all-workers');
  s.on('worker:position', cb);
  return () => { s.off('worker:position', cb); };
};

// Subscribe to all live vehicles
export const subscribeAllVehicles = (cb: (data: any) => void) => {
  const s = getSocket();
  s.emit('join:all-vehicles');
  s.on('vehicle:position', cb);
  return () => { s.off('vehicle:position', cb); };
};

// Subscribe to D2D events (supervisor dashboard)
export const subscribeD2DEvents = (wardId: string, cb: (data: any) => void) => {
  const s = getSocket();
  s.emit('join:ward', wardId);
  s.on('d2d:verified', cb);
  return () => { s.off('d2d:verified', cb); };
};

// Worker sends live position (used when online instead of HTTP heartbeat)
export const emitWorkerPosition = (data: {
  staffId: string; lat: number; lng: number;
  speed: number; heading: number; battery: number; timestamp: string;
}) => {
  const s = getSocket();
  if (s.connected) {
    s.emit('worker:heartbeat', data);
    return true;
  }
  return false; // offline — caller should queue it
};


