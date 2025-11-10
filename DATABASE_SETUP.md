# 📊 数据库设置指南

## 数据库表结构

本项目使用 PostgreSQL (Supabase) 存储 Notion 页面数据。

### 表结构

```sql
CREATE TABLE zilean_notion_page (
  id BIGSERIAL PRIMARY KEY,                 -- 自增主键
  notion_page_id TEXT UNIQUE NOT NULL,      -- Notion 页面 ID（唯一）
  title TEXT NOT NULL,                      -- 页面标题
  content TEXT NOT NULL DEFAULT '',         -- 页面内容（Markdown 格式）
  created_time TIMESTAMPTZ,                 -- Notion 页面创建时间
  last_edited_time TIMESTAMPTZ,             -- Notion 页面最后编辑时间
  category TEXT NOT NULL DEFAULT '',        -- 页面分类
  featured_img TEXT NOT NULL DEFAULT '',    -- 配图 URL（Cloudflare R2）
  properties JSONB,                         -- Notion 页面属性（JSON 格式）
  created_at TIMESTAMPTZ DEFAULT NOW(),     -- 记录创建时间
  updated_at TIMESTAMPTZ DEFAULT NOW()      -- 记录更新时间
);
```

**注意：** TEXT 字段使用空字符串 `''` 而不是 `NULL` 来表示"没有值"。

### 索引

为了提高查询性能，创建了以下索引：

- `idx_zilean_notion_page_notion_page_id` - Notion 页面 ID 索引
- `idx_zilean_notion_page_category` - 分类索引
- `idx_zilean_notion_page_created_time` - 创建时间索引
- `idx_zilean_notion_page_last_edited_time` - 最后编辑时间索引

## 创建表

### 方法 1：使用 SQL 文件（推荐）

在 Supabase Dashboard 的 SQL Editor 中执行：

```bash
# 新建表
执行 create_table.sql
```

### 方法 2：命令行

```bash
psql -h your-host -U your-user -d your-db -f create_table.sql
```

## 迁移 NULL 值到空字符串

如果你的表已经存在，需要将 TEXT 字段的 NULL 值改为空字符串：

```bash
# 在 Supabase SQL Editor 中执行 migrate_null_to_empty_string.sql
```

这个脚本会：
1. 将现有的 NULL 值更新为空字符串
2. 修改字段为 NOT NULL
3. 设置默认值为空字符串

详细说明请查看 [NULL_TO_EMPTY_STRING.md](./NULL_TO_EMPTY_STRING.md)

## 添加配图字段

如果你的表已经存在但没有 `featured_img` 字段，执行以下 SQL：

```bash
# 在 Supabase SQL Editor 中执行 add_featured_img.sql
```

或者手动执行：

```sql
ALTER TABLE zilean_notion_page
ADD COLUMN IF NOT EXISTS featured_img TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN zilean_notion_page.featured_img IS '配图 URL（Cloudflare R2）';
```

## 迁移现有表

如果你已经有使用 UUID 作为主键的旧表，需要迁移到自增 ID：

### ⚠️  警告

迁移会删除并重建表，**所有数据将丢失**！

### 迁移步骤

1. **备份数据（如果需要）**

   在 Supabase SQL Editor 中执行：
   ```sql
   CREATE TABLE zilean_notion_page_backup AS
   SELECT * FROM zilean_notion_page;
   ```

2. **执行迁移脚本**

   在 Supabase SQL Editor 中执行 `migrate_to_bigserial.sql`

3. **重新同步数据**

   ```bash
   npm run sync <notion-page-id>
   ```

## 验证表结构

在 Supabase SQL Editor 中执行：

```sql
-- 查看表结构
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'zilean_notion_page'
ORDER BY ordinal_position;

-- 查看索引
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'zilean_notion_page';

-- 查看数据
SELECT id, notion_page_id, title, created_at
FROM zilean_notion_page
ORDER BY id DESC
LIMIT 10;
```

## 主键类型说明

### BIGSERIAL vs UUID

**之前（UUID）：**
```sql
id UUID DEFAULT gen_random_uuid() PRIMARY KEY
```

**现在（BIGSERIAL）：**
```sql
id BIGSERIAL PRIMARY KEY
```

**优势：**
- ✅ 更简单的自增 ID（类似 MySQL 的 AUTO_INCREMENT）
- ✅ 更小的存储空间（8 字节 vs 16 字节）
- ✅ 更好的索引性能
- ✅ 更易于调试和查询

**BIGSERIAL 范围：**
- 最小值：1
- 最大值：9,223,372,036,854,775,807（约 922 万亿）
- 足够存储任何规模的博客文章

## 常见问题

### Q: 为什么改用自增 ID？

A: 自增 ID 更简单、性能更好，且对于博客文章这种场景完全够用。UUID 主要用于分布式系统，但我们的场景不需要。

### Q: 如何保留现有数据？

A: 在执行迁移脚本前，先创建备份表：
```sql
CREATE TABLE zilean_notion_page_backup AS 
SELECT * FROM zilean_notion_page;
```

然后在迁移后，可以手动恢复数据（但会丢失原来的 UUID ID）。

### Q: 迁移后需要做什么？

A: 重新同步 Notion 数据即可：
```bash
npm run sync <notion-page-id>
```

## 相关文件

- `create_table.sql` - 创建新表的 SQL 脚本
- `migrate_to_bigserial.sql` - 从 UUID 迁移到 BIGSERIAL 的脚本
- `src/types/index.ts` - TypeScript 类型定义

## 下一步

1. ✅ 创建数据库表
2. ✅ 配置 `.env` 文件
3. ✅ 运行 `npm run sync <page-id>` 同步数据
4. ✅ 运行 `npm run export` 导出文章

---

如有问题，请查看其他文档或提交 Issue。

