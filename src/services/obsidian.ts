import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { Logger } from '../utils/logger';

/**
 * ObsidianService - 处理 Obsidian Markdown 文件的解析
 */
export class ObsidianService {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * 解析 Markdown 文件，提取 Front Matter 和内容
   */
  parseMarkdownFile(filePath: string): { frontMatter: any; content: string; rawContent: string } {
    this.logger.debug(`📄 开始解析 Markdown 文件: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const parsed = this.parseFrontMatter(rawContent);

    this.logger.debug(`✅ 文件解析完成`);
    this.logger.debug(`   - Front Matter 字段数: ${Object.keys(parsed.frontMatter).length}`);
    this.logger.debug(`   - 内容长度: ${parsed.content.length} 字符`);

    return {
      frontMatter: parsed.frontMatter,
      content: parsed.content,
      rawContent
    };
  }

  /**
   * 解析 YAML Front Matter
   */
  parseFrontMatter(content: string): { frontMatter: any; content: string } {
    try {
      const parsed = matter(content);
      return {
        frontMatter: parsed.data,
        content: parsed.content
      };
    } catch (error) {
      this.logger.error(`❌ Front Matter 解析失败:`, error);
      throw new Error(`Front Matter 解析失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 提取并解析 featured_img
   * 支持 Obsidian 语法：[[image.png]] 和标准路径
   */
  extractFeaturedImage(frontMatter: any, markdownFilePath: string): string | null {
    const featuredImg = frontMatter.featured_img;

    if (!featuredImg) {
      return null;
    }

    // 如果是远程 URL，直接返回
    if (typeof featuredImg === 'string' && (featuredImg.startsWith('http://') || featuredImg.startsWith('https://'))) {
      this.logger.debug(`🌐 Featured image 是远程 URL: ${featuredImg}`);
      return featuredImg;
    }

    // 解析本地路径
    const resolvedPath = this.resolveObsidianImagePath(featuredImg, markdownFilePath);

    if (!resolvedPath) {
      this.logger.warn(`⚠️  无法解析 featured_img 路径: ${featuredImg}`);
      return null;
    }

    if (!fs.existsSync(resolvedPath)) {
      this.logger.warn(`⚠️  Featured image 文件不存在: ${resolvedPath}`);
      return null;
    }

    this.logger.debug(`✅ Featured image 解析成功: ${resolvedPath}`);
    return resolvedPath;
  }

  /**
   * 解析 Obsidian 图片路径为绝对路径
   * 支持：
   * - Obsidian 语法：[[image.png]]
   * - 相对路径：./image.png, ../image.png
   * - 绝对路径：/path/to/image.png
   */
  resolveObsidianImagePath(obsidianPath: string, markdownFilePath: string): string | null {
    if (!obsidianPath) {
      return null;
    }

    // 移除 Obsidian 语法的 [[ ]]
    let imagePath = obsidianPath.trim();
    if (imagePath.startsWith('[[') && imagePath.endsWith(']]')) {
      imagePath = imagePath.slice(2, -2).trim();
    }

    // 如果是绝对路径，直接返回
    if (path.isAbsolute(imagePath)) {
      return imagePath;
    }

    // 相对路径：相对于 Markdown 文件所在目录
    const markdownDir = path.dirname(markdownFilePath);
    const resolvedPath = path.resolve(markdownDir, imagePath);

    return resolvedPath;
  }
}

