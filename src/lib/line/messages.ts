import { formatThaiDate, generateLineShiftSummary } from '../../utils/censusUtils';
import { SHIFT_META } from '../../types/census';
import type { LineCensusRecord, LineSettingsSnapshot, LineShift } from './types';
import { LINE_MAX_MESSAGES, LINE_MAX_TEXT_LENGTH } from './types';

export function generateReportMessage(record: LineCensusRecord, settings: LineSettingsSnapshot): string {
  return generateLineShiftSummary(record, {
    format: settings.reportFormat,
    includeCapacityAndOccupancy: settings.includeCapacityAndOccupancy,
    includeCategories: settings.includeCategories,
    includeWorkloadHours: settings.reportFormat === 'detailed' || settings.includeWorkloadHours,
    includeNote: settings.includeNote,
    hospitalName: settings.hospitalName,
    wardName: settings.wardName,
  });
}

export function generateMissingMessage(reportDate: string, shift: LineShift, settings: LineSettingsSnapshot): string {
  void settings;
  return `${formatThaiDate(reportDate, false)} · ${SHIFT_META[shift].label}\n\nยังไม่มีข้อมูลเวรนี้`;
}

function splitByUnits(text: string, preferNewline: boolean): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let index = start;
    let units = 0;
    let lastNewline = -1;
    while (index < text.length) {
      const first = text.charCodeAt(index);
      const isPair = first >= 0xd800 && first <= 0xdbff && index + 1 < text.length
        && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff;
      const width = isPair ? 2 : 1;
      if (units + width > LINE_MAX_TEXT_LENGTH) break;
      units += width;
      if (text.charCodeAt(index) === 0x0a) lastNewline = index;
      index += width;
    }
    if (index === text.length) {
      chunks.push(text.slice(start));
      break;
    }
    if (index === start) {
      throw new Error('LINE message contains an unrepresentable character boundary');
    }
    const end = preferNewline && lastNewline >= start ? lastNewline + 1 : index;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/** Splits on line boundaries where possible and never splits a Unicode surrogate pair. */
export function splitLineText(text: string): string[] {
  if (text.length === 0) throw new Error('LINE message cannot be empty');
  let chunks = splitByUnits(text, true);
  // A line-aware split can use more messages than necessary when many long lines
  // leave unused space. Fall back to the provider's exact unit limit before rejecting.
  if (chunks.length > LINE_MAX_MESSAGES) chunks = splitByUnits(text, false);
  if (chunks.length > LINE_MAX_MESSAGES) throw new Error(`LINE message exceeds ${LINE_MAX_MESSAGES} messages`);
  // LINE counts UTF-16 code units; chunk boundaries still must not bisect a surrogate pair.
  if (chunks.some((chunk) => chunk.length > LINE_MAX_TEXT_LENGTH || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(chunk))) {
    throw new Error('LINE message splitting failed');
  }
  return chunks;
}
