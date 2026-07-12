import { guardAdminOrigin } from '@/server/http/adminRequestGuard'

// ── Admin CSV upload reader (Phase 8 Slice 5) ────────────────────────────────
// The member-import upload can't use guardAdminPost (JSON-only, 4KB). This reads a
// raw text/csv body with a REAL byte cap: it drains request.body through a reader and
// aborts the moment the accumulated size exceeds maxBytes, so an oversized or
// unknown-length (chunked) body is never fully buffered. Content-Length is not
// trusted as the limit. The bytes are then strictly UTF-8 decoded (fatal), so invalid
// encoding is a clean 400 rather than silent U+FFFD substitution.

const NO_STORE = { 'cache-control': 'no-store' }

export type CsvUploadResult =
  | { ok: true; bytes: Uint8Array; text: string }
  | { ok: false; response: Response }

function refuse(reason: string, status: number): CsvUploadResult {
  return { ok: false, response: Response.json({ ok: false, reason }, { status, headers: NO_STORE }) }
}

// Exact MIME match (ignore parameters like "; charset=utf-8"); never a substring test.
function isCsvContentType(header: string | null): boolean {
  if (!header) return false
  const mime = header.split(';')[0].trim().toLowerCase()
  return mime === 'text/csv'
}

export async function readAdminCsvUpload(request: Request, maxBytes: number): Promise<CsvUploadResult> {
  const originRefusal = guardAdminOrigin(request)
  if (originRefusal) return { ok: false, response: originRefusal }

  if (!isCsvContentType(request.headers.get('content-type'))) {
    return refuse('unsupported_media_type', 415)
  }
  // Early exit when the declared length is already over the cap (cheap, but not the
  // real guard — a missing/lying Content-Length still gets caught by the reader below).
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    return refuse('payload_too_large', 413)
  }

  if (!request.body) return refuse('empty', 400)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel() // stop the transfer; don't buffer the rest
        return refuse('payload_too_large', 413)
      }
      chunks.push(value)
    }
  } catch {
    return refuse('invalid_request', 400)
  }

  if (total === 0) return refuse('empty', 400)

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return refuse('invalid_encoding', 400)
  }

  return { ok: true, bytes, text }
}
