/**
 * Cloudflare R2 错误类
 */
export class CloudflareError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number,
    public readonly originalError?: any
  ) {
    super(message);
    this.name = 'CloudflareError';
  }

  /**
   * 从 AWS SDK 错误创建 CloudflareError
   */
  static fromAwsError(error: any): CloudflareError {
    const code = error.name || error.code;
    const statusCode = error.$metadata?.httpStatusCode || error.statusCode;

    // 认证错误
    if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || statusCode === 403) {
      return new CloudflareError(
        'Cloudflare R2 认证失败，请检查 Access Key 和 Secret Key',
        code,
        statusCode,
        error
      );
    }

    // 存储桶不存在
    if (code === 'NoSuchBucket' || statusCode === 404) {
      return new CloudflareError(
        'Cloudflare R2 存储桶不存在',
        code,
        statusCode,
        error
      );
    }

    // 网络错误
    if (code === 'NetworkingError' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
      return new CloudflareError(
        'Cloudflare R2 网络连接失败',
        code,
        statusCode,
        error
      );
    }

    // 其他错误
    return new CloudflareError(
      error.message || 'Cloudflare R2 操作失败',
      code,
      statusCode,
      error
    );
  }

  /**
   * 从图片下载错误创建 CloudflareError
   */
  static fromDownloadError(url: string, error: any): CloudflareError {
    return new CloudflareError(
      `图片下载失败: ${url}`,
      'IMAGE_DOWNLOAD_FAILED',
      error.statusCode,
      error
    );
  }

  /**
   * 从图片处理错误创建 CloudflareError
   */
  static fromProcessingError(filename: string, error: any): CloudflareError {
    return new CloudflareError(
      `图片处理失败: ${filename}`,
      'IMAGE_PROCESSING_FAILED',
      undefined,
      error
    );
  }
}

