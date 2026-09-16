const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required when STORAGE_PROVIDER=s3`);
  return value;
}

function createStorage({ directory }) {
  const provider = String(process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase();
  if (provider === 'local') {
    if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') {
      throw new Error('STORAGE_PROVIDER=local is not allowed in production; configure an S3-compatible provider.');
    }
    return {
      provider,
      async uploadImage({ buffer, format }) {
        const key = `${Date.now()}-${crypto.randomUUID()}.${format}`;
        await fs.writeFile(path.join(directory, key), buffer, { flag: 'wx' });
        return { key, url: `/uploads/${key}` };
      },
      async deleteImage(key) {
        if (!key || key.includes('/') || key.includes('\\') || key === '.' || key === '..') return;
        await fs.rm(path.join(directory, key), { force: true });
      },
      getImageUrl(key) { return key && key.startsWith('http') ? key : `/uploads/${key}`; },
    };
  }

  if (provider !== 's3') throw new Error(`Unsupported STORAGE_PROVIDER: ${provider}`);
  const bucket = required('S3_BUCKET');
  const region = required('S3_REGION');
  const publicBaseUrl = required('S3_PUBLIC_BASE_URL').replace(/\/$/, '');
  const client = new S3Client({
    region,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
  });
  return {
    provider,
    async uploadImage({ buffer, format, mimetype }) {
      const key = `products/${Date.now()}-${crypto.randomUUID()}.${format}`;
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimetype, CacheControl: 'public, max-age=31536000, immutable' }));
      return { key, url: `${publicBaseUrl}/${key}` };
    },
    async deleteImage(key) {
      if (!key || key.startsWith('http')) return;
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key.replace(/^\/+/, '') }));
    },
    getImageUrl(key) { return key && key.startsWith('http') ? key : `${publicBaseUrl}/${String(key).replace(/^\/+/, '')}`; },
  };
}

module.exports = { createStorage };
