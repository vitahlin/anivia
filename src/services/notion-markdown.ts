import { NotionToMarkdown } from 'notion-to-md';
import { Client } from '@notionhq/client';
import { Logger } from '../utils/logger';

export class NotionMarkdownConverter {
  private n2m: NotionToMarkdown;
  private logger: Logger;

  constructor(notionClient: Client, logger: Logger) {
    this.logger = logger;
    this.n2m = new NotionToMarkdown({ notionClient });
  }

  async convertPageToMarkdown(pageId: string): Promise<string> {
    this.logger.debug(`📝 开始使用 notion-to-md 转换页面: ${pageId}`);
    try {

      // 获取页面的 Markdown 块
      const mdBlocks = await this.n2m.pageToMarkdown(pageId);

      this.logger.debug(`📦 获取到 ${mdBlocks.length} 个 Markdown 块`);
      this.logger.debug(`📄 Markdown 块数据:`);
      this.logger.debug(JSON.stringify(mdBlocks, null, 2));

      // 转换为 Markdown 字符串
      const markdownString = this.n2m.toMarkdownString(mdBlocks);

      this.logger.debug(`📝 转换完成，Markdown 长度: ${markdownString.parent.length} 字符`);
      this.logger.debug(`📄 生成的原始 Markdown 内容:`);
      this.logger.debug(markdownString.parent);

      return markdownString.parent;
    } catch (error) {
      this.logger.error(`❌ Markdown 转换失败:`, error);
      throw error;
    }
  }



  // 获取支持的块类型
  getSupportedBlockTypes(): string[] {
    return [
      'paragraph',
      'heading_1',
      'heading_2',
      'heading_3',
      'bulleted_list_item',
      'numbered_list_item',
      'to_do',
      'toggle',
      'child_page',
      'child_database',
      'embed',
      'image',
      'video',
      'file',
      'pdf',
      'bookmark',
      'callout',
      'quote',
      'equation',
      'divider',
      'table_of_contents',
      'column',
      'column_list',
      'link_preview',
      'synced_block',
      'template',
      'link_to_page',
      'table',
      'table_row',
      'code'
    ];
  }
}
