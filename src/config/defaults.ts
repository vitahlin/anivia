/**
 * 默认配置文件
 *
 * 此文件包含非敏感的默认配置值，可以安全地提交到 Git 仓库
 * 敏感信息（API 密钥等）仍然需要通过环境变量提供
 */

// 确保环境变量已加载
import dotenv from 'dotenv';
dotenv.config();

/**
 * 非敏感的默认配置
 * 这些值可以在环境变量中覆盖
 */
export const DEFAULT_CONFIG = {
  /**
   * Supabase 配置
   */
  supabase: {
    // Supabase 项目 URL（非敏感，可以公开）
    // 示例: 'https://your-project.supabase.co'
    url: process.env.SUPABASE_URL || '',
    
    // Supabase 表名（非敏感）
    tableName: process.env.SUPABASE_TABLE_NAME || 'notion_pages',
  },

  /**
   * Cloudflare R2 配置
   */
  cloudflare: {
    // Cloudflare 账户 ID（非敏感，可以公开）
    // 示例: 'abc123def456...'
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    
    // R2 Bucket 名称（非敏感）
    // 示例: 'my-blog-images'
    bucketName: process.env.CLOUDFLARE_BUCKET_NAME || 'sonder',
    
    // R2 公开访问 URL（非敏感）
    publicUrl: process.env.CLOUDFLARE_PUBLIC_URL || 'https://sonder.vitah.me',
    
    // R2 Endpoint（根据账户 ID 自动生成）
    get endpoint(): string {
      if (this.accountId) {
        return `https://${this.accountId}.r2.cloudflarestorage.com`;
      }
      return process.env.CLOUDFLARE_R2_ENDPOINT || '';
    },
  },

  /**
   * 应用配置
   */
  app: {
    // 日志级别（非敏感）
    logLevel: process.env.LOG_LEVEL || 'info',

    // 导出目录（非敏感）
    exportDir: process.env.EXPORT_DIR || 'anivia_export',

    // 服务器端口（非敏感）
    port: parseInt(process.env.PORT || '3000', 10),
  },

  /**
   * 图片处理配置
   */
  image: {
    // WebP 质量（0-100）
    webpQuality: parseInt(process.env.WEBP_QUALITY || '80', 10),
    
    // 最大图片宽度（像素）
    maxWidth: parseInt(process.env.MAX_IMAGE_WIDTH || '2000', 10),
    
    // 最大图片高度（像素）
    maxHeight: parseInt(process.env.MAX_IMAGE_HEIGHT || '2000', 10),
  },
} as const;

/**
 * 获取完整的配置（包括敏感信息）
 * 敏感信息必须通过环境变量提供
 *
 * @param options.skipNotionValidation - 跳过 Notion API Key 验证（用于 export 命令）
 * @param options.skipCloudflareValidation - 跳过 Cloudflare 验证（用于 export 命令）
 */
export function getFullConfig(options?: {
  skipNotionValidation?: boolean;
  skipCloudflareValidation?: boolean;
}) {
  const skipNotion = options?.skipNotionValidation || false;
  const skipCloudflare = options?.skipCloudflareValidation || false;

  // 验证必需的敏感环境变量
  const requiredSecrets: string[] = [];

  if (!skipNotion) {
    requiredSecrets.push('NOTION_API_KEY');
  }

  // Supabase 总是需要的
  requiredSecrets.push('SUPABASE_ANON_KEY');

  if (!skipCloudflare) {
    // 检查 R2 API Token 生成的 Access Key
    const hasAccessKey = !!(process.env.ZILEAN_CLOUDFLARE_R2_ACCESS_KEY && process.env.ZILEAN_CLOUDFLARE_R2_SECRET_KEY);

    if (!hasAccessKey) {
      throw new Error(
        'Missing Cloudflare R2 credentials. Please provide:\n' +
        '  - ZILEAN_CLOUDFLARE_R2_ACCESS_KEY (Access Key ID from R2 API Token)\n' +
        '  - ZILEAN_CLOUDFLARE_R2_SECRET_KEY (Secret Access Key from R2 API Token)\n\n' +
        'To create R2 API Token:\n' +
        '  1. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens\n' +
        '  2. Create API Token → Select permissions (Object Read & Write)\n' +
        '  3. Copy the Access Key ID and Secret Access Key\n' +
        '  4. Set them as ZILEAN_CLOUDFLARE_R2_ACCESS_KEY and ZILEAN_CLOUDFLARE_R2_SECRET_KEY'
      );
    }
  }

  const missingSecrets = requiredSecrets.filter(
    (varName) => !process.env[varName]
  );

  if (missingSecrets.length > 0) {
    throw new Error(
      `Missing required secret environment variables: ${missingSecrets.join(', ')}\n` +
      'These must be set in environment variables or .env file (not committed to Git)'
    );
  }

  // 验证必需的非敏感环境变量（如果没有默认值）
  const requiredNonSecrets = [];

  if (!DEFAULT_CONFIG.supabase.url) {
    requiredNonSecrets.push('SUPABASE_URL');
  }

  if (!skipCloudflare) {
    if (!DEFAULT_CONFIG.cloudflare.accountId) {
      requiredNonSecrets.push('CLOUDFLARE_ACCOUNT_ID');
    }
    if (!DEFAULT_CONFIG.cloudflare.bucketName) {
      requiredNonSecrets.push('CLOUDFLARE_BUCKET_NAME');
    }
    if (!DEFAULT_CONFIG.cloudflare.publicUrl) {
      requiredNonSecrets.push('CLOUDFLARE_PUBLIC_URL');
    }
  }

  if (requiredNonSecrets.length > 0) {
    throw new Error(
      `Missing required configuration: ${requiredNonSecrets.join(', ')}\n` +
      'These can be set in environment variables or hardcoded in src/config/defaults.ts'
    );
  }

  return {
    notion: {
      apiKey: process.env.NOTION_API_KEY || '',
    },
    supabase: {
      url: DEFAULT_CONFIG.supabase.url,
      anonKey: process.env.SUPABASE_ANON_KEY!,
      tableName: DEFAULT_CONFIG.supabase.tableName,
    },
    cloudflare: {
      accountId: DEFAULT_CONFIG.cloudflare.accountId,
      accessKeyId: process.env.ZILEAN_CLOUDFLARE_R2_ACCESS_KEY!,
      secretAccessKey: process.env.ZILEAN_CLOUDFLARE_R2_SECRET_KEY!,
      bucketName: DEFAULT_CONFIG.cloudflare.bucketName,
      endpoint: DEFAULT_CONFIG.cloudflare.endpoint,
      publicUrl: DEFAULT_CONFIG.cloudflare.publicUrl,
    },
    app: {
      logLevel: DEFAULT_CONFIG.app.logLevel,
      exportDir: DEFAULT_CONFIG.app.exportDir,
      port: DEFAULT_CONFIG.app.port,
    },
    image: {
      webpQuality: DEFAULT_CONFIG.image.webpQuality,
      maxWidth: DEFAULT_CONFIG.image.maxWidth,
      maxHeight: DEFAULT_CONFIG.image.maxHeight,
    },
  };
}

/**
 * 打印当前配置（隐藏敏感信息）
 */
export function printConfig() {
  const config = getFullConfig();
  
  console.log('📋 Current Configuration:');
  console.log('');
  console.log('Notion:');
  console.log(`  API Key: ${maskSecret(config.notion.apiKey)}`);
  console.log('');
  console.log('Supabase:');
  console.log(`  URL: ${config.supabase.url}`);
  console.log(`  Anon Key: ${maskSecret(config.supabase.anonKey)}`);
  console.log(`  Table Name: ${config.supabase.tableName}`);
  console.log('');
  console.log('Cloudflare R2:');
  console.log(`  Account ID: ${config.cloudflare.accountId}`);
  console.log(`  Access Key ID: ${maskSecret(config.cloudflare.accessKeyId)}`);
  console.log(`  Secret Access Key: ${maskSecret(config.cloudflare.secretAccessKey)}`);
  console.log(`  Bucket Name: ${config.cloudflare.bucketName}`);
  console.log(`  Endpoint: ${config.cloudflare.endpoint}`);
  console.log(`  Public URL: ${config.cloudflare.publicUrl}`);
  console.log('');
  console.log('Application:');
  console.log(`  Log Level: ${config.app.logLevel}`);
  console.log(`  Export Dir: ${config.app.exportDir}`);
  console.log(`  Port: ${config.app.port}`);
  console.log('');
  console.log('Image Processing:');
  console.log(`  WebP Quality: ${config.image.webpQuality}`);
  console.log(`  Max Width: ${config.image.maxWidth}px`);
  console.log(`  Max Height: ${config.image.maxHeight}px`);
  console.log('');
}

/**
 * 隐藏敏感信息（只显示前后几个字符）
 */
function maskSecret(secret: string): string {
  if (!secret || secret.length < 10) {
    return '***';
  }
  return `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`;
}

