#!/usr/bin/env node

import { Command } from 'commander';
import { getConfig } from './utils/config';
import { Logger } from './utils/logger';
import { SyncService } from './services/sync';
import { ExportService } from './services/export';
import { SupabaseService } from './services/supabase';
import { NotionService } from './services/notion';
import * as path from 'path';

const program = new Command();

/**
 * 从 Notion page link 中提取 page ID
 * 支持格式：
 * - https://www.notion.so/5W2H-270baa810695804981e8e432c4fafe3a
 * - https://www.notion.so/5W2H-270baa810695804981e8e432c4fafe3a?source=copy_link
 * - 直接的 page ID: 270baa810695804981e8e432c4fafe3a
 */
function extractPageId(input: string): string {
  // 如果输入已经是一个 32 位的 page ID（去掉连字符后），直接返回
  const cleanInput = input.replace(/-/g, '');
  if (/^[a-f0-9]{32}$/i.test(cleanInput)) {
    return input;
  }

  // 尝试从 URL 中提取 page ID
  try {
    const url = new URL(input);
    const pathname = url.pathname;

    // Notion URL 格式: /Title-{pageId} 或 /{pageId}
    // pageId 通常是最后一个连字符后的 32 位十六进制字符串
    const match = pathname.match(/([a-f0-9]{32})/i);
    if (match) {
      return match[1];
    }

    // 也支持带连字符的格式
    const matchWithDashes = pathname.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (matchWithDashes) {
      return matchWithDashes[1];
    }
  } catch (e) {
    // 不是有效的 URL，可能是其他格式
    console.error("Not a valid notion page link URL");
  }

  // 如果无法解析，返回原始输入
  return input;
}

program
  .name('notion-upload')
  .description('Sync Notion pages to Supabase database with image upload to Cloudflare')
  .version('1.0.0');

program
  .command('sync')
  .description('Sync a Notion page to Supabase')
  .argument('<pageId>', 'Notion page ID or URL to sync')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-d, --debug', 'Enable debug mode (shows detailed JSON logs)')
  .action(async (pageIdOrUrl: string, options) => {
    try {
      // Load configuration
      const config = getConfig();

      // 确定日志级别：debug > verbose > config.logLevel
      let logLevel = config.logLevel;
      if (options.debug) {
        logLevel = 'debug';
      } else if (options.verbose) {
        logLevel = 'info';
      }

      const logger = new Logger(logLevel);

      // 从 URL 或 ID 中提取 page ID
      const pageId = extractPageId(pageIdOrUrl);

      logger.info('Starting Notion to Supabase sync...');
      if (pageIdOrUrl !== pageId) {
        logger.info(`Input: ${pageIdOrUrl}`);
        logger.info(`Extracted Page ID: ${pageId}`);
      } else {
        logger.info(`Page ID: ${pageId}`);
      }

      // Initialize sync service
      const syncService = new SyncService(config, logger);

      // Perform sync
      const result = await syncService.syncPage(pageId);

      if (result.success) {
        logger.info(`✅ 同步成功! 页面: ${result.pageId}, 图片处理: ${result.imagesProcessed}`);
      } else {
        logger.error(`❌ 同步失败! 页面: ${result.pageId}, 图片处理: ${result.imagesProcessed}`);
        if (result.errors) {
          result.errors.forEach(error => logger.error(`   - ${error}`));
        }
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    }
  });

program
  .command('check-notion')
  .description('Check Notion API configuration and permissions')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      const config = getConfig();
      const logger = new Logger(options.verbose ? 'debug' : config.logLevel);

      logger.info('🔍 检查 Notion API 配置...');
      logger.info('');

      // Initialize Notion service
      const notionService = new NotionService(config.notion, logger);

      // Validate Notion
      const result = await notionService.validateNotion();

      logger.info('');
      logger.info('📊 验证结果：');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Display results
      if (result.apiKeyValid) {
        logger.info('✅ API Key: 有效');
        if (result.userInfo) {
          logger.info(`   - 用户类型: ${result.userInfo.type}`);
          logger.info(`   - 用户 ID: ${result.userInfo.id}`);
          if (result.userInfo.name) {
            logger.info(`   - 用户名: ${result.userInfo.name}`);
          }
        }
      } else {
        logger.error('❌ API Key: 无效');
      }

      if (result.canAccessPages) {
        logger.info('✅ 页面访问: 可以访问');
        if (result.testPageId) {
          logger.info(`   - 测试页面: ${result.testPageTitle || '(无标题)'}`);
          logger.info(`   - 页面 ID: ${result.testPageId}`);
        }
      } else {
        logger.error('❌ 页面访问: 无法访问');
      }

      if (result.errors.length > 0) {
        logger.info('');
        logger.error('❌ 错误信息:');
        result.errors.forEach((error: string) => logger.error(`   - ${error}`));
      }

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('');

      if (result.success) {
        logger.info('🎉 Notion API 配置正常！');
        logger.info('');
        logger.info('下一步:');
        logger.info('  1. 检查数据库: npm run check-db');
        logger.info('  2. 同步页面: npm run sync <page-id>');
        if (result.testPageId) {
          logger.info('');
          logger.info('💡 提示: 你可以使用找到的测试页面:');
          logger.info(`   npm run sync ${result.testPageId}`);
        }
      } else {
        logger.error('❌ Notion API 配置有问题！');
        logger.info('');
        logger.info('解决方法:');

        if (!result.apiKeyValid) {
          logger.info('  1. 检查 .env 文件中的 NOTION_API_KEY');
          logger.info('  2. 确保 API Key 格式正确（以 secret_ 开头）');
          logger.info('  3. 在 Notion 中重新生成 Integration Token');
          logger.info('     https://www.notion.so/my-integrations');
        }

        if (!result.canAccessPages) {
          logger.info('  1. 确保 Integration 已被添加到至少一个页面');
          logger.info('  2. 在 Notion 页面中点击 "..." → "Add connections" → 选择你的 Integration');
          logger.info('  3. 或者创建一个新页面并添加 Integration');
        }

        process.exit(1);
      }

    } catch (error) {
      console.error('❌ Notion 检查失败:', error);
      process.exit(1);
    }
  });

program
  .command('check-db')
  .description('Check Supabase database configuration and table structure')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      const config = getConfig();
      const logger = new Logger(options.verbose ? 'debug' : config.logLevel);

      logger.info('🔍 检查 Supabase 数据库配置...');
      logger.info('');

      // Initialize Supabase service
      const supabaseService = new SupabaseService(config.supabase, logger);

      // Validate Supabase
      const result = await supabaseService.validateSupabase();

      logger.info('');
      logger.info('📊 验证结果：');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Display results
      if (result.connection) {
        logger.info('✅ Supabase 连接: 成功');
      } else {
        logger.error('❌ Supabase 连接: 失败');
      }

      if (result.tableExists) {
        logger.info('✅ 表存在: 是');
      } else {
        logger.error('❌ 表存在: 否');
      }

      if (result.recordCount !== undefined) {
        logger.info(`📊 记录数: ${result.recordCount}`);
      }

      if (result.tableStructure) {
        logger.info('');
        logger.info('📋 表结构:');
        if (result.tableStructure.note) {
          logger.info(`   ${result.tableStructure.note}`);
          logger.info(`   字段: ${result.tableStructure.fields.join(', ')}`);
        } else if (Array.isArray(result.tableStructure)) {
          result.tableStructure.forEach((col: any) => {
            logger.info(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : ''}`);
          });
        }
      }

      if (result.errors.length > 0) {
        logger.info('');
        logger.error('❌ 错误信息:');
        result.errors.forEach(error => logger.error(`   - ${error}`));
      }

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('');

      if (result.success) {
        logger.info('🎉 数据库配置正常！');
        logger.info('');
        logger.info('下一步:');
        logger.info('  1. 同步 Notion 页面: npm run sync <page-id>');
        logger.info('  2. 导出文章: npm run export');
      } else {
        logger.error('❌ 数据库配置有问题！');
        logger.info('');
        logger.info('解决方法:');

        if (!result.connection) {
          logger.info('  1. 检查 .env 文件中的 SUPABASE_URL 和 SUPABASE_ANON_KEY');
          logger.info('  2. 确保网络连接正常（关闭 VPN 试试）');
        }

        if (!result.tableExists) {
          logger.info('  1. 在 Supabase SQL Editor 中执行 create_table.sql');
          logger.info('  2. 或参考 DATABASE_SETUP.md 文档');
        }

        process.exit(1);
      }

    } catch (error) {
      console.error('❌ 数据库检查失败:', error);
      process.exit(1);
    }
  });

program
  .command('export')
  .description('Export all articles from Supabase to local Markdown files')
  .option('-o, --output <dir>', 'Output directory for markdown files', './anivia_export')
  .option('-v, --verbose', 'Enable verbose logging')
  .option('--no-overwrite', 'Do not overwrite existing files (skip them)')
  .option('--no-metadata', 'Do not include front matter metadata in markdown files')
  .action(async (options) => {
    try {
      // Load configuration (same as sync command)
      const config = getConfig();

      // Determine log level (same as sync command)
      const logger = new Logger(options.verbose ? 'debug' : config.logLevel);

      logger.info('🚀 开始导出文章...');
      logger.info(`📁 输出目录: ${options.output}`);

      // Initialize services using the same pattern as sync command
      // This ensures consistent initialization and configuration
      const supabaseService = new SupabaseService(config.supabase, logger);
      const exportService = new ExportService(supabaseService, logger);

      // Export all pages
      // Default behavior: overwrite existing files (overwrite: true)
      // Use --no-overwrite to skip existing files
      const result = await exportService.exportAllPages({
        outputDir: path.resolve(options.output),
        overwrite: options.overwrite !== false, // Default to true
        includeMetadata: options.metadata !== false
      });

      // Display results
      if (result.success) {
        logger.info('✅ 导出完成！');
        logger.info(`📊 总文章数: ${result.totalPages}`);
        logger.info(`✅ 成功导出: ${result.exportedPages}`);
        logger.info(`📁 输出目录: ${result.outputDir}`);
      } else {
        logger.error('❌ 导出完成，但有错误');
        logger.error(`📊 总文章数: ${result.totalPages}`);
        logger.error(`✅ 成功导出: ${result.exportedPages}`);
        logger.error(`❌ 失败数量: ${result.errors.length}`);
        result.errors.forEach(error => logger.error(`   - ${error}`));
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ 导出失败:', error);
      process.exit(1);
    }
  });

program
  .command('query-updated-page')
  .description('Query pages updated in a time range from Notion database')
  .argument('<databaseId>', 'Notion database ID')
  .argument('[startTime]', 'Start time in format yyyyMMddHHmmss (default: 20000101000000)')
  .argument('[endTime]', 'End time in format yyyyMMddHHmmss (default: current time)')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (databaseId: string, startTime: string | undefined, endTime: string | undefined, options) => {
    try {
      const config = getConfig();
      const logger = new Logger(options.verbose ? 'debug' : config.logLevel);

      // Parse time strings
      const parseTime = (timeStr: string): Date => {
        const year = parseInt(timeStr.substring(0, 4));
        const month = parseInt(timeStr.substring(4, 6)) - 1;
        const day = parseInt(timeStr.substring(6, 8));
        const hour = parseInt(timeStr.substring(8, 10));
        const minute = parseInt(timeStr.substring(10, 12));
        const second = parseInt(timeStr.substring(12, 14));
        return new Date(year, month, day, hour, minute, second);
      };

      // 如果没有提供 startTime，默认使用 2000-01-01 00:00:00
      const defaultStartTime = '20000101000000';
      const start = parseTime(startTime || defaultStartTime);

      // 如果没有提供 endTime，默认使用当前时间
      const end = endTime ? parseTime(endTime) : new Date();

      logger.info('🔍 查询更新的页面...');
      logger.info(`📊 数据库 ID: ${databaseId}`);
      logger.info(`⏰ 开始时间: ${start.toISOString()}`);
      logger.info(`⏰ 结束时间: ${end.toISOString()}`);

      const notionService = new NotionService(config.notion, logger);
      const pages = await notionService.queryDatabaseByTimeRange(
        databaseId,
        start.toISOString(),
        end.toISOString()
      );

      logger.info('');
      logger.info(`✅ 找到 ${pages.length} 个更新的页面:`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      pages.forEach((page, index) => {
        logger.info(`${index + 1}. ${page.title || '(无标题)'}`);
        logger.info(`   ID: ${page.id}`);
        logger.info(`   最后编辑: ${page.lastEditedTime}`);
      });

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (error) {
      console.error('❌ 查询失败:', error);
      process.exit(1);
    }
  });

program
  .command('sync-updated-page')
  .description('Query and sync pages updated in a time range from Notion database to Supabase')
  .argument('<databaseId>', 'Notion database ID')
  .argument('[startTime]', 'Start time in format yyyyMMddHHmmss (default: 20000101000000)')
  .argument('[endTime]', 'End time in format yyyyMMddHHmmss (default: current time)')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (databaseId: string, startTime: string | undefined, endTime: string | undefined, options) => {
    try {
      const config = getConfig();
      const logger = new Logger(options.verbose ? 'debug' : config.logLevel);

      const parseTime = (timeStr: string): Date => {
        const year = parseInt(timeStr.substring(0, 4));
        const month = parseInt(timeStr.substring(4, 6)) - 1;
        const day = parseInt(timeStr.substring(6, 8));
        const hour = parseInt(timeStr.substring(8, 10));
        const minute = parseInt(timeStr.substring(10, 12));
        const second = parseInt(timeStr.substring(12, 14));
        return new Date(year, month, day, hour, minute, second);
      };

      // 如果没有提供 startTime，默认使用 2000-01-01 00:00:00
      const defaultStartTime = '20000101000000';
      const start = parseTime(startTime || defaultStartTime);

      // 如果没有提供 endTime，默认使用当前时间
      const end = endTime ? parseTime(endTime) : new Date();

      logger.info('🔍 查询并同步更新的页面...');
      logger.info(`📊 数据库 ID: ${databaseId}`);
      logger.info(`⏰ 开始时间: ${start.toISOString()}`);
      logger.info(`⏰ 结束时间: ${end.toISOString()}`);

      const notionService = new NotionService(config.notion, logger);
      const pages = await notionService.queryDatabaseByTimeRange(
        databaseId,
        start.toISOString(),
        end.toISOString()
      );

      logger.info('');
      logger.info(`✅ 找到 ${pages.length} 个更新的页面`);

      if (pages.length === 0) {
        logger.info('没有需要同步的页面');
        return;
      }

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('🚀 开始同步页面到 Supabase...');
      logger.info('');

      const syncService = new SyncService(config, logger);
      let successCount = 0;
      let skippedCount = 0;
      let failCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        logger.info(`[${i + 1}/${pages.length}] 同步: ${page.title || '(无标题)'}`);
        logger.info(`   ID: ${page.id}`);

        try {
          const result = await syncService.syncPage(page.id);
          if (result.success) {
            if (result.skipped) {
              skippedCount++;
              logger.info(`   ⏭️  跳过 (未更新)`);
            } else {
              successCount++;
              logger.info(`   ✅ 成功 (处理 ${result.imagesProcessed} 张图片)`);
            }
          } else {
            failCount++;
            const errorMsg = `${page.title || page.id}: ${result.message}`;
            errors.push(errorMsg);
            logger.error(`   ❌ 失败: ${result.message}`);
          }
        } catch (error: any) {
          failCount++;
          const errorMsg = `${page.title || page.id}: ${error.message}`;
          errors.push(errorMsg);
          logger.error(`   ❌ 异常: ${error.message}`);
        }

        logger.info('');
      }

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('📊 同步完成统计:');
      logger.info(`   总计: ${pages.length} 个页面`);
      logger.info(`   ✅ 成功: ${successCount}`);
      logger.info(`   ⏭️  跳过: ${skippedCount}`);
      logger.info(`   ❌ 失败: ${failCount}`);

      if (errors.length > 0) {
        logger.info('');
        logger.info('失败详情:');
        errors.forEach((error, index) => {
          logger.error(`   ${index + 1}. ${error}`);
        });
      }

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      if (failCount > 0) {
        process.exit(1);
      }

    } catch (error) {
      console.error('❌ 同步失败:', error);
      process.exit(1);
    }
  });

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

program.parse();
