import { randomBytes } from "node:crypto";
import { extname } from "node:path";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { AppEnv } from "../config/env.js";

export class StorageService {
  private readonly client: S3Client | null;
  private readonly bucketName: string | undefined;
  private readonly publicUrl: string | undefined;

  public constructor(env: AppEnv) {
    if (env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME) {
      this.client = new S3Client({
        region: "auto",
        endpoint: env.R2_ENDPOINT,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        },
      });
      this.bucketName = env.R2_BUCKET_NAME;
      this.publicUrl = env.R2_PUBLIC_URL?.replace(/\/+$/, "");
    } else {
      this.client = null;
    }
  }

  public get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Upload a buffer to R2/S3.
   * Returns { key, url } where url is the public URL of the uploaded file.
   */
  public async upload(params: {
    buffer: Buffer;
    contentType: string;
    folder: string;
    originalFilename?: string;
  }): Promise<{ key: string; url: string }> {
    if (!this.client || !this.bucketName) {
      throw new Error("Storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.");
    }

    const metadata = this.normaliseUploadMetadata({
      contentType: params.contentType,
      originalFilename: params.originalFilename,
    });
    const extension = params.originalFilename ? extname(params.originalFilename) : this.extensionFromContentType(metadata.contentType);
    const uniqueId = randomBytes(16).toString("hex");
    const key = `${params.folder}/${uniqueId}${extension}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: params.buffer,
        ContentType: metadata.contentType,
        ContentDisposition: "inline",
      }),
    );

    const url = this.publicUrl ? `${this.publicUrl}/${key}` : `https://${this.bucketName}.r2.dev/${key}`;

    return { key, url };
  }

  public async delete(key: string): Promise<void> {
    if (!this.client || !this.bucketName) {
      throw new Error("Storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.");
    }

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
  }

  private extensionFromContentType(contentType: string): string {
    const mapping: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
      "application/pdf": ".pdf",
      "video/mp4": ".mp4",
      "video/quicktime": ".mov",
    };
    return mapping[contentType] ?? "";
  }

  private normaliseUploadMetadata(params: { contentType: string; originalFilename?: string }) {
    const extension = params.originalFilename ? extname(params.originalFilename).toLowerCase() : "";
    const contentType = params.contentType.toLowerCase();

    // Discord often labels macOS screen recordings, and sometimes .mp4 files
    // exported from macOS, as QuickTime. If the file is actually named .mp4,
    // serve it as MP4 so clients such as Discord can render an inline player.
    if (extension === ".mp4" || extension === ".m4v") {
      return { contentType: "video/mp4" };
    }

    if (extension === ".mov") {
      return { contentType: "video/quicktime" };
    }

    if (contentType === "video/x-m4v") {
      return { contentType: "video/mp4" };
    }

    return { contentType: params.contentType };
  }
}
