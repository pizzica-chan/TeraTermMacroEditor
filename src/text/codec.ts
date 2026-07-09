import Encoding from 'encoding-japanese'
import type { TextEncoding } from './types'

function toLibEncoding(enc: TextEncoding): string {
  return enc === 'UTF-8' ? 'UTF8' : 'SJIS'
}

function fromLibEncoding(enc: string | boolean | null | undefined): TextEncoding {
  if (!enc || typeof enc !== 'string') return 'UTF-8'
  const upper = enc.toUpperCase()
  if (upper === 'SJIS' || upper === 'CP932' || upper === 'WINDOWS31J' || upper === 'SHIFT_JIS') return 'SJIS'
  return 'UTF-8'
}

export function detectEncoding(bytes: Uint8Array): TextEncoding {
  // UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'UTF-8'
  }

  const detected = Encoding.detect(bytes)
  return fromLibEncoding(detected)
}

export function decodeBytes(bytes: Uint8Array, encoding: TextEncoding): string {
  let data = bytes
  if (encoding === 'UTF-8' && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    data = bytes.slice(3)
  }

  const result = Encoding.convert(data, {
    to: 'UNICODE',
    from: toLibEncoding(encoding),
    type: 'string',
  })

  return typeof result === 'string' ? result : ''
}

export function encodeString(text: string, encoding: TextEncoding, withBom = false): Uint8Array {
  const result = Encoding.convert(text, {
    to: toLibEncoding(encoding),
    from: 'UNICODE',
    type: 'array',
  }) as number[]

  if (encoding === 'UTF-8' && withBom) {
    return new Uint8Array([0xef, 0xbb, 0xbf, ...result])
  }

  return new Uint8Array(result)
}

/** 指定エンコードで表現できない文字があるか検証 */
export function findUnencodableChars(text: string, encoding: TextEncoding): string[] {
  if (encoding === 'UTF-8') return []

  const encoded = Encoding.convert(text, {
    to: toLibEncoding(encoding),
    from: 'UNICODE',
    type: 'array',
  }) as number[]

  const roundTrip = Encoding.convert(encoded, {
    to: 'UNICODE',
    from: toLibEncoding(encoding),
    type: 'string',
  }) as string

  if (roundTrip === text) return []

  const bad: string[] = []
  for (const char of text) {
    const single = Encoding.convert(char, {
      to: toLibEncoding(encoding),
      from: 'UNICODE',
      type: 'array',
    }) as number[]
    const back = Encoding.convert(single, {
      to: 'UNICODE',
      from: toLibEncoding(encoding),
      type: 'string',
    }) as string
    if (back !== char && !bad.includes(char)) bad.push(char)
  }
  return bad
}
