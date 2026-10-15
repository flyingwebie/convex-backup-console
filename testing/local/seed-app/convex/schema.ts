import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  notes: defineTable({ title: v.string(), n: v.number() }),
  attachments: defineTable({ noteId: v.id('notes'), file: v.id('_storage'), sha: v.string() }),
})
