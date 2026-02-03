import { Client } from '@notionhq/client';
import { NotionConfig, AniviaImage, NotionPageData } from '../types';
import { Logger } from '../utils/logger';
import { NotionError } from '../errors/notion-error';

export class NotionService {
  private readonly client: Client;
  private logger: Logger;

  constructor(config: NotionConfig, logger: Logger) {
    this.client = new Client({ auth: config.apiKey });
    this.logger = logger;
  }

  getClient(): Client {
    return this.client;
  }

  async getPageData(pageId: string): Promise<NotionPageData> {
    const page = await this.callNotionApi(() =>
      this.client.pages.retrieve({ page_id: pageId })
    );

    this.logger.debug(`📄 页面原始数据:`);
    this.logger.debug(JSON.stringify(page, null, 2));

    // Extract page properties
    const properties = this.extractProperties(page);
    const title = this.extractTitle(page);
    const createdTime = this.extractCreatedTime(page);
    const lastEditedTime = this.extractLastEditedTime(page);
    const slug = this.extractSlug(page);
    const published = this.extractPublished(page);
    const draft = this.extractDraft(page);
    const archived = this.extractArchived(page);
    const categories = this.extractCategories(page);
    const tags = this.extractTags(page);
    const excerpt = this.extractExcerpt(page);
    const featuredImg = this.extractFeaturedImg(page);
    const galleryImgs = this.extractGallery(page);

    this.logger.info(`页面信息解析完成:`);
    this.logger.info(`   - ID: ${pageId}`);
    this.logger.info(`   - 创建时间: ${createdTime}`);
    this.logger.info(`   - 最后编辑: ${lastEditedTime}`);

    return {
      id: pageId,
      title,
      content: '', // Will be filled by markdown converter
      createdTime,
      lastEditedTime,
      slug,
      published,
      draft,
      archived,
      categories,
      tags,
      excerpt,
      featuredImg,
      galleryImgs,
      properties,
      images: [], // 图片将在后续从 Markdown 中提取
      postOrigin: 'notion', // NotionService 返回的数据默认来源为 notion
      postType: '' // 默认为空字符串
    };
  }

  async getPageBlocks(pageId: string): Promise<any[]> {
    this.logger.info(`📄 开始获取页面块数据: ${pageId}`);

    // Fetch all blocks with pagination
    const allBlocks = await this.fetchBlocksWithPagination(pageId);

    // Recursively fetch child blocks
    for (const block of allBlocks) {
      if (block.has_children) {
        this.logger.info(`🔄 获取子块: ${block.id}`);
        block.children = await this.getPageBlocks(block.id);
      }
    }

    this.logger.info(`✅ 页面块获取完成，总计 ${allBlocks.length} 个顶级块`);
    return allBlocks;
  }

  /**
   * 封装 Notion API 调用，统一处理错误
   */
  private async callNotionApi<T>(apiCall: () => Promise<T>): Promise<T> {
    try {
      return await apiCall();
    } catch (error: any) {
      const notionError = NotionError.fromNotionApiError(error);
      console.error('❌ Notion API 调用失败');
      console.error(notionError.message);
      if (notionError.code) {
        console.error(`错误代码: ${notionError.code}`);
      }
      if (notionError.status) {
        console.error(`HTTP 状态码: ${notionError.status}`);
      }
      process.exit(1);
    }
  }

  /**
   * 分页获取块列表
   * @param blockId 块或页面的 ID
   * @returns 所有块的数组
   */
  private async fetchBlocksWithPagination(blockId: string): Promise<any[]> {
    const allBlocks: any[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.callNotionApi(() =>
        this.client.blocks.children.list({
          block_id: blockId,
          page_size: 100,
          start_cursor: cursor
        })
      );

      allBlocks.push(...response.results);
      cursor = response.next_cursor || undefined;

      this.logger.debug(`📦 获取到 ${response.results.length} 个块，总计: ${allBlocks.length}`);
    } while (cursor);

    return allBlocks;
  }

  private extractProperties(page: any): Record<string, any> {
    if ('properties' in page) {
      return page.properties;
    }
    return {};
  }

  private extractTitle(page: any): string {
    if ('properties' in page) {
      // Look for title property
      for (const [key, value] of Object.entries(page.properties)) {
        if ((value as any).type === 'title' && (value as any).title) {
          return (value as any).title.map((t: any) => t.plain_text).join('');
        }
      }
    }
    return 'Untitled';
  }

  private extractCreatedTime(page: any): string {
    return page.created_time || new Date().toISOString();
  }

  private extractLastEditedTime(page: any): string {
    return page.last_edited_time || new Date().toISOString();
  }

  private extractSlug(page: any): string {
    if ('properties' in page) {
      for (const [key, value] of Object.entries(page.properties)) {
        if (key.toLowerCase() === 'slug' || key.toLowerCase() === 'handler' || key === '处理人') {
          const prop = value as any;
          if (prop.type === 'rich_text' && prop.rich_text && prop.rich_text.length > 0) {
            return prop.rich_text.map((t: any) => t.plain_text).join('');
          }
        }
      }
    }
    return '';
  }

  private extractPublished(page: any): boolean {
    if ('properties' in page) {
      for (const [key, value] of Object.entries(page.properties)) {
        if (key.toLowerCase() === 'published' || key === '发布' || key === 'Published') {
          const prop = value as any;
          if (prop.type === 'checkbox') {
            return prop.checkbox || false;
          }
        }
      }
    }
    return false;
  }

  private extractDraft(page: any): boolean {
    if ('properties' in page) {
      for (const [key, value] of Object.entries(page.properties)) {
        if (key.toLowerCase() === 'draft' || key === '草稿' || key === 'Draft') {
          const prop = value as any;
          if (prop.type === 'checkbox') {
            return prop.checkbox || false;
          }
        }
      }
    }
    return false;
  }

  private extractArchived(page: any): boolean {
    if ('properties' in page) {
      for (const [key, value] of Object.entries(page.properties)) {
        if (key.toLowerCase() === 'archived' || key === '归档' || key === 'Archived') {
          const prop = value as any;
          if (prop.type === 'checkbox') {
            return prop.checkbox || false;
          }
        }
      }
    }
    return false;
  }

  private extractCategories(page: any): string[] {
    if ('properties' in page) {
      for (const [key, value] of Object.entries(page.properties)) {
        if (key.toLowerCase() === 'categories' || key.toLowerCase() === 'category' || key === '分类') {
          const prop = value as any;
          // 支持 multi_select（多选）
          if (prop.type === 'multi_select' && prop.multi_select) {
            return prop.multi_select.map((s: any) => s.name);
          }
          // 兼容旧的 select（单选），转换为数组
          if (prop.type === 'select' && prop.select) {
            return [prop.select.name];
          }
        }
      }
    }
    return [];
  }

  private extractTags(page: any): string[] {
    if ('properties' in page) {
      for (const [key, value] of Object.entries(page.properties)) {
        if (key.toLowerCase() === 'tags' || key === '标签' || key === 'Tags') {
          const prop = value as any;
          if (prop.type === 'multi_select' && prop.multi_select) {
            return prop.multi_select.map((s: any) => s.name);
          }
        }
      }
    }
    return [];
  }

  private extractExcerpt(page: any): string {
    if ('properties' in page) {
      for (const [key, value] of Object.entries(page.properties)) {
        if (key.toLowerCase() === 'excerpt' || key === '摘要' || key === '简介') {
          const prop = value as any;
          if (prop.type === 'rich_text' && prop.rich_text && prop.rich_text.length > 0) {
            return prop.rich_text.map((t: any) => t.plain_text).join('');
          }
        }
      }
    }
    return '';
  }

  private extractFeaturedImg(page: any): string {
    if ('properties' in page) {
      for (const [key, prop] of Object.entries(page.properties)) {
        // Check for featured image property
        if (key === '配图' ||
            key.toLowerCase() === 'featured image' ||
            key.toLowerCase() === 'featured img' ||
            key === 'Featured Img' ||
            key.toLowerCase() === 'cover') {
          const propValue = prop as any;

          // Handle files property type (uploaded images)
          if (propValue.type === 'files' && propValue.files && propValue.files.length > 0) {
            const file = propValue.files[0];
            if (file.type === 'external') {
              return file.external.url;
            } else if (file.type === 'file') {
              return file.file.url;
            }
          }

          // Handle URL property type (text URL)
          if (propValue.type === 'url' && propValue.url) {
            return propValue.url;
          }

          // Handle rich_text property type (text with URL)
          if (propValue.type === 'rich_text' && propValue.rich_text && propValue.rich_text.length > 0) {
            const text = propValue.rich_text[0].plain_text;
            if (text && text.trim()) {
              return text.trim();
            }
          }
        }
      }
    }
    return '';
  }

  private extractGallery(page: any): string[] {
    if ('properties' in page) {
      for (const [key, prop] of Object.entries(page.properties)) {
        // Check for gallery property
        if (key === '组图' ||
            key.toLowerCase() === 'gallery' ||
            key.toLowerCase() === 'gallery imgs' ||
            key === 'Gallery Imgs' ||
            key.toLowerCase() === 'images') {
          const propValue = prop as any;

          // Handle files property type
          if (propValue.type === 'files' && propValue.files && propValue.files.length > 0) {
            const urls: string[] = [];
            for (const file of propValue.files) {
              if (file.type === 'external') {
                urls.push(file.external.url);
              } else if (file.type === 'file') {
                urls.push(file.file.url);
              }
            }
            return urls;
          }
        }
      }
    }
    return [];
  }



  /**
   * 查询数据库中指定时间范围内更新的页面
   */
  async queryDatabaseByTimeRange(
    databaseId: string,
    startTime: string,
    endTime: string
  ): Promise<Array<{ id: string; title: string; lastEditedTime: string }>> {
    const response = await this.callNotionApi(() =>
      this.client.databases.query({
        database_id: databaseId,
        filter: {
          and: [
            {
              timestamp: 'last_edited_time',
              last_edited_time: {
                on_or_after: startTime
              }
            },
            {
              timestamp: 'last_edited_time',
              last_edited_time: {
                on_or_before: endTime
              }
            }
          ]
        },
        sorts: [
          {
            timestamp: 'last_edited_time',
            direction: 'descending'
          }
        ]
      })
    );

    return response.results.map((page: any) => {
      let title = 'Untitled';
      if (page.properties) {
        for (const [key, value] of Object.entries(page.properties)) {
          if ((value as any).type === 'title' && (value as any).title) {
            title = (value as any).title.map((t: any) => t.plain_text).join('');
            break;
          }
        }
      }

      return {
        id: page.id,
        title,
        lastEditedTime: page.last_edited_time
      };
    });
  }

  /**
   * 验证 Notion API 配置
   */
  async validateNotion(): Promise<{
    success: boolean;
    apiKeyValid: boolean;
    canAccessPages: boolean;
    userInfo?: any;
    testPageId?: string;
    testPageTitle?: string;
    errors: string[];
  }> {
    const result: {
      success: boolean;
      apiKeyValid: boolean;
      canAccessPages: boolean;
      userInfo?: any;
      testPageId?: string;
      testPageTitle?: string;
      errors: string[];
    } = {
      success: false,
      apiKeyValid: false,
      canAccessPages: false,
      errors: []
    };

    // 1. 测试 API Key 是否有效 - 获取当前用户信息
    this.logger.info('🔑 测试 Notion API Key...');
    try {
      const user = await this.callNotionApi(() => this.client.users.me({}));
      result.apiKeyValid = true;
      result.userInfo = {
        type: user.type,
        id: user.id,
        name: (user as any).name || 'Bot User'
      };
      this.logger.info('✅ API Key 有效');
      this.logger.info(`   - 用户类型: ${user.type}`);
      this.logger.info(`   - 用户 ID: ${user.id}`);
    } catch (error: any) {
      result.errors.push(`API Key 无效: ${error.message}`);
      this.logger.error('❌ API Key 无效:', error.message);
      return result;
    }

    // 2. 测试是否能访问页面 - 搜索最近的页面
    this.logger.info('📄 测试页面访问权限...');
    try {
      const searchResult = await this.callNotionApi(() =>
        this.client.search({
          filter: {
            property: 'object',
            value: 'page'
          },
          page_size: 1,
          sort: {
            direction: 'descending',
            timestamp: 'last_edited_time'
          }
        })
      );

      if (searchResult.results.length > 0) {
          result.canAccessPages = true;
          const page = searchResult.results[0] as any;
          result.testPageId = page.id;

          // 尝试提取标题
          if (page.properties) {
            const titleProp = Object.values(page.properties).find(
              (prop: any) => prop.type === 'title'
            ) as any;
            if (titleProp && titleProp.title && titleProp.title.length > 0) {
              result.testPageTitle = titleProp.title[0].plain_text;
            }
          }

          this.logger.info('✅ 可以访问页面');
          this.logger.info(`   - 找到页面: ${result.testPageTitle || '(无标题)'}`);
          this.logger.info(`   - 页面 ID: ${result.testPageId}`);
        } else {
          result.errors.push('无法找到任何可访问的页面');
          this.logger.warn('⚠️  无法找到任何可访问的页面');
          this.logger.warn('   请确保 Integration 已被添加到至少一个页面');
        }
      } catch (error: any) {
        result.errors.push(`无法访问页面: ${error.message}`);
        this.logger.error('❌ 无法访问页面:', error.message);
      }

      // 3. 如果找到了测试页面，尝试读取其内容
      if (result.testPageId) {
        this.logger.info('📖 测试读取页面内容...');
        try {
          await this.callNotionApi(() =>
            this.client.pages.retrieve({
              page_id: result.testPageId!
            })
          );

          const blocks = await this.callNotionApi(() =>
            this.client.blocks.children.list({
              block_id: result.testPageId!,
              page_size: 10
            })
          );

          this.logger.info('✅ 可以读取页面内容');
          this.logger.info(`   - 页面块数量: ${blocks.results.length}`);
        } catch (error: any) {
          result.errors.push(`无法读取页面内容: ${error.message}`);
          this.logger.error('❌ 无法读取页面内容:', error.message);
        }
      }

    result.success = result.apiKeyValid && result.canAccessPages && result.errors.length === 0;
    return result;
  }
}
