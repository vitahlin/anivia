import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { CloudflareConfig, NotionImage } from '../types';
import { Logger } from '../utils/logger';
import { CloudflareError } from '../errors/cloudflare-error';
import fetch from 'node-fetch';
import sharp from 'sharp';
import crypto from 'crypto';

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
      this.logger.error('❌ Cloudflare 认证配置缺失');
      this.logger.error(`  accessKeyId: ${config.accessKeyId ? '已设置' : '未设置'}`);
      this.logger.error(`  secretAccessKey: ${config.secretAccessKey ? '已设置' : '未设置'}`);
      throw new Error('Cloudflare R2 认证配置缺失，请检查 CLOUDFLARE_ACCESS_KEY_ID 和 CLOUDFLARE_SECRET_ACCESS_KEY 环境变量');
    }

    this.logger.debug(`🔧 初始化 Cloudflare S3 客户端:`);
    this.logger.debug(`  Endpoint: ${config.endpoint}`);
    this.logger.debug(`  Bucket: ${config.bucketName}`);
    this.logger.debug(`  Access Key ID: ${config.accessKeyId.substring(0, 8)}...`);

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async processImages(images: NotionImage[]): Promise<NotionImage[]> {
    this.logger.info(`🚀 开始并行处理 ${images.length} 张图片...`);

    // 并行处理所有图片
    const processPromises = images.map(async (image, index) => {
      try {
        this.logger.debug(`[${index + 1}/${images.length}] 开始处理: ${image.filename}`);

        // 首先下载图片以计算内容哈希
        const { buffer: originalBuffer, contentHash } = await this.downloadAndHashImage(image.url);

        // 更新图片对象的哈希值
        const imageWithHash = {
          ...image,
          hash: contentHash
        };

        // Check if image already exists in Cloudflare
        const existingUrl = await this.checkImageExists(contentHash);
        if (existingUrl) {
          this.logger.debug(`[${index + 1}/${images.length}] ✅ 图片已存在: ${image.filename}, 现有地址: ${existingUrl}`);
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

  private async checkImageExists(contentHash: string): Promise<string | null> {
    try {
      const key = `images/${contentHash}.webp`;

      const headResponse = await this.s3Client.send(new HeadObjectCommand({
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
        this.logger.debug(`图片不存在于 Cloudflare: images/${contentHash}.webp`);
        return null;
      }

      // 401 错误特殊处理
      if (error.$metadata?.httpStatusCode === 401) {
        this.logger.error(`🚨 Cloudflare R2 认证失败 (401 Unauthorized)`);
        this.logger.error(`  请检查以下配置:`);
        this.logger.error(`  - CLOUDFLARE_ACCESS_KEY_ID 是否正确`);
        this.logger.error(`  - CLOUDFLARE_SECRET_ACCESS_KEY 是否正确`);
        this.logger.error(`  - Cloudflare R2 API Token 是否有效`);
        this.logger.error(`  - Bucket 名称是否正确: ${this.config.bucketName}`);
        this.logger.error(`  - Endpoint 是否正确: ${this.config.endpoint}`);
      }

      this.logger.error(`🚨 检查图片存在性时出错: ${error.message || error.name}`);
      this.logger.debug(`错误详情:`, error);
      throw CloudflareError.fromAwsError(error);
    }
  }

  private async downloadAndHashImage(imageUrl: string): Promise<{ buffer: Buffer; contentHash: string }> {
    let response;
    try {
      response = await fetch(imageUrl);
    } catch (error) {
      this.logger.error(`❌ 下载图片失败: ${imageUrl}`, error);
      throw CloudflareError.fromDownloadError(imageUrl, error);
    }

    if (!response.ok) {
      this.logger.error(`❌ 下载图片失败: ${imageUrl}, 状态码: ${response.status}`);
      throw CloudflareError.fromDownloadError(imageUrl, {
        statusCode: response.status,
        message: response.statusText
      });
    }

    const originalBuffer = Buffer.from(await response.arrayBuffer());

    // 基于图片内容计算哈希
    const contentHash = crypto.createHash('md5').update(originalBuffer).digest('hex');
    return { buffer: originalBuffer, contentHash };
  }

  private async uploadImageBuffer(image: NotionImage, originalBuffer: Buffer): Promise<string> {
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
      this.logger.error(`❌ 图片转换失败 ${image.filename}:`, error);
      throw CloudflareError.fromProcessingError(image.filename, error);
    }

    const webpSize = webpBuffer.length;
    const compressionRatio = ((originalSize - webpSize) / originalSize * 100).toFixed(1);
    this.logger.debug(`📊 图片压缩完成: ${originalSize} 字节 -> ${webpSize} 字节 (节省 ${compressionRatio}%)`);

    // Generate key using content hash for deduplication, with .webp extension
    const key = `images/${image.hash}.webp`;

    // Upload to Cloudflare R2
    this.logger.debug(`☁️ 正在上传到 Cloudflare R2: ${key}`);
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
          uploadedAt: new Date().toISOString(),
          convertedToWebp: 'true'
        }
      }));
    } catch (error) {
      this.logger.error(`❌ 上传到 Cloudflare 失败 ${image.filename}:`, error);
      throw CloudflareError.fromAwsError(error);
    }

    const cloudflareUrl = `${this.config.publicUrl}/${key}`;
    this.uploadedImages.add(image.hash);

    this.logger.debug(`✅ 图片上传成功: ${image.filename} -> ${cloudflareUrl} (${originalSize}字节 -> ${webpSize}字节, 节省${compressionRatio}%)`);

    return cloudflareUrl;
  }

  async deleteImage(hash: string): Promise<void> {
    try {
      const key = `images/${hash}.webp`;

      // Note: DeleteObjectCommand would be used here, but we're being conservative
      // and not implementing deletion to avoid accidental data loss
      this.logger.warn(`Image deletion not implemented for safety: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete image ${hash}:`, error);
      throw error;
    }
  }

  getUploadedImagesCount(): number {
    return this.uploadedImages.size;
  }

  clearUploadedImages(): void {
    this.uploadedImages.clear();
  }
}
