/**
 * All UI copy (ARCHITECTURE §2: V1 is Simplified Chinese only). Copy follows the
 * detailed design pages verbatim; the section names match the page IDs.
 * Rules (UI §6): call the user 你, buttons are verbs, no exclamation marks or emoji.
 */
export const t = {
  common: {
    cancel: '取消',
    close: '关闭',
    done: '完成',
    save: '保存',
    saved: '已保存',
    retry: '重试',
    reload: '重新加载',
    gotIt: '知道了',
    undo: '撤销',
    undone: '已撤销',
    view: '查看',
    viewDetail: '查看详情',
    copied: '已复制',
    more: '更多操作',
    collapseActions: '收起操作',
    untitledWork: '未命名作品',
    untitledSlip: '未命名',
    movedToTrash: '已移到回收站',
    deleted: '已删除',
    comingSoon: '这个功能还在开发中，后续版本开放',
    aiComingSoon: 'AI 功能还在开发中，后续版本开放',
    discard: '放弃修改',
    keepEditing: '继续编辑',
  },

  errors: {
    genericTitle: '操作没有完成',
    notSaved: '没有保存成功',
    dbError: '本机数据库出了问题，这次操作没有生效。可以复制详情反馈给我们。',
    storageFull: '手机存储空间不足，内容没有保存。请清理空间后重试。',
    detailTitle: '错误详情',
    detailHeader: 'AI 小说创作伙伴 错误详情',
    copyDetail: '复制详情',
    workGone: '这部作品已被删除',
    chapterGone: '这一章已被删除',
  },

  badge: {
    chapterState: { draft: '草稿', finalized: '已定稿', modified: '有修改未定稿' },
    chapterKind: { extra: '番外', draft: '草稿' },
    versionReason: { auto: '自动', finalize: '定稿', before_ai: 'AI 插入前', manual: '手动', before_restore: '恢复前' },
  },

  /** G02 §10 startup */
  boot: {
    migrateFailedTitle: '数据升级失败',
    migrateFailedBody:
      '这台手机上的作品数据没有升级成功，为了不损坏数据，App 暂时不能打开。请复制详情反馈给我们，不要卸载 App。',
    openFailedTitle: '数据没有打开',
    openFailedBody:
      '本机数据库没有打开。请重启 App 再试；如果仍然失败，请复制详情反馈给我们，不要卸载 App。',
    copyDetail: '复制详情',
    retry: '重试',
  },

  tabs: {
    overview: '概览',
    chapters: '章节',
    partner: 'AI 伙伴',
    archive: '档案',
    backToShelf: '书架',
  },

  /** S03 书架 */
  shelf: {
    title: '我的书架',
    search: '搜索作品',
    settings: '设置',
    filterAll: (n: number) => `全部 ${n}`,
    filterOngoing: (n: number) => `连载中 ${n}`,
    filterFinished: (n: number) => `已完结 ${n}`,
    newWork: '新建作品',
    sortNote: '按最近编辑排序。长按书封可重命名、换封面、导出或删除。',
    emptyTitle: '写下第一句灵感，故事就从这里开始',
    restore: '从备份恢复',
    noOngoing: '没有连载中的作品。',
    noFinished: '还没有已完结的作品。长按书封，可以把写完的作品标记为已完结。',
    showAll: '查看全部作品',
    loadFailed: '书架没有加载出来。',
    planning: '构思中',
    chapters: (n: number) => `${n} 章`,
    finished: '已完结',
    a11yBook: (title: string, meta: string, time: string) =>
      `${title}，${meta}，最近编辑${time}`,
  },

  /** S03a 作品操作菜单 */
  workActions: {
    title: (name: string, meta: string) => (meta ? `${name} · ${meta}` : name),
    open: '打开',
    editInfo: '编辑作品信息',
    changeCover: '更换封面',
    markFinished: '标记为已完结',
    markOngoing: '标记为连载中',
    export: '导出这部作品',
    remove: '删除作品',
    removeA11y: '删除作品，移到回收站',
    markedFinished: '已标记为已完结',
    markedOngoing: '已标记为连载中',
    a11yMenu: (name: string) => `${name}，作品操作`,
  },

  /** S03b 搜索作品 */
  search: {
    placeholder: '搜索书名、简介或题材',
    found: (n: number) => `找到 ${n} 部作品`,
    none: (q: string) => `没有找到与「${q}」相关的作品`,
    noneHint: '可以试试书名里的其他字，或题材名，如"玄幻"',
    noneA11y: '没有找到相关作品',
  },

  /** S04 新建作品 */
  newWork: {
    title: '新建作品',
    premiseLabel: '一句话灵感',
    premisePlaceholder: '写下脑海里的一个画面、人物或故事点子…',
    premiseTooLong: '最多 2000 字',
    genreLabel: '题材',
    titleLabel: '作品名称',
    titlePlaceholder: '暂不命名，稍后和 AI 一起定',
    titleTooLong: '最多 30 字',
    ideate: '开始和 AI 构思',
    createOnly: '只创建作品，直接写',
    discardTitle: '放弃这部新作品？',
    discardBody: '灵感和填写的内容不会保存。',
    discard: '放弃',
  },

  /** S05 作品概览 */
  overview: {
    info: '作品信息',
    plannedProgress: (n: number, m: number) => `正文 ${n} / 计划 ${m} 章`,
    mainCount: (n: number) => `正文 ${n} 章`,
    ongoing: '连载中',
    finished: '已完结',
    continueWriting: '继续写作',
    newFirstChapter: '＋ 新建第一章',
    noBodyYet: '还没有正文',
    pending: '待处理',
    conflicts: (n: number) => `${n} 处设定冲突`,
    proposals: (n: number) => `${n} 条待审核记忆`,
    proposalsFromChapter: (n: number) => `来自第 ${n} 章定稿提取`,
    proposalsFromChapters: (k: number) => `来自 ${k} 个章节`,
    jobsRunning: (n: number | null, k: number) =>
      n != null ? `正在整理第 ${n} 章（${k}/3）` : `正在整理（${k}/3）`,
    jobsPaused: (n: number) => `${n} 个任务已暂停`,
    jobsFailed: (n: number) => `${n} 个任务失败`,
    archive: '故事档案',
    viewAll: '查看全部 ›',
    characters: '人物',
    settings: '世界与设定',
    foreshadows: '未回收伏笔',
    loadFailed: '概览没有加载出来。',
  },

  /** S05a 作品信息 */
  workInfo: {
    title: '作品信息',
    backOverview: '概览',
    backShelf: '书架',
    changeCover: '更换封面',
    titleLabel: '书名',
    titlePlaceholder: '未命名作品',
    genreLabel: '题材',
    premiseLabel: '简介（一句话灵感）',
    premiseEmpty: '简介不能为空，写一句话说明这个故事就行',
    styleLabel: '文风偏好',
    stylePlaceholder: '例如：克制冷静，少用形容词',
    plannedLabel: '计划章数',
    plannedPlaceholder: '不填则不显示进度',
    plannedRange: '计划章数需在 1–9999 之间',
    statusLabel: '连载状态',
    ongoing: '连载中',
    finished: '已完结',
    remove: '删除作品',
  },

  /** S06 章节 */
  chapters: {
    newChapter: '新建章节',
    reorder: '调整顺序',
    volumeActions: '卷操作',
    volumeMeta: (n: number, chars: string) => `${n} 章 ${chars}`,
    emptyVolume: '这一卷还没有章节',
    createHere: '在这里新建',
    noSummary: '定稿后自动生成摘要',
    conflicts: (n: number) => `${n} 处冲突`,
    organizing: '整理中…',
    emptyTitle: '还没有章节。写下第一章，故事就开始了。',
    newFirst: '新建第一章',
    loadFailed: '章节列表没有加载出来。',
    swipeMore: '更多',
    swipeDelete: '删除',
  },

  /** S06a 章节信息 */
  chapterForm: {
    createTitle: '新建章节',
    editTitle: '章节信息',
    titleLabel: '章节标题',
    titlePlaceholder: '给这一章起个标题',
    titleEmpty: '章节标题不能为空',
    kindLabel: '类型',
    kindMain: (n: number) => `正文（第 ${n} 章）`,
    kindExtra: '番外',
    kindDraft: '草稿',
    kindHelp: {
      main: '正文章节参与连续编号，定稿后自动整理人物与设定变更。',
      extra: '番外不占章节号，不参与定稿和记忆整理。',
      draft: '草稿不占章节号，适合先放片段和备用情节。',
    },
    shiftNote: '之后的正文章节编号会顺延 1',
    volumeLabel: '所属卷',
    pickVolume: '移到哪一卷',
    create: '创建并开始写',
    kindLocked: '已定稿的章节不能直接改为番外或草稿，请先在章节菜单中撤销定稿',
    volumeGone: (name: string) => `所选的卷已被删除，已改为${name}`,
  },

  /** S06b 章节操作 */
  chapterActions: {
    editInfo: '编辑章节信息',
    move: '移到其他卷',
    pickVolume: '移到哪一卷',
    current: '（当前）',
    finalize: '定稿本章',
    unfinalize: '撤销定稿',
    versions: '版本历史',
    export: '导出本章',
    remove: '删除章节',
    removeA11y: '删除章节，移到回收站',
    moved: (name: string) => `已移到「${name}」末尾`,
    unfinalized: '已撤销定稿，本章回到草稿',
    emptyBody: '正文还是空的，写点内容再定稿',
  },

  /** S06c 卷管理 */
  volumes: {
    title: '卷管理',
    meta: (n: number, chars: string, trashed: number) =>
      `${n} 章 · ${chars}${trashed ? ` · 回收站 ${trashed} 章` : ''}`,
    rename: '重命名',
    up: '上移',
    down: '下移',
    remove: '删除',
    add: '＋ 新建卷',
    note: '卷的顺序决定全书正文的编号。只有空卷可以删除，回收站里属于该卷的章节也算在内。',
    nameEmpty: '卷名不能为空，已还原',
    keepOne: '作品至少要保留一卷',
    notEmpty: (m: number) =>
      `请先移走或删除卷内章节${m ? `（包括回收站里的 ${m} 章）` : ''}`,
  },

  /** S06d 调整章节顺序 */
  reorder: {
    title: '调整顺序',
    note: '按住右侧 ≡ 拖动章节，可以拖到其他卷。正文编号会随之变化。',
    volumeCount: (n: number) => `${n} 章`,
    was: (m: number) => `原第 ${m} 章`,
    dropHere: '拖到这里放入本卷',
    handle: '拖动调整顺序',
    moveUp: '上移一位',
    moveDown: '下移一位',
    saved: '已调整顺序',
    changed: '章节已变化，请重新调整',
    discardTitle: '放弃调整的顺序？',
    discardBody: '章节会保持原来的顺序。',
    discard: '放弃',
  },

  /** S07 编辑器 */
  editor: {
    placeholder: '从这里开始写……',
    saved: '已保存',
    saving: '保存中…',
    saveFailed: '保存失败 · 重试',
    more: '更多',
    undo: '撤销',
    redo: '重做',
    describe: '描写助手',
    archive: '档案',
    finalize: '定稿本章',
    finalized: '已定稿',
    emptyFinalize: '正文为空，写点内容再定稿',
    conflictBar: (n: number) => `本章有 ${n} 处设定冲突 ›`,
    longBar: '本章已超过 2 万字。长章节在部分手机上输入会变慢，建议拆成两章。',
    tooLongBar:
      '本章已超过 5 万字。内容照常保存，但输入可能明显变慢，AI 也只能参考其中一部分。建议拆成几章。',
    hardLimit: '单章最多 10 万字，请把后面的内容放到新的一章。',
    selected: (n: string) => `已选 ${n} 字`,
    selectedTooMany: (n: string) =>
      `已选 ${n} 字 · 超过 2000 字，缩小选区后可用 AI`,
    ops: {
      rewrite: '改写',
      expand: '扩写',
      shorten: '缩写',
      polish: '润色',
      detail: '补细节',
      describe: '描写',
    },
    notSavedFor: (op: string) => `正文没有保存成功，暂时不能${op}。`,
    opFinalize: '定稿',
    opAi: '使用 AI',
    opVersions: '查看版本历史',
    opSnapshot: '存为版本',
    opExport: '导出本章',
    loadFailed: '这一章没有加载出来。',
    restored: '已恢复，原内容已存为版本',
    unsavedTitle: '修改还没有保存',
    unsavedBody:
      '最近的修改没有存进手机，离开后会丢失。可以先复制全文，清理空间后再粘贴回来。',
    copyAll: '复制全文',
    copiedAll: '已复制全文',
    discardLeave: '放弃修改并离开',
    stay: '留在本页',
    locateNear: '没有找到原句，可能已经改过了。已定位到原来的位置附近。',
    locateMissing: '没有找到原句，可能已经改过或删除了。',
  },

  /** S07a 编辑器更多菜单 */
  editorMore: {
    header: (heading: string, chars: number, status: string) =>
      `${heading} · ${chars} 字 · ${status}`,
    info: '章节信息',
    versions: '版本历史',
    snapshot: '存为版本',
    export: '导出本章',
    font: '字体与字号',
    snapshotDone: '已存为版本',
    snapshotSame: '内容没有变化，未新建版本',
    snapshotEmpty: '正文为空，没有可保存的版本',
    exportEmpty: '正文为空，没有可导出的内容',
    fontTitle: '字体与字号',
    fontLabel: '正文字体',
    serif: '宋体',
    sans: '黑体',
    sizeLabel: '字号',
    sizes: { 16: '小', 18: '中', 20: '大' } as Record<16 | 18 | 20, string>,
  },

  /** S07b 定稿本章 */
  finalize: {
    first: (heading: string) => `定稿「${heading}」？`,
    again: (heading: string) => `重新定稿「${heading}」？`,
    firstBody:
      '定稿会保存当前版本。之后 AI 会在后台读取本章：生成摘要，列出新出现或变化的人物状态、设定和伏笔，并检查与档案的冲突。',
    firstBold: '这些变化由你逐条审核后才会写入档案。',
    againBody:
      '会用当前内容替换上次的定稿版本（旧定稿版本仍保留在版本历史中）。AI 只读取与上次定稿相比改动过的段落，重新生成摘要并检查冲突。',
    againBold: '新的变化同样需要你审核。',
    noService:
      '当前未连接模型。定稿会照常完成，AI 整理会暂停，连接模型后自动继续。',
    noKey:
      '默认模型服务缺少 API Key。定稿会照常完成，AI 整理会暂停，填写 Key 后自动继续。',
    offline: '当前没有网络。定稿会照常完成，AI 整理会在联网后自动开始。',
    confirmFirst: '定稿本章',
    confirmAgain: '重新定稿',
    done: '已定稿，正在后台整理本章',
    donePaused: '已定稿，AI 整理已暂停',
    failed: '定稿没有成功',
  },

  /** S07d 版本历史 */
  versions: {
    title: '版本历史',
    now: (chars: string) => `现在 ${chars}`,
    current: '当前定稿',
    more: (n: string) => `比现在多 ${n}`,
    less: (n: string) => `比现在少 ${n}`,
    same: '与现在字数相同',
    retention:
      '自动版本每章最多保留 50 个，AI 插入前的版本最多 30 个，超出时删除最旧的；定稿、手动和恢复前的版本永久保留。',
    emptyTitle: '还没有保存过版本。',
    emptyBody: '离开编辑器、定稿本章、插入 AI 文本之前，都会自动存一个版本。',
    saveNow: '把现在的内容存为版本',
    snapshotDone: '已存为版本',
    loadFailed: '版本列表没有加载出来。',
  },

  /** S07e 版本对比与恢复 */
  diff: {
    title: '版本对比',
    expandAll: '全部展开',
    collapseAll: '全部折叠',
    stats: (back: number, gone: number, changed: number) =>
      '与现在相比：' +
      [
        back ? `恢复后会回来 ${back} 段` : '',
        gone ? `会消失 ${gone} 段` : '',
        changed ? `有改动 ${changed} 段` : '',
      ]
        .filter(Boolean)
        .join('、'),
    nowEmpty: '现在的正文是空的',
    legendBack: '恢复后会回来',
    legendGone: '恢复后会消失',
    legendChanged: '有改动',
    folded: (n: number) => `⋯ ${n} 段未变化 · 展开`,
    comparing: '正在对比…',
    identical: '这个版本与现在的内容完全相同。',
    sameAsNow: '这个版本与现在的内容相同',
    restore: '恢复这个版本',
    confirmTitle: '恢复这个版本？',
    confirmBody: (when: string, vChars: number, nowChars: number) =>
      `正文会换成${when}的版本（${vChars} 字）。现在的内容（${nowChars} 字）会先存为"恢复前"版本，可以随时在版本历史里找回。`,
    noteModified: '恢复后本章会变为"有修改未定稿"，需要时请重新定稿。',
    noteFinalized: '恢复后与定稿内容一致，本章回到"已定稿"。',
    noteEmpty: '这个版本没有正文，恢复后本章会变成空白。',
    storageFull: '手机存储空间不足，没有恢复。请清理空间后重试。',
    versionGone: '这个版本已被清理',
    loadFailed: '没有对比出来。',
  },

  /** D02 删除确认 */
  confirmDelete: {
    title: (name: string) => `删除「${name}」？`,
    workUntitled: '删除这部作品？',
    workBody: (n: number) =>
      `作品${
        n > 0 ? `连同 ${n} 个章节、` : '连同'
      }档案和 AI 伙伴对话会移到回收站，30 天内可以恢复。`,
    workButton: '删除作品',
    chapterBody:
      '章节会移到回收站，30 天内可以恢复。已经审核通过、写进档案的设定不受影响。',
    chapterPending: (n: number) =>
      `这一章还有 ${n} 条待审核的记忆变更，会保留在审核列表里。`,
    chapterButton: '删除章节',
    volumeBody: '这一卷没有章节，删除后不能恢复。',
    volumeButton: '删除卷',
  },

  /** D03 先连接模型 */
  connectModel: {
    titleA: '先连接一个模型服务',
    bodyA:
      'AI 伙伴、描写助手和定稿后的整理需要连接模型服务。支持 OpenAI Responses 和 Anthropic Messages 两种协议，填写你自己的地址和 API Key 即可。',
    noteA: '不连接也可以正常写作和整理档案。',
    connect: '连接模型',
    titleB: '需要填写 API Key',
    bodyB: (name: string) => `「${name}」缺少 API Key，填写后才能使用。`,
    fillKey: '填写 Key',
    withoutAi: '不用 AI，继续写',
  },

  /** D04 放弃未保存的修改 */
  unsaved: {
    title: '放弃未保存的修改？',
    body: '现在离开，刚才填写的内容不会保存。',
    discard: '放弃修改',
    keep: '继续编辑',
  },
} as const;

export type Strings = typeof t;

/** S04 / S05 / S05a copy, kept separate while the writing screens are developed. */
export const workCopy = {
  newWork: {
    ...t.newWork,
    premiseLabel: '脑海里的画面或一句话灵感（必填）',
    genreLabel: '题材（可选）',
    titleLabel: '作品名称（可选，可稍后和 AI 一起定）',
  },
  overview: {
    ...t.overview,
    archive: '故事档案速览',
    jobSteps: {
      summarize: '生成章节摘要中…',
      extract_memory: '提取设定变更中…',
      detect_conflicts: '检查设定冲突中…',
    },
    jobsQueued: '等待整理本章',
    newProposals: (n: number) => `新增${n}条待审核记忆`,
    newConflicts: (n: number) => `新增${n}处设定冲突`,
  },
  info: {
    ...t.workInfo,
    styleLabel: '文风偏好（选填）',
    plannedLabel: '计划章数（选填）',
    loadFailed: '作品信息没有加载出来。',
    styleTooLong: '最多 500 字',
  },
  genres: {
    xuanhuan: '玄幻',
    xianxia: '仙侠',
    dushi: '都市',
    kehuan: '科幻',
    xuanyi: '悬疑',
    yanqing: '言情',
    lishi: '历史',
    qihuan: '奇幻',
    other: '其他',
  },
} as const;

/** Supplementary S06 strings; the shared screen vocabulary lives in zh-CN. */
export const chapterText = {
  title: '章节',
  chapterNumber: (n: number) => `第 ${n} 章`,
  titleTooLong: '最多 30 字',
  volumeName: '卷名',
  chapterGone: '这一章已被删除',
  selectVolume: '选择所属卷',
  delete: '删除',
  movedToTrash: '已移到回收站',
  removed: '已删除',
  reorderTitle: '调整章节顺序',
  move: '移动章节',
  rowHint: '点击开始写作，长按打开章节操作',
  rowMenu: (title: string) => `${title}，章节操作`,
  volumeMenu: (title: string) => `${title}，卷管理`,
  moveA11y: (title: string) => `${title}，拖动调整顺序`,
  selectVolumeName: (title: string) => `选择${title}`,
  renamed: '已保存',
} as const;

/** Phase 1 editor additions; common S07 strings live in zh-CN. */
export const editorCopy = {
  body: '章节正文',
  characters: (n: number) => `${n} 字`,
  queued: '已定稿，AI 整理任务已排队',
};

/** S02 / S15 model service and settings copy lives in its own file. */
export { settingsText } from './settings';
