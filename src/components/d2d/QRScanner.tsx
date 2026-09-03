import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Dimensions, Vibration, Alert,
} from 'react-native';
import { CameraView, Camera, BarcodeScanningResult } from 'expo-camera';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../constants/theme';

const { width, height } = Dimensions.get('window');
const SCAN_BOX = width * 0.65;

interface Props {
  onScan: (code: string) => void;
  onClose: () => void;
}

export const QRScanner: React.FC<Props> = ({ onScan, onClose }) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const lastScanRef = useRef<string>('');

  useEffect(() => {
    Camera.requestCameraPermissionsAsync().then(({ status }) => {
      setHasPermission(status === 'granted');
    });
  }, []);

  const handleBarcodeScanned = ({ type, data }: BarcodeScanningResult) => {
    if (scanned || data === lastScanRef.current) return;
    lastScanRef.current = data;
    setScanned(true);
    Vibration.vibrate([0, 80, 40, 80]);
    onScan(data);
  };

  if (hasPermission === null) {
    return (
      <View style={styles.permissionBox}>
        <Text style={styles.permissionText}>Requesting camera access...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.permissionBox}>
        <Text style={styles.permissionIcon}>📷</Text>
        <Text style={styles.permissionTitle}>Camera Permission Required</Text>
        <Text style={styles.permissionText}>Please allow camera access in Settings to scan QR codes.</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera */}
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={flashOn}
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
      />

      {/* Dark overlay with scan window cutout */}
      <View style={styles.overlay}>
        {/* Top dark area */}
        <View style={styles.overlayTop} />

        {/* Middle row: dark | scan box | dark */}
        <View style={styles.overlayMiddleRow}>
          <View style={styles.overlaySide} />
          <View style={styles.scanBox}>
            {/* Corner brackets */}
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
            {/* Scan line animation would go here */}
          </View>
          <View style={styles.overlaySide} />
        </View>

        {/* Bottom dark area with controls */}
        <View style={styles.overlayBottom}>
          <Text style={styles.instructionText}>
            Point camera at QR code or barcode
          </Text>

          <View style={styles.controlRow}>
            <TouchableOpacity style={styles.controlBtn} onPress={() => setFlashOn(f => !f)}>
              <Text style={styles.controlBtnText}>{flashOn ? '🔦 Flash On' : '🔦 Flash Off'}</Text>
            </TouchableOpacity>
            {scanned && (
              <TouchableOpacity style={styles.controlBtn} onPress={() => { setScanned(false); lastScanRef.current = ''; }}>
                <Text style={styles.controlBtnText}>🔄 Scan Again</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕  Close Scanner</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  permissionBox: {
    flex: 1, backgroundColor: Colors.bg,
    alignItems: 'center', justifyContent: 'center', padding: Spacing['3xl'],
  },
  permissionIcon: { fontSize: 56, marginBottom: Spacing.lg },
  permissionTitle: {
    fontSize: Typography.size.xl, fontWeight: Typography.weight.bold,
    color: Colors.textPrimary, textAlign: 'center', marginBottom: Spacing.sm,
  },
  permissionText: {
    fontSize: Typography.size.sm, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },
  overlay: { flex: 1 },
  overlayTop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
  },
  overlayMiddleRow: { flexDirection: 'row', height: SCAN_BOX },
  overlaySide: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
  },
  scanBox: {
    width: SCAN_BOX, height: SCAN_BOX,
    backgroundColor: 'transparent',
  },
  overlayBottom: {
    flex: 1.2, backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', paddingTop: Spacing.xl, paddingHorizontal: Spacing['2xl'],
  },
  instructionText: {
    color: '#fff', fontSize: Typography.size.sm,
    textAlign: 'center', marginBottom: Spacing.xl, opacity: 0.85,
  },
  controlRow: {
    flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.xl,
  },
  controlBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  controlBtnText: {
    color: '#fff', fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold,
  },
  closeBtn: {
    backgroundColor: 'rgba(239,68,68,0.2)', borderRadius: Radius.lg,
    paddingHorizontal: Spacing['2xl'], paddingVertical: Spacing.md,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
  },
  closeBtnText: {
    color: Colors.danger, fontSize: Typography.size.md, fontWeight: Typography.weight.bold,
  },
  // Corner bracket style
  corner: {
    position: 'absolute', width: 28, height: 28,
    borderColor: Colors.primary, borderWidth: 3,
  },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
});

