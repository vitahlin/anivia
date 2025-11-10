import { SupabaseService } from './supabase';
import { SupabasePageRecord } from '../types';
import { Logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface ExportOptions {
  outputDir: string;
  overwrite?: boolean;
  includeMetadata?: boolean;
}

export interface ExportResult {
  success: boolean;
  totalPages: number;
  exportedPages: number;
  errors: string[];
  outputDir: string;
}

export class ExportService {
  private supabaseService: SupabaseService;
  private logger: Logger;

  constructor(supabaseService: SupabaseService, logger: Logger) {
    this.supabaseService = supabaseService;
    this.logger = logger;
  }

  /**
   * 从 Supabase 导出所有文章为 Markdown 文件
   */
  async exportAllPages(options: ExportOptions): Promise<ExportResult> {
    const result: ExportResult = {
      success: true,
      totalPages: 0,
      exportedPages: 0,
      errors: [],
      outputDir: options.outputDir
    };

    try {
      this.logger.info('🚀 开始从 Supabase 导出文章...');

      // 确保输出目录存在
      this.ensureDirectoryExists(options.outputDir);

      // 从 Supabase 获取所有页面
      this.logger.info('📖 从 Supabase 查询所有文章...');
      const allPages = await this.supabaseService.getAllPages();

      // 只导出已发布的文章
      const pages = allPages.filter(page => page.published === true);
      result.totalPages = pages.length;

      this.logger.info(`📊 找到 ${allPages.length} 篇文章，其中 ${pages.length} 篇已发布`);

      if (pages.length === 0) {
        this.logger.warn('⚠️  没有找到已发布的文章。请确保文章的 "发布" 字段为 true。');
        return result;
      }

      // 导出每个页面
      for (const page of pages) {
        try {
          await this.exportPage(page, options);
          result.exportedPages++;
          this.logger.info(`✅ 已导出: ${page.title}`);
        } catch (error) {
          const errorMsg = `导出失败 "${page.title}": ${error instanceof Error ? error.message : String(error)}`;
          result.errors.push(errorMsg);
          this.logger.error(errorMsg);
          result.success = false;
        }
      }

      if (result.success) {
        this.logger.info(`🎉 导出完成！共导出 ${result.exportedPages} 篇文章到 ${options.outputDir}`);
      } else {
        this.logger.warn(`⚠️  导出完成，但有 ${result.errors.length} 个错误`);
      }

    } catch (error) {
      result.success = false;
      const errorMsg = `导出过程出错: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);
      this.logger.error(errorMsg);
    }

    return result;
  }

  /**
   * 导出单个页面为 Markdown 文件
   */
  private async exportPage(page: SupabasePageRecord, options: ExportOptions): Promise<void> {
    // 生成文件名（使用标题，移除特殊字符）
    const filename = this.sanitizeFilename(page.title) + '.md';
    const filepath = path.join(options.outputDir, filename);

    // 检查文件是否已存在
    if (fs.existsSync(filepath) && !options.overwrite) {
      this.logger.warn(`⚠️  文件已存在，跳过: ${filename}`);
      return;
    }

    // 生成 Markdown 内容
    const markdownContent = this.generateMarkdownContent(page, options.includeMetadata);

    // 写入文件
    fs.writeFileSync(filepath, markdownContent, 'utf-8');
  }

  /**
   * 将 ISO 时间字符串转换为北京时间格式
   */
  private formatBeijingTime(isoString: string): string {
    const date = new Date(isoString);

    // 转换为北京时间（UTC+8）
    const beijingTime = new Date(date.getTime() + (8 * 60 * 60 * 1000));

    // 格式化为 yyyy-MM-dd HH:mm:ss
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getUTCDate()).padStart(2, '0');
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * 获取当前北京时间
   */
  private getCurrentBeijingTime(): string {
    const now = new Date();
    return this.formatBeijingTime(now.toISOString());
  }

  /**
   * 生成 Markdown 文件内容
   */
  private generateMarkdownContent(page: SupabasePageRecord, includeMetadata: boolean = true): string {
    let content = '';

    // 添加 Front Matter（元数据）
    if (includeMetadata) {
      content += '---\n';
      content += `title: ${page.title}\n`;
      content += `notion_page_id: ${page.notion_page_id}\n`;
      content += `created_time: ${this.formatBeijingTime(page.created_time)}\n`;
      content += `last_edited_time: ${this.formatBeijingTime(page.last_edited_time)}\n`;
      content += `exported_time: ${this.getCurrentBeijingTime()}\n`;
      content += `handler: ${page.handler || ''}\n`;
      content += `published: ${page.published}\n`;

      if (page.categories && page.categories.length > 0) {
        content += `categories:\n`;
        page.categories.forEach(category => {
          content += `  - ${category}\n`;
        });
      }

      if (page.tags && page.tags.length > 0) {
        content += `tags:\n`;
        page.tags.forEach(tag => {
          content += `  - ${tag}\n`;
        });
      }

      if (page.excerpt) {
        content += `excerpt: ${page.excerpt}\n`;
      }

      if (page.featured_img) {
        content += `featured_img: ${page.featured_img}\n`;
      }

      if (page.gallery_imgs && page.gallery_imgs.length > 0) {
        content += `gallery_imgs:\n`;
        page.gallery_imgs.forEach(url => {
          content += `  - ${url}\n`;
        });
      }

      // 添加自定义属性
      if (page.properties && Object.keys(page.properties).length > 0) {
        content += 'properties:\n';
        for (const [key, value] of Object.entries(page.properties)) {
          content += `  ${key}: ${JSON.stringify(value)}\n`;
        }
      }

      content += '---\n\n';
    }

    // 添加标题
    content += `# ${page.title}\n\n`;

    // 添加正文内容
    content += page.content;

    return content;
  }

  /**
   * 清理文件名，移除特殊字符
   */
  private sanitizeFilename(filename: string): string {
    // 移除或替换不允许的文件名字符
    return filename
      .replace(/[<>:"/\\|?*]/g, '-')  // 替换特殊字符为 -
      .replace(/\s+/g, '-')            // 替换空格为 -
      .replace(/-+/g, '-')             // 合并多个 -
      .replace(/^-|-$/g, '')           // 移除开头和结尾的 -
      .substring(0, 200);              // 限制文件名长度
  }

  /**
   * 确保目录存在，不存在则创建
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      this.logger.info(`📁 创建输出目录: ${dirPath}`);
    }
  }
}

