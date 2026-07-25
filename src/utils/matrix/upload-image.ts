import { createMatrixApiClient, utils as mxUtils } from '@ixo/matrixclient-sdk';
import { UploadContentType } from '@ixo/matrixclient-sdk/types/api/media/v1beta1';
import { readFileSync } from 'fs';
import path from 'path';

/** Image extensions we accept for an oracle avatar, mapped to their MIME type. */
const IMAGE_CONTENT_TYPES: Record<string, UploadContentType> = {
  '.png': 'image/png' as UploadContentType,
  '.jpg': 'image/jpeg' as UploadContentType,
  '.jpeg': 'image/jpeg' as UploadContentType,
  '.gif': 'image/gif' as UploadContentType,
  '.webp': 'image/webp' as UploadContentType,
  '.bmp': 'image/bmp' as UploadContentType,
  '.svg': 'image/svg+xml' as UploadContentType,
};

/** 5 MB — a generous ceiling for an avatar; keeps a stray large file from uploading. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export const SUPPORTED_IMAGE_EXTENSIONS = Object.keys(IMAGE_CONTENT_TYPES);

/** Resolves the MIME type for a local image path, or undefined if unsupported. */
export function imageContentType(filePath: string): UploadContentType | undefined {
  return IMAGE_CONTENT_TYPES[path.extname(filePath).toLowerCase()];
}

/**
 * Uploads a local image file to Matrix as public media and returns its HTTP URL
 * (the legacy `/_matrix/media/v3/download/` endpoint, which devmx/testnet/mainnet
 * serve without auth — verified against the live homeserver). The returned URL is
 * suitable as a durable avatar/logo `contentUrl` in the domain card, the same way
 * the agent card and domain card are hosted on Matrix.
 *
 * Unlike `publicUpload` (JSON only), this preserves the image's binary bytes and
 * content type. No CID/proof is computed — an avatar is not an on-chain resource.
 */
export async function uploadImageToMatrix({
  filePath,
  homeServerUrl,
  accessToken,
}: {
  filePath: string;
  homeServerUrl: string;
  accessToken: string;
}): Promise<string> {
  const contentType = imageContentType(filePath);
  if (!contentType) {
    throw new Error(
      `Unsupported image type "${path.extname(filePath) || '(none)'}". Supported: ${SUPPORTED_IMAGE_EXTENSIONS.join(', ')}`,
    );
  }

  const fileBuffer = readFileSync(filePath);
  if (fileBuffer.length === 0) {
    throw new Error(`Image file is empty: ${filePath}`);
  }
  if (fileBuffer.length > MAX_AVATAR_BYTES) {
    throw new Error(
      `Image is ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB; the max is ${MAX_AVATAR_BYTES / 1024 / 1024} MB.`,
    );
  }

  const matrixAPIClient = createMatrixApiClient({ homeServerUrl, accessToken });
  const response = await matrixAPIClient.media.v1beta1.upload(
    path.basename(filePath),
    contentType,
    fileBuffer,
  );

  const httpUrl = mxUtils.mxc.mxcUrlToHttp(homeServerUrl, response.content_uri);
  if (!httpUrl) {
    throw new Error('Matrix upload succeeded but returned no resolvable HTTP URL');
  }
  return httpUrl;
}
