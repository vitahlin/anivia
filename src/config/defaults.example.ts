/**
 * 配置示例文件
 * 
 * 这个文件展示了如何在代码中直接配置非敏感信息
 * 
 * 使用方法：
 * 1. 复制 defaults.ts 文件
 * 2. 在 DEFAULT_CONFIG 中填入你的实际值
 * 3. 提交到 Git（因为这些都是非敏感信息）
 */

export const DEFAULT_CONFIG = {
  /**
   * Supabase 配置
   */
  supabase: {
    // ✅ 可以直接硬编码（非敏感）
    url: 'https://your-project.supabase.co',
    
    // ✅ 可以直接硬编码（非敏感）
    tableName: 'notion_pages',
  },

  /**
   * Cloudflare R2 配置
   */
  cloudflare: {
    // ✅ 可以直接硬编码（非敏感）
    accountId: 'your-cloudflare-account-id',
    
    // ✅ 可以直接硬编码（非敏感）
    bucketName: 'my-blog-images',
    
    // ✅ 可以直接硬编码（非敏感）
    publicUrl: 'https://images.yourdomain.com',
    
    // ✅ 自动生成，无需修改
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
    // ✅ 可以直接硬编码（非敏感）
    logLevel: 'info',
    
    // ✅ 可以直接硬编码（非敏感）
    exportDir: 'exported-posts',
    
    // ✅ 可以直接硬编码（非敏感）
    port: 3000,
  },

  /**
   * 图片处理配置
   */
  image: {
    // ✅ 可以直接硬编码（非敏感）
    webpQuality: 80,
    
    // ✅ 可以直接硬编码（非敏感）
    maxWidth: 2000,
    
    // ✅ 可以直接硬编码（非敏感）
    maxHeight: 2000,
  },
} as const;

/**
 * ❌ 敏感信息示例（不要在代码中硬编码！）
 * 
 * 这些信息必须通过环境变量或 .env 文件提供：
 * 
 * NOTION_API_KEY=secret_xxx...
 * SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 * CLOUDFLARE_ACCESS_KEY_ID=abc123...
 * CLOUDFLARE_SECRET_ACCESS_KEY=xyz789...
 */

