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
/** Uploads an in-memory image buffer and returns both the `mxc://` URI (needed
 *  for Matrix profile avatars) and the public HTTP URL (needed for the domain
 *  card logo). */
async function uploadImageBuffer({
  buffer,
  fileName,
  contentType,
  homeServerUrl,
  accessToken,
}: {
  buffer: Buffer;
  fileName: string;
  contentType: UploadContentType;
  homeServerUrl: string;
  accessToken: string;
}): Promise<{ mxc: string; httpUrl: string }> {
  if (buffer.length === 0) throw new Error('Image is empty');
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new Error(
      `Image is ${(buffer.length / 1024 / 1024).toFixed(1)} MB; the max is ${MAX_AVATAR_BYTES / 1024 / 1024} MB.`,
    );
  }

  const matrixAPIClient = createMatrixApiClient({ homeServerUrl, accessToken });
  const response = await matrixAPIClient.media.v1beta1.upload(fileName, contentType, buffer);

  const httpUrl = mxUtils.mxc.mxcUrlToHttp(homeServerUrl, response.content_uri);
  if (!httpUrl) {
    throw new Error('Matrix upload succeeded but returned no resolvable HTTP URL');
  }
  return { mxc: response.content_uri, httpUrl };
}

/**
 * Uploads a local image file to Matrix as public media and returns its public
 * HTTP URL — suitable as a durable avatar/logo `contentUrl` in the domain card.
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
  const { httpUrl } = await uploadImageBuffer({
    buffer: readFileSync(filePath),
    fileName: path.basename(filePath),
    contentType,
    homeServerUrl,
    accessToken,
  });
  return httpUrl;
}

/**
 * Resolves any image URL to an `mxc://` URI on the given Matrix account's
 * homeserver, so it can be used as that account's profile avatar
 * (`setAvatarUrl` requires an mxc URI, not an HTTP URL). If the input is already
 * an mxc URI it is returned unchanged; otherwise the bytes are fetched and
 * re-uploaded to Matrix. Used to give the oracle's Matrix account the same image
 * shown on its domain card.
 */
export async function resolveImageToMatrixMxc({
  imageUrl,
  homeServerUrl,
  accessToken,
}: {
  imageUrl: string;
  homeServerUrl: string;
  accessToken: string;
}): Promise<string> {
  if (imageUrl.startsWith('mxc://')) return imageUrl;

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status}) from ${imageUrl}`);

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`URL did not return an image (content-type: ${contentType || 'unknown'})`);
  }

  const { mxc } = await uploadImageBuffer({
    buffer: Buffer.from(await res.arrayBuffer()),
    fileName: 'avatar',
    contentType: contentType as UploadContentType,
    homeServerUrl,
    accessToken,
  });
  return mxc;
}
