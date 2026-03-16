import { ObsidianService } from './obsidian';
import { CloudflareService } from './cloudflare';
import { SupabaseService } from './supabase';
import { ImageProcessor } from './image-processor';
import { AppConfig, SyncResult, NotionPageData, AniviaImage } from '../types';
import { Logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

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
    let imagesProcessed = 0;

    // 验证文件存在
    if (!fs.existsSync(filePath)) {
      console.error(`❌ 文件不存在: ${filePath}`);
      process.exit(1);
    }

    // Step 1: 解析 Markdown 文件和 Front Matter
    const { frontMatter, content, rawContent } = this.obsidianService.parseMarkdownFile(filePath);

    // 验证 slug 字段（Obsidian 文章的唯一标识）
    // 如果不存在 slug，则跳过该文件
    if (!frontMatter.slug) {
      return {
        success: true,
        pageId: '',
        message: `跳过文件（缺少 slug 字段）`,
        imagesProcessed: 0,
        skipped: true
      };
    }

    // 检查是否需要更新（通过比较 last_edited_time）
    const existingPage = await this.supabaseService.getPageByOrigin('obsidian', frontMatter.slug);

    if (existingPage) {
      // 从 Obsidian 属性中获取更新时间，如果没有则使用当前时间
      const obsidianUpdatedTime = this.getObsidianUpdatedTime(frontMatter, filePath);
      const obsidianLastModified = new Date(obsidianUpdatedTime);
      const supabaseLastEdited = new Date(existingPage.last_edited_time);

      // 如果 Supabase 最后编辑时间 >= Obsidian 更新时间，则跳过同步
      if (supabaseLastEdited.getTime() >= obsidianLastModified.getTime()) {
        return {
          success: true,
          pageId: existingPage.notion_page_id || '',
          message: `文件未更新，跳过同步 (Obsidian: ${obsidianUpdatedTime}, Supabase: ${existingPage.last_edited_time})`,
          imagesProcessed: 0,
          skipped: true
        };
      }

      this.logger.info(`🔄 文件已更新，继续同步 (Obsidian: ${obsidianUpdatedTime}, Supabase: ${existingPage.last_edited_time})`);
    } else {
      this.logger.info(`🆕 新文件，继续同步`);
    }

    // Step 2: 提取本地图片
    const allImages: AniviaImage[] = [];

    // 2.1 提取 featured_img（只处理本地图片）
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
    }

    // 2.2 提取 Markdown 中的图片
    const markdownImagePaths = this.imageProcessor.extractObsidianImagesFromMarkdown(content, filePath);
    const markdownImages = this.imageProcessor.convertLocalPathsToAniviaImages(markdownImagePaths, 'markdown');
    allImages.push(...markdownImages);
    this.logger.debug(`📸 从 Markdown 中提取到 ${markdownImages.length} 张图片`);

    // Step 3: 上传图片到 Cloudflare
    const processedImages = await this.uploadImagesToCloudflare(allImages);
    imagesProcessed = processedImages.filter(img => img.cloudflareUrl).length;

    // 分离处理后的图片
    const processedMarkdownImages = processedImages.filter(img => img.type === 'markdown');
    const processedFeaturedImage = processedImages.find(img => img.type === 'featured');

    // Step 4: 替换图片路径
    const imageMap = new Map<string, string>();
    processedMarkdownImages.forEach(img => {
      if (img.cloudflareUrl) {
        imageMap.set(img.originalUrl, img.cloudflareUrl);
      }
    });
    const finalMarkdown = this.imageProcessor.replaceObsidianImageSyntax(content, imageMap);

    // Step 5: 保存到 Supabase
    const pageData = this.convertToNotionPageData(frontMatter, finalMarkdown, processedFeaturedImage, processedMarkdownImages, filePath);
    await this.supabaseService.syncPageData(pageData);

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
   * 从 Obsidian 属性中获取创建时间
   * 优先使用 frontMatter 中的 created/created_time 字段，如果没有则使用当前时间
   * @param frontMatter Front Matter 对象
   * @param filePath 文件路径
   * @returns ISO 8601 格式的时间戳
   */
  private getObsidianCreatedTime(frontMatter: any, filePath: string): string {
    // 尝试从 frontMatter 中获取创建时间（支持多种字段名）
    const createdField = frontMatter.created || frontMatter.created_time || frontMatter.createdTime || frontMatter.Created;

    if (createdField) {
      // 如果是字符串，尝试解析
      if (typeof createdField === 'string') {
        try {
          const date = new Date(createdField);
          if (!isNaN(date.getTime())) {
            return date.toISOString();
          }
        } catch (error) {
          this.logger.warn(`⚠️  无法解析创建时间: ${createdField}`);
        }
      }
      // 如果是 Date 对象
      if (createdField instanceof Date) {
        return createdField.toISOString();
      }
    }

    // 如果没有找到有效的创建时间，使用当前时间
    return new Date().toISOString();
  }

  /**
   * 从 Obsidian 属性中获取更新时间
   * 优先使用 frontMatter 中的 updated/last_edited_time 字段，如果没有则使用当前时间
   * @param frontMatter Front Matter 对象
   * @param filePath 文件路径
   * @returns ISO 8601 格式的时间戳
   */
  private getObsidianUpdatedTime(frontMatter: any, filePath: string): string {
    // 尝试从 frontMatter 中获取更新时间（支持多种字段名）
    const updatedField = frontMatter.updated || frontMatter.last_edited_time || frontMatter.lastEditedTime || frontMatter.Updated || frontMatter.modified || frontMatter.Modified;

    if (updatedField) {
      // 如果是字符串，尝试解析
      if (typeof updatedField === 'string') {
        try {
          const date = new Date(updatedField);
          if (!isNaN(date.getTime())) {
            return date.toISOString();
          }
        } catch (error) {
          this.logger.warn(`⚠️  无法解析更新时间: ${updatedField}`);
        }
      }
      // 如果是 Date 对象
      if (updatedField instanceof Date) {
        return updatedField.toISOString();
      }
    }

    // 如果没有找到有效的更新时间，使用当前时间
    return new Date().toISOString();
  }

  /**
   * 使用 Git 命令获取文件的创建时间和最后修改时间
   * @param filePath 文件路径
   * @returns { createdTime: string, lastEditedTime: string } ISO 8601 格式的时间戳
   * @deprecated 已改为使用 Obsidian 属性中的时间字段
   */
  private getGitTimestamps(filePath: string): { createdTime: string; lastEditedTime: string } {
    try {
      // 获取文件的第一次提交时间（创建时间）
      const createdTimeCmd = `git log --follow --format=%aI --reverse "${filePath}" | head -1`;
      const createdTimeOutput = execSync(createdTimeCmd, { encoding: 'utf-8', cwd: path.dirname(filePath) }).trim();

      // 获取文件的最后一次提交时间（更新时间）
      const lastEditedTimeCmd = `git log --follow --format=%aI -1 "${filePath}"`;
      const lastEditedTimeOutput = execSync(lastEditedTimeCmd, { encoding: 'utf-8', cwd: path.dirname(filePath) }).trim();

      // 如果 Git 命令返回空（文件未提交），使用文件系统时间
      const fileStats = fs.statSync(filePath);
      const createdTime = createdTimeOutput || fileStats.birthtime.toISOString();
      const lastEditedTime = lastEditedTimeOutput || fileStats.mtime.toISOString();

      return {
        createdTime,
        lastEditedTime
      };
    } catch (error) {
      // 如果 Git 命令失败（例如不在 Git 仓库中），使用文件系统时间
      this.logger.warn(`⚠️  无法获取 Git 时间戳，使用文件系统时间: ${error}`);
      const fileStats = fs.statSync(filePath);
      return {
        createdTime: fileStats.birthtime.toISOString(),
        lastEditedTime: fileStats.mtime.toISOString()
      };
    }
  }

  /**
   * 将 Front Matter 转换为 NotionPageData 格式
   */
  private convertToNotionPageData(
    frontMatter: any,
    markdown: string,
    featuredImage: AniviaImage | undefined,
    markdownImages: AniviaImage[],
    filePath: string
  ): NotionPageData {
    // 从 Obsidian 属性中获取创建时间和更新时间
    const createdTime = this.getObsidianCreatedTime(frontMatter, filePath);
    const lastEditedTime = this.getObsidianUpdatedTime(frontMatter, filePath);

    // 处理 title 字段：如果没有 title，使用文件名（不含扩展名）
    const title = frontMatter.title || path.basename(filePath, '.md');

    // 处理布尔值字段：支持 true/false、True/False、"true"/"false" 等格式
    const parseBooleanField = (value: any, defaultValue: boolean): boolean => {
      if (value === undefined || value === null || value === '') {
        return defaultValue;
      }
      // 处理字符串格式的布尔值
      if (typeof value === 'string') {
        const lowerValue = value.toLowerCase();
        return lowerValue === 'true';
      }
      // 处理布尔值
      return Boolean(value);
    };

    // 处理 featured_img 字段：优先使用上传到 Cloudflare 的图片
    // 如果没有上传（可能是远程 URL），则使用原始 URL
    let featuredImgUrl = '';
    if (featuredImage?.cloudflareUrl) {
      // 本地图片已上传到 Cloudflare
      featuredImgUrl = featuredImage.cloudflareUrl;
    } else if (featuredImage?.originalUrl) {
      // 远程 URL，直接使用
      featuredImgUrl = featuredImage.originalUrl;
    }

    return {
      id: '', // Obsidian 文章的 notion_page_id 为空字符串
      title,
      content: markdown,
      createdTime,
      lastEditedTime,
      slug: frontMatter.slug,
      published: parseBooleanField(frontMatter.published, false), // 默认为 false
      draft: parseBooleanField(frontMatter.draft, false), // 默认为 false
      archived: parseBooleanField(frontMatter.archived, false), // 默认为 false
      categories: Array.isArray(frontMatter.categories) ? frontMatter.categories : [],
      tags: Array.isArray(frontMatter.tags) ? frontMatter.tags : [],
      excerpt: frontMatter.excerpt || '',
      featuredImg: featuredImgUrl,
      galleryImgs: [], // Obsidian 不支持组图
      properties: {},
      images: markdownImages,
      postOrigin: 'obsidian',
      postType: frontMatter.post_type || frontMatter.postType || '' // 优先使用下划线命名
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

}
