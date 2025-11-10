import { Logger } from '../utils/logger';
import { NotionImage, ImageType } from '../types';

export class ImageProcessor {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * 从 Markdown 内容中提取图片 URL
   */
  extractImagesFromMarkdown(markdown: string): string[] {
    const imageUrls: string[] = [];

    // 使用正则表达式匹配 Markdown 中的图片
    const imageRegex = /!\[.*?]\((https?:\/\/[^)]+)\)/g;
    let match;

    while ((match = imageRegex.exec(markdown)) !== null) {
      const imageUrl = match[1];
      if (!imageUrls.includes(imageUrl)) {
        imageUrls.push(imageUrl);
      }
    }

    return imageUrls;
  }

  /**
   * 将图片 URL 转换为 NotionImage 对象
   */
  convertUrlsToNotionImages(imageUrls: string[], type: ImageType): NotionImage[] {
    const images: NotionImage[] = [];
    imageUrls.forEach((url, index) => {
      const filename = this.generateImageFilename(url, `img_${index}`);

      images.push({
        url: url,
        originalUrl: url,
        filename: filename,
        hash: '', // 将在下载时基于内容计算
        type: type
      });
    });
    return images;
  }

  createImageMappings(processedImages: NotionImage[]): Map<string, string> {
    const imageMap = new Map<string, string>();
    let mappedCount = 0;

    processedImages.forEach((img, index) => {
      if (img.cloudflareUrl) {
        // 映射原始 URL 到 Cloudflare URL
        imageMap.set(img.url, img.cloudflareUrl);
        // 也映射 originalUrl，以防有差异
        if (img.originalUrl && img.originalUrl !== img.url) {
          imageMap.set(img.originalUrl, img.cloudflareUrl);
        }
        mappedCount++;
      } else {
        this.logger.warn(`   ❌ 没有 Cloudflare URL: ${img.filename}`);
      }
    });

    return imageMap;
  }

  /**
   * 替换 Markdown 中的图片 URL
   */
  replaceImageUrlsInMarkdown(markdown: string, imageMap: Map<string, string>): string {
    let finalMarkdown = markdown;
    let totalReplacements = 0;

    if (imageMap.size === 0) {
      this.logger.warn(`⚠️ 图片映射表为空，跳过 URL 替换`);
      return finalMarkdown;
    }

    imageMap.forEach((cloudflareUrl, originalUrl) => {
      const escapedUrl = this.escapeRegExp(originalUrl);
      const regex = new RegExp(escapedUrl, 'g');
      const beforeCount = (finalMarkdown.match(regex) || []).length;
      
      if (beforeCount > 0) {
        finalMarkdown = finalMarkdown.replace(regex, cloudflareUrl);
        totalReplacements += beforeCount;
      } else {
        this.logger.warn(`⚠️ 未找到需要替换的 URL: ${originalUrl}`);
      }
    });

    // 统计替换结果
    const imageCount = (finalMarkdown.match(/!\[.*?\]\(.*?\)/g) || []).length;
    const cloudflareImageCount = (finalMarkdown.match(/!\[.*?\]\(https?:\/\/[^)]*cloudflare[^)]*\)/g) || []).length;
    const notionImageCount = (finalMarkdown.match(/!\[.*?\]\(https?:\/\/[^)]*notion[^)]*\)/g) || []).length;

    this.logger.debug(`📊 图片 URL 替换统计:`);
    this.logger.debug(`   - 总替换次数: ${totalReplacements}`);
    this.logger.debug(`   - Markdown 中总图片数: ${imageCount}`);
    this.logger.debug(`   - 使用 Cloudflare URL 的图片: ${cloudflareImageCount}`);
    this.logger.debug(`   - 仍使用 Notion URL 的图片: ${notionImageCount}`);

    return finalMarkdown;
  }

  /**
   * 生成图片文件名
   */
  private generateImageFilename(url: string, blockId: string): string {
    const urlParts = url.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    const extension = lastPart.includes('.') ? lastPart.split('.').pop() : 'jpg';
    return `${blockId}_${Date.now()}.${extension}`;
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
