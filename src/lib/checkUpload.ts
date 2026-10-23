import { validateUpload, UPLOAD_RULES, type UploadKind, type UploadResult } from '../shared/upload'

/**
 * Checks a chosen file by its real contents before the app accepts it.
 * Videos can be large, so only their header is read; other files are read in full
 * (PDFs are scanned end to end for scripts and embedded files).
 */
export async function checkFile(file: File, kind: UploadKind): Promise<UploadResult> {
  const source = kind === 'video' ? file.slice(0, 64 * 1024) : file
  const bytes = new Uint8Array(await source.arrayBuffer())
  return validateUpload({ name: file.name, size: file.size }, bytes, kind)
}

export const uploadHint = (kind: UploadKind) => UPLOAD_RULES[kind].label
