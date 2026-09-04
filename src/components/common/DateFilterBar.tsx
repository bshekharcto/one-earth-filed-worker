import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../constants/theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * `YYYY-MM-DD` for a Date, in the DEVICE's timezone.
 *
 * Deliberately NOT toISOString().split('T')[0] -- that converts to UTC first,
 * so in IST (+05:30) every night between 00:00 and 05:30 it reports yesterday
 * and playback would silently load the wrong day.
 */
export const toDateKey = (d: Date): string => {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export const fromDateKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const addDays = (key: string, delta: number): string => {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
};

const prettyLabel = (key: string): string => {
  const today = toDateKey(new Date());
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  const d = fromDateKey(key);
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
};

interface Props {
  value: string;                       // YYYY-MM-DD
  onChange: (dateKey: string) => void;
  /** Days with data, if known -- rendered with a dot in the calendar. */
  markedDates?: string[];
}

export const DateFilterBar: React.FC<Props> = ({ value, onChange, markedDates }) => {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => fromDateKey(value));

  const todayKey = toDateKey(new Date());
  const marked = useMemo(() => new Set(markedDates || []), [markedDates]);

  // Leading blanks so the 1st lands under the right weekday.
  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (string | null)[] = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push(toDateKey(new Date(year, month, d)));
    }
    return out;
  }, [cursor]);

  const openPicker = () => {
    setCursor(fromDateKey(value));
    setOpen(true);
  };

  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
  };

  const shiftMonth = (delta: number) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    setCursor(next);
  };

  const isAtToday = value === todayKey;

  return (
    <>
      <View style={styles.bar}>
        <TouchableOpacity
          style={styles.arrowBtn}
          onPress={() => onChange(addDays(value, -1))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
        >
          <Feather name="chevron-left" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.dateBtn} onPress={openPicker} activeOpacity={0.7}>
          <Feather name="calendar" size={14} color={Colors.primary} style={{ marginRight: 6 }} />
          <Text style={styles.dateText}>{prettyLabel(value)}</Text>
          <Feather name="chevron-down" size={14} color={Colors.textSecondary} style={{ marginLeft: 4 }} />
        </TouchableOpacity>

        {/* Future days hold no track, so stop the user walking past today. */}
        <TouchableOpacity
          style={[styles.arrowBtn, isAtToday && styles.arrowBtnDisabled]}
          disabled={isAtToday}
          onPress={() => onChange(addDays(value, 1))}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
        >
          <Feather name="chevron-right" size={18} color={isAtToday ? Colors.textDisabled : Colors.textSecondary} />
        </TouchableOpacity>

        {!isAtToday && (
          <TouchableOpacity style={styles.todayBtn} onPress={() => onChange(todayKey)}>
            <Text style={styles.todayBtnText}>Today</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Swallow taps inside the card so it doesn't close on every day press. */}
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.monthRow}>
              <TouchableOpacity style={styles.monthArrow} onPress={() => shiftMonth(-1)}>
                <Feather name="chevron-left" size={20} color={Colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.monthText}>
                {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
              </Text>
              <TouchableOpacity style={styles.monthArrow} onPress={() => shiftMonth(1)}>
                <Feather name="chevron-right" size={20} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.grid}>
              {DOW.map((d, i) => (
                <View key={`dow-${i}`} style={styles.cell}>
                  <Text style={styles.dowText}>{d}</Text>
                </View>
              ))}

              {cells.map((key, i) => {
                if (!key) return <View key={`pad-${i}`} style={styles.cell} />;
                const isFuture = key > todayKey;
                const isSelected = key === value;
                const isToday = key === todayKey;
                return (
                  <TouchableOpacity
                    key={key}
                    style={styles.cell}
                    disabled={isFuture}
                    onPress={() => pick(key)}
                  >
                    <View style={[
                      styles.dayPill,
                      isToday && !isSelected && styles.dayPillToday,
                      isSelected && styles.dayPillSelected,
                    ]}>
                      <Text style={[
                        styles.dayText,
                        isFuture && styles.dayTextDisabled,
                        isSelected && styles.dayTextSelected,
                      ]}>
                        {Number(key.slice(8))}
                      </Text>
                    </View>
                    {marked.has(key) ? <View style={[styles.dot, isSelected && styles.dotSelected]} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.footerBtn} onPress={() => pick(addDays(todayKey, -1))}>
                <Text style={styles.footerBtnText}>Yesterday</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.footerBtn, styles.footerBtnPrimary]} onPress={() => pick(todayKey)}>
                <Text style={[styles.footerBtnText, styles.footerBtnTextPrimary]}>Today</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  arrowBtn: {
    width: 30, height: 30, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bgSunken,
  },
  arrowBtnDisabled: { opacity: 0.45 },
  dateBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 7, paddingHorizontal: 10,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bgCard,
  },
  dateText: { fontSize: 13, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
  todayBtn: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: '#EFF6FF',
    borderWidth: 1, borderColor: Colors.primary,
  },
  todayBtnText: { fontSize: 11, color: Colors.primary, fontWeight: Typography.weight.bold },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center', justifyContent: 'center', padding: Spacing.lg,
  },
  card: {
    width: '100%', maxWidth: 360, backgroundColor: Colors.bgCard,
    borderRadius: Radius.xl, padding: Spacing.md, ...Shadow.lg,
  },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  monthArrow: { width: 34, height: 34, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgSunken },
  monthText: { fontSize: 15, fontWeight: Typography.weight.bold, color: Colors.textPrimary },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dowText: { fontSize: 11, color: Colors.textDisabled, fontWeight: Typography.weight.semibold },
  dayPill: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayPillToday: { borderWidth: 1, borderColor: Colors.primary },
  dayPillSelected: { backgroundColor: Colors.primary },
  dayText: { fontSize: 13, color: Colors.textPrimary },
  dayTextDisabled: { color: Colors.textDisabled },
  dayTextSelected: { color: '#fff', fontWeight: Typography.weight.bold },
  dot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.success },
  dotSelected: { backgroundColor: '#fff' },

  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: Spacing.sm },
  footerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.md, backgroundColor: Colors.bgSunken },
  footerBtnPrimary: { backgroundColor: Colors.primary },
  footerBtnText: { fontSize: 12, color: Colors.textSecondary, fontWeight: Typography.weight.semibold },
  footerBtnTextPrimary: { color: '#fff' },
});
