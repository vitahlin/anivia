/**
 * Notion 属性到 Supabase 字段的映射配置
 * 
 * 这个配置文件定义了如何将 Notion 页面属性映射到 Supabase 数据库字段
 * 可以通过修改这个文件来动态调整字段映射关系
 */

export type NotionPropertyType = 
  | 'title'
  | 'rich_text'
  | 'select'
  | 'multi_select'
  | 'checkbox'
  | 'url'
  | 'files'
  | 'date'
  | 'number'
  | 'email'
  | 'phone_number';

export interface FieldMapping {
  /** Notion 属性名称（支持多个可能的名称） */
  notionPropertyNames: string[];
  /** Notion 属性类型 */
  notionPropertyType: NotionPropertyType;
  /** Supabase 字段名称 */
  supabaseField: string;
  /** 是否必需 */
  required: boolean;
  /** 默认值（如果属性不存在或为空） */
  defaultValue?: any;
  /** 是否需要特殊处理（如图片上传） */
  needsProcessing?: boolean;
  /** 处理类型 */
  processingType?: 'image_upload' | 'array_join' | 'custom';
  /** 描述 */
  description?: string;
}

/**
 * 字段映射配置
 */
export const FIELD_MAPPINGS: FieldMapping[] = [
  {
    notionPropertyNames: ['标题', 'Title', 'Name'],
    notionPropertyType: 'title',
    supabaseField: 'title',
    required: true,
    defaultValue: 'Untitled',
    description: '页面标题'
  },
  {
    notionPropertyNames: ['handler', 'Handler', '处理人'],
    notionPropertyType: 'rich_text',
    supabaseField: 'handler',
    required: false,
    defaultValue: '',
    description: '处理人'
  },
  {
    notionPropertyNames: ['发布', 'Published', 'Publish'],
    notionPropertyType: 'checkbox',
    supabaseField: 'published',
    required: false,
    defaultValue: false,
    description: '是否发布'
  },
  {
    notionPropertyNames: ['categories', 'Categories', '分类', 'category', 'Category'],
    notionPropertyType: 'multi_select',
    supabaseField: 'categories',
    required: false,
    defaultValue: [],
    processingType: 'array_join',
    description: '分类（多选）'
  },
  {
    notionPropertyNames: ['tags', 'Tags', '标签'],
    notionPropertyType: 'multi_select',
    supabaseField: 'tags',
    required: false,
    defaultValue: [],
    processingType: 'array_join',
    description: '标签（多选）'
  },
  {
    notionPropertyNames: ['excerpt', 'Excerpt', '摘要', '简介'],
    notionPropertyType: 'rich_text',
    supabaseField: 'excerpt',
    required: false,
    defaultValue: '',
    description: '文章摘要'
  },
  {
    notionPropertyNames: ['配图', 'Featured Image', 'Cover'],
    notionPropertyType: 'files',
    supabaseField: 'featured_img',
    required: false,
    defaultValue: '',
    needsProcessing: true,
    processingType: 'image_upload',
    description: '配图（单张）'
  },
  {
    notionPropertyNames: ['组图', 'Gallery', 'Images', '图片集'],
    notionPropertyType: 'files',
    supabaseField: 'gallery_imgs',
    required: false,
    defaultValue: [],
    needsProcessing: true,
    processingType: 'image_upload',
    description: '组图（多张）'
  }
];

/**
 * 根据 Notion 属性名称查找映射配置
 */
export function findMappingByNotionProperty(propertyName: string): FieldMapping | undefined {
  return FIELD_MAPPINGS.find(mapping => 
    mapping.notionPropertyNames.some(name => 
      name.toLowerCase() === propertyName.toLowerCase()
    )
  );
}

/**
 * 根据 Supabase 字段名称查找映射配置
 */
export function findMappingBySupabaseField(fieldName: string): FieldMapping | undefined {
  return FIELD_MAPPINGS.find(mapping => 
    mapping.supabaseField === fieldName
  );
}

/**
 * 获取所有需要图片处理的字段映射
 */
export function getImageProcessingMappings(): FieldMapping[] {
  return FIELD_MAPPINGS.filter(mapping => 
    mapping.needsProcessing && mapping.processingType === 'image_upload'
  );
}

