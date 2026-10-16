/**
 * 人物相关类型定义
 */

// 人物角色类型
export enum CharacterRole {
  PROTAGONIST = 'protagonist', // 主角
  MAJOR = 'major', // 主要角色
  SUPPORTING = 'supporting', // 配角
  MINOR = 'minor', // 次要角色
}

// 人物状态
export enum CharacterStatus {
  PROPOSED = 'proposed', // 提议中
  ESTABLISHED = 'established', // 已确定
  RETIRED = 'retired', // 已退场
}

// 外貌描述
export interface Appearance {
  age?: number;
  gender?: string;
  height?: string;
  physique?: string;
  hair?: string;
  eyes?: string;
  features?: string[]; // 特征标签
}

// 性格描述
export interface Personality {
  traits?: string[]; // 性格特点
  strengths?: string[]; // 优点
  weaknesses?: string[]; // 缺点
  habits?: string[]; // 习惯
}

// 人物关系
export interface CharacterRelationship {
  targetCharacterId: string;
  targetCharacterName: string;
  relationshipType: string; // 关系类型：朋友、敌人、恋人等
  description?: string;
}

// 人物
export interface Character {
  id: string;
  projectId: string;
  name: string;
  role: CharacterRole;
  appearance?: Appearance;
  personality?: Personality;
  background?: string;
  goals?: string[];
  abilities?: string[];
  relationships?: CharacterRelationship[];
  status: CharacterStatus;
  createdAt: string;
  updatedAt: string;
}

// 创建人物输入
export interface CreateCharacterInput {
  projectId: string;
  name: string;
  role: CharacterRole;
  appearance?: Appearance;
  personality?: Personality;
  background?: string;
}

// 更新人物输入
export interface UpdateCharacterInput {
  name?: string;
  role?: CharacterRole;
  appearance?: Appearance;
  personality?: Personality;
  background?: string;
  goals?: string[];
  abilities?: string[];
  status?: CharacterStatus;
}
