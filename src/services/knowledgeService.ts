// PHASE 12: Grounded / curated disease knowledge base.
//
// A small, hand-curated set of well-established plant disease facts, stored
// in D1 (table `knowledge_base`, seeded by migration 0004). This is
// deliberately NOT a vector database -- the knowledge base is small enough
// that an exact/fuzzy name lookup in SQLite is simple, fast, and fully
// explainable. When a curated record exists for a disease, callers should
// prefer it and label it "Verified PlantGuard Knowledge"; otherwise fall
// back to the existing AI-generated + cached `disease_cache` path, clearly
// labeled "General AI Knowledge".

export type KnowledgeRecord = {
  plant_name: string | null
  disease_name: string
  symptoms: string[]
  causes: string[]
  treatment: string[]
  prevention: string[]
  source: string
  verified: boolean
  last_updated: string | null
}

function safeParseArr(v: any): string[] {
  if (!v) return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Exact-name lookup first, then a loose "contains" match as a fallback. */
export async function lookupKnowledge(db: D1Database, diseaseName: string): Promise<KnowledgeRecord | null> {
  const exact = await db.prepare(`SELECT * FROM knowledge_base WHERE disease_name = ? COLLATE NOCASE`).bind(diseaseName).first()
  const row = exact || (await fuzzyLookup(db, diseaseName))
  if (!row) return null
  return {
    plant_name: (row as any).plant_name ?? null,
    disease_name: (row as any).disease_name,
    symptoms: safeParseArr((row as any).symptoms),
    causes: safeParseArr((row as any).causes),
    treatment: safeParseArr((row as any).treatment),
    prevention: safeParseArr((row as any).prevention),
    source: (row as any).source,
    verified: !!(row as any).verified,
    last_updated: (row as any).last_updated ?? null
  }
}

async function fuzzyLookup(db: D1Database, diseaseName: string) {
  const cleaned = diseaseName.trim()
  if (!cleaned) return null
  const { results } = await db
    .prepare(`SELECT * FROM knowledge_base WHERE disease_name LIKE ? COLLATE NOCASE LIMIT 1`)
    .bind(`%${cleaned}%`)
    .all()
  return (results as any[])[0] ?? null
}
