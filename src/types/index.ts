export interface NotionPageData {
  id: string;
  title: string;
  content: string; // Markdown content
  createdTime: string;
  lastEditedTime: string;
  handler: string; // 处理人
  published: boolean; // 是否发布
  draft: boolean; // 是否是草稿
  archived: boolean; // 是否归档
  categories: string[]; // 分类（多选）
  tags: string[]; // 标签（多选）
  excerpt: string; // 文章摘要
  featuredImg: string; // 配图
  galleryImgs: string[]; // 组图
  properties: Record<string, any>;
  images: AniviaImage[];
}

export type ImageType = 'markdown' | 'featured' | 'gallery';

export type ImageSource = 'notion' | 'local';

export interface AniviaImage {
  url: string;                    // Notion URL 或本地文件路径
  originalUrl: string;            // 原始 URL 或本地文件路径
  filename: string;
  hash: string;                   // For deduplication
  cloudflareUrl?: string;
  type: ImageType;                // 图片类型：markdown 图片或配图
  source: ImageSource;            // 'notion' | 'local'
}

export interface SupabasePageRecord {
  id: number; // Changed from string (UUID) to number (BIGSERIAL)
  notion_page_id: string;
  title: string;
  content: string;
  created_time: string;
  last_edited_time: string;
  handler: string; // 处理人
  published: boolean; // 是否发布
  draft: boolean; // 是否是草稿
  archived: boolean; // 是否归档
  categories: string[]; // 分类（数组）
  tags: string[]; // 标签（数组）
  excerpt: string; // 文章摘要
  featured_img: string; // 配图
  gallery_imgs: string[]; // 组图（数组）
  properties: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface CloudflareConfig {
  accountId: string;
  // R2 API Token 生成的 Access Key ID 和 Secret Access Key
  // 在 Cloudflare Dashboard 创建 R2 API Token 时获得
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
  publicUrl: string;
}

export interface NotionConfig {
  apiKey: string;
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface AppConfig {
  notion: NotionConfig;
  supabase: SupabaseConfig;
  cloudflare: CloudflareConfig;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface SyncResult {
  success: boolean;
  pageId: string;
  message: string;
  imagesProcessed: number;
  errors?: string[];
  skipped?: boolean;
}
