export class NotionSyncError extends Error {
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = 'NotionSyncError';
    this.code = code;
    this.details = details;
  }
}

export class NotionApiError extends NotionSyncError {
  constructor(message: string, details?: any) {
    super(message, 'NOTION_API_ERROR', details);
    this.name = 'NotionApiError';
  }
}

export class CloudflareError extends NotionSyncError {
  constructor(message: string, details?: any) {
    super(message, 'CLOUDFLARE_ERROR', details);
    this.name = 'CloudflareError';
  }
}

export class SupabaseError extends NotionSyncError {
  constructor(message: string, details?: any) {
    super(message, 'SUPABASE_ERROR', details);
    this.name = 'SupabaseError';
  }
}

export class ConfigurationError extends NotionSyncError {
  constructor(message: string, details?: any) {
    super(message, 'CONFIGURATION_ERROR', details);
    this.name = 'ConfigurationError';
  }
}

export class ValidationError extends NotionSyncError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export function isRetryableError(error: any): boolean {
  // Network errors that might be temporary
  if (error.code === 'ECONNRESET' || 
      error.code === 'ENOTFOUND' || 
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNREFUSED') {
    return true;
  }

  // HTTP status codes that might be retryable
  if (error.status || error.statusCode) {
    const status = error.status || error.statusCode;
    return status === 429 || // Rate limit
           status === 502 || // Bad Gateway
           status === 503 || // Service Unavailable
           status === 504;   // Gateway Timeout
  }

  // Notion API specific errors
  if (error.code === 'rate_limited') {
    return true;
  }

  return false;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error;
      }

      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export function sanitizeError(error: any): any {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error as any).details && { details: (error as any).details }
    };
  }

  if (typeof error === 'object' && error !== null) {
    // Remove sensitive information
    const sanitized = { ...error };
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.key;
    delete sanitized.secret;
    return sanitized;
  }

  return error;
}
