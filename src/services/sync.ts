import {NotionService} from './notion';
import {NotionMarkdownConverter} from './notion-markdown';
import {CloudflareService} from './cloudflare';
import {SupabaseService} from './supabase';
import {ImageProcessor} from './image-processor';
import {AniviaImage, AppConfig, NotionPageData, SyncResult} from '../types';
import {Logger} from '../utils/logger';

export class SyncService {
  private notionService: NotionService;
  private notionMarkdownConverter: NotionMarkdownConverter;
  private cloudflareService: CloudflareService;
  private supabaseService: SupabaseService;
  private imageProcessor: ImageProcessor;
  private logger: Logger;

  constructor(config: AppConfig, logger: Logger) {
    this.logger = logger;
    this.notionService = new NotionService(config.notion, logger);
    this.notionMarkdownConverter = new NotionMarkdownConverter(
      this.notionService.getClient(),
      logger
    );
    this.cloudflareService = new CloudflareService(config.cloudflare, logger);
    this.supabaseService = new SupabaseService(config.supabase, logger);
    this.imageProcessor = new ImageProcessor(logger);
  }

  async syncPage(pageId: string, ignoreUpdateTime: boolean = false): Promise<SyncResult> {
    this.logger.info(`开始同步页面: ${pageId}`);
    if (ignoreUpdateTime) {
      this.logger.info(`忽略更新时间检查，强制同步`);
    }
    let imagesProcessed = 0;

    const cleanPageId = pageId.replace(/-/g, '');

    // 获取页面数据
    const pageData: NotionPageData = await this.notionService.getPageData(pageId);

    // 检查 published 状态
    if (!pageData.published) {
      return {
        success: true,
        pageId,
        message: '跳过 (未发布)',
        imagesProcessed: 0,
        skipped: true
      };
    }

    // 检查是否需要更新（除非 ignoreUpdateTime 为 true）
    const existingPage = await this.supabaseService.getPageById(cleanPageId);

    if (existingPage && !ignoreUpdateTime) {
      // 获取 Notion 页面的最后编辑时间
      const notionLastEdited = new Date(pageData.lastEditedTime);
      const supabaseLastEdited = new Date(existingPage.last_edited_time);

      if (notionLastEdited.getTime() <= supabaseLastEdited.getTime()) {
        return {
          success: true,
          pageId,
          message: '跳过 (未更新)',
          imagesProcessed: 0,
          skipped: true
        };
      }

    } else if (existingPage && ignoreUpdateTime) {
      this.logger.debug(`忽略更新时间，强制同步已存在的页面`);
    }

    // Step 1: 转换页面为 Markdown
    this.logger.info('Step 1: 转换页面为 Markdown...');
    const rawMarkdown = await this.notionMarkdownConverter.convertPageToMarkdown(pageId);

    // Step 2: 提取图片
    const imageUrls = this.imageProcessor.extractNotionImagesFromMarkdown(rawMarkdown);
    const markdownImages = this.imageProcessor.convertUrlsToAniviaImages(imageUrls, 'markdown');

    const allImages: AniviaImage[] = [...markdownImages];

    // 处理配图
    if (pageData.featuredImg) {
      const featuredImage: AniviaImage = {
        url: pageData.featuredImg,
        originalUrl: pageData.featuredImg,
        filename: this.generateFeaturedImageFilename(pageData.featuredImg, pageId),
        hash: '',
        type: 'featured',
        source: 'notion'
      };
      allImages.push(featuredImage);
    }

    // 处理组图
    if (pageData.galleryImgs && pageData.galleryImgs.length > 0) {
      pageData.galleryImgs.forEach((url, index) => {
        const galleryImage: AniviaImage = {
          url: url,
          originalUrl: url,
          filename: this.generateGalleryImageFilename(url, pageId, index),
          hash: '',
          type: 'gallery',
          source: 'notion'
        };
        allImages.push(galleryImage);
      });
    }

    const imageStats = {
      markdown: markdownImages.length,
      featured: pageData.featuredImg ? 1 : 0,
      gallery: pageData.galleryImgs?.length || 0,
      total: allImages.length
    };
    this.logger.info(`Step 2: 提取到 ${imageStats.total} 张图片 (内容: ${imageStats.markdown}, 配图: ${imageStats.featured}, 组图: ${imageStats.gallery})`);

    // Step 3: 上传图片到 Cloudflare
    this.logger.info('Step 3: 上传图片到 Cloudflare...');
    const processedImages = await this.uploadImagesToCloudflare(allImages);

    // 分离处理后的图片
    const processedMarkdownImages = processedImages.filter(img => img.type === 'markdown');
    const processedFeaturedImage = processedImages.find(img => img.type === 'featured');
    const processedGalleryImages = processedImages.filter(img => img.type === 'gallery');

    imagesProcessed = processedImages.filter(img => img.cloudflareUrl).length;

    // Step 4: 替换 Markdown 中的图片 URL
    this.logger.info('Step 4: 替换 Markdown 中的图片 URL...');
    const imageMap = this.imageProcessor.createImageMappings(processedMarkdownImages);
    const finalMarkdown = this.imageProcessor.replaceImageUrlsInMarkdown(rawMarkdown, imageMap);

    // Step 5: 保存到 Supabase
    this.logger.info('Step 5: 保存到 Supabase...');
    const finalPageData: NotionPageData = {
      ...pageData,
      featuredImg: processedFeaturedImage?.cloudflareUrl || '',
      galleryImgs: processedGalleryImages
        .map(img => img.cloudflareUrl)
        .filter((url): url is string => !!url),
      content: finalMarkdown,
      images: processedMarkdownImages,
      postOrigin: 'notion'
    };

    await this.supabaseService.syncPageData(finalPageData);

    return {
        success: true,
        pageId,
        message: `页面 ${pageId} 同步成功`,
        imagesProcessed
    };
  }

  /**
   * 上传图片到 Cloudflare
   * 封装图片上传逻辑，统一处理 Markdown 图片和配图
   */
  private async uploadImagesToCloudflare(images: AniviaImage[]): Promise<AniviaImage[]> {
    if (images.length === 0) {
      this.logger.info('没有图片需要上传');
      return [];
    }

    // 上传所有图片
    const processedImages = await this.cloudflareService.processImages(images);

    return processedImages;
  }

  /**
   * 生成配图文件名
   */
  private generateFeaturedImageFilename(url: string, pageId: string): string {
    const urlParts = url.split('/');
    const lastPart = urlParts[urlParts.length - 1];

    // 尝试从 URL 中提取扩展名
    let extension = 'jpg';
    if (lastPart.includes('.')) {
      const parts = lastPart.split('.');
      const ext = parts[parts.length - 1].split('?')[0]; // 移除查询参数
      if (ext && /^[a-z0-9]+$/i.test(ext)) {
        extension = ext;
      }
    }

    return `featured_${pageId}_${Date.now()}.${extension}`;
  }

  /**
   * 生成组图文件名
   */
  private generateGalleryImageFilename(url: string, pageId: string, index: number): string {
    const urlParts = url.split('/');
    const lastPart = urlParts[urlParts.length - 1];

    // 尝试从 URL 中提取扩展名
    let extension = 'jpg';
    if (lastPart.includes('.')) {
      const parts = lastPart.split('.');
      const ext = parts[parts.length - 1].split('?')[0]; // 移除查询参数
      if (ext && /^[a-z0-9]+$/i.test(ext)) {
        extension = ext;
      }
    }

    return `gallery_${pageId}_${index}_${Date.now()}.${extension}`;
  }

}
