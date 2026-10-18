import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Modal, TextInput } from 'react-native';
import { act } from 'react-test-renderer';
import { openMemoryDb } from '../../src/data/drivers/nodeSqlite';
import { migrate } from '../../src/data/migrations';
import { setDb } from '../../src/data/db';
import * as works from '../../src/features/works';
import * as volumes from '../../src/features/volumes';
import * as chapters from '../../src/features/chapters';
import { t } from '../../src/locales/zh-CN';
import { useOverlay } from '../../src/components/overlay/store';
import { ChapterFormSheet } from '../../src/screens/work/ChapterFormSheet';
import { ChaptersScreen } from '../../src/screens/work/ChaptersScreen';
import { chapterActionItems } from '../../src/screens/work/ChapterActionsSheet';
import {
  defaultVolume,
  layoutOf,
  mainNumberAt,
  moveChapter,
  previewNumbers,
  sameLayout,
} from '../../src/screens/work/chapterLayout';
import {
  allText,
  press,
  renderApp,
  typeInto,
  until,
  wait,
} from '../helpers/render';

async function fixture() {
  const db = openMemoryDb();
  setDb(db);
  await migrate(db);
  const work = await works.create({ premise: '海边发生的故事', title: '潮汐' });
  const [first] = await volumes.list(work.id);
  return { db, work, first };
}

async function enterChapters(db: ReturnType<typeof openMemoryDb>) {
  const app = await renderApp(db);
  await until(app, text => text.includes('潮汐'));
  await press(app, /潮汐/, 'onLongPress');
  await press(app, '打开');
  await until(app, text => text.includes('故事档案'));
  // Bottom tab labels may carry nested text, so use the supplied accessibility label.
  await press(app, '章节');
  return app;
}

test('chapter layout preview numbers main chapters only and remembers changes across empty volumes', async () => {
  const { work, first } = await fixture();
  const second = await volumes.create(work.id, '第二卷');
  const main = await chapters.create({ workId: work.id, volumeId: first.id });
  const extra = await chapters.create({
    workId: work.id,
    volumeId: first.id,
    kind: 'extra',
  });
  const last = await chapters.create({ workId: work.id, volumeId: first.id });
  const groups = await chapters.list(work.id);
  const layout = layoutOf(groups);
  const moved = moveChapter(layout, main.id, second.id, 0);
  const byId = new Map([main, extra, last].map(c => [c.id, c]));
  expect(previewNumbers(moved, byId).get(last.id)).toBe(1);
  expect(previewNumbers(moved, byId).get(main.id)).toBe(2);
  expect(previewNumbers(moved, byId).get(extra.id)).toBeNull();
  expect(sameLayout(layout, moveChapter(moved, main.id, first.id, 0))).toBe(
    true,
  );
  expect(defaultVolume(groups)).toBe(first.id);
  expect(mainNumberAt(groups, first.id)).toBe(3);
  expect(mainNumberAt(groups, second.id, main.id)).toBe(2);
  await chapters.reorder(work.id, moved);
  expect(await chapters.numberOf(last.id)).toBe(1);
  expect(await chapters.numberOf(main.id)).toBe(2);
});

test('chapter menus follow kind and state restrictions', async () => {
  const { work, first } = await fixture();
  const chapter = await chapters.create({
    workId: work.id,
    volumeId: first.id,
  });
  const keys = (
    kind: typeof chapter.kind,
    state: typeof chapter.state,
    n = 2,
  ) => chapterActionItems({ ...chapter, kind, state }, n).map(i => i.key);
  expect(keys('main', 'draft')).toEqual([
    'info',
    'move',
    'finalize',
    'versions',
    'export',
    'remove',
  ]);
  expect(keys('main', 'modified')).toContain('unfinalize');
  expect(keys('main', 'finalized')).not.toContain('finalize');
  expect(keys('extra', 'draft', 1)).toEqual([
    'info',
    'versions',
    'export',
    'remove',
  ]);
  expect(keys('draft', 'draft', 1)).toEqual(['info', 'versions', 'remove']);
});

test('empty chapters opens first-chapter form and switching kinds maintains untouched defaults', async () => {
  const { db } = await fixture();
  const app = await enterChapters(db);
  await until(app, text => text.includes(t.chapters.emptyTitle));
  await press(app, t.chapters.newFirst);
  await until(app, text => text.includes(t.chapterForm.create));
  expect(allText(app)).toContain('正文（第 1 章）');
  await press(app, '番外');
  const input = app.root.findAll(
    n =>
      n.props.placeholder === t.chapterForm.titlePlaceholder &&
      typeof n.props.onChangeText === 'function',
  )[0];
  expect(input.props.value).toBe('');
  await press(app, '正文（第 1 章）');
  expect(input.props.value).toBe('第 1 章');
  await typeInto(app, t.chapterForm.titlePlaceholder, '海边');
  await press(app, t.common.cancel);
  expect(useOverlay.getState().dialogs.at(-1)?.title).toBe(t.unsaved.title);
  await press(app, t.unsaved.discard);
  expect(
    (await chapters.list((await works.list())[0].id))[0].chapters,
  ).toHaveLength(0);
  await act(async () => app.unmount());
});

test('chapter form moves an edited chapter to the chosen volume and locks finalized kinds', async () => {
  const { db, work, first } = await fixture();
  const second = await volumes.create(work.id, '远航');
  const chapter = await chapters.create({
    workId: work.id,
    volumeId: first.id,
    title: '潮起',
  });
  await chapters.saveBody(chapter.id, '潮水涌来', 0);
  await chapters.finalize(chapter.id);
  const app = await enterChapters(db);
  await until(app, text => text.includes('潮起'));
  await press(app, '第 1 章 潮起', 'onLongPress');
  await press(app, t.chapterActions.editInfo);
  await until(app, text => text.includes(t.chapterForm.titleLabel));
  await press(app, t.chapterForm.kindExtra);
  expect(useOverlay.getState().toast?.message).toBe(t.chapterForm.kindLocked);
  await press(app, '选择所属卷');
  await until(app, text => text.includes(t.chapterForm.pickVolume));
  await press(app, '远航');
  await until(app, text => text.includes(t.chapterForm.titleLabel));
  await press(app, t.common.save);
  await wait(350);
  expect((await chapters.get(chapter.id)).volumeId).toBe(second.id);
  expect((await chapters.get(chapter.id)).state).toBe('finalized');
  await act(async () => app.unmount());
});

test('deleting a chapter confirms pending memories and undo restores it', async () => {
  const { db, work, first } = await fixture();
  const chapter = await chapters.create({
    workId: work.id,
    volumeId: first.id,
    title: '潮起',
  });
  await db.run(
    `INSERT INTO memory_proposals (id, work_id, chapter_id, kind, target_type, target_name, after_value, evidence, confidence, created_at)
     VALUES ('pending-1', ?, ?, 'new_fact', 'character', '守夜人', '守着灯塔', '潮起', 'high', '2026-10-18T09:00:00+08:00')`,
    [work.id, chapter.id],
  );
  const app = await enterChapters(db);
  await until(app, text => text.includes('潮起'));
  await press(app, '第 1 章 潮起', 'onLongPress');
  await press(app, t.chapterActions.removeA11y);
  await until(app, text => text.includes(t.confirmDelete.chapterBody));
  expect(allText(app)).toContain(t.confirmDelete.chapterPending(1));
  await press(app, t.confirmDelete.chapterButton);
  await wait(350);
  expect((await chapters.list(work.id))[0].chapters).toHaveLength(0);
  const undo = useOverlay.getState().toast?.action;
  expect(undo?.label).toBe(t.common.undo);
  await act(async () => undo?.onPress());
  await wait(350);
  expect((await chapters.list(work.id))[0].chapters[0].id).toBe(chapter.id);
  await act(async () => app.unmount());
});

test('volume management renames, reorders, and protects nonempty volumes', async () => {
  const { db, work, first } = await fixture();
  await chapters.create({ workId: work.id, volumeId: first.id, title: '潮起' });
  const second = await volumes.create(work.id, '第二卷');
  const app = await enterChapters(db);
  await until(app, text => text.includes('第二卷'));
  await press(app, '第二卷，卷管理');
  await until(app, text => text.includes(t.volumes.note));
  await press(app, '第一卷，删除');
  expect(useOverlay.getState().toast?.message).toBe(t.volumes.notEmpty(0));
  await press(app, '第二卷，重命名');
  const field = app.root.findAll(
    n =>
      n.props.accessibilityLabel === '卷名' &&
      typeof n.props.onChangeText === 'function',
  )[0];
  await act(async () => {
    field.props.onChangeText('星渊');
  });
  await act(async () => {
    await field.props.onSubmitEditing();
  });
  await until(app, text => text.includes('星渊'));
  await press(app, '星渊，上移');
  await wait(350);
  expect((await volumes.list(work.id))[0].id).toBe(second.id);
  await press(app, '星渊，删除');
  await until(app, text => text.includes(t.confirmDelete.volumeBody));
  await press(app, t.confirmDelete.volumeButton);
  await wait(350);
  expect(await volumes.list(work.id)).toHaveLength(1);
  await act(async () => app.unmount());
});

test('reorder previews changed numbers, saves once, and discards subsequent changes', async () => {
  const { db, work, first } = await fixture();
  const a = await chapters.create({
    workId: work.id,
    volumeId: first.id,
    title: '潮起',
  });
  const b = await chapters.create({
    workId: work.id,
    volumeId: first.id,
    title: '远航',
  });
  const app = await enterChapters(db);
  await until(app, text => text.includes('远航'));
  await press(app, t.chapters.reorder);
  await until(app, text => text.includes(t.reorder.note));
  await wait(100);
  const handle = app.root.findAll(
    n =>
      n.props.accessibilityRole === 'adjustable' &&
      n.props.accessibilityLabel?.startsWith('第 2 章'),
  )[0];
  await act(async () => {
    handle.props.onAccessibilityAction({
      nativeEvent: { actionName: 'decrement' },
    });
  });
  expect(allText(app)).toContain('原第 2 章');
  await press(app, t.common.done);
  await wait(350);
  expect((await chapters.list(work.id))[0].chapters.map(c => c.id)).toEqual([
    b.id,
    a.id,
  ]);
  await press(app, t.chapters.reorder);
  await until(app, text => text.includes(t.reorder.note));
  await wait(100);
  const next = app.root.findAll(
    n =>
      n.props.accessibilityRole === 'adjustable' &&
      n.props.accessibilityLabel?.startsWith('第 2 章'),
  )[0];
  await act(async () => {
    next.props.onAccessibilityAction({
      nativeEvent: { actionName: 'decrement' },
    });
  });
  expect(allText(app)).toContain('原第 2 章');
  await press(app, t.common.cancel);
  await until(app, text => text.includes(t.reorder.discardTitle));
  await press(app, t.reorder.discard);
  await wait(350);
  expect((await chapters.list(work.id))[0].chapters.map(c => c.id)).toEqual([
    b.id,
    a.id,
  ]);
  await act(async () => app.unmount());
});

test('chapter back returns to the existing shelf without pushing a duplicate route', async () => {
  const { db } = await fixture();
  const app = await enterChapters(db);
  await until(app, text => text.includes(t.chapters.emptyTitle));
  const navigation = app.root.findByType(ChaptersScreen).props.navigation;
  const stack = navigation.getParent();
  expect(stack.getState().routes.map((r: { name: string }) => r.name)).toEqual([
    'Shelf',
    'Work',
  ]);
  await press(app, '返回书架');
  await wait(50);
  expect(stack.getState().routes.map((r: { name: string }) => r.name)).toEqual([
    'Shelf',
  ]);
  await act(async () => app.unmount());
});

test('chapter form focuses only once the native modal is shown and restores typed input after volume selection', async () => {
  const { work } = await fixture();
  await volumes.create(work.id, '第二卷');
  let app!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    app = ReactTestRenderer.create(
      <ChapterFormSheet
        visible
        mode="create"
        workId={work.id}
        onRequestClose={() => {}}
      />,
    );
  });
  await until(app, text => text.includes(t.chapterForm.titleLabel));
  const input = app.root.findByType(TextInput);
  const focus = jest.spyOn(input.instance, 'focus');
  focus.mockClear();
  expect(focus).not.toHaveBeenCalled();
  await act(async () => {
    app.root.findByType(Modal).props.onShow();
  });
  expect(focus).not.toHaveBeenCalled();
  await wait(350);
  expect(focus).toHaveBeenCalledTimes(1);
  expect(input.props.selectTextOnFocus).toBe(true);
  await typeInto(app, t.chapterForm.titlePlaceholder, '保留输入的标题');
  await press(app, '选择所属卷');
  await until(app, text => text.includes(t.chapterForm.pickVolume));
  await press(app, '第二卷');
  await until(app, text => text.includes(t.chapterForm.titleLabel));
  expect(app.root.findByType(TextInput).props.value).toBe('保留输入的标题');
  await act(async () => {
    app.root.findByType(Modal).props.onShow();
  });
  await wait(350);
  expect(focus).toHaveBeenCalledTimes(2);
  focus.mockRestore();
  await act(async () => app.unmount());
});

test('chapter form waits for initial data when the native modal shows before loading finishes', async () => {
  const { work } = await fixture();
  const rows = await chapters.list(work.id);
  let resolve!: (value: typeof rows) => void;
  const pending = new Promise<typeof rows>(done => {
    resolve = done;
  });
  const listSpy = jest.spyOn(chapters, 'list').mockReturnValueOnce(pending);
  let app!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    app = ReactTestRenderer.create(
      <ChapterFormSheet
        visible
        mode="create"
        workId={work.id}
        onRequestClose={() => {}}
      />,
    );
  });
  await act(async () => {
    app.root.findByType(Modal).props.onShow();
  });
  expect(app.root.findAllByType(TextInput)).toHaveLength(0);
  await wait(350);
  // TextInput's Jest native-method mocks are shared by instances.
  jest.clearAllMocks();
  await act(async () => {
    resolve(rows);
  });
  const input = app.root.findByType(TextInput);
  expect(input.instance.focus).toHaveBeenCalledTimes(1);
  expect(input.props.value).toBe('第 1 章');
  listSpy.mockRestore();
  await act(async () => app.unmount());
});
