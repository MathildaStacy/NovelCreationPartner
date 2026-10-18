import {
  chapterHeading,
  chineseNumeral,
  defaultVolumeTitle,
  formatChars,
  formatTime,
  slipFontSize,
} from '../../src/utils/format';

const at = (s: string) => new Date(s);

test('G01 time format', () => {
  const now = at('2026-10-18T14:40:00');
  expect(formatTime(at('2026-10-18T14:39:30').toISOString(), now)).toBe('刚刚');
  expect(formatTime(at('2026-10-18T09:05:00').toISOString(), now)).toBe('今天 09:05');
  expect(formatTime(at('2026-10-17T23:59:00').toISOString(), now)).toBe('昨天 23:59');
  expect(formatTime(at('2026-10-12T08:00:00').toISOString(), now)).toBe('10月12日');
  expect(formatTime(at('2025-12-03T08:00:00').toISOString(), now)).toBe('2025年12月3日');
});

test('G01 number format', () => {
  expect(formatChars(7204)).toBe('7204 字');
  expect(formatChars(82_000)).toBe('8.2 万字');
  expect(formatChars(10_000)).toBe('1 万字');
  expect(formatChars(0)).toBe('0 字');
});

test('slip size shrinks for long titles', () => {
  expect(slipFontSize(4, 140)).toBe(13);
  expect(slipFontSize(8, 140)).toBeLessThan(13);
  expect(slipFontSize(8, 40)).toBe(10);
});

test('volume names and chapter headings', () => {
  expect(chineseNumeral(3)).toBe('三');
  expect(chineseNumeral(10)).toBe('十');
  expect(chineseNumeral(21)).toBe('二十一');
  expect(defaultVolumeTitle(3)).toBe('第三卷');
  expect(defaultVolumeTitle(100)).toBe('第 100 卷');
  expect(chapterHeading({ kind: 'main', number: 12, title: '第 12 章' })).toBe('第 12 章');
  expect(chapterHeading({ kind: 'main', number: 12, title: '海边的相遇' })).toBe('第 12 章 海边的相遇');
  expect(chapterHeading({ kind: 'extra', number: null, title: '番外' })).toBe('番外');
  expect(chapterHeading({ kind: 'draft', number: null, title: '备用' })).toBe('草稿 备用');
});
