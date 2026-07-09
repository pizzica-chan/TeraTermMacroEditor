interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface FileSystemFileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | BufferSource | Blob): Promise<void>
  close(): Promise<void>
}

interface Window {
  showOpenFilePicker?(options?: {
    types?: FilePickerAcceptType[]
    multiple?: boolean
  }): Promise<FileSystemFileHandle[]>
  showSaveFilePicker?(options?: {
    suggestedName?: string
    types?: FilePickerAcceptType[]
  }): Promise<FileSystemFileHandle>
}
