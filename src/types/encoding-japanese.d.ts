declare module 'encoding-japanese' {
  interface ConvertOptions {
    to: string
    from: string
    type?: 'string' | 'array' | 'arraybuffer'
  }

  const Encoding: {
    detect(data: Uint8Array | number[]): string | boolean | null
    convert(data: string | Uint8Array | number[], options: ConvertOptions): string | number[] | ArrayBuffer
  }

  export default Encoding
}
