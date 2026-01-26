import { Logger } from '../utils/logger';
import { AniviaImage, ImageType } from '../types';

export class ImageProcessor {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * 从 Notion Markdown 内容中提取图片 URL（远程 URL）
   */
  extractNotionImagesFromMarkdown(markdown: string): string[] {
    const imageUrls: string[] = [];

    // 使用正则表达式匹配 Markdown 中的图片（远程 URL）
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
   * 从 Obsidian Markdown 内容中提取图片路径（本地文件）
   * 支持 Obsidian 语法：![[image.png]] 和标准 Markdown 语法：![](image.png)
   */
  extractObsidianImagesFromMarkdown(markdown: string, markdownFilePath: string): string[] {
    const imagePaths: string[] = [];

    // 1. 匹配 Obsidian 语法：![[image.png]]
    const obsidianRegex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|webp|svg))\]\]/gi;
    let match;

    while ((match = obsidianRegex.exec(markdown)) !== null) {
      const imagePath = match[1];
      const resolvedPath = this.resolveObsidianImagePath(imagePath, markdownFilePath);
      if (resolvedPath && !imagePaths.includes(resolvedPath)) {
        imagePaths.push(resolvedPath);
      }
    }

    // 2. 匹配标准 Markdown 语法中的本地图片：![](./image.png) 或 ![](image.png)
    const markdownRegex = /!\[.*?]\(([^)]+\.(png|jpg|jpeg|gif|webp|svg))\)/gi;

    while ((match = markdownRegex.exec(markdown)) !== null) {
      const imagePath = match[1];
      // 跳过远程 URL
      if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        continue;
      }
      const resolvedPath = this.resolveObsidianImagePath(imagePath, markdownFilePath);
      if (resolvedPath && !imagePaths.includes(resolvedPath)) {
        imagePaths.push(resolvedPath);
      }
    }

    return imagePaths;
  }

  /**
   * 解析 Obsidian 图片路径为绝对路径
   * 支持相对路径、绝对路径
   */
  private resolveObsidianImagePath(obsidianPath: string, markdownFilePath: string): string {
    const path = require('path');
    const fs = require('fs');

    // 如果已经是绝对路径，直接返回
    if (path.isAbsolute(obsidianPath)) {
      return fs.existsSync(obsidianPath) ? obsidianPath : '';
    }

    // 获取 Markdown 文件所在目录
    const markdownDir = path.dirname(markdownFilePath);

    // 解析相对路径
    const resolvedPath = path.resolve(markdownDir, obsidianPath);

    // 检查文件是否存在
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }

    this.logger.warn(`⚠️ 图片文件不存在: ${obsidianPath} (解析为: ${resolvedPath})`);
    return '';
  }

  /**
   * 将图片 URL 转换为 AniviaImage 对象（Notion 远程图片）
   */
  convertUrlsToAniviaImages(imageUrls: string[], type: ImageType): AniviaImage[] {
    const images: AniviaImage[] = [];
    imageUrls.forEach((url, index) => {
      const filename = this.generateImageFilename(url, `img_${index}`);

      images.push({
        url: url,
        originalUrl: url,
        filename: filename,
        hash: '', // 将在下载时基于内容计算
        type: type,
        source: 'notion'
      });
    });
    return images;
  }

  /**
   * 将本地图片路径转换为 AniviaImage 对象（Obsidian 本地图片）
   */
  convertLocalPathsToAniviaImages(imagePaths: string[], type: ImageType): AniviaImage[] {
    const path = require('path');
    const images: AniviaImage[] = [];

    imagePaths.forEach((filePath, index) => {
      const filename = this.generateLocalImageFilename(filePath, `img_${index}`);

      images.push({
        url: filePath,           // 本地文件路径
        originalUrl: filePath,   // 本地文件路径
        filename: filename,
        hash: '',                // 将在读取文件时基于内容计算
        type: type,
        source: 'local'
      });
    });
    return images;
  }

  /**
   * 替换 Obsidian 图片语法为标准 Markdown 语法
   * ![[image.png]] -> ![](cloudflare-url)
   * ![](./image.png) -> ![](cloudflare-url)
   */
  replaceObsidianImageSyntax(markdown: string, imageMap: Map<string, string>): string {
    let finalMarkdown = markdown;
    let totalReplacements = 0;

    if (imageMap.size === 0) {
      this.logger.warn(`⚠️ 图片映射表为空，跳过 Obsidian 图片语法替换`);
      return finalMarkdown;
    }

    imageMap.forEach((cloudflareUrl, localPath) => {
      const path = require('path');
      const filename = path.basename(localPath);

      // 1. 替换 Obsidian 语法：![[image.png]]
      const obsidianPattern = `!\\[\\[${this.escapeRegExp(filename)}\\]\\]`;
      const obsidianRegex = new RegExp(obsidianPattern, 'g');
      const obsidianCount = (finalMarkdown.match(obsidianRegex) || []).length;

      if (obsidianCount > 0) {
        finalMarkdown = finalMarkdown.replace(obsidianRegex, `![](${cloudflareUrl})`);
        totalReplacements += obsidianCount;
        this.logger.debug(`   ✅ 替换 Obsidian 语法: ![[${filename}]] -> ![](${cloudflareUrl}) (${obsidianCount} 次)`);
      }

      // 2. 替换标准 Markdown 语法中的本地路径：![](./image.png) 或 ![](image.png)
      const escapedPath = this.escapeRegExp(localPath);
      const markdownRegex = new RegExp(`!\\[([^\\]]*)\\]\\(${escapedPath}\\)`, 'g');
      const markdownCount = (finalMarkdown.match(markdownRegex) || []).length;

      if (markdownCount > 0) {
        finalMarkdown = finalMarkdown.replace(markdownRegex, `![$1](${cloudflareUrl})`);
        totalReplacements += markdownCount;
        this.logger.debug(`   ✅ 替换 Markdown 语法: ![](${localPath}) -> ![](${cloudflareUrl}) (${markdownCount} 次)`);
      }
    });

    this.logger.debug(`📊 Obsidian 图片语法替换统计: 总替换次数 ${totalReplacements}`);

    return finalMarkdown;
  }

  createImageMappings(processedImages: AniviaImage[]): Map<string, string> {
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
   * 生成图片文件名（Notion 远程图片）
   */
  private generateImageFilename(url: string, blockId: string): string {
    const urlParts = url.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    const extension = lastPart.includes('.') ? lastPart.split('.').pop() : 'jpg';
    return `${blockId}_${Date.now()}.${extension}`;
  }

  /**
   * 生成图片文件名（Obsidian 本地图片）
   */
  private generateLocalImageFilename(filePath: string, blockId: string): string {
    const path = require('path');
    const extension = path.extname(filePath).slice(1) || 'jpg';
    const basename = path.basename(filePath, path.extname(filePath));
    return `${basename}_${Date.now()}.${extension}`;
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
