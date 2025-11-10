import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseConfig, NotionPageData, SupabasePageRecord } from '../types';
import { Logger } from '../utils/logger';

export class SupabaseService {
  private client: SupabaseClient;
  private logger: Logger;
  private tableName = 'zilean_notion_page';

  constructor(config: SupabaseConfig, logger: Logger) {
    this.client = createClient(config.url, config.anonKey);
    this.logger = logger;
  }

  async syncPageData(pageData: NotionPageData): Promise<void> {
    try {
      // Check if page already exists
      const existingPage = await this.getPageById(pageData.id);

      const record: Partial<SupabasePageRecord> = {
        notion_page_id: pageData.id,
        title: pageData.title,
        content: pageData.content,
        created_time: pageData.createdTime,
        last_edited_time: pageData.lastEditedTime,
        handler: pageData.handler,
        published: pageData.published,
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
    } catch (error) {
      this.logger.error(`Failed to sync page data for ${pageData.id}:`, error);
      throw error;
    }
  }

  private async getPageById(notionPageId: string): Promise<SupabasePageRecord | null> {
    try {
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
        throw error;
      }

      return data;
    } catch (error) {
      this.logger.error(`Failed to get page by ID ${notionPageId}:`, error);
      throw error;
    }
  }

  private async insertPage(record: Partial<SupabasePageRecord>): Promise<SupabasePageRecord> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .insert(record)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      this.logger.error('Failed to insert page:', error);
      throw error;
    }
  }

  private async updatePage(id: number, record: Partial<SupabasePageRecord>): Promise<SupabasePageRecord> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .update(record)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      this.logger.error(`Failed to update page ${id}:`, error);
      throw error;
    }
  }

  async getAllPages(): Promise<SupabasePageRecord[]> {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      this.logger.error('Failed to get all pages:', error);
      throw error;
    }
  }

  async deletePage(notionPageId: string): Promise<void> {
    try {
      const { error } = await this.client
        .from(this.tableName)
        .delete()
        .eq('notion_page_id', notionPageId);

      if (error) {
        throw error;
      }

      this.logger.info(`Deleted page: ${notionPageId}`);
    } catch (error) {
      this.logger.error(`Failed to delete page ${notionPageId}:`, error);
      throw error;
    }
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
}
