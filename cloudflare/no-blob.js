// On Cloudflare the rooms live in Durable Objects, never in Vercel Blob: wrangler.jsonc points
// '@vercel/blob' here so the Worker doesn't bundle it.
const unavailable = () => { throw new Error('Vercel Blob is not used on Cloudflare'); };
export const get = unavailable, put = unavailable, del = unavailable;
export class BlobError extends Error {}
export class BlobPreconditionFailedError extends BlobError {}
