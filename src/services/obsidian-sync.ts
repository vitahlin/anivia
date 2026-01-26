import { ObsidianService } from './obsidian';
import { CloudflareService } from './cloudflare';
import { SupabaseService } from './supabase';
import { ImageProcessor } from './image-processor';
import { AppConfig, SyncResult, NotionPageData, AniviaImage } from '../types';
import { Logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';

export class ObsidianSyncService {
  private obsidianService: ObsidianService;
  private cloudflareService: CloudflareService;
  private supabaseService: SupabaseService;
  private imageProcessor: ImageProcessor;
  private logger: Logger;

  constructor(config: AppConfig, logger: Logger) {
    this.logger = logger;
    this.obsidianService = new ObsidianService(logger);
    this.cloudflareService = new CloudflareService(config.cloudflare, logger);
    this.supabaseService = new SupabaseService(config.supabase, logger);
    this.imageProcessor = new ImageProcessor(logger);
  }

  async syncObsidianFile(filePath: string): Promise<SyncResult> {
    this.logger.info(`开始同步 Obsidian 文件: ${filePath}`);
    let imagesProcessed = 0;

    // 验证文件存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    // Step 1: 解析 Markdown 文件和 Front Matter
    this.logger.info('Step 1: 解析 Markdown 文件...');
    const { frontMatter, content, rawContent } = this.obsidianService.parseMarkdownFile(filePath);

    // 验证必需字段
    if (!frontMatter.title) {
      throw new Error('Front Matter 缺少必需字段: title');
    }

    // Step 2: 提取本地图片
    this.logger.info('Step 2: 提取本地图片...');
    const allImages: AniviaImage[] = [];

    // 2.1 提取 featured_img
    const featuredImgPath = this.obsidianService.extractFeaturedImage(frontMatter, filePath);
    if (featuredImgPath) {
      const featuredImage: AniviaImage = {
        url: featuredImgPath,
        originalUrl: featuredImgPath,
        filename: this.generateFeaturedImageFilename(featuredImgPath, frontMatter.notion_page_id || ''),
        hash: '',
        type: 'featured',
        source: 'local'
      };
      allImages.push(featuredImage);
      this.logger.info(`提取到配图: ${path.basename(featuredImgPath)}`);
    } else {
      this.logger.info('页面没有配图');
    }

    // 2.2 提取 Markdown 中的图片
    const markdownImagePaths = this.imageProcessor.extractObsidianImagesFromMarkdown(content, filePath);
    const markdownImages = this.imageProcessor.convertLocalPathsToAniviaImages(markdownImagePaths, 'markdown');
    allImages.push(...markdownImages);
    this.logger.debug(`📸 从 Markdown 中提取到 ${markdownImages.length} 张图片`);

    // Step 3: 上传图片到 Cloudflare
    this.logger.info('☁️ Step 3: 上传图片到 Cloudflare...');
    const processedImages = await this.uploadImagesToCloudflare(allImages);
    imagesProcessed = processedImages.filter(img => img.cloudflareUrl).length;

    // 分离处理后的图片
    const processedMarkdownImages = processedImages.filter(img => img.type === 'markdown');
    const processedFeaturedImage = processedImages.find(img => img.type === 'featured');

    // Step 4: 替换图片路径
    this.logger.info('🔄 Step 4: 替换 Markdown 中的图片路径...');
    const imageMap = new Map<string, string>();
    processedMarkdownImages.forEach(img => {
      if (img.cloudflareUrl) {
        imageMap.set(img.originalUrl, img.cloudflareUrl);
      }
    });
    const finalMarkdown = this.imageProcessor.replaceObsidianImageSyntax(content, imageMap);

    // Step 5: 保存到 Supabase
    this.logger.info('💾 Step 5: 保存到 Supabase...');
    const pageData = this.convertToNotionPageData(frontMatter, finalMarkdown, processedFeaturedImage, processedMarkdownImages);
    await this.supabaseService.syncPageData(pageData);
    this.logger.debug('✅ 成功保存到 Supabase');

    const result: SyncResult = {
      success: true,
      pageId: pageData.id,
      message: `🎉 Obsidian 文件同步成功: ${path.basename(filePath)}`,
      imagesProcessed
    };

    return result;
  }

  /**
   * 上传图片到 Cloudflare
   */
  private async uploadImagesToCloudflare(images: AniviaImage[]): Promise<AniviaImage[]> {
    if (images.length === 0) {
      this.logger.info('📭 没有图片需要上传');
      return [];
    }

    const markdownCount = images.filter(img => img.type === 'markdown').length;
    const featuredCount = images.filter(img => img.type === 'featured').length;

    this.logger.debug(`准备上传 ${images.length} 张图片 (Markdown: ${markdownCount}, 配图: ${featuredCount})`);

    // 上传所有图片
    const processedImages = await this.cloudflareService.processImages(images);

    // 统计上传结果
    const markdownSuccess = processedImages.filter(img => img.type === 'markdown' && img.cloudflareUrl).length;
    const featuredSuccess = processedImages.filter(img => img.type === 'featured' && img.cloudflareUrl).length;

    this.logger.info(`✅ 图片上传完成: Markdown ${markdownSuccess}/${markdownCount}, 配图 ${featuredSuccess}/${featuredCount}`);

    return processedImages;
  }

  /**
   * 生成配图文件名
   */
  private generateFeaturedImageFilename(filePath: string, pageId: string): string {
    const ext = path.extname(filePath).slice(1) || 'jpg';
    const timestamp = Date.now();
    return `featured_${pageId || 'obsidian'}_${timestamp}.${ext}`;
  }



  /**
   * 将 Front Matter 转换为 NotionPageData 格式
   */
  private convertToNotionPageData(
    frontMatter: any,
    markdown: string,
    featuredImage: AniviaImage | undefined,
    markdownImages: AniviaImage[]
  ): NotionPageData {
    // 生成或使用现有的 notion_page_id
    const notionPageId = frontMatter.notion_page_id || this.generatePageId();

    // 时间格式转换：yyyy-MM-dd HH:mm:ss → ISO 8601 with timezone
    const createdTime = this.convertToISO8601(frontMatter.created_time);
    const lastEditedTime = this.convertToISO8601(frontMatter.last_edited_time);

    // 处理 category 字段：支持单个字符串或数组
    let categories: string[] = [];
    if (Array.isArray(frontMatter.category)) {
      categories = frontMatter.category;
    } else if (frontMatter.category) {
      categories = [frontMatter.category];
    }

    return {
      id: notionPageId,
      title: frontMatter.title,
      content: markdown,
      createdTime,
      lastEditedTime,
      handler: frontMatter.handler || '',
      published: frontMatter.published !== false, // 默认为 true
      draft: frontMatter.draft === true, // 默认为 false
      archived: frontMatter.archived === true, // 默认为 false
      categories: categories,
      tags: Array.isArray(frontMatter.tags) ? frontMatter.tags : [],
      excerpt: frontMatter.excerpt || '',
      featuredImg: featuredImage?.cloudflareUrl || '',
      galleryImgs: [], // Obsidian 不支持组图
      properties: {},
      images: markdownImages
    };
  }

  /**
   * 将时间字符串转换为 ISO 8601 格式（北京时间 + 时区）
   * 输入格式：yyyy-MM-dd HH:mm:ss
   * 输出格式：yyyy-MM-ddTHH:mm:ss+08:00
   */
  private convertToISO8601(timeStr: string | undefined): string {
    if (!timeStr) {
      // 如果没有提供时间，使用当前北京时间
      const now = new Date();
      const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const year = beijingTime.getUTCFullYear();
      const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(beijingTime.getUTCDate()).padStart(2, '0');
      const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
      const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
      const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`;
    }

    // 解析输入时间字符串：yyyy-MM-dd HH:mm:ss
    const match = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
      this.logger.warn(`⚠️  时间格式不正确: ${timeStr}，使用当前时间`);
      return this.convertToISO8601(undefined);
    }

    const [, year, month, day, hours, minutes, seconds] = match;
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`;
  }

  /**
   * 生成新的页面 ID（32位十六进制字符串，类似 Notion ID）
   */
  private generatePageId(): string {
    const chars = '0123456789abcdef';
    let id = '';
    for (let i = 0; i < 32; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }
}
