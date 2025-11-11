import express, { Request, Response, NextFunction } from 'express';
import { getConfig } from './utils/config';
import { Logger } from './utils/logger';
import { SyncService } from './services/sync';
import { ExportService } from './services/export';
import { SupabaseService } from './services/supabase';
import { NotionService } from './services/notion';
import * as path from 'path';

const app = express();
const PORT = process.env.API_PORT || 3000;

// Middleware
app.use(express.json());

// 从 URL 或 ID 中提取 page ID
function extractPageId(input: string): string {
  const cleanInput = input.replace(/-/g, '');
  if (/^[a-f0-9]{32}$/i.test(cleanInput)) {
    return input;
  }

  try {
    const url = new URL(input);
    const pathname = url.pathname;
    
    const match = pathname.match(/([a-f0-9]{32})/i);
    if (match) {
      return match[1];
    }
    
    const matchWithDashes = pathname.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (matchWithDashes) {
      return matchWithDashes[1];
    }
  } catch (e) {
    // 不是有效的 URL
  }

  return input;
}

// 健康检查端点（不需要 API key）
app.get('/health', (req: Request, res: Response) => {
  const config = getConfig();
  const logger = new Logger(config.logLevel);
  logger.info(`receive health`)
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'anivia'
  });
});

// API 信息端点
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'anivia API',
    version: '1.0.0',
    endpoints: {
      'GET /sync?pageId=xxx': 'Sync a Notion page to Supabase',
      'POST /webhook/notion/pageCreate': 'Receive Notion webhook and sync page',
      'POST /export': 'Export all articles from Supabase to Markdown',
      'GET /check/notion': 'Check Notion API configuration',
      'GET /check/db': 'Check Supabase database configuration',
      'GET /health': 'Health check endpoint'
    }
  });
});

// 同步 Notion 页面
app.get('/sync', async (req: Request, res: Response) => {
  try {
    const pageIdOrUrl = req.query.pageId as string;
    const verbose = req.query.verbose === 'true';
    const debug = req.query.debug === 'true';

    if (!pageIdOrUrl) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: pageId'
      });
    }

    const config = getConfig();
    let logLevel = config.logLevel;
    if (debug) {
      logLevel = 'debug';
    } else if (verbose) {
      logLevel = 'info';
    }

    const logger = new Logger(logLevel);
    const pageId = extractPageId(pageIdOrUrl);

    logger.info(`API: Starting sync for page ${pageId}`);

    const syncService = new SyncService(config, logger);
    const result = await syncService.syncPage(pageId);

    res.json({
      success: result.success,
      pageId: result.pageId,
      imagesProcessed: result.imagesProcessed,
      errors: result.errors || []
    });

  } catch (error: any) {
    console.error('Sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Notion Webhook 端点
app.post('/webhook/notion/pageUpdate', async (req: Request, res: Response) => {
  const config = getConfig();
  const logger = new Logger(config.logLevel);
  logger.info(`receive notion pageUpdate webhook content: ${req.body.data}`)
  try {
    // 验证请求体结构
    if (!req.body || !req.body.data || !req.body.data.id) {
      return res.status(400).json({
        success: false,
        error: 'Invalid webhook payload: missing data.id field'
      });
    }

    const pageId = req.body.data.id;
    // 使用现有的同步逻辑
    const syncService = new SyncService(config, logger);
    const result = await syncService.syncPage(pageId);

    logger.info(`Webhook: Sync completed for page ${pageId}, success: ${result.success}`);

    res.json({
      success: result.success,
      pageId: result.pageId,
      imagesProcessed: result.imagesProcessed,
      errors: result.errors || []
    });

  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// 导出所有文章
app.post('/export', async (req: Request, res: Response) => {
  try {
    const {
      outputDir = '/app/exported-posts',
      overwrite = true,
      includeMetadata = true,
      verbose = false
    } = req.body;

    const config = getConfig();
    const logger = new Logger(verbose ? 'debug' : config.logLevel);

    logger.info('API: Starting export');

    const supabaseService = new SupabaseService(config.supabase, logger);
    const exportService = new ExportService(supabaseService, logger);

    const result = await exportService.exportAllPages({
      outputDir: path.resolve(outputDir),
      overwrite,
      includeMetadata
    });

    res.json({
      success: result.success,
      totalPages: result.totalPages,
      exportedPages: result.exportedPages,
      outputDir: result.outputDir,
      errors: result.errors || []
    });

  } catch (error: any) {
    console.error('Export error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// 检查 Notion 配置
app.get('/check/notion', async (req: Request, res: Response) => {
  try {
    const config = getConfig();
    const logger = new Logger(config.logLevel);

    const notionService = new NotionService(config.notion, logger);
    const result = await notionService.validateNotion();

    res.json(result);

  } catch (error: any) {
    console.error('Notion check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// 检查数据库配置
app.get('/check/db', async (req: Request, res: Response) => {
  try {
    const config = getConfig();
    const logger = new Logger(config.logLevel);

    const supabaseService = new SupabaseService(config.supabase, logger);
    const result = await supabaseService.validateSupabase();

    res.json(result);

  } catch (error: any) {
    console.error('Database check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// 错误处理中间件
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 Notion Upload API server is running on port ${PORT}`);
  console.log(`📝 API Documentation: http://localhost:${PORT}/`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
});

export default app;

