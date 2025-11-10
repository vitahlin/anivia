-- =====================================================
-- Zilean Notion Page - 简化数据库表创建
-- =====================================================
-- 在 Supabase 项目的 SQL Editor 中执行此脚本

-- 创建主表：zilean_notion_page
CREATE TABLE IF NOT EXISTS zilean_notion_page (
  id BIGSERIAL PRIMARY KEY,
  notion_page_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_time TIMESTAMPTZ,
  last_edited_time TIMESTAMPTZ,
  handler TEXT NOT NULL DEFAULT '',
  published BOOLEAN NOT NULL DEFAULT false,
  categories TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  excerpt TEXT NOT NULL DEFAULT '',
  featured_img TEXT NOT NULL DEFAULT '',
  gallery_imgs TEXT[] NOT NULL DEFAULT '{}',
  properties JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 添加表和字段注释
COMMENT ON TABLE zilean_notion_page IS '存储从 Notion 同步的页面数据';
COMMENT ON COLUMN zilean_notion_page.id IS '主键，自增 ID';
COMMENT ON COLUMN zilean_notion_page.notion_page_id IS 'Notion 页面的唯一 ID';
COMMENT ON COLUMN zilean_notion_page.title IS '页面标题';
COMMENT ON COLUMN zilean_notion_page.content IS '页面内容（Markdown 格式）';
COMMENT ON COLUMN zilean_notion_page.created_time IS 'Notion 页面创建时间';
COMMENT ON COLUMN zilean_notion_page.last_edited_time IS 'Notion 页面最后编辑时间';
COMMENT ON COLUMN zilean_notion_page.handler IS '处理人';
COMMENT ON COLUMN zilean_notion_page.published IS '是否发布（控制导出）';
COMMENT ON COLUMN zilean_notion_page.categories IS '页面分类（多选）';
COMMENT ON COLUMN zilean_notion_page.tags IS '标签（多选）';
COMMENT ON COLUMN zilean_notion_page.excerpt IS '文章摘要';
COMMENT ON COLUMN zilean_notion_page.featured_img IS '配图 URL（Cloudflare R2）';
COMMENT ON COLUMN zilean_notion_page.gallery_imgs IS '组图 URL 数组（Cloudflare R2）';
COMMENT ON COLUMN zilean_notion_page.properties IS 'Notion 页面属性（JSON 格式）';
COMMENT ON COLUMN zilean_notion_page.created_at IS '记录创建时间';
COMMENT ON COLUMN zilean_notion_page.updated_at IS '记录更新时间（由应用代码管理）';

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_zilean_notion_page_notion_page_id ON zilean_notion_page(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_zilean_notion_page_published ON zilean_notion_page(published);
CREATE INDEX IF NOT EXISTS idx_zilean_notion_page_handler ON zilean_notion_page(handler);
CREATE INDEX IF NOT EXISTS idx_zilean_notion_page_categories ON zilean_notion_page USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_zilean_notion_page_tags ON zilean_notion_page USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_zilean_notion_page_created_time ON zilean_notion_page(created_time);
CREATE INDEX IF NOT EXISTS idx_zilean_notion_page_last_edited_time ON zilean_notion_page(last_edited_time);

-- =====================================================
-- 验证表创建成功
-- =====================================================
-- 执行以下查询来验证表是否创建成功：
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'zilean_notion_page'
-- ORDER BY ordinal_position;
