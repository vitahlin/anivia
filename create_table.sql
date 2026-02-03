-- 创建主表：sonder_post
CREATE TABLE IF NOT EXISTS sonder_post (
  id BIGSERIAL PRIMARY KEY,
  notion_page_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_time TIMESTAMPTZ,
  last_edited_time TIMESTAMPTZ,
  slug TEXT NOT NULL DEFAULT '' UNIQUE,
  published BOOLEAN NOT NULL DEFAULT false,
  draft BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  categories TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  excerpt TEXT NOT NULL DEFAULT '',
  featured_img TEXT NOT NULL DEFAULT '',
  gallery_imgs TEXT[] NOT NULL DEFAULT '{}',
  properties JSONB,
  post_origin TEXT NOT NULL,
  post_type TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 添加表和字段注释
COMMENT ON TABLE sonder_post IS '存储从 Notion 和 Obsidian 同步的文章数据';
COMMENT ON COLUMN sonder_post.id IS '主键，自增 ID';
COMMENT ON COLUMN sonder_post.notion_page_id IS 'Notion 页面的唯一 ID（Obsidian 文章为空字符串）';
COMMENT ON COLUMN sonder_post.title IS '文章标题';
COMMENT ON COLUMN sonder_post.content IS '文章内容（Markdown 格式）';
COMMENT ON COLUMN sonder_post.created_time IS '文章创建时间';
COMMENT ON COLUMN sonder_post.last_edited_time IS '文章最后编辑时间';
COMMENT ON COLUMN sonder_post.slug IS 'URL 友好的唯一标识符（Obsidian 文章的唯一标识）';
COMMENT ON COLUMN sonder_post.published IS '是否发布';
COMMENT ON COLUMN sonder_post.draft IS '是否是草稿';
COMMENT ON COLUMN sonder_post.archived IS '是否归档';
COMMENT ON COLUMN sonder_post.categories IS '文章分类（多选）';
COMMENT ON COLUMN sonder_post.tags IS '标签（多选）';
COMMENT ON COLUMN sonder_post.excerpt IS '文章摘要';
COMMENT ON COLUMN sonder_post.featured_img IS '配图 URL';
COMMENT ON COLUMN sonder_post.gallery_imgs IS '组图 URL 数组';
COMMENT ON COLUMN sonder_post.properties IS 'Notion 页面属性（JSON 格式）';
COMMENT ON COLUMN sonder_post.post_origin IS '文章来源:notion,obsidian';
COMMENT ON COLUMN sonder_post.post_type IS '文章类型';
COMMENT ON COLUMN sonder_post.created_at IS '记录创建时间';
COMMENT ON COLUMN sonder_post.updated_at IS '记录更新时间（由应用代码管理）';

-- 创建普通索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_sonder_post_notion_page_id ON sonder_post(notion_page_id) WHERE notion_page_id != '';
CREATE INDEX IF NOT EXISTS idx_sonder_post_post_origin ON sonder_post(post_origin);
CREATE INDEX IF NOT EXISTS idx_sonder_post_published ON sonder_post(published);
CREATE INDEX IF NOT EXISTS idx_sonder_post_draft ON sonder_post(draft);
CREATE INDEX IF NOT EXISTS idx_sonder_post_archived ON sonder_post(archived);
CREATE INDEX IF NOT EXISTS idx_sonder_post_categories ON sonder_post USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_sonder_post_tags ON sonder_post USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_sonder_post_created_time ON sonder_post(created_time);
CREATE INDEX IF NOT EXISTS idx_sonder_post_last_edited_time ON sonder_post(last_edited_time);

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
