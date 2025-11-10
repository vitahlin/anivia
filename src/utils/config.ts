import dotenv from 'dotenv';
import { AppConfig } from '../types';
import { getFullConfig } from '../config/defaults';

// Load environment variables from .env file if it exists, otherwise use system env vars
dotenv.config();

/**
 * 获取应用配置
 *
 * 配置优先级：
 * 1. 环境变量（最高优先级）
 * 2. .env 文件
 * 3. src/config/defaults.ts 中的默认值（最低优先级）
 *
 * 敏感信息（API 密钥等）必须通过环境变量或 .env 文件提供
 * 非敏感信息可以在 src/config/defaults.ts 中硬编码
 */
export function getConfig(): AppConfig {
  const config = getFullConfig();

  return {
    notion: {
      apiKey: config.notion.apiKey
    },
    supabase: {
      url: config.supabase.url,
      anonKey: config.supabase.anonKey
    },
    cloudflare: {
      accountId: config.cloudflare.accountId,
      accessKeyId: config.cloudflare.accessKeyId,
      secretAccessKey: config.cloudflare.secretAccessKey,
      bucketName: config.cloudflare.bucketName,
      endpoint: config.cloudflare.endpoint,
      publicUrl: config.cloudflare.publicUrl
    },
    logLevel: config.app.logLevel as any
  };
}

// 导出配置打印函数
export { printConfig } from '../config/defaults';
