/**
 * Mock数据 - 用于开发阶段的模拟数据
 */

import {
  Project,
  ProjectStatus,
  Chapter,
  ChapterStatus,
  Character,
  CharacterRole,
  CharacterStatus,
} from '../types';

// Mock项目数据
export const mockProjects: Project[] = [
  {
    id: '1',
    name: '星辰纪元',
    description: '一个关于星际探索与人类命运的史诗故事',
    genre: '科幻',
    coverImage: undefined,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-10-15T12:30:00Z',
    chapterCount: 12,
    wordCount: 48000,
    status: ProjectStatus.IN_PROGRESS,
  },
  {
    id: '2',
    name: '修仙逆途',
    description: '少年从废材到仙尊的逆袭之路',
    genre: '玄幻',
    coverImage: undefined,
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-10-10T18:00:00Z',
    chapterCount: 25,
    wordCount: 105000,
    status: ProjectStatus.IN_PROGRESS,
  },
  {
    id: '3',
    name: '都市异能者',
    description: '现代都市中觉醒超能力的普通人的故事',
    genre: '都市',
    coverImage: undefined,
    createdAt: '2026-07-20T00:00:00Z',
    updatedAt: '2026-09-30T10:00:00Z',
    chapterCount: 8,
    wordCount: 32000,
    status: ProjectStatus.DRAFT,
  },
  {
    id: '4',
    name: '悬疑笔记',
    description: '解开古宅背后的百年谜团',
    genre: '悬疑',
    coverImage: undefined,
    createdAt: '2026-06-10T00:00:00Z',
    updatedAt: '2026-08-20T14:00:00Z',
    chapterCount: 30,
    wordCount: 120000,
    status: ProjectStatus.COMPLETED,
  },
];

// Mock章节数据
export const mockChapters: Record<string, Chapter[]> = {
  '1': [
    {
      id: 'c1-1',
      projectId: '1',
      title: '第一章 启程',
      content:
        '2156年，地球联邦宇航局...\n\n（这里是章节内容，包含数千字的正文）',
      orderIndex: 1,
      wordCount: 4000,
      status: ChapterStatus.COMPLETED,
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-02T14:00:00Z',
      summary: '主角林浩接到前往半人马座阿尔法星的任务',
    },
    {
      id: 'c1-2',
      projectId: '1',
      title: '第二章 未知信号',
      content: '飞船穿越星际空间的第三个月...',
      orderIndex: 2,
      wordCount: 3800,
      status: ChapterStatus.COMPLETED,
      createdAt: '2026-09-03T10:00:00Z',
      updatedAt: '2026-09-05T16:00:00Z',
      summary: '探测到神秘信号，决定前往调查',
    },
    {
      id: 'c1-3',
      projectId: '1',
      title: '第三章 初遇',
      content: '当飞船降落在那颗蓝色星球上...',
      orderIndex: 3,
      wordCount: 4200,
      status: ChapterStatus.WRITING,
      createdAt: '2026-09-06T10:00:00Z',
      updatedAt: '2026-10-15T12:30:00Z',
    },
  ],
  '2': [
    {
      id: 'c2-1',
      projectId: '2',
      title: '第一章 废材少年',
      content: '青云宗外门，李凡再次被人嘲笑...',
      orderIndex: 1,
      wordCount: 4500,
      status: ChapterStatus.COMPLETED,
      createdAt: '2026-08-15T10:00:00Z',
      updatedAt: '2026-08-16T14:00:00Z',
      summary: '介绍主角的废材背景和遭遇',
    },
    {
      id: 'c2-2',
      projectId: '2',
      title: '第二章 神秘戒指',
      content: '一枚古戒指改变了李凡的命运...',
      orderIndex: 2,
      wordCount: 4000,
      status: ChapterStatus.COMPLETED,
      createdAt: '2026-08-17T10:00:00Z',
      updatedAt: '2026-08-18T16:00:00Z',
      summary: '获得金手指',
    },
  ],
};

// Mock人物数据
export const mockCharacters: Record<string, Character[]> = {
  '1': [
    {
      id: 'char1-1',
      projectId: '1',
      name: '林浩',
      role: CharacterRole.PROTAGONIST,
      appearance: {
        age: 28,
        gender: 'male',
        height: '180cm',
        physique: '匀称健壮',
        hair: '黑色短发',
        eyes: '深邃的黑眸',
        features: ['英俊', '冷静的气质'],
      },
      personality: {
        traits: ['沉着冷静', '责任心强', '善于分析'],
        strengths: ['决策果断', '适应力强'],
        weaknesses: ['过于理性', '不善表达情感'],
        habits: ['每天晨跑', '睡前阅读'],
      },
      background: '地球联邦精英宇航员，曾执行过5次深空任务',
      goals: ['探索未知星系', '寻找外星文明'],
      abilities: ['飞船驾驶', '应急处理', '基础格斗'],
      relationships: [],
      status: CharacterStatus.ESTABLISHED,
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-02T14:00:00Z',
    },
    {
      id: 'char1-2',
      projectId: '1',
      name: '艾莉娅',
      role: CharacterRole.MAJOR,
      appearance: {
        age: 25,
        gender: 'female',
        height: '168cm',
        physique: '纤细',
        hair: '金色长发',
        eyes: '碧蓝色',
        features: ['美丽', '睿智'],
      },
      personality: {
        traits: ['聪明', '好奇心重', '乐观'],
        strengths: ['科研能力强', '善于沟通'],
        weaknesses: ['有时过于理想化'],
      },
      background: '生物学家，专门研究外星生命形式',
      goals: ['发现新的生命形式'],
      abilities: ['生物学研究', '外语能力'],
      relationships: [
        {
          targetCharacterId: 'char1-1',
          targetCharacterName: '林浩',
          relationshipType: '队友',
          description: '彼此信任的探险伙伴',
        },
      ],
      status: CharacterStatus.ESTABLISHED,
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-02T14:00:00Z',
    },
  ],
  '2': [
    {
      id: 'char2-1',
      projectId: '2',
      name: '李凡',
      role: CharacterRole.PROTAGONIST,
      appearance: {
        age: 16,
        gender: 'male',
        height: '175cm',
        physique: '清瘦',
        hair: '黑色',
        eyes: '黑色',
      },
      personality: {
        traits: ['坚韧不拔', '心思缜密'],
        strengths: ['意志坚定', '善于隐藏'],
        weaknesses: ['初期实力弱'],
      },
      background: '青云宗外门弟子，曾是天才后因意外成为废材',
      goals: ['重回巅峰', '查明当年真相', '复仇'],
      abilities: ['基础剑术', '戒指空间'],
      relationships: [],
      status: CharacterStatus.ESTABLISHED,
      createdAt: '2026-08-15T10:00:00Z',
      updatedAt: '2026-08-16T14:00:00Z',
    },
  ],
};

// 通用的获取函数
export const getMockProjects = (): Promise<Project[]> => {
  return new Promise(resolve => {
    setTimeout(() => resolve(mockProjects), 500);
  });
};

export const getMockProjectById = (id: string): Promise<Project | null> => {
  return new Promise(resolve => {
    setTimeout(() => {
      const project = mockProjects.find(p => p.id === id);
      resolve(project || null);
    }, 300);
  });
};

export const getMockChaptersByProjectId = (
  projectId: string,
): Promise<Chapter[]> => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(mockChapters[projectId] || []);
    }, 400);
  });
};

export const getMockCharactersByProjectId = (
  projectId: string,
): Promise<Character[]> => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(mockCharacters[projectId] || []);
    }, 400);
  });
};
