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
   * 支持：
   * - 相对路径：./image.png, ../image.png
   * - Vault 绝对路径：/assets/image.png (相对于 vault 根目录)
   * - 系统绝对路径：/Users/xxx/image.png
   */
  private resolveObsidianImagePath(obsidianPath: string, markdownFilePath: string): string {
    const path = require('path');
    const fs = require('fs');

    // 移除 Obsidian 语法的 [[ ]]
    let imagePath = obsidianPath.trim();
    if (imagePath.startsWith('[[') && imagePath.endsWith(']]')) {
      imagePath = imagePath.slice(2, -2).trim();
    }

    // 如果以 / 开头，可能是 vault 内的绝对路径（如 /assets/image.png）
    if (imagePath.startsWith('/')) {
      const vaultRoot = this.findVaultRoot(markdownFilePath);
      if (vaultRoot) {
        // 移除开头的 /，然后拼接到 vault 根目录
        const relativePath = imagePath.slice(1);
        const resolvedPath = path.join(vaultRoot, relativePath);

        // 检查文件是否存在
        if (fs.existsSync(resolvedPath)) {
          return resolvedPath;
        }

        this.logger.debug(`尝试 vault 路径失败: ${resolvedPath}`);
      }

      // 如果找不到 vault 根目录，或文件不存在，尝试作为系统绝对路径
      if (fs.existsSync(imagePath)) {
        return imagePath;
      }

      this.logger.warn(`图片文件不存在: ${obsidianPath}`);
      return '';
    }

    // 如果是系统绝对路径
    if (path.isAbsolute(imagePath)) {
      return fs.existsSync(imagePath) ? imagePath : '';
    }

    // 相对路径：相对于 Markdown 文件所在目录
    const markdownDir = path.dirname(markdownFilePath);
    const resolvedPath = path.resolve(markdownDir, imagePath);

    // 检查文件是否存在
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }

    this.logger.warn(`图片文件不存在: ${obsidianPath} (解析为: ${resolvedPath})`);
    return '';
  }

  /**
   * 查找 Obsidian vault 的根目录
   * 通过向上查找包含 .obsidian 目录的父目录来确定 vault 根目录
   */
  private findVaultRoot(markdownFilePath: string): string | null {
    const path = require('path');
    const fs = require('fs');

    let currentDir = path.dirname(markdownFilePath);
    let previousDir = '';

    // 向上查找，直到找到 .obsidian 目录或到达文件系统根目录
    while (currentDir !== previousDir) {
      // 检查是否存在 .obsidian 目录
      const obsidianDir = path.join(currentDir, '.obsidian');
      if (fs.existsSync(obsidianDir) && fs.statSync(obsidianDir).isDirectory()) {
        this.logger.debug(`找到 vault 根目录: ${currentDir}`);
        return currentDir;
      }

      previousDir = currentDir;
      currentDir = path.dirname(currentDir);
    }

    // 如果没有找到 .obsidian 目录，尝试查找常见的 vault 目录名
    let testDir = path.dirname(markdownFilePath);
    let maxDepth = 5;

    while (maxDepth > 0 && testDir !== path.dirname(testDir)) {
      const parentDir = path.dirname(testDir);
      const dirName = path.basename(parentDir);

      if (dirName === 'ryze-repo' || dirName === 'vault' || dirName === 'obsidian' || dirName.includes('vault')) {
        this.logger.debug(`使用推测的 vault 根目录: ${parentDir}`);
        return parentDir;
      }

      testDir = parentDir;
      maxDepth--;
    }

    this.logger.debug(`未找到 vault 根目录，使用 Markdown 文件所在目录: ${path.dirname(markdownFilePath)}`);
    return path.dirname(markdownFilePath);
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
      this.logger.debug(`图片映射表为空，跳过 Obsidian 图片语法替换`);
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
        this.logger.warn(`没有 Cloudflare URL: ${img.filename}`);
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
      this.logger.debug(`图片映射表为空，跳过 URL 替换`);
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
        this.logger.debug(`未找到需要替换的 URL: ${originalUrl}`);
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
