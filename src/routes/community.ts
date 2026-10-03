import { Hono } from 'hono'
import type { Bindings } from '../types'
import { getOrCreateSessionId } from '../utils/session'

const community = new Hono<{ Bindings: Bindings }>()

// GET /api/community/posts?page=1&page_size=10
// PHASE 14: Fixed N+1 query. Previously ran one `comments` query PER post.
// Now runs exactly 3 queries total regardless of page size: one page of
// posts, one batched comments query (WHERE post_id IN (...)), and one
// batched likes query for the current session.
community.get('/posts', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('page_size') || '10', 10) || 10))
  const offset = (page - 1) * pageSize

  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM posts`).first()
  const totalPosts = (countRow as any)?.cnt ?? 0

  const { results: posts } = await c.env.DB.prepare(
    `SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(pageSize, offset)
    .all()

  const postIds = (posts as any[]).map((p) => p.id)

  let commentsByPost: Record<number, any[]> = {}
  if (postIds.length > 0) {
    const placeholders = postIds.map(() => '?').join(',')
    const { results: comments } = await c.env.DB.prepare(
      `SELECT * FROM comments WHERE post_id IN (${placeholders}) ORDER BY created_at ASC`
    )
      .bind(...postIds)
      .all()
    for (const cm of comments as any[]) {
      if (!commentsByPost[cm.post_id]) commentsByPost[cm.post_id] = []
      commentsByPost[cm.post_id].push(cm)
    }
  }

  const { results: likedRows } = await c.env.DB.prepare(
    `SELECT post_id FROM post_likes WHERE session_id = ?`
  )
    .bind(sessionId)
    .all()
  const likedSet = new Set((likedRows as any[]).map((r) => r.post_id))

  const enriched = (posts as any[]).map((p) => ({
    ...p,
    tags: safeParseTags(p.tags),
    comments: commentsByPost[p.id] || [],
    liked_by_me: likedSet.has(p.id),
    editable_by_me: p.session_id === sessionId
  }))

  return c.json({
    posts: enriched,
    page,
    page_size: pageSize,
    total_posts: totalPosts,
    total_pages: Math.max(1, Math.ceil(totalPosts / pageSize))
  })
})

// POST /api/community/posts  { author, title, content, tags?: string[] }
community.post('/posts', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const { author, title, content, tags } = await c.req.json<{
    author: string
    title: string
    content: string
    tags?: string[]
  }>()

  if (!author?.trim() || !title?.trim() || !content?.trim()) {
    return c.json({ error: 'Author, title, and content are all required.' }, 400)
  }
  if (title.length > 200) return c.json({ error: 'Title too long (max 200 characters).' }, 400)
  if (content.length > 5000) return c.json({ error: 'Content too long (max 5000 characters).' }, 400)

  // PHASE 14: Simple, useful tags -- plant/disease only, not a general tag system.
  const cleanTags = Array.isArray(tags)
    ? tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 5).map((t) => t.trim().slice(0, 60))
    : []

  const result = await c.env.DB.prepare(
    `INSERT INTO posts (session_id, author, title, content, tags) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(sessionId, author.trim().slice(0, 80), title.trim(), content.trim(), JSON.stringify(cleanTags))
    .run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// PUT /api/community/posts/:id  { title, content, tags? } -- only by original author's session
community.put('/posts/:id', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const id = c.req.param('id')
  const { title, content, tags } = await c.req.json<{ title: string; content: string; tags?: string[] }>()

  if (!title?.trim() || !content?.trim()) {
    return c.json({ error: 'Title and content are required.' }, 400)
  }

  const post = await c.env.DB.prepare(`SELECT session_id FROM posts WHERE id = ?`).bind(id).first()
  if (!post) return c.json({ error: 'Post not found.' }, 404)
  if (post.session_id !== sessionId) return c.json({ error: 'Not authorized to edit this post.' }, 403)

  const cleanTags = Array.isArray(tags)
    ? tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 5).map((t) => t.trim().slice(0, 60))
    : undefined

  if (cleanTags) {
    await c.env.DB.prepare(`UPDATE posts SET title = ?, content = ?, tags = ? WHERE id = ?`)
      .bind(title.trim(), content.trim(), JSON.stringify(cleanTags), id)
      .run()
  } else {
    await c.env.DB.prepare(`UPDATE posts SET title = ?, content = ? WHERE id = ?`)
      .bind(title.trim(), content.trim(), id)
      .run()
  }

  return c.json({ success: true })
})

// DELETE /api/community/posts/:id
community.delete('/posts/:id', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const id = c.req.param('id')

  const post = await c.env.DB.prepare(`SELECT session_id FROM posts WHERE id = ?`).bind(id).first()
  if (!post) return c.json({ error: 'Post not found.' }, 404)
  if (post.session_id !== sessionId) return c.json({ error: 'Not authorized to delete this post.' }, 403)

  await c.env.DB.prepare(`DELETE FROM posts WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

// POST /api/community/posts/bulk-delete  { ids: number[] }
community.post('/posts/bulk-delete', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const { ids } = await c.req.json<{ ids: number[] }>()
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: 'No ids provided.' }, 400)

  const placeholders = ids.map(() => '?').join(',')
  await c.env.DB.prepare(
    `DELETE FROM posts WHERE id IN (${placeholders}) AND session_id = ?`
  )
    .bind(...ids, sessionId)
    .run()

  return c.json({ success: true })
})

// POST /api/community/posts/:id/like -- toggle like (one per session)
community.post('/posts/:id/like', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    `SELECT id FROM post_likes WHERE post_id = ? AND session_id = ?`
  )
    .bind(id, sessionId)
    .first()

  if (existing) {
    await c.env.DB.prepare(`DELETE FROM post_likes WHERE post_id = ? AND session_id = ?`)
      .bind(id, sessionId)
      .run()
    await c.env.DB.prepare(`UPDATE posts SET likes = MAX(likes - 1, 0) WHERE id = ?`).bind(id).run()
    return c.json({ liked: false })
  } else {
    await c.env.DB.prepare(`INSERT INTO post_likes (post_id, session_id) VALUES (?, ?)`)
      .bind(id, sessionId)
      .run()
    await c.env.DB.prepare(`UPDATE posts SET likes = likes + 1 WHERE id = ?`).bind(id).run()
    return c.json({ liked: true })
  }
})

// POST /api/community/posts/:id/comments  { author, content }
community.post('/posts/:id/comments', async (c) => {
  const id = c.req.param('id')
  const { author, content } = await c.req.json<{ author: string; content: string }>()

  if (!author?.trim() || !content?.trim()) {
    return c.json({ error: 'Author and content are required.' }, 400)
  }
  if (content.length > 2000) return c.json({ error: 'Comment too long (max 2000 characters).' }, 400)

  const post = await c.env.DB.prepare(`SELECT id FROM posts WHERE id = ?`).bind(id).first()
  if (!post) return c.json({ error: 'Post not found.' }, 404)

  await c.env.DB.prepare(`INSERT INTO comments (post_id, author, content) VALUES (?, ?, ?)`)
    .bind(id, author.trim().slice(0, 80), content.trim())
    .run()

  return c.json({ success: true })
})

function safeParseTags(v: any): string[] {
  if (!v) return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export default community
