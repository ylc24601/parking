import { describe, expect, it } from 'vitest'
import { readAdminCsvUpload } from '@/server/http/csvUpload'

const URL = 'http://localhost/api/admin/members/import/preview'

function req(
  body: BodyInit | null,
  headers: Record<string, string>,
  init: RequestInit & { duplex?: 'half' } = {},
): Request {
  return new Request(URL, { method: 'POST', headers, body, ...init } as RequestInit & { duplex?: string })
}

// A ReadableStream body with no Content-Length (chunked) — the stream cap is the only guard.
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}
const bytesN = (n: number) => new Uint8Array(n).fill(0x61) // 'a'

async function status(r: Awaited<ReturnType<typeof readAdminCsvUpload>>): Promise<number | 'ok'> {
  return r.ok ? 'ok' : r.response.status
}
async function reason(r: Awaited<ReturnType<typeof readAdminCsvUpload>>): Promise<string> {
  if (r.ok) return 'ok'
  return (await r.response.json()).reason
}

describe('readAdminCsvUpload — content-type', () => {
  it('accepts text/csv and text/csv; charset=utf-8', async () => {
    expect(await status(await readAdminCsvUpload(req('a,b\n1,2', { 'content-type': 'text/csv' }), 1024))).toBe('ok')
    expect(await status(await readAdminCsvUpload(req('a,b\n1,2', { 'content-type': 'text/csv; charset=utf-8' }), 1024))).toBe('ok')
  })

  it('rejects a non-csv MIME even when the string contains "csv"', async () => {
    const r = await readAdminCsvUpload(req('x', { 'content-type': 'application/not-text/csv-evil' }), 1024)
    expect(await status(r)).toBe(415)
  })

  it('rejects a missing content-type', async () => {
    // Build a request whose body forces no default content-type override.
    const r = await readAdminCsvUpload(
      new Request(URL, { method: 'POST', body: 'x', headers: {} }),
      1024,
    )
    // string body defaults content-type to text/plain → not text/csv → 415
    expect(await status(r)).toBe(415)
  })
})

describe('readAdminCsvUpload — bounded size (real cap, not Content-Length trust)', () => {
  it('exactly maxBytes passes; maxBytes+1 → 413', async () => {
    expect(await status(await readAdminCsvUpload(req(bytesN(10), { 'content-type': 'text/csv' }), 10))).toBe('ok')
    expect(await status(await readAdminCsvUpload(req(bytesN(11), { 'content-type': 'text/csv' }), 10))).toBe(413)
  })

  it('an over-cap body with an honest Content-Length → 413', async () => {
    const r = await readAdminCsvUpload(req(bytesN(100), { 'content-type': 'text/csv' }), 10)
    expect(await status(r)).toBe(413)
  })

  it('an over-cap chunked stream (no Content-Length) → 413', async () => {
    const r = await readAdminCsvUpload(
      req(streamOf([bytesN(4), bytesN(4), bytesN(4)]), { 'content-type': 'text/csv' }, { duplex: 'half' }),
      10,
    )
    expect(await status(r)).toBe(413)
  })

  it('a lying (small) Content-Length but an over-cap stream still → 413', async () => {
    const r = await readAdminCsvUpload(
      req(streamOf([bytesN(20)]), { 'content-type': 'text/csv', 'content-length': '5' }, { duplex: 'half' }),
      10,
    )
    expect(await status(r)).toBe(413)
  })

  it('an empty body → 400 empty', async () => {
    const r = await readAdminCsvUpload(req(streamOf([]), { 'content-type': 'text/csv' }, { duplex: 'half' }), 1024)
    expect(await reason(r)).toBe('empty')
  })
})

describe('readAdminCsvUpload — encoding + origin', () => {
  it('invalid UTF-8 → 400 invalid_encoding (no silent replacement)', async () => {
    const bad = new Uint8Array([0x61, 0xff, 0xfe, 0x62]) // 0xff 0xfe are not valid UTF-8
    const r = await readAdminCsvUpload(req(bad, { 'content-type': 'text/csv' }), 1024)
    expect(await reason(r)).toBe('invalid_encoding')
  })

  it('valid UTF-8 (incl. CJK) decodes', async () => {
    const r = await readAdminCsvUpload(req('姓名,電話\n王,0912345678', { 'content-type': 'text/csv' }), 1024)
    expect(r.ok && r.text.startsWith('姓名')).toBe(true)
  })

  it('a foreign Origin → 403', async () => {
    const r = await readAdminCsvUpload(
      req('a,b', { 'content-type': 'text/csv', origin: 'https://evil.example' }),
      1024,
    )
    expect(await status(r)).toBe(403)
  })
})
