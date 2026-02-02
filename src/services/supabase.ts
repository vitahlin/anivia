import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseConfig, NotionPageData, SupabasePageRecord } from '../types';
import { Logger } from '../utils/logger';

export class SupabaseService {
  private client: SupabaseClient;
  private logger: Logger;
  private tableName = 'anivia_notion_page';
  private configTableName = 'anivia_config';

  constructor(config: SupabaseConfig, logger: Logger) {
    this.client = createClient(config.url, config.anonKey);
    this.logger = logger;
  }

  async syncPageData(pageData: NotionPageData): Promise<void> {
    // Remove dashes from page ID
    const cleanPageId = pageData.id.replace(/-/g, '');

    // Check if page already exists
    const existingPage = await this.getPageById(cleanPageId);

    const record: Partial<SupabasePageRecord> = {
      notion_page_id: cleanPageId,
      title: pageData.title,
      content: pageData.content,
      created_time: pageData.createdTime,
      last_edited_time: pageData.lastEditedTime,
      handler: pageData.handler,
      published: pageData.published,
      draft: pageData.draft,
      archived: pageData.archived,
      categories: pageData.categories,
      tags: pageData.tags,
      excerpt: pageData.excerpt,
      featured_img: pageData.featuredImg,
      gallery_imgs: pageData.galleryImgs,
      properties: pageData.properties,
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

  async getPageById(notionPageId: string): Promise<SupabasePageRecord | null> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select('*')
      .eq('notion_page_id', notionPageId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return null;
      }
      console.error(`❌ 从 Supabase 获取页面失败: ${notionPageId}`);
      console.error(error.message || String(error));
      process.exit(1);
    }

    return data;
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

      // 2. 查询表结构
      this.logger.info('📋 检查表结构...');
      const { data: structureData, error: structureError } = await this.client
        .rpc('exec_sql', {
          sql: `
            SELECT
              column_name,
              data_type,
              is_nullable,
              column_default
            FROM information_schema.columns
            WHERE table_name = '${this.tableName}'
            ORDER BY ordinal_position;
          `
        });

      // 如果 RPC 不可用，尝试直接查询一条记录来验证结构
      if (structureError) {
        this.logger.warn('⚠️  无法查询表结构详情（RPC 不可用），尝试基本验证...');

        // 尝试查询一条记录来验证基本结构
        const { data: sampleData, error: sampleError } = await this.client
          .from(this.tableName)
          .select('*')
          .limit(1);

        if (!sampleError && sampleData) {
          result.tableStructure = {
            note: '通过样本数据推断的字段',
            fields: sampleData.length > 0 ? Object.keys(sampleData[0]) : []
          };
          this.logger.info('✅ 表结构基本验证通过');
        }
      } else {
        result.tableStructure = structureData;
        this.logger.info('✅ 表结构查询成功');
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
        'category',
        'properties',
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
