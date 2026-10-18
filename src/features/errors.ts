/** Error codes from G02 §8. UI maps them to messages per G01 §errors. */
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
  | 'BACKUP_TOO_NEW';

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

export const isAppError = (e: unknown, code?: ErrorCode): e is AppError =>
  e instanceof AppError && (code === undefined || e.code === code);

export function validation(field: string, message: string): AppError {
  return new AppError('VALIDATION', message, field);
}

export function notFound(what: string): AppError {
  return new AppError('NOT_FOUND', `这个${what}已被删除`);
}
