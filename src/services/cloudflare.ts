import { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { CloudflareConfig, AniviaImage, ImageType } from '../types';
import { Logger } from '../utils/logger';
import { CloudflareError } from '../errors/cloudflare-error';
import fetch from 'node-fetch';
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';

export class CloudflareService {
  private s3Client: S3Client;
  private config: CloudflareConfig;
  private logger: Logger;
  private uploadedImages: Set<string> = new Set();

  constructor(config: CloudflareConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;

    // 验证配置
    if (!config.accessKeyId || !config.secretAccessKey) {
      console.error('❌ Cloudflare R2 认证配置缺失');
      console.error(`  Access Key ID: ${config.accessKeyId ? '已设置' : '未设置'}`);
      console.error(`  Secret Access Key: ${config.secretAccessKey ? '已设置' : '未设置'}`);
      console.error('Cloudflare R2 认证配置缺失。请提供：');
      console.error('  - ZILEAN_CLOUDFLARE_R2_ACCESS_KEY (从 R2 API Token 获得的 Access Key ID)');
      console.error('  - ZILEAN_CLOUDFLARE_R2_SECRET_KEY (从 R2 API Token 获得的 Secret Access Key)');
      console.error('');
      console.error('如何创建 R2 API Token：');
      console.error('  1. 访问 Cloudflare Dashboard → R2 → Manage R2 API Tokens');
      console.error('  2. 点击 Create API Token → 选择权限 (Object Read & Write)');
      console.error('  3. 创建后会显示 Access Key ID 和 Secret Access Key，请妥善保存');
      console.error('  4. 将它们设置为环境变量 ZILEAN_CLOUDFLARE_R2_ACCESS_KEY 和 ZILEAN_CLOUDFLARE_R2_SECRET_KEY');
      process.exit(1);
    }

    this.logger.debug(`🔧 初始化 Cloudflare R2 S3 客户端:`);
    this.logger.debug(`  Endpoint: ${config.endpoint}`);
    this.logger.debug(`  Bucket: ${config.bucketName}`);
    this.logger.debug(`  Access Key ID: ${config.accessKeyId.substring(0, 8)}...`);

    // 使用 R2 API Token 生成的 Access Key ID 和 Secret Access Key
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async processImages(images: AniviaImage[]): Promise<AniviaImage[]> {
    this.logger.info(`🚀 开始并行处理 ${images.length} 张图片...`);

    // 并行处理所有图片
    const processPromises = images.map(async (image, index) => {
      try {
        this.logger.debug(`[${index + 1}/${images.length}] 开始处理: ${image.filename}`);

        // 根据图片来源获取图片内容和哈希
        const { buffer: originalBuffer, contentHash } = image.source === 'notion'
          ? await this.downloadAndHashImage(image.url)
          : await this.readLocalFileAndHash(image.url);

        // 更新图片对象的哈希值
        const imageWithHash = {
          ...image,
          hash: contentHash
        };

        // Check if image already exists in Cloudflare
        const existingUrl = await this.checkImageExists(contentHash, image.type);
        if (existingUrl) {
          this.logger.debug(`[${index + 1}/${images.length}] ✅ 图片已存在: ${image.filename} (${image.type}), 现有地址: ${existingUrl}`);
          return {
            ...imageWithHash,
            cloudflareUrl: existingUrl
          };
        }

        const cloudflareUrl = await this.uploadImageBuffer(imageWithHash, originalBuffer);
        this.logger.debug(`[${index + 1}/${images.length}] ✅ 图片上传成功: ${image.filename} -> ${cloudflareUrl}`);

        return {
          ...imageWithHash,
          cloudflareUrl
        };
      } catch (error) {
        this.logger.error(`[${index + 1}/${images.length}] ❌ 处理图片失败: ${image.filename}`, error);
        // 返回原始图片信息，但不包含 cloudflareUrl
        return image;
      }
    });

    // 等待所有图片处理完成
    const processedImages = await Promise.all(processPromises);

    const successCount = processedImages.filter(img => img.cloudflareUrl).length;
    this.logger.info(`✅ 图片处理完成: ${successCount}/${images.length} 成功`);

    return processedImages;
  }

  /**
   * 根据图片类型获取目录路径
   */
  private getImageDirectory(imageType: ImageType): string {
    switch (imageType) {
      case 'markdown':
        return 'posts';
      case 'featured':
        return 'featured';
      case 'gallery':
        return 'gallery';
      default:
        return 'images'; // 默认目录（向后兼容）
    }
  }

  private async checkImageExists(contentHash: string, imageType: ImageType): Promise<string | null> {
    const directory = this.getImageDirectory(imageType);
    const key = `${directory}/${contentHash}.webp`;

    try {
      await this.s3Client.send(new HeadObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
      }));

      // If no error, the object exists
      const publicUrl = `${this.config.publicUrl}/${key}`;
      this.logger.debug(`✅ 图片已存在于 Cloudflare: ${key}`);

      // 记录到本地缓存，避免重复检查
      this.uploadedImages.add(contentHash);

      return publicUrl;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        this.logger.debug(`图片不存在于 Cloudflare: ${key}`);
        return null;
      }

      // 401 错误特殊处理
      if (error.$metadata?.httpStatusCode === 401) {
        console.error('🚨 Cloudflare R2 认证失败 (401 Unauthorized)');
        console.error('  请检查以下配置:');
        console.error('  - ZILEAN_CLOUDFLARE_R2_ACCESS_KEY 是否正确');
        console.error('  - ZILEAN_CLOUDFLARE_R2_SECRET_KEY 是否正确');
        console.error('  - R2 API Token 是否有读写权限');
        console.error(`  - Bucket 名称是否正确: ${this.config.bucketName}`);
        console.error(`  - Endpoint 是否正确: ${this.config.endpoint}`);
        console.error('  - API Token/Access Key 是否已过期或被撤销');
        process.exit(1);
      }

      console.error(`❌ 检查图片存在性时出错: ${error.message || error.name}`);
      console.error(error instanceof Error ? error.stack : String(error));
      process.exit(1);
    }
  }

  private async downloadAndHashImage(imageUrl: string): Promise<{ buffer: Buffer; contentHash: string }> {
    let response;
    try {
      response = await fetch(imageUrl);
    } catch (error) {
      console.error(`❌ 下载图片失败: ${imageUrl}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    if (!response.ok) {
      console.error(`❌ 下载图片失败: ${imageUrl}`);
      console.error(`状态码: ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    const originalBuffer = Buffer.from(await response.arrayBuffer());

    // 基于图片内容计算哈希
    const contentHash = crypto.createHash('md5').update(originalBuffer).digest('hex');
    return { buffer: originalBuffer, contentHash };
  }

  private async readLocalFileAndHash(filePath: string): Promise<{ buffer: Buffer; contentHash: string }> {
    let originalBuffer: Buffer;
    try {
      originalBuffer = fs.readFileSync(filePath);
    } catch (error) {
      console.error(`❌ 读取本地图片失败: ${filePath}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    // 基于图片内容计算哈希
    const contentHash = crypto.createHash('md5').update(originalBuffer).digest('hex');
    return { buffer: originalBuffer, contentHash };
  }

  private async uploadImageBuffer(image: AniviaImage, originalBuffer: Buffer): Promise<string> {
    this.logger.debug(`🖼️ 开始处理图片: ${image.filename}`);
    this.logger.debug(`📥 原始 Notion 图片地址: ${image.url}`);

    const originalSize = originalBuffer.length;

    // 生成图片的 base64 用于调试
    const imageBase64 = originalBuffer.toString('base64');
    const base64Preview = imageBase64.length > 100 ?
      `${imageBase64.substring(0, 100)}...` : imageBase64;
    this.logger.debug(`📏 图片 Base64 总长度: ${imageBase64.length} 字符`);

    // 验证内容哈希
    const actualContentHash = crypto.createHash('md5').update(originalBuffer).digest('hex');
    if (actualContentHash !== image.hash) {
      this.logger.warn(`⚠️ 内容哈希不匹配 ${image.filename}: 期望 ${image.hash}, 实际 ${actualContentHash}`);
      // 使用实际计算的哈希
      image.hash = actualContentHash;
    }

    // Convert image to WebP format for space efficiency
    this.logger.debug(`🔄 正在转换图片为 WebP 格式: ${image.filename}`);
    let webpBuffer: Buffer;
    try {
      webpBuffer = await sharp(originalBuffer)
        .webp({
          quality: 85,  // Good balance between quality and file size
          effort: 4     // Compression effort (0-6, higher = better compression)
        })
        .toBuffer();
    } catch (error) {
      console.error(`❌ 图片转换失败: ${image.filename}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    const webpSize = webpBuffer.length;
    const compressionRatio = ((originalSize - webpSize) / originalSize * 100).toFixed(1);
    this.logger.debug(`📊 图片压缩完成: ${originalSize} 字节 -> ${webpSize} 字节 (节省 ${compressionRatio}%)`);

    // Generate key using content hash for deduplication, with .webp extension
    // 根据图片类型选择目录
    const directory = this.getImageDirectory(image.type);
    const key = `${directory}/${image.hash}.webp`;

    // Upload to Cloudflare R2
    this.logger.debug(`☁️ 正在上传到 Cloudflare R2: ${key} (类型: ${image.type})`);
    try {
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: key,
        Body: webpBuffer,
        ContentType: 'image/webp',
        Metadata: {
          originalUrl: image.originalUrl,
          originalFilename: image.filename,
          originalFormat: 'unknown', // 无法从 buffer 获取原始格式
          originalSize: originalSize.toString(),
          webpSize: webpSize.toString(),
          compressionRatio: compressionRatio,
          contentHash: image.hash, // 基于内容的哈希
          imageType: image.type, // 图片类型
          uploadedAt: new Date().toISOString(),
          convertedToWebp: 'true'
        }
      }));
    } catch (error) {
      console.error(`❌ 上传到 Cloudflare R2 失败: ${image.filename}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    const cloudflareUrl = `${this.config.publicUrl}/${key}`;
    this.uploadedImages.add(image.hash);

    this.logger.debug(`✅ 图片上传成功: ${image.filename} -> ${cloudflareUrl} (${originalSize}字节 -> ${webpSize}字节, 节省${compressionRatio}%)`);

    return cloudflareUrl;
  }

  async deleteImage(hash: string, imageType: ImageType = 'markdown'): Promise<void> {
    const directory = this.getImageDirectory(imageType);
    const key = `${directory}/${hash}.webp`;

    // Note: DeleteObjectCommand would be used here, but we're being conservative
    // and not implementing deletion to avoid accidental data loss
    this.logger.warn(`Image deletion not implemented for safety: ${key}`);
  }

  getUploadedImagesCount(): number {
    return this.uploadedImages.size;
  }

  clearUploadedImages(): void {
    this.uploadedImages.clear();
  }

  /**
   * 验证 Cloudflare R2 配置是否正确
   * 通过尝试列出 bucket 中的对象来验证连接和权限
   */
  async verifyConfiguration(): Promise<{
    success: boolean;
    message: string;
    details: {
      endpoint: string;
      bucketName: string;
      publicUrl: string;
      accessKeyId: string;
      canConnect: boolean;
      canRead: boolean;
      error?: string;
    };
  }> {
    const details = {
      endpoint: this.config.endpoint,
      bucketName: this.config.bucketName,
      publicUrl: this.config.publicUrl,
      accessKeyId: `${this.config.accessKeyId.substring(0, 8)}...`,
      canConnect: false,
      canRead: false,
    };

    try {
      this.logger.info('🔍 开始验证 Cloudflare R2 配置...');
      this.logger.info(`  Endpoint: ${details.endpoint}`);
      this.logger.info(`  Bucket: ${details.bucketName}`);
      this.logger.info(`  Access Key ID: ${details.accessKeyId}`);

      // 尝试列出 bucket 中的对象（最多 1 个）来验证连接和权限
      // 这比 HeadObject 更可靠，因为不需要知道具体的对象名称
      try {
        const listCommand = new ListObjectsV2Command({
          Bucket: this.config.bucketName,
          MaxKeys: 1,
          Prefix: 'images/', // 只列出 images/ 目录下的对象
        });

        const response = await this.s3Client.send(listCommand);

        // 如果能成功列出对象（即使是空列表），说明连接和权限都正常
        details.canConnect = true;
        details.canRead = true;

        if (response.Contents && response.Contents.length > 0) {
          this.logger.info(`✅ 连接成功！找到 ${response.KeyCount || 0} 个对象`);
        } else {
          this.logger.info('✅ 连接成功！Bucket 为空或 images/ 目录下没有对象');
        }
      } catch (error: any) {
        this.logger.debug(`验证错误详情:`, error);

        if (error.$metadata?.httpStatusCode === 401) {
          // 401 认证失败
          details.canConnect = true;
          details.canRead = false;
          throw new Error('认证失败 (401 Unauthorized)。请检查 API Token 或 Access Key 是否正确。');
        } else if (error.$metadata?.httpStatusCode === 403) {
          // 403 权限不足
          details.canConnect = true;
          details.canRead = false;
          throw new Error('权限不足 (403 Forbidden)。请检查 API Token 或 Access Key 是否有 R2 读写权限。');
        } else if (error.name === 'NoSuchBucket' || error.Code === 'NoSuchBucket') {
          // Bucket 不存在
          details.canConnect = true;
          details.canRead = false;
          throw new Error(`Bucket "${this.config.bucketName}" 不存在。请检查 Bucket 名称是否正确。`);
        } else {
          // 其他错误 - 提供更详细的错误信息
          const errorMessage = error.message || error.name || 'Unknown error';
          const statusCode = error.$metadata?.httpStatusCode;
          const errorCode = error.Code || error.code;

          let detailedMessage = `连接或验证失败: ${errorMessage}`;
          if (statusCode) {
            detailedMessage += ` (HTTP ${statusCode})`;
          }
          if (errorCode) {
            detailedMessage += ` [${errorCode}]`;
          }

          throw new Error(detailedMessage);
        }
      }

      return {
        success: true,
        message: '✅ Cloudflare R2 配置验证成功！',
        details,
      };
    } catch (error: any) {
      this.logger.error('❌ Cloudflare R2 配置验证失败');
      this.logger.error(`  错误: ${error.message}`);

      return {
        success: false,
        message: `❌ Cloudflare R2 配置验证失败: ${error.message}`,
        details: {
          ...details,
          error: error.message,
        },
      };
    }
  }
}
