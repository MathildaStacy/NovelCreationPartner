/**
 * 项目状态管理
 */

import {create} from 'zustand';
import {
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectStatus,
} from '../types';
import {getMockProjects, getMockProjectById} from '../mock/data';

interface ProjectState {
  // 状态
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;
  error: string | null;

  // 操作
  fetchProjects: () => Promise<void>;
  fetchProjectById: (id: string) => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  updateProject: (id: string, input: UpdateProjectInput) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
  clearError: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  // 初始状态
  projects: [],
  currentProject: null,
  isLoading: false,
  error: null,

  // 获取所有项目
  fetchProjects: async () => {
    set({isLoading: true, error: null});
    try {
      const projects = await getMockProjects();
      set({projects, isLoading: false});
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '获取项目列表失败',
        isLoading: false,
      });
    }
  },

  // 获取单个项目
  fetchProjectById: async (id: string) => {
    set({isLoading: true, error: null});
    try {
      const project = await getMockProjectById(id);
      set({currentProject: project, isLoading: false});
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '获取项目详情失败',
        isLoading: false,
      });
    }
  },

  // 创建项目
  createProject: async (input: CreateProjectInput) => {
    set({isLoading: true, error: null});
    try {
      // Mock创建
      const newProject: Project = {
        id: Date.now().toString(),
        name: input.name,
        description: input.description,
        genre: input.genre,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        chapterCount: 0,
        wordCount: 0,
        status: ProjectStatus.DRAFT,
      };

      const {projects} = get();
      set({
        projects: [newProject, ...projects],
        isLoading: false,
      });

      return newProject;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '创建项目失败',
        isLoading: false,
      });
      throw error;
    }
  },

  // 更新项目
  updateProject: async (id: string, input: UpdateProjectInput) => {
    set({isLoading: true, error: null});
    try {
      // Mock更新
      const {projects} = get();
      const updatedProjects = projects.map(p =>
        p.id === id
          ? {
              ...p,
              ...input,
              updatedAt: new Date().toISOString(),
            }
          : p,
      );

      set({projects: updatedProjects, isLoading: false});
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '更新项目失败',
        isLoading: false,
      });
    }
  },

  // 删除项目
  deleteProject: async (id: string) => {
    set({isLoading: true, error: null});
    try {
      const {projects} = get();
      const updatedProjects = projects.filter(p => p.id !== id);
      set({projects: updatedProjects, isLoading: false});
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '删除项目失败',
        isLoading: false,
      });
    }
  },

  // 设置当前项目
  setCurrentProject: (project: Project | null) => {
    set({currentProject: project});
  },

  // 清除错误
  clearError: () => {
    set({error: null});
  },
}));
