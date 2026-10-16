import { describe, expect, it } from 'vitest';
import { generateMissingMessage, generateReportMessage, splitLineText } from '../src/lib/line/messages';
import type { LineSettingsSnapshot } from '../src/lib/line/types';

const settings: LineSettingsSnapshot = {
  hospitalName: 'โรงพยาบาลทดสอบ',
  wardName: 'หอผู้ป่วย A',
  reportFormat: 'standard',
  includeCapacityAndOccupancy: true,
  includeCategories: true,
  includeWorkloadHours: false,
  includeNote: true,
  lineEnabled: false,
  lineGroupId: '',
  nightSendTime: '00:00',
  morningSendTime: '08:00',
  afternoonSendTime: '16:00',
};

const lineRecord = {
  id: 'line-message-test',
  date: '2026-10-14',
  shift: 'เช้า' as const,
  totalPatients: 12,
  capacity: 20,
  availableBeds: 8,
  newPatients: 2,
  discharges: 1,
  referrals: 0,
  cat1: 4,
  cat2: 3,
  cat3: 3,
  cat4: 1,
  cat5: 1,
  note: 'ข้อมูลภายในที่ห้ามส่งออก',
  lineNote: 'เตรียมทีมรับส่งต่อ',
  updatedAt: '2026-10-14T02:00:00.000Z',
};

describe('LINE message limits', () => {
  it('generates plain report and missing messages without identity metadata', () => {
    expect(generateReportMessage(lineRecord, settings)).toBe([
      '14 ต.ค. 2569 · เวรเช้า',
      '',
      'ผู้ป่วย 12 ราย · เตียงทั้งหมด 20 · เตียงว่าง 8 · ครองเตียง 60.0%',
      'รับใหม่ 2 · จำหน่าย 1 · ส่งต่อ 0',
      '',
      'ประเภทผู้ป่วย',
      'ประเภท 1 (อาการน้อยสุด): 4 ราย',
      'ประเภท 2 (อาการน้อย): 3 ราย',
      'ประเภท 3 (อาการปานกลาง): 3 ราย',
      'ประเภท 4 (อาการหนัก / กึ่งวิกฤต): 1 ราย',
      'ประเภท 5 (วิกฤต / หนักมาก): 1 ราย',
      '',
      'หมายเหตุสำหรับ LINE: เตรียมทีมรับส่งต่อ',
    ].join('\n'));
    expect(generateMissingMessage('2026-10-14', 'เช้า', settings)).toBe(
      '14 ต.ค. 2569 · เวรเช้า\n\nยังไม่มีข้อมูลเวรนี้',
    );
  });

  it('never includes the internal census note in LINE output', () => {
    const message = generateReportMessage(lineRecord, { ...settings, includeNote: true });
    expect(message).toContain('เตรียมทีมรับส่งต่อ');
    expect(message).not.toContain('ข้อมูลภายในที่ห้ามส่งออก');
  });

  it('counts UTF-16 units while never splitting a surrogate pair', () => {
    const input = `${'a'.repeat(4999)}😀`;
    const chunks = splitLineText(input);
    expect(chunks).toEqual(['a'.repeat(4999), '😀']);
    expect(chunks.join('')).toBe(input);
    expect(chunks.every((chunk) => chunk.length <= 5000)).toBe(true);
  });

  it('splits 5000 emoji into two messages and preserves newlines exactly', () => {
    const emojiInput = '😀'.repeat(5000);
    const chunks = splitLineText(emojiInput);
    expect(chunks.length).toBe(2);
    expect(chunks.join('')).toBe(emojiInput);

    const input = `${emojiInput}\nท้ายข้อความ`;
    const withNewline = splitLineText(input);
    expect(withNewline.length).toBeLessThanOrEqual(5);
    for (const chunk of withNewline) {
      expect(chunk.length).toBeLessThanOrEqual(5000);
      expect(chunk).not.toContain('\uFFFD');
    }
    expect(withNewline.join('')).toBe(input);
  });

  it('falls back to exact unit chunks when line boundaries would exceed five messages', () => {
    const input = `${'a'.repeat(4000)}\n`.repeat(6);
    const chunks = splitLineText(input);
    expect(chunks).toHaveLength(5);
    expect(chunks.join('')).toBe(input);
    expect(chunks.every((chunk) => chunk.length <= 5000)).toBe(true);
  });

  it('rejects text that would exceed LINE’s five-message limit', () => {
    expect(() => splitLineText('x'.repeat(25_001))).toThrow(/5 messages/);
    expect(() => splitLineText('')).toThrow(/empty/);
  });
});
