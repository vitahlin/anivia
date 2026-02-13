import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseConfig, NotionPageData, SupabasePageRecord } from '../types';
import { Logger } from '../utils/logger';

export class SupabaseService {
  private client: SupabaseClient;
  private logger: Logger;
  private tableName = 'sonder_post';
  private configTableName = 'anivia_config';

  constructor(config: SupabaseConfig, logger: Logger) {
    this.client = createClient(config.url, config.anonKey);
    this.logger = logger;
  }

  async syncPageData(pageData: NotionPageData): Promise<void> {
    // Remove dashes from page ID (for Notion pages)
    const cleanPageId = pageData.id.replace(/-/g, '');

    // Check if page already exists
    // Priority: 1. Check by slug (unique constraint), 2. Check by post_origin + identifier
    let existingPage: SupabasePageRecord | null = null;

    if (pageData.slug) {
      // First, try to find by slug (since slug is unique across the table)
      existingPage = await this.getPageBySlug(pageData.slug);
    }

    if (!existingPage) {
      // If not found by slug, try to find by post_origin + identifier
      existingPage = await this.getPageByOrigin(
        pageData.postOrigin,
        pageData.postOrigin === 'notion' ? cleanPageId : pageData.slug
      );
    }

    const record: Partial<SupabasePageRecord> = {
      notion_page_id: pageData.postOrigin === 'notion' ? cleanPageId : '',
      title: pageData.title,
      content: pageData.content,
      created_time: pageData.createdTime,
      last_edited_time: pageData.lastEditedTime,
      slug: pageData.slug,
      published: pageData.published,
      draft: pageData.draft,
      archived: pageData.archived,
      categories: pageData.categories,
      tags: pageData.tags,
      excerpt: pageData.excerpt,
      featured_img: pageData.featuredImg,
      gallery_imgs: pageData.galleryImgs,
      properties: pageData.properties,
      post_origin: pageData.postOrigin,
      post_type: pageData.postType,
      updated_at: new Date().toISOString()
    };

    if (existingPage) {
      // Update existing record
      await this.updatePage(existingPage.id, record);
    } else {
      // Insert new record
      record.created_at = new Date().toISOString();
      await this.insertPage(record);
    }
  }

  /**
   * 根据来源和标识符获取页面
   * - Notion: 使用 notion_page_id
   * - Obsidian: 使用 slug
   */
  async getPageByOrigin(postOrigin: 'notion' | 'obsidian', identifier: string): Promise<SupabasePageRecord | null> {
    const query = this.client
      .from(this.tableName)
      .select('*')
      .eq('post_origin', postOrigin);

    if (postOrigin === 'notion') {
      query.eq('notion_page_id', identifier);
    } else {
      query.eq('slug', identifier);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error(`❌ 从 Supabase 获取页面失败 (${postOrigin}): ${identifier}`);
      console.error(error.message || String(error));
      process.exit(1);
    }

    return data;
  }

  /**
   * 根据 slug 获取页面
   * 由于 slug 是全局唯一的，不需要指定 post_origin
   */
  async getPageBySlug(slug: string): Promise<SupabasePageRecord | null> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select('*')
      .eq('slug', slug)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error(`❌ 从 Supabase 获取页面失败 (slug): ${slug}`);
      console.error(error.message || String(error));
      process.exit(1);
    }

    return data;
  }

  /**
   * 根据 Notion Page ID 获取页面（向后兼容）
   */
  async getPageById(notionPageId: string): Promise<SupabasePageRecord | null> {
    return this.getPageByOrigin('notion', notionPageId);
  }

  private async insertPage(record: Partial<SupabasePageRecord>): Promise<SupabasePageRecord> {
    const { data, error } = await this.client
      .from(this.tableName)
      .insert(record)
      .select()
      .single();

    if (error) {
      console.error('❌ 插入页面到 Supabase 失败');
      console.error(error.message || String(error));
      process.exit(1);
    }

    return data;
  }

  private async updatePage(id: number, record: Partial<SupabasePageRecord>): Promise<SupabasePageRecord> {
    const { data, error } = await this.client
      .from(this.tableName)
      .update(record)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error(`❌ 更新 Supabase 页面失败 (ID: ${id})`);
      console.error(error.message || String(error));
      process.exit(1);
    }

    return data;
  }

  async getAllPages(): Promise<SupabasePageRecord[]> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ 从 Supabase 获取所有页面失败');
      console.error(error.message || String(error));
      process.exit(1);
    }

    return data || [];
  }

  async deletePage(notionPageId: string): Promise<void> {
    const { error } = await this.client
      .from(this.tableName)
      .delete()
      .eq('notion_page_id', notionPageId);

    if (error) {
      console.error(`❌ 从 Supabase 删除页面失败: ${notionPageId}`);
      console.error(error.message || String(error));
      process.exit(1);
    }

    this.logger.info(`Deleted page: ${notionPageId}`);
  }

  /**
   * 验证 Supabase 配置和表结构
   */
  async validateSupabase(): Promise<{
    success: boolean;
    connection: boolean;
    tableExists: boolean;
    tableStructure?: any;
    recordCount?: number;
    errors: string[];
  }> {
    const result: {
      success: boolean;
      connection: boolean;
      tableExists: boolean;
      tableStructure?: any;
      recordCount?: number;
      errors: string[];
    } = {
      success: false,
      connection: false,
      tableExists: false,
      errors: []
    };

    try {
      // 1. 测试连接
      this.logger.info('🔌 测试 Supabase 连接...');
      const { error: connectionError } = await this.client
        .from(this.tableName)
        .select('id')
        .limit(1);

      if (connectionError) {
        if (connectionError.code === '42P01') {
          // 表不存在
          result.errors.push(`表 "${this.tableName}" 不存在`);
          this.logger.error(`❌ 表 "${this.tableName}" 不存在`);
          return result;
        } else {
          result.errors.push(`连接失败: ${connectionError.message}`);
          this.logger.error('❌ Supabase 连接失败:', connectionError.message);
          return result;
        }
      }

      result.connection = true;
      result.tableExists = true;
      this.logger.info('✅ Supabase 连接成功');
      this.logger.info(`✅ 表 "${this.tableName}" 存在`);

      // 2. 查询表结构（通过样本数据）
      this.logger.info('📋 检查表结构...');
      const { data: sampleData, error: sampleError } = await this.client
        .from(this.tableName)
        .select('*')
        .limit(1);

      if (!sampleError && sampleData) {
        result.tableStructure = {
          fields: sampleData.length > 0 ? Object.keys(sampleData[0]) : []
        };
        this.logger.info('✅ 表结构验证通过');
      } else if (sampleError) {
        this.logger.warn('⚠️  无法查询表结构（表可能为空）');
      }

      // 3. 统计记录数
      this.logger.info('📊 统计记录数...');
      const { count, error: countError } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true });

      if (countError) {
        result.errors.push(`统计记录数失败: ${countError.message}`);
        this.logger.warn('⚠️  无法统计记录数:', countError.message);
      } else {
        result.recordCount = count || 0;
        this.logger.info(`✅ 当前记录数: ${count || 0}`);
      }

      // 4. 验证必需字段
      this.logger.info('🔍 验证必需字段...');
      const requiredFields = [
        'id',
        'notion_page_id',
        'title',
        'content',
        'created_time',
        'last_edited_time',
        'slug',
        'published',
        'draft',
        'archived',
        'categories',
        'tags',
        'excerpt',
        'featured_img',
        'gallery_imgs',
        'properties',
        'post_origin',
        'post_type',
        'created_at',
        'updated_at'
      ];

      const { data: testData, error: testError } = await this.client
        .from(this.tableName)
        .select(requiredFields.join(','))
        .limit(1);

      if (testError) {
        result.errors.push(`字段验证失败: ${testError.message}`);
        this.logger.error('❌ 字段验证失败:', testError.message);
      } else {
        this.logger.info('✅ 所有必需字段验证通过');
      }

      result.success = result.connection && result.tableExists && result.errors.length === 0;
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`验证过程出错: ${errorMessage}`);
      this.logger.error('❌ 验证过程出错:', error);
      return result;
    }
  }

  /**
   * 更新配置表中的最后同步时间
   * 用于防止 Supabase 免费版因长时间无操作而归档数据库
   */
  async updateLastSyncTime(): Promise<void> {
    try {
      // 获取当前 UTC 时间
      const utcNow = new Date();

      // 转换为北京时间（UTC+8）
      const beijingTime = new Date(utcNow.getTime() + 8 * 60 * 60 * 1000);

      // 格式化为 ISO 8601 格式，带时区信息：yyyy-MM-ddTHH:mm:ss+08:00
      const year = beijingTime.getUTCFullYear();
      const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
      const day = String(beijingTime.getUTCDate()).padStart(2, '0');
      const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
      const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
      const seconds = String(beijingTime.getUTCSeconds()).padStart(2, '0');

      const beijingTimeStr = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+08:00`;

      const { error } = await this.client
        .from(this.configTableName)
        .upsert({
          config_key: 'last_notion_sync_time',
          config_value: beijingTimeStr,
          description: '最近一次 Notion 页面同步时间（北京时间，ISO 8601 格式）',
          updated_at: utcNow.toISOString()
        }, {
          onConflict: 'config_key'
        });

      if (error) {
        this.logger.warn('⚠️  更新配置表失败（不影响主流程）:', error.message);
      } else {
        this.logger.debug(`✅ 已更新最后同步时间: ${beijingTimeStr}`);
      }
    } catch (error) {
      // 配置表更新失败不应该影响主流程
      this.logger.warn('⚠️  更新配置表时出错（不影响主流程）:', error);
    }
  }
}
