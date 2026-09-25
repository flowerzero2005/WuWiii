export interface AssetProvenanceManifest {
  schemaVersion: 1
  author?: string
  licenseName?: string
  sourceUrl?: string
  evidenceUrl?: string
  evidenceNote?: string
  redistribution: 'allowed' | 'local-only' | 'unknown'
}
