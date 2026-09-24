// Where the signalling state lives while players connect.
//
// On Vercel: a *private* Vercel Blob store. Every read passes useCache:false, which Vercel
// documents as served from origin storage and guaranteed to return the latest write (read-after-
// write across function instances). Every update is a conditional write: create-only (fails if
// the blob exists) or replace-if-unchanged (ifMatch on the ETag we read), so two function
// instances can never silently overwrite each other. Nothing is kept in function memory.
//
// Locally (tools/dev.mjs): an in-memory store with the same semantics, so the whole flow can be
// tested without a Vercel account.

export class Conflict extends Error {}

let memory = null;
export function useMemoryStore() { memory = memory || new MemoryStore(); return memory; }

export function store() { return memory || blobStore; }

const blobStore = {
  async read(path) {
    const { get } = await import('@vercel/blob');
    const r = await get(path, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return { etag: r.blob.etag, data: JSON.parse(await new Response(r.stream).text()) };
  },
  // etag === null: create only; otherwise replace only if still at that ETag. Throws Conflict.
  async write(path, data, etag = null) {
    const { put, BlobPreconditionFailedError, BlobError } = await import('@vercel/blob');
    try {
      const b = await put(path, JSON.stringify(data), {
        access: 'private', contentType: 'application/json', addRandomSuffix: false,
        allowOverwrite: !!etag, ifMatch: etag || undefined, cacheControlMaxAge: 60,
      });
      return b.etag;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) throw new Conflict(e.message);
      // create-only: the API answers "already exists" (a bad request); if the wording ever changes,
      // the blob being there now says the same thing
      if (!etag && e instanceof BlobError && (/exist/i.test(e.message) || await this.read(path))) throw new Conflict(e.message);
      throw e;
    }
  },
  async remove(paths) {
    const { del } = await import('@vercel/blob');
    const list = [].concat(paths);
    if (list.length) await del(list);
  },
};

class MemoryStore {
  constructor() { this.map = new Map(); this.n = 0; this.ops = { read: 0, write: 0 }; }
  async read(path) {
    this.ops.read++;
    const v = this.map.get(path);
    return v ? { etag: v.etag, data: JSON.parse(v.json) } : null;
  }
  async write(path, data, etag = null) {
    this.ops.write++;
    const cur = this.map.get(path);
    if (etag ? !cur || cur.etag !== etag : cur) throw new Conflict('conflict');
    const e = `"m${++this.n}"`;
    this.map.set(path, { etag: e, json: JSON.stringify(data) });
    return e;
  }
  async remove(paths) { for (const p of [].concat(paths)) this.map.delete(p); }
}
