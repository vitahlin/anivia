#!/usr/bin/env node

import {Command} from 'commander';
import {getConfig} from './utils/config';
import {Logger} from './utils/logger';
import {SyncService} from './services/sync';
import {ExportService} from './services/export';
import {SupabaseService} from './services/supabase';
import {NotionService} from './services/notion';
import {ObsidianSyncService} from './services/obsidian-sync';
import {extractPageId} from './utils/notionUtil';
import * as path from 'path';
import * as fs from 'fs';

const program = new Command();

program
    .name('anivia')
    .description('Sync Notion pages to Supabase database with image upload to Cloudflare')
    .version('1.0.0');

program
    .command('sync-notion-page')
    .description('Sync a Notion page to Supabase')
    .argument('<pageId>', 'Notion page ID or URL to sync')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-d, --debug', 'Enable debug mode (shows detailed JSON logs)')
    .action(async (pageIdOrUrl: string, options) => {
        const config = getConfig();

        // 确定日志级别：debug > verbose > config.logLevel
        let logLevel = config.logLevel;
        if (options.debug) {
            logLevel = 'debug';
        } else if (options.verbose) {
            logLevel = 'info';
        }

        const logger = new Logger(logLevel);

        // 从 URL 或 ID 中提取 page ID（解析失败会直接退出）
        const pageId = extractPageId(pageIdOrUrl);

        logger.info('Starting Notion to Supabase sync...');
        if (pageIdOrUrl !== pageId) {
            logger.info(`Input: ${pageIdOrUrl}`);
            logger.info(`Extracted Page ID: ${pageId}`);
        } else {
            logger.info(`Page ID: ${pageId}`);
        }

        // 初始化同步服务
        const syncService = new SyncService(config, logger);

        // 执行同步（可能抛出异常）
        let result;
        try {
            result = await syncService.syncPage(pageId);
        } catch (error) {
            logger.error('❌ 同步过程中发生致命错误:');
            logger.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }

        // 处理同步结果
        if (result.success) {
            logger.info(`✅ 同步成功! 页面: ${result.pageId}, 图片处理: ${result.imagesProcessed}`);
        } else {
            logger.error(`❌ 同步失败! 页面: ${result.pageId}, 图片处理: ${result.imagesProcessed}`);
            if (result.errors) {
                result.errors.forEach(error => logger.error(`   - ${error}`));
            }
            process.exit(1);
        }
    });


program
    .command('sync-obsidian')
    .description('Sync Obsidian Markdown file(s) to Supabase')
    .argument('<path>', 'Path to Obsidian Markdown file or directory')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-d, --debug', 'Enable debug mode (shows detailed JSON logs)')
    .option('-r, --recursive', 'Recursively sync all Markdown files in subdirectories', true)
    .action(async (inputPath: string, options) => {
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

        // 解析路径（支持相对路径和绝对路径）
        const absolutePath = path.isAbsolute(inputPath)
            ? inputPath
            : path.resolve(process.cwd(), inputPath);

        // 检查路径是否存在
        if (!fs.existsSync(absolutePath)) {
            logger.error(`❌ Path not found: ${absolutePath}`);
            process.exit(1);
        }

        // 获取所有需要同步的 Markdown 文件
        const getMarkdownFiles = (dirPath: string, recursive: boolean): string[] => {
            const files: string[] = [];
            const stats = fs.statSync(dirPath);

            if (stats.isFile()) {
                // 如果是文件，检查是否是 .md 文件
                if (dirPath.endsWith('.md')) {
                    files.push(dirPath);
                } else {
                    logger.error(`❌ Not a Markdown file: ${dirPath}`);
                    process.exit(1);
                }
            } else if (stats.isDirectory()) {
                // 如果是目录，遍历所有文件
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);

                    if (entry.isFile() && entry.name.endsWith('.md')) {
                        files.push(fullPath);
                    } else if (entry.isDirectory() && recursive) {
                        // 递归处理子目录
                        files.push(...getMarkdownFiles(fullPath, recursive));
                    }
                }
            }

            return files;
        };

        const markdownFiles = getMarkdownFiles(absolutePath, options.recursive);

        if (markdownFiles.length === 0) {
            logger.error(`❌ No Markdown files found in: ${absolutePath}`);
            process.exit(1);
        }

        logger.info('Starting Obsidian Markdown to Supabase sync...');
        logger.info(`Path: ${absolutePath}`);
        logger.info(`Found ${markdownFiles.length} Markdown file(s)`);
        logger.info(`Recursive: ${options.recursive ? 'Yes' : 'No'}`);
        logger.info('');

        // Initialize Obsidian sync service
        const obsidianSyncService = new ObsidianSyncService(config, logger);

        let successCount = 0;

        // 同步所有文件
        let skippedCount = 0;

        for (let i = 0; i < markdownFiles.length; i++) {
            const file = markdownFiles[i];
            const relativePath = path.relative(absolutePath, file);
            const displayPath = relativePath || path.basename(file);

            logger.info(`[${i + 1}/${markdownFiles.length}] Syncing: ${displayPath}`);

            const result = await obsidianSyncService.syncObsidianFile(file);

            if (result.success) {
                if (result.skipped) {
                    skippedCount++;
                    logger.info(`   ⏭️  Skipped: ${result.message}`);
                } else {
                    successCount++;
                    logger.info(`   ✅ Success (Page: ${result.pageId}, Images: ${result.imagesProcessed})`);
                }
            } else {
                const errorMsg = result.errors?.join(', ') || result.message || 'Unknown error';
                logger.error(`   ❌ Failed: ${errorMsg}`);
                logger.error('');
                logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                logger.error(`❌ Sync failed at file: ${displayPath}`);
                logger.error(`   Error: ${errorMsg}`);
                logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                process.exit(1);
            }

            logger.info('');
        }

        // 输出统计信息
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        logger.info('✅ All files processed successfully!');
        logger.info(`   Total: ${markdownFiles.length} file(s)`);
        logger.info(`   ✅ Synced: ${successCount}`);
        if (skippedCount > 0) {
            logger.info(`   ⏭️  Skipped: ${skippedCount}`);
        }
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    });

program
    .command('verify-config-notion')
    .description('Verify Notion API configuration and permissions')
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
    .command('verify-config-supabase')
    .description('Verify Supabase database configuration and table structure')
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
            // Load configuration - export only needs Supabase, skip Notion and Cloudflare validation
            const config = getConfig({
                skipNotionValidation: true,
                skipCloudflareValidation: true
            });

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
    .command('query-notion-database-updated-pages')
    .description('Query pages updated in a time range from Notion database')
    .argument('<databaseId>', 'Notion database ID')
    .argument('[startTime]', 'Start time in format yyyyMMddHHmmss (default: 20000101000000)')
    .argument('[endTime]', 'End time in format yyyyMMddHHmmss (default: current time)')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (databaseId: string, startTime: string | undefined, endTime: string | undefined, options) => {
        try {
            const config = getConfig();
            const logger = new Logger(options.verbose ? 'debug' : config.logLevel);

            // Parse time strings as Beijing time (UTC+8) and convert to UTC
            const parseTime = (timeStr: string): Date => {
                const year = parseInt(timeStr.substring(0, 4));
                const month = parseInt(timeStr.substring(4, 6)) - 1;
                const day = parseInt(timeStr.substring(6, 8));
                const hour = parseInt(timeStr.substring(8, 10));
                const minute = parseInt(timeStr.substring(10, 12));
                const second = parseInt(timeStr.substring(12, 14));

                // 输入是北京时间（UTC+8），需要转换为 UTC 时间
                // 北京时间减去 8 小时 = UTC 时间
                const utcDate = new Date(Date.UTC(year, month, day, hour, minute, second));
                utcDate.setUTCHours(utcDate.getUTCHours() - 8);
                return utcDate;
            };

            // 将 UTC 时间转换为北京时间字符串用于显示
            const toBeijingTimeString = (date: Date): string => {
                const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
                const year = beijingTime.getUTCFullYear();
                const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
                const day = String(beijingTime.getUTCDate()).padStart(2, '0');
                const hour = String(beijingTime.getUTCHours()).padStart(2, '0');
                const minute = String(beijingTime.getUTCMinutes()).padStart(2, '0');
                const second = String(beijingTime.getUTCSeconds()).padStart(2, '0');
                return `${year}-${month}-${day} ${hour}:${minute}:${second} (北京时间)`;
            };

            // 如果没有提供 startTime，默认使用 2000-01-01 00:00:00 (北京时间)
            const defaultStartTime = '20000101000000';
            const start = parseTime(startTime || defaultStartTime);

            // 如果没有提供 endTime，默认使用当前北京时间
            const end = endTime ? parseTime(endTime) : (() => {
                const now = new Date();
                // 获取当前 UTC 时间，加 8 小时得到北京时间
                const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
                // 提取北京时间的年月日时分秒
                const year = beijingTime.getUTCFullYear();
                const month = beijingTime.getUTCMonth();
                const day = beijingTime.getUTCDate();
                const hour = beijingTime.getUTCHours();
                const minute = beijingTime.getUTCMinutes();
                const second = beijingTime.getUTCSeconds();
                // 再转回 UTC
                const utcDate = new Date(Date.UTC(year, month, day, hour, minute, second));
                utcDate.setUTCHours(utcDate.getUTCHours() - 8);
                return utcDate;
            })();

            logger.info('🔍 查询更新的页面...');
            logger.info(`📊 数据库 ID: ${databaseId}`);
            logger.info(`⏰ 开始时间: ${toBeijingTimeString(start)}`);
            logger.info(`⏰ 结束时间: ${toBeijingTimeString(end)}`);

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
                logger.info(`   最后编辑: ${toBeijingTimeString(new Date(page.lastEditedTime))}`);
            });

            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        } catch (error) {
            console.error('❌ 查询失败:', error);
            process.exit(1);
        }
    });

program
    .command('sync-notion-database')
    .description('Query and sync pages updated in a time range from Notion database to Supabase')
    .argument('<databaseIdOrUrl>', 'Notion database ID or page URL (database is also a page)')
    .argument('[startTime]', 'Start time in format yyyyMMddHHmmss (default: 20000101000000)')
    .argument('[endTime]', 'End time in format yyyyMMddHHmmss (default: current time)')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--ignore-update-time', 'Ignore update time check and force sync all pages', false)
    .action(async (databaseIdOrUrl: string, startTime: string | undefined, endTime: string | undefined, options) => {
        const config = getConfig();
        const logger = new Logger(options.verbose ? 'debug' : config.logLevel);

        // 从 URL 或 ID 中提取 database ID（解析失败会直接退出）
        const databaseId = extractPageId(databaseIdOrUrl);

        // Parse time strings as Beijing time (UTC+8) and convert to UTC
        const parseTime = (timeStr: string): Date => {
            const year = parseInt(timeStr.substring(0, 4));
            const month = parseInt(timeStr.substring(4, 6)) - 1;
            const day = parseInt(timeStr.substring(6, 8));
            const hour = parseInt(timeStr.substring(8, 10));
            const minute = parseInt(timeStr.substring(10, 12));
            const second = parseInt(timeStr.substring(12, 14));

            // 输入是北京时间（UTC+8），需要转换为 UTC 时间
            // 北京时间减去 8 小时 = UTC 时间
            const utcDate = new Date(Date.UTC(year, month, day, hour, minute, second));
            utcDate.setUTCHours(utcDate.getUTCHours() - 8);
            return utcDate;
        };

        // 将 UTC 时间转换为北京时间字符串用于显示
        const toBeijingTimeString = (date: Date): string => {
            const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
            const year = beijingTime.getUTCFullYear();
            const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
            const day = String(beijingTime.getUTCDate()).padStart(2, '0');
            const hour = String(beijingTime.getUTCHours()).padStart(2, '0');
            const minute = String(beijingTime.getUTCMinutes()).padStart(2, '0');
            const second = String(beijingTime.getUTCSeconds()).padStart(2, '0');
            return `${year}-${month}-${day} ${hour}:${minute}:${second} (北京时间)`;
        };

        // 如果没有提供 startTime，默认使用 2000-01-01 00:00:00 (北京时间)
        const defaultStartTime = '20000101000000';
        const start = parseTime(startTime || defaultStartTime);

        // 如果没有提供 endTime，默认使用当前北京时间
        const end = endTime ? parseTime(endTime) : (() => {
            const now = new Date();
            // 获取当前 UTC 时间，加 8 小时得到北京时间
            const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
            // 提取北京时间的年月日时分秒
            const year = beijingTime.getUTCFullYear();
            const month = beijingTime.getUTCMonth();
            const day = beijingTime.getUTCDate();
            const hour = beijingTime.getUTCHours();
            const minute = beijingTime.getUTCMinutes();
            const second = beijingTime.getUTCSeconds();
            // 再转回 UTC
            const utcDate = new Date(Date.UTC(year, month, day, hour, minute, second));
            utcDate.setUTCHours(utcDate.getUTCHours() - 8);
            return utcDate;
        })();

        logger.info('🔍 查询并同步更新的页面...');
        if (databaseIdOrUrl !== databaseId) {
            logger.info(`输入: ${databaseIdOrUrl}`);
            logger.info(`提取的数据库 ID: ${databaseId}`);
        } else {
            logger.info(`📊 数据库 ID: ${databaseId}`);
        }
        logger.info(`⏰ 开始时间: ${toBeijingTimeString(start)}`);
        logger.info(`⏰ 结束时间: ${toBeijingTimeString(end)}`);
        if (options.ignoreUpdateTime) {
            logger.info(`⚠️  忽略更新时间检查: 是`);
        }

        const notionService = new NotionService(config.notion, logger);
        const pages = await notionService.queryDatabaseByTimeRange(
            databaseId,
            start.toISOString(),
            end.toISOString()
        );

        logger.info('');
        logger.info(`✅ 找到 ${pages.length} 个更新的页面`);

        let successCount = 0;
        let skippedCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        if (pages.length === 0) {
            logger.info('没有需要同步的页面');
        } else {
            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.info('🚀 开始同步页面到 Supabase...');
            logger.info('');

            const syncService = new SyncService(config, logger);

            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];
                logger.info(`[${i + 1}/${pages.length}] ${page.title || '(无标题)'}`);

                try {
                    const result = await syncService.syncPage(page.id, options.ignoreUpdateTime);
                    if (result.success) {
                        if (result.skipped) {
                            skippedCount++;
                            logger.info(`   ${result.message}`);
                        } else {
                            successCount++;
                            logger.info(`   成功 (处理 ${result.imagesProcessed} 张图片)`);
                        }
                    } else {
                        failCount++;
                        const errorMsg = `${page.title || page.id}: ${result.message}`;
                        errors.push(errorMsg);
                        logger.error(`   失败: ${result.message}`);
                    }
                } catch (error: any) {
                    failCount++;
                    const errorMsg = `${page.title || page.id}: ${error.message}`;
                    errors.push(errorMsg);
                    logger.error(`   异常: ${error.message}`);
                }

                logger.info('');
            }

            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.info('同步完成统计:');
            logger.info(`   总计: ${pages.length} 个页面`);
            logger.info(`   成功: ${successCount}`);
            logger.info(`   跳过: ${skippedCount}`);
            logger.info(`   失败: ${failCount}`);

            if (errors.length > 0) {
                logger.info('');
                logger.info('失败详情:');
                errors.forEach((error, index) => {
                    logger.error(`   ${index + 1}. ${error}`);
                });
            }

            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        }

        // 更新配置表中的最后同步时间（防止 Supabase 数据库休眠）
        // 无论是否有页面需要同步，都更新时间
        const supabaseService = new SupabaseService(config.supabase, logger);
        await supabaseService.updateLastSyncTime();
        logger.info('✅ 已更新最后同步时间');

        // 输出特殊标记，用于 GitHub Actions 检测是否有数据更新
        // 使用新的 GitHub Actions 输出方式（Environment Files）
        if (successCount > 0) {
            // 检查是否在 GitHub Actions 环境中
            if (process.env.GITHUB_OUTPUT) {
                fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_updates=true\n`);
            }
            logger.info('🔔 检测到数据更新，将触发通知');
        } else {
            if (process.env.GITHUB_OUTPUT) {
                fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_updates=false\n`);
            }
            logger.info('ℹ️  没有数据更新');
        }

        if (failCount > 0) {
            process.exit(1);
        }
    });

// Verify Cloudflare configuration
program
    .command('verify-config-cloudflare')
    .description('Verify Cloudflare R2 configuration and connection')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options) => {
        try {
            const config = getConfig();
            const logger = new Logger(options.verbose ? 'debug' : config.logLevel);

            logger.info('╔══════════════════════════════════════════════════════════════════════╗');
            logger.info('║           验证 Cloudflare R2 配置                                      ║');
            logger.info('╚══════════════════════════════════════════════════════════════════════╝');
            logger.info('');

            // 显示配置信息
            logger.info('📋 当前配置:');
            logger.info(`  Account ID: ${config.cloudflare.accountId}`);
            logger.info(`  Bucket Name: ${config.cloudflare.bucketName}`);
            logger.info(`  Endpoint: ${config.cloudflare.endpoint}`);
            logger.info(`  Public URL: ${config.cloudflare.publicUrl}`);
            logger.info(`  Access Key ID: ${'*'.repeat(config.cloudflare.accessKeyId.length)}`);
            logger.info(`  Secret Access Key: ${'*'.repeat(config.cloudflare.secretAccessKey.length)}`);

            logger.info('');
            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.info('');

            // 导入 CloudflareService
            const {CloudflareService} = await import('./services/cloudflare');
            const cloudflareService = new CloudflareService(config.cloudflare, logger);

            // 执行验证
            const result = await cloudflareService.verifyConfiguration();

            logger.info('');
            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            logger.info('');
            logger.info('📊 验证结果:');
            logger.info(`  状态: ${result.success ? '✅ 成功' : '❌ 失败'}`);
            logger.info(`  消息: ${result.message}`);
            logger.info('');
            logger.info('详细信息:');
            logger.info(`  Endpoint: ${result.details.endpoint}`);
            logger.info(`  Bucket: ${result.details.bucketName}`);
            logger.info(`  Public URL: ${result.details.publicUrl}`);
            logger.info(`  Access Key ID: ${result.details.accessKeyId}`);
            logger.info(`  可以连接: ${result.details.canConnect ? '✅ 是' : '❌ 否'}`);
            logger.info(`  可以读取: ${result.details.canRead ? '✅ 是' : '❌ 否'}`);

            if (result.details.error) {
                logger.info(`  错误信息: ${result.details.error}`);
            }

            logger.info('');
            logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            if (!result.success) {
                logger.info('');
                logger.info('💡 故障排查建议:');
                logger.info('');
                logger.info('1. 检查环境变量是否正确设置:');
                logger.info('   - SONDER_R2_ACCESS_KEY (从 R2 API Token 获得的 Access Key ID)');
                logger.info('   - SONDER_R2_SECRET_KEY (从 R2 API Token 获得的 Secret Access Key)');
                logger.info('   - CLOUDFLARE_ACCOUNT_ID');
                logger.info('   - CLOUDFLARE_BUCKET_NAME (可选，默认: zilean)');
                logger.info('');
                logger.info('2. 如何创建 R2 API Token:');
                logger.info('   - 访问 Cloudflare Dashboard → R2 → Manage R2 API Tokens');
                logger.info('   - 点击 Create API Token → 选择权限（需要 Object Read & Write）');
                logger.info('   - 创建后会显示 Access Key ID 和 Secret Access Key');
                logger.info('   - 将 Access Key ID 设置为 SONDER_R2_ACCESS_KEY');
                logger.info('   - 将 Secret Access Key 设置为 SONDER_R2_SECRET_KEY');
                logger.info('');
                logger.info('3. 检查 API Token 权限:');
                logger.info('   - 确保有 R2 的读写权限');
                logger.info('   - 确保 Token 未过期或被撤销');
                logger.info('');
                logger.info('4. 检查 Bucket 配置:');
                logger.info('   - 确保 Bucket 名称正确');
                logger.info('   - 确保 Bucket 存在于指定的 Account 下');
                logger.info('');
                logger.info('5. 检查网络连接:');
                logger.info('   - 确保可以访问 Cloudflare R2 服务');
                logger.info('   - 检查防火墙或代理设置');
                logger.info('');

                process.exit(1);
            }

            logger.info('');
            logger.info('🎉 Cloudflare R2 配置验证成功！可以正常使用。');
            logger.info('');

        } catch (error: any) {
            console.error('❌ 验证过程中发生错误:', error.message);
            if (options.verbose) {
                console.error(error);
            }
            process.exit(1);
        }
    });

program
    .command('update-sync-time')
    .description('Update last sync time in config table (for testing)')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options) => {
        try {
            const config = getConfig();
            const logger = new Logger(options.verbose ? 'debug' : config.logLevel);

            logger.info('🔄 更新配置表中的最后同步时间...');
            logger.info('');

            const supabaseService = new SupabaseService(config.supabase, logger);
            await supabaseService.updateLastSyncTime();

            logger.info('');
            logger.info('✅ 配置表更新成功！');
            logger.info('');

        } catch (error: any) {
            console.error('❌ 更新配置表失败:', error.message);
            if (options.verbose) {
                console.error(error);
            }
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
