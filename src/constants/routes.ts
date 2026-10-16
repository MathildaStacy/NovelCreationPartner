/**
 * 路由名称常量
 */

export const Routes = {
  // 主导航
  MAIN_TAB: 'MainTab',

  // Tab页面
  HOME: 'Home',
  PROJECTS: 'Projects',
  CREATE: 'Create',
  LIBRARY: 'Library',
  SETTINGS: 'Settings',

  // 项目相关
  PROJECT_DETAIL: 'ProjectDetail',
  CREATE_PROJECT: 'CreateProject',
  EDIT_PROJECT: 'EditProject',

  // 章节相关
  CHAPTER_LIST: 'ChapterList',
  CHAPTER_EDITOR: 'ChapterEditor',
  CREATE_CHAPTER: 'CreateChapter',

  // 人物相关
  CHARACTER_LIST: 'CharacterList',
  CHARACTER_DETAIL: 'CharacterDetail',
  CREATE_CHARACTER: 'CreateCharacter',
  EDIT_CHARACTER: 'EditCharacter',

  // 世界观相关
  WORLDVIEW: 'Worldview',

  // AI辅助
  AI_ASSISTANT: 'AIAssistant',
  IDEA_INCUBATION: 'IdeaIncubation',
  DESCRIPTION_HELPER: 'DescriptionHelper',
} as const;

export type RouteNames = (typeof Routes)[keyof typeof Routes];
