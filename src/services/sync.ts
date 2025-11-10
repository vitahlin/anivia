import { NotionService } from './notion';
import { NotionMarkdownConverter } from './notion-markdown';
import { CloudflareService } from './cloudflare';
import { SupabaseService } from './supabase';
import { ImageProcessor } from './image-processor';
import { AppConfig, SyncResult, NotionPageData, NotionImage } from '../types';
import { Logger } from '../utils/logger';
import { NotionError } from '../errors/notion-error';
import { CloudflareError } from '../errors/cloudflare-error';

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

  async syncPage(pageId: string): Promise<SyncResult> {
    this.logger.info(`开始同步页面: ${pageId}`);
    let imagesProcessed = 0;

    // Step 1: 获取 Notion 页面数据
    this.logger.info('Step 1: 获取 Notion 页面数据...');
    const pageData: NotionPageData = await this.notionService.getPageData(pageId);

    // Step 2: 转换页面为 Markdown
    this.logger.info('Step 2: 转换页面为 Markdown...');
    const rawMarkdown = await this.notionMarkdownConverter.convertPageToMarkdown(pageId);

    // Step 3: 从 Markdown 中提取图片
    this.logger.info('Step 3: 提取图片...');
    const imageUrls = this.imageProcessor.extractImagesFromMarkdown(rawMarkdown);
    const markdownImages = this.imageProcessor.convertUrlsToNotionImages(imageUrls, 'markdown');
    this.logger.debug(`📸 从 Markdown 中提取到 ${markdownImages.length} 张图片`);

    // Step 4: 提取配图和组图
    this.logger.info('🖼️ Step 4: 提取配图和组图...');
    const allImages: NotionImage[] = [...markdownImages];

    // 处理配图
    if (pageData.featuredImg) {
      const featuredImage: NotionImage = {
        url: pageData.featuredImg,
        originalUrl: pageData.featuredImg,
        filename: this.generateFeaturedImageFilename(pageData.featuredImg, pageId),
        hash: '',
        type: 'featured'
      };
      allImages.push(featuredImage);
      this.logger.info(`📸 提取到配图: ${pageData.featuredImg}`);
    } else {
      this.logger.info('📸 页面没有配图');
    }

    // 处理组图
    if (pageData.galleryImgs && pageData.galleryImgs.length > 0) {
      pageData.galleryImgs.forEach((url, index) => {
        const galleryImage: NotionImage = {
          url: url,
          originalUrl: url,
          filename: this.generateGalleryImageFilename(url, pageId, index),
          hash: '',
          type: 'gallery'
        };
        allImages.push(galleryImage);
      });
      this.logger.info(`📸 提取到组图: ${pageData.galleryImgs.length} 张`);
    } else {
      this.logger.info('📸 页面没有组图');
    }

    // Step 5: 上传所有图片到 Cloudflare
    this.logger.info('☁️ Step 5: 上传图片到 Cloudflare...');
    const processedImages = await this.uploadImagesToCloudflare(allImages);

    // 分离处理后的图片
    const processedMarkdownImages = processedImages.filter(img => img.type === 'markdown');
    const processedFeaturedImage = processedImages.find(img => img.type === 'featured');
    const processedGalleryImages = processedImages.filter(img => img.type === 'gallery');

    imagesProcessed = processedImages.filter(img => img.cloudflareUrl).length;

    // Step 6: 替换 Markdown 中的图片 URL
    this.logger.info('🔄 Step 6: 替换 Markdown 中的图片 URL...');
    const imageMap = this.imageProcessor.createImageMappings(processedMarkdownImages);
    const finalMarkdown = this.imageProcessor.replaceImageUrlsInMarkdown(rawMarkdown, imageMap);

    // Step 7: 保存到 Supabase
    this.logger.info('💾 Step 7: 保存到 Supabase...');
    const finalPageData: NotionPageData = {
      ...pageData,
      featuredImg: processedFeaturedImage?.cloudflareUrl || '',
      galleryImgs: processedGalleryImages
        .map(img => img.cloudflareUrl)
        .filter((url): url is string => !!url),
      content: finalMarkdown,
      images: processedMarkdownImages
    };

    await this.supabaseService.syncPageData(finalPageData);
    this.logger.debug('✅ 成功保存到 Supabase');

    const result: SyncResult = {
      success: true,
      pageId,
      message: `🎉 页面 ${pageId} 同步成功`,
      imagesProcessed
    };

    return result;
  }

  /**
   * 上传图片到 Cloudflare
   * 封装图片上传逻辑，统一处理 Markdown 图片和配图
   */
  private async uploadImagesToCloudflare(images: NotionImage[]): Promise<NotionImage[]> {
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
    const gallerySuccess = processedImages.filter(img => img.type === 'gallery' && img.cloudflareUrl).length;
    const galleryCount = images.filter(img => img.type === 'gallery').length;

    this.logger.info(`✅ 图片上传完成: Markdown ${markdownSuccess}/${markdownCount}, 配图 ${featuredSuccess}/${featuredCount}, 组图 ${gallerySuccess}/${galleryCount}`);

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
