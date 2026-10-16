/**
 * 项目相关类型定义
 */

// 项目状态
export enum ProjectStatus {
  DRAFT = 'draft',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

// 项目
export interface Project {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  coverImage?: string;
  createdAt: string;
  updatedAt: string;
  chapterCount: number;
  wordCount: number;
  status: ProjectStatus;
}

// 创建项目输入
export interface CreateProjectInput {
  name: string;
  description?: string;
  genre?: string;
}

// 更新项目输入
export interface UpdateProjectInput {
  name?: string;
  description?: string;
  genre?: string;
  status?: ProjectStatus;
}
