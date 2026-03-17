import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import {Logger} from '../utils/logger';

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
      console.error(`❌ 文件不存在: ${filePath}`);
      process.exit(1);
    }

    let rawContent: string;
    try {
      rawContent = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      console.error(`❌ 读取文件失败: ${filePath}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

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
      console.error('❌ Front Matter 解析失败:');
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
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
   * - Vault 相对路径：assets/image.png (相对于 vault 根目录，Obsidian 默认行为)
   * - 相对路径：./image.png, ../image.png (相对于 Markdown 文件)
   * - Vault 绝对路径：/assets/image.png (相对于 vault 根目录)
   * - 系统绝对路径：/Users/xxx/image.png
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

    // 如果以 / 开头，可能是 vault 内的绝对路径（如 /assets/image.png）
    // 需要找到 vault 根目录
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

      return null;
    }

    // 如果是系统绝对路径（Windows: C:\, Unix: 已经在上面处理）
    if (path.isAbsolute(imagePath)) {
      return imagePath;
    }

    // 相对路径处理
    // Obsidian 的默认行为：assets 目录下的图片总是相对于 vault 根目录
    // 优先尝试从 vault 根目录解析
    const vaultRoot = this.findVaultRoot(markdownFilePath);
    if (vaultRoot) {
      const vaultRelativePath = path.join(vaultRoot, imagePath);
      if (fs.existsSync(vaultRelativePath)) {
        this.logger.debug(`从 vault 根目录解析成功: ${vaultRelativePath}`);
        return vaultRelativePath;
      }
    }

    // 如果从 vault 根目录找不到，尝试相对于 Markdown 文件所在目录
    const markdownDir = path.dirname(markdownFilePath);
    const markdownRelativePath = path.resolve(markdownDir, imagePath);

    if (fs.existsSync(markdownRelativePath)) {
      this.logger.debug(`从 Markdown 目录解析成功: ${markdownRelativePath}`);
      return markdownRelativePath;
    }

    // 都找不到，返回 null
    return null;
  }

  /**
   * 查找 Obsidian vault 的根目录
   * 通过向上查找包含 .obsidian 目录的父目录来确定 vault 根目录
   * 如果找不到 .obsidian 目录，则返回 Markdown 文件所在目录的最顶层可访问目录
   */
  private findVaultRoot(markdownFilePath: string): string | null {
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

    // 如果没有找到 .obsidian 目录，返回 Markdown 文件的父目录
    // 这适用于没有 .obsidian 目录的简单 vault
    const fallbackRoot = path.dirname(markdownFilePath);

    // 尝试向上找到一个合理的根目录（例如包含多个 .md 文件的目录）
    let testDir = fallbackRoot;
    let maxDepth = 5; // 最多向上查找 5 层

    while (maxDepth > 0 && testDir !== path.dirname(testDir)) {
      const parentDir = path.dirname(testDir);

      // 如果父目录名是常见的 vault 名称或项目目录，使用它
      const dirName = path.basename(parentDir);
      if (dirName === 'ryze-repo' || dirName === 'vault' || dirName === 'obsidian' || dirName.includes('vault')) {
        this.logger.debug(`使用推测的 vault 根目录: ${parentDir}`);
        return parentDir;
      }

      testDir = parentDir;
      maxDepth--;
    }

    this.logger.debug(`未找到 vault 根目录，使用 Markdown 文件所在目录: ${fallbackRoot}`);
    return fallbackRoot;
  }
}

