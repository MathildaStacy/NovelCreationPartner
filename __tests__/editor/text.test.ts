import {
  displayEdit,
  toBody,
  toDisplay,
  toBodyOffset,
  toDisplayOffset,
} from '../../src/screens/editor/indent';
import { EditHistory } from '../../src/screens/editor/history';
import { locateSelection } from '../../src/screens/editor/locate';
import { groupDiff } from '../../src/screens/editor/diffRows';

const caret = (n: number) => ({ start: n, end: n });

describe('editor paragraph display and native offsets', () => {
  it('normalizes pasted leading whitespace without discarding empty paragraphs or trailing spaces', () => {
    expect(toBody('　　第一段  \r\n \r\n\t第三段')).toBe('第一段  \n\n第三段');
    expect(toDisplay('第一段\n\n第三段')).toBe('　　第一段\n　　\n　　第三段');
  });
  it('round trips UTF-16 offsets, including emoji and empty paragraphs', () => {
    const body = '风🌊\n\n海';
    for (let i = 0; i <= body.length; i++) {
      expect(toBodyOffset(toDisplay(body), toDisplayOffset(body, i))).toBe(i);
    }
    expect(toBodyOffset('　　风\n　　海', 5)).toBe(2);
    expect(toBodyOffset('　　风\n　　海', 6)).toBe(2);
  });
  it('adds indentation on return and merges paragraphs on backspace at their start', () => {
    expect(displayEdit('风', caret(1), '　　风\n')).toEqual({
      body: '风\n',
      selection: caret(2),
    });
    expect(displayEdit('风\n海', caret(2), '　　风\n　海')).toEqual({
      body: '风海',
      selection: caret(1),
    });
    expect(displayEdit('风', caret(0), '　风').body).toBe('风');
  });
  it('maps a pasted multiline cursor against native text before display indentation is added', () => {
    const result = displayEdit('风', caret(1), '　　风\n 海');
    expect(result).toEqual({ body: '风\n海', selection: caret(3) });
    expect(toDisplayOffset(result.body, result.selection.start)).toBe(7);
  });
});

describe('compact editor history', () => {
  it('invalidates captured revisions after merged typing, undo and redo, but not unchanged text', () => {
    const h = new EditHistory();
    h.record('', '风', caret(0), caret(1), 100);
    const first = h.revision;
    h.record('风', '风', caret(1), caret(1), 200);
    expect(h.revision).toBe(first);
    h.record('风', '风起', caret(1), caret(2), 300);
    expect(h.revision).toBeGreaterThan(first);
    const typed = h.revision;
    expect(h.undo('风起')?.body).toBe('');
    expect(h.revision).toBeGreaterThan(typed);
    const undone = h.revision;
    expect(h.redo('')?.body).toBe('风起');
    expect(h.revision).toBeGreaterThan(undone);
  });

  it('merges adjacent typing but starts a step after a pause, newline or moved cursor', () => {
    const h = new EditHistory();
    h.record('', '风', caret(0), caret(1), 100);
    h.record('风', '风起', caret(1), caret(2), 800);
    h.record('风起', '风起了', caret(2), caret(3), 1800);
    expect(h.undo('风起了')).toEqual({ body: '风起', selection: caret(2) });
    expect(h.undo('风起')).toEqual({ body: '', selection: caret(0) });
    expect(h.redo('')).toEqual({ body: '风起', selection: caret(2) });
    h.record('风起', '海风起', caret(0), caret(1), 1900);
    expect(h.canRedo).toBe(false);
    expect(h.undo('海风起')?.body).toBe('风起');
  });
  it('restores a replaced selection and merges successive backspaces', () => {
    const h = new EditHistory();
    h.record('风吹海', '风过海', { start: 1, end: 2 }, caret(2), 0);
    expect(h.undo('风过海')).toEqual({
      body: '风吹海',
      selection: { start: 1, end: 2 },
    });
    h.record('风吹海', '风吹', caret(3), caret(2), 100);
    h.record('风吹', '风', caret(2), caret(1), 200);
    expect(h.undo('风')).toEqual({ body: '风吹海', selection: caret(3) });
  });
  it('keeps only the latest 100 steps', () => {
    const h = new EditHistory();
    let body = '';
    for (let i = 0; i < 101; i++) {
      h.record(body, body + '风', caret(i), caret(i + 1), i * 1000);
      body += '风';
    }
    for (let i = 0; i < 100; i++) {
      body = h.undo(body)!.body;
    }
    expect(body).toBe('风');
    expect(h.canUndo).toBe(false);
  });
});

describe('source location and version folding', () => {
  it('chooses the nearest exact occurrence, then tries normalized punctuation and whitespace', () => {
    expect(
      locateSelection('风起。风起。', 0, { quote: '风起', offset: 4 })
        .selection,
    ).toEqual({ start: 3, end: 5 });
    expect(
      locateSelection('他 说：风起了。', 0, { quote: '他说:风起了.' })
        .selection,
    ).toEqual({ start: 0, end: 8 });
  });
  it('falls back to the offset paragraph start or saved cursor', () => {
    expect(
      locateSelection('风起\n海潮', 1, { quote: '没了', offset: 4 }),
    ).toEqual({ selection: caret(3), missing: 'near' });
    expect(locateSelection('风起', 1, { quote: '没了' })).toEqual({
      selection: caret(1),
      missing: 'missing',
    });
  });
  it('folds runs of three or more paragraphs while marking the first change', () => {
    const same = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'same' as const, a: `段${i}`, b: `段${i}` }));
    const rows = groupDiff([...same(5), { type: 'added', b: '四' }, ...same(1)]);
    // Two unchanged paragraphs stay visible before the change as context.
    expect(rows.map(r => [r.foldable, r.firstChange, r.blocks.length])).toEqual(
      [
        [true, false, 3],
        [false, false, 2],
        [false, true, 1],
        [false, false, 1],
      ],
    );
  });
  it('keeps two paragraphs of context on both sides and shows short remainders', () => {
    const same = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'same' as const, a: `段${i}`, b: `段${i}` }));
    const change = { type: 'removed' as const, a: '删' };
    expect(groupDiff([change, ...same(7), change]).map(r => [r.foldable, r.blocks.length])).toEqual(
      [[false, 1], [false, 2], [true, 3], [false, 2], [false, 1]],
    );
    expect(groupDiff([change, ...same(6), change]).map(r => [r.foldable, r.blocks.length])).toEqual(
      [[false, 1], [false, 6], [false, 1]],
    );
    expect(groupDiff(same(4)).map(r => r.foldable)).toEqual([true]);
  });
});
