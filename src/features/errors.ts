/** Error codes from G02 §8. UI maps them to messages per G01 §errors. */
import type { AiErrorInfo } from './types';
export type ErrorCode =
  | 'VALIDATION'
  | 'DUPLICATE'
  | 'NOT_FOUND'
  | 'CONFLICT_STATE'
  | 'STORAGE_FULL'
  | 'DB_ERROR'
  | 'KEY_UNAVAILABLE'
  | 'NO_SERVICE'
  | 'BACKUP_INVALID'
  | 'BACKUP_TOO_NEW'
  | AiErrorCode;

export type AiErrorCode =
  | 'AI_NETWORK' | 'AI_TIMEOUT' | 'AI_AUTH' | 'AI_PERMISSION' | 'AI_NOT_FOUND'
  | 'AI_CONTEXT_TOO_LONG' | 'AI_BAD_REQUEST' | 'AI_QUOTA' | 'AI_RATE_LIMIT'
  | 'AI_SERVER' | 'AI_STREAM_INTERRUPTED' | 'AI_TRUNCATED' | 'AI_REFUSAL'
  | 'AI_RESPONSE_TOO_LARGE' | 'AI_CANCELLED' | 'AI_FORMAT' | 'AI_PROTOCOL_MISMATCH';

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Input field the error belongs to (VALIDATION / DUPLICATE). */
  readonly field?: string;

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.field = field;
  }
}

export class AiCallError extends AppError {
  constructor(readonly info: AiErrorInfo) {
    super(info.code as AiErrorCode, info.message);
    this.name = 'AiCallError';
  }
}

export const isAppError = (e: unknown, code?: ErrorCode): e is AppError =>
  e instanceof AppError && (code === undefined || e.code === code);

export function validation(field: string, message: string): AppError {
  return new AppError('VALIDATION', message, field);
}

export function notFound(what: string): AppError {
  return new AppError('NOT_FOUND', `这个${what}已被删除`);
}
