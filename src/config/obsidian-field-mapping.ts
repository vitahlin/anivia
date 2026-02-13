/**
 * Obsidian Front Matter 字段到 Supabase 字段的映射配置
 *
 * 这个配置文件定义了如何将 Obsidian Markdown 文件的 Front Matter 字段映射到 Supabase 数据库字段
 * 可以通过修改这个文件来动态调整字段映射关系
 */

export type ObsidianFieldType =
  | 'string'
  | 'boolean'
  | 'array'
  | 'number'
  | 'date'
  | 'image'
  | 'images';

export interface ObsidianFieldMapping {
  /** Obsidian Front Matter 字段名称（支持多个可能的名称） */
  obsidianFieldNames: string[];
  /** Obsidian 字段类型 */
  obsidianFieldType: ObsidianFieldType;
  /** Supabase 字段名称 */
  supabaseField: string;
  /** 是否必需 */
  required: boolean;
  /** 默认值（如果字段不存在或为空） */
  defaultValue?: any;
  /** 是否需要特殊处理（如图片上传） */
  needsProcessing?: boolean;
  /** 处理类型 */
  processingType?: 'image_upload' | 'boolean_parse' | 'array_parse' | 'git_timestamp' | 'custom';
  /** 描述 */
  description?: string;
}

/**
 * Obsidian 字段映射配置
 */
export const OBSIDIAN_FIELD_MAPPINGS: ObsidianFieldMapping[] = [
  {
    obsidianFieldNames: ['title', 'Title', '标题'],
    obsidianFieldType: 'string',
    supabaseField: 'title',
    required: false, // 如果没有 title，使用文件名
    defaultValue: '', // 将在代码中使用文件名作为默认值
    description: '文章标题（如果为空，使用文件名）'
  },
  {
    obsidianFieldNames: ['slug', 'Slug'],
    obsidianFieldType: 'string',
    supabaseField: 'slug',
    required: true, // Obsidian 文章必须有 slug
    description: 'URL 友好的唯一标识符（必需）'
  },
  {
    obsidianFieldNames: ['post_type', 'postType', 'type', 'Type'],
    obsidianFieldType: 'string',
    supabaseField: 'post_type',
    required: false,
    defaultValue: '',
    description: '文章类型'
  },
  {
    obsidianFieldNames: ['published', 'Published', '发布'],
    obsidianFieldType: 'boolean',
    supabaseField: 'published',
    required: false,
    defaultValue: false,
    needsProcessing: true,
    processingType: 'boolean_parse',
    description: '是否发布'
  },
  {
    obsidianFieldNames: ['draft', 'Draft', '草稿'],
    obsidianFieldType: 'boolean',
    supabaseField: 'draft',
    required: false,
    defaultValue: false,
    needsProcessing: true,
    processingType: 'boolean_parse',
    description: '是否是草稿'
  },
  {
    obsidianFieldNames: ['archived', 'Archived', '归档'],
    obsidianFieldType: 'boolean',
    supabaseField: 'archived',
    required: false,
    defaultValue: false,
    needsProcessing: true,
    processingType: 'boolean_parse',
    description: '是否归档'
  },
  {
    obsidianFieldNames: ['categories', 'Categories', '分类', 'category', 'Category'],
    obsidianFieldType: 'array',
    supabaseField: 'categories',
    required: false,
    defaultValue: [],
    needsProcessing: true,
    processingType: 'array_parse',
    description: '分类（数组）'
  },
  {
    obsidianFieldNames: ['tags', 'Tags', '标签'],
    obsidianFieldType: 'array',
    supabaseField: 'tags',
    required: false,
    defaultValue: [],
    needsProcessing: true,
    processingType: 'array_parse',
    description: '标签（数组）'
  },
  {
    obsidianFieldNames: ['excerpt', 'Excerpt', '摘要', '简介', 'description', 'Description'],
    obsidianFieldType: 'string',
    supabaseField: 'excerpt',
    required: false,
    defaultValue: '',
    description: '文章摘要'
  },
  {
    obsidianFieldNames: ['featured_img', 'featuredImg', 'cover', 'Cover', '配图'],
    obsidianFieldType: 'image',
    supabaseField: 'featured_img',
    required: false,
    defaultValue: '',
    needsProcessing: true,
    processingType: 'image_upload',
    description: '配图（单张，支持本地路径和远程 URL）'
  },
  {
    obsidianFieldNames: ['created_time', 'createdTime', 'created', 'Created'],
    obsidianFieldType: 'date',
    supabaseField: 'created_time',
    required: false,
    needsProcessing: true,
    processingType: 'git_timestamp',
    description: '创建时间（优先使用 Git 时间戳）'
  },
  {
    obsidianFieldNames: ['last_edited_time', 'lastEditedTime', 'updated', 'Updated', 'modified', 'Modified'],
    obsidianFieldType: 'date',
    supabaseField: 'last_edited_time',
    required: false,
    needsProcessing: true,
    processingType: 'git_timestamp',
    description: '最后编辑时间（优先使用 Git 时间戳）'
  }
];

/**
 * 根据 Obsidian Front Matter 字段名称查找映射配置
 */
export function findObsidianMappingByFieldName(fieldName: string): ObsidianFieldMapping | undefined {
  return OBSIDIAN_FIELD_MAPPINGS.find(mapping =>
    mapping.obsidianFieldNames.some(name =>
      name.toLowerCase() === fieldName.toLowerCase()
    )
  );
}

/**
 * 根据 Supabase 字段名称查找 Obsidian 映射配置
 */
export function findObsidianMappingBySupabaseField(fieldName: string): ObsidianFieldMapping | undefined {
  return OBSIDIAN_FIELD_MAPPINGS.find(mapping =>
    mapping.supabaseField === fieldName
  );
}

/**
 * 获取所有需要图片处理的 Obsidian 字段映射
 */
export function getObsidianImageProcessingMappings(): ObsidianFieldMapping[] {
  return OBSIDIAN_FIELD_MAPPINGS.filter(mapping =>
    mapping.needsProcessing && mapping.processingType === 'image_upload'
  );
}

/**
 * 获取所有需要布尔值解析的 Obsidian 字段映射
 */
export function getObsidianBooleanMappings(): ObsidianFieldMapping[] {
  return OBSIDIAN_FIELD_MAPPINGS.filter(mapping =>
    mapping.needsProcessing && mapping.processingType === 'boolean_parse'
  );
}

/**
 * 获取所有需要数组解析的 Obsidian 字段映射
 */
export function getObsidianArrayMappings(): ObsidianFieldMapping[] {
  return OBSIDIAN_FIELD_MAPPINGS.filter(mapping =>
    mapping.needsProcessing && mapping.processingType === 'array_parse'
  );
}

/**
 * 获取所有需要 Git 时间戳的 Obsidian 字段映射
 */
export function getObsidianGitTimestampMappings(): ObsidianFieldMapping[] {
  return OBSIDIAN_FIELD_MAPPINGS.filter(mapping =>
    mapping.needsProcessing && mapping.processingType === 'git_timestamp'
  );
}

/**
 * 获取所有必需的 Obsidian 字段
 */
export function getRequiredObsidianFields(): ObsidianFieldMapping[] {
  return OBSIDIAN_FIELD_MAPPINGS.filter(mapping => mapping.required);
}

/**
 * 验证 Obsidian Front Matter 是否包含所有必需字段
 */
export function validateObsidianFrontMatter(frontMatter: any): { valid: boolean; missingFields: string[] } {
  const requiredFields = getRequiredObsidianFields();
  const missingFields: string[] = [];

  for (const mapping of requiredFields) {
    // 检查是否有任何一个可能的字段名存在
    const hasField = mapping.obsidianFieldNames.some(fieldName => {
      const value = frontMatter[fieldName];
      return value !== undefined && value !== null && value !== '';
    });

    if (!hasField) {
      missingFields.push(mapping.supabaseField);
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields
  };
}

/**
 * 从 Front Matter 中获取字段值（支持多个可能的字段名）
 */
export function getObsidianFieldValue(frontMatter: any, mapping: ObsidianFieldMapping): any {
  for (const fieldName of mapping.obsidianFieldNames) {
    const value = frontMatter[fieldName];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return mapping.defaultValue;
}

