import { t } from './zh-CN';

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
    xuanhuan: '玄幻', xianxia: '仙侠', dushi: '都市', kehuan: '科幻', xuanyi: '悬疑',
    yanqing: '言情', lishi: '历史', qihuan: '奇幻', other: '其他',
  },
} as const;
