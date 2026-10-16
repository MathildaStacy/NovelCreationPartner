/**
 * API相关类型定义
 */

// 通用API响应
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  message?: string;
}

// API错误
export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

// 分页参数
export interface PaginationParams {
  page: number;
  pageSize: number;
}

// 分页响应
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// 列表查询参数
export interface ListQueryParams extends Partial<PaginationParams> {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filter?: Record<string, any>;
}
