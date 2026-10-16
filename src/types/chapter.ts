/**
 * 章节相关类型定义
 */

// 章节状态
export enum ChapterStatus {
  DRAFT = 'draft',
  WRITING = 'writing',
  COMPLETED = 'completed',
}

// 章节
export interface Chapter {
  id: string;
  projectId: string;
  title: string;
  content: string;
  orderIndex: number;
  wordCount: number;
  status: ChapterStatus;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  tags?: string[];
}

// 创建章节输入
export interface CreateChapterInput {
  projectId: string;
  title: string;
  content?: string;
  orderIndex?: number;
}

// 更新章节输入
export interface UpdateChapterInput {
  title?: string;
  content?: string;
  status?: ChapterStatus;
  summary?: string;
  tags?: string[];
}
