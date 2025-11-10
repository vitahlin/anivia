/**
 * Notion API 错误类
 */
export class NotionError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'NotionError';
  }

  /**
   * 从 Notion API 错误创建 NotionError
   */
  static fromNotionApiError(error: any): NotionError {
    const code = error.code;
    const status = error.status;

    // API Key 配置错误
    if (code === 'unauthorized' || status === 401) {
      return new NotionError(
        'Notion API Key 配置错误或无效',
        code,
        status,
        error
      );
    }

    // 页面不存在或无权访问
    if (code === 'object_not_found' || status === 404) {
      return new NotionError(
        '页面不存在或无权访问',
        code,
        status,
        error
      );
    }

    // API 请求频率超限
    if (code === 'rate_limited' || status === 429) {
      return new NotionError(
        'Notion API 请求频率超限',
        code,
        status,
        error
      );
    }

    // 其他错误
    return new NotionError(
      error.message || '获取 Notion 数据失败',
      code,
      status,
      error
    );
  }
}

