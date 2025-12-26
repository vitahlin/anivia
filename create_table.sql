-- 创建主表：anivia_notion_page
CREATE TABLE IF NOT EXISTS anivia_notion_page (
  id BIGSERIAL PRIMARY KEY,
  notion_page_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_time TIMESTAMPTZ,
  last_edited_time TIMESTAMPTZ,
  handler TEXT NOT NULL DEFAULT '',
  published BOOLEAN NOT NULL DEFAULT false,
  draft BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
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
COMMENT ON TABLE anivia_notion_page IS '存储从 Notion 同步的页面数据';
COMMENT ON COLUMN anivia_notion_page.id IS '主键，自增 ID';
COMMENT ON COLUMN anivia_notion_page.notion_page_id IS 'Notion 页面的唯一 ID';
COMMENT ON COLUMN anivia_notion_page.title IS '页面标题';
COMMENT ON COLUMN anivia_notion_page.content IS '页面内容（Markdown 格式）';
COMMENT ON COLUMN anivia_notion_page.created_time IS 'Notion 页面创建时间';
COMMENT ON COLUMN anivia_notion_page.last_edited_time IS 'Notion 页面最后编辑时间';
COMMENT ON COLUMN anivia_notion_page.handler IS '处理人';
COMMENT ON COLUMN anivia_notion_page.published IS '是否发布';
COMMENT ON COLUMN anivia_notion_page.draft IS '是否是草稿';
COMMENT ON COLUMN anivia_notion_page.archived IS '是否归档';
COMMENT ON COLUMN anivia_notion_page.categories IS '页面分类（多选）';
COMMENT ON COLUMN anivia_notion_page.tags IS '标签（多选）';
COMMENT ON COLUMN anivia_notion_page.excerpt IS '文章摘要';
COMMENT ON COLUMN anivia_notion_page.featured_img IS '配图 URL（Cloudflare R2）';
COMMENT ON COLUMN anivia_notion_page.gallery_imgs IS '组图 URL 数组（Cloudflare R2）';
COMMENT ON COLUMN anivia_notion_page.properties IS 'Notion 页面属性（JSON 格式）';
COMMENT ON COLUMN anivia_notion_page.created_at IS '记录创建时间';
COMMENT ON COLUMN anivia_notion_page.updated_at IS '记录更新时间（由应用代码管理）';

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_anivia_notion_page_notion_page_id ON anivia_notion_page(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_anivia_notion_page_published ON anivia_notion_page(published);
CREATE INDEX IF NOT EXISTS idx_anivia_notion_page_draft ON anivia_notion_page(draft);
CREATE INDEX IF NOT EXISTS idx_anivia_notion_page_archived ON anivia_notion_page(archived);
CREATE INDEX IF NOT EXISTS idx_anivia_notion_page_handler ON anivia_notion_page(handler);
CREATE INDEX IF NOT EXISTS idx_anivia_notion_page_categories ON anivia_notion_page USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_anivia_notion_page_tags ON anivia_notion_page USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_anivia_notion_page_created_time ON anivia_notion_page(created_time);
CREATE INDEX IF NOT EXISTS idx_anivia_notion_page_last_edited_time ON anivia_notion_page(last_edited_time);

-- =====================================================
-- 创建配置表：anivia_config
-- =====================================================
-- 用于保存系统配置信息，防止 Supabase 免费版因长时间无操作而归档数据库
CREATE TABLE IF NOT EXISTS anivia_config (
  id BIGSERIAL PRIMARY KEY,
  config_key TEXT UNIQUE NOT NULL,
  config_value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 添加表和字段注释
COMMENT ON TABLE anivia_config IS '系统配置表，用于保存配置信息和防止数据库休眠';
COMMENT ON COLUMN anivia_config.id IS '主键，自增 ID';
COMMENT ON COLUMN anivia_config.config_key IS '配置键（唯一）';
COMMENT ON COLUMN anivia_config.config_value IS '配置值';
COMMENT ON COLUMN anivia_config.description IS '配置描述';
COMMENT ON COLUMN anivia_config.updated_at IS '最后更新时间';

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_anivia_config_key ON anivia_config(config_key);
CREATE INDEX IF NOT EXISTS idx_anivia_config_updated_at ON anivia_config(updated_at);

-- 插入初始配置：最近一次 Notion 同步时间
INSERT INTO anivia_config (config_key, config_value, description)
VALUES (
  'last_notion_sync_time',
  NOW()::TEXT,
  '最近一次 Notion 页面同步时间'
)
ON CONFLICT (config_key) DO NOTHING;

-- =====================================================
-- 验证表创建成功
-- =====================================================
-- 执行以下查询来验证表是否创建成功：
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'anivia_notion_page'
-- ORDER BY ordinal_position;

-- 验证配置表：
-- SELECT * FROM anivia_config;
