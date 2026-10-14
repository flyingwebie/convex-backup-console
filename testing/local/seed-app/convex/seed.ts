import { v } from 'convex/values'
import { action, internalMutation, query } from './_generated/server'
import { api, internal } from './_generated/api'

export const insertNotes = internalMutation({
  args: { from: v.number(), count: v.number() },
  handler: async (ctx, { from, count }) => {
    const ids = []
    for (let i = from; i < from + count; i++) ids.push(await ctx.db.insert('notes', { title: `note ${i}`, n: i }))
    return ids
  },
})

export const attach = internalMutation({
  args: { noteId: v.id('notes'), file: v.id('_storage'), sha: v.string() },
  handler: (ctx, args) => ctx.db.insert('attachments', args),
})

/** Inserts `notes` documents and `files` random blobs in storage. */
export const run = action({
  args: { notes: v.number(), files: v.number() },
  handler: async (ctx, { notes, files }) => {
    const ids = await ctx.runMutation(internal.seed.insertNotes, { from: 0, count: notes })
    for (let i = 0; i < files; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(64 * 1024))
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
      const file = await ctx.storage.store(new Blob([bytes]))
      await ctx.runMutation(internal.seed.attach, { noteId: ids[i % ids.length], file, sha })
    }
  },
})

/** Fingerprint used to compare instances after a restore. */
export const fingerprint = query({
  args: {},
  handler: async (ctx) => {
    const notes = await ctx.db.query('notes').collect()
    const attachments = await ctx.db.query('attachments').collect()
    const storage = await ctx.db.system.query('_storage').collect()
    return {
      notes: notes.length,
      noteSum: notes.reduce((s, n) => s + n.n, 0),
      attachments: attachments.length,
      storageFiles: storage.length,
      shas: attachments.map((a) => a.sha).sort().join(',').length,
    }
  },
})

export const listAttachments = query({
  args: {},
  handler: (ctx) => ctx.db.query('attachments').collect(),
})

/** Re-hashes every stored file and compares it with the hash recorded at seed time. */
export const verifyFiles = action({
  args: {},
  handler: async (ctx): Promise<{ checked: number; mismatched: number; missing: number }> => {
    const attachments = await ctx.runQuery(api.seed.listAttachments, {})
    let mismatched = 0
    let missing = 0
    for (const a of attachments) {
      const blob = await ctx.storage.get(a.file)
      if (!blob) { missing++; continue }
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
      const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
      if (sha !== a.sha) mismatched++
    }
    return { checked: attachments.length, mismatched, missing }
  },
})
