import { getDriveClient, DRIVE_ROOT_FOLDER_ID } from './google';
import { sanitizeFolderName, getMonthFolder } from './utils';
import { Readable } from 'stream';

// ─── Types ────────────────────────────────────────────────────────────────────
// Using any for drive client due to duplicate google-auth-library package conflict
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DriveClient = any;

// ─── Folder Management ────────────────────────────────────────────────────────

async function ensureFolderByName(
  drive: DriveClient,
  name: string,
  parentId: string,
): Promise<string> {
  const safeName = sanitizeFolderName(name);
  const escapedName = safeName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const existing = await drive.files.list({
    q: `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingFiles = existing.data?.files as any[];
  if (existingFiles && existingFiles.length > 0) {
    return existingFiles[0].id as string;
  }

  const created = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });

  return created.data.id as string;
}

/**
 * Build folder path: Root → [Departemen] → [Divisi] → [YYYY-MM] → [Acara - Tanggal]
 */
export async function ensureSubmissionFolder(params: {
  namaDepartemen: string;
  namaDivisi: string;
  namaAcara: string;
  tanggalPelaksanaan: string;
  accessToken?: string;
}): Promise<{ folderId: string; folderLink: string }> {
  const drive = getDriveClient(params.accessToken) as any;
  const monthFolder = getMonthFolder(params.tanggalPelaksanaan);
  const acaraFolder = sanitizeFolderName(`${params.namaAcara} - ${params.tanggalPelaksanaan}`);
  const rootId = DRIVE_ROOT_FOLDER_ID;

  const deptId   = await ensureFolderByName(drive, params.namaDepartemen, rootId);
  const divId    = await ensureFolderByName(drive, params.namaDivisi, deptId);
  const monthId  = await ensureFolderByName(drive, monthFolder, divId);
  const acaraId  = await ensureFolderByName(drive, acaraFolder, monthId);

  const meta = await drive.files.get({ fileId: acaraId, fields: 'webViewLink' });
  const webViewLink = meta.data?.webViewLink as string | undefined;

  return {
    folderId: acaraId,
    folderLink: webViewLink ?? `https://drive.google.com/drive/folders/${acaraId}`,
  };
}

// ─── File Upload ─────────────────────────────────────────────────────────────

export interface UploadResult {
  fileId: string;
  fileName: string;
  webViewLink: string;
}

export async function uploadFileToDrive(params: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  folderId: string;
  accessToken?: string;
}): Promise<UploadResult> {
  const drive = getDriveClient(params.accessToken) as any;
  const readable = Readable.from(params.buffer);

  const res = await drive.files.create({
    requestBody: { name: params.fileName, parents: [params.folderId] },
    media: { mimeType: params.mimeType, body: readable },
    fields: 'id, name, webViewLink',
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = res.data as any;
  return {
    fileId:      data.id       ?? '',
    fileName:    data.name     ?? params.fileName,
    webViewLink: data.webViewLink ?? '',
  };
}

/**
 * Move a Drive folder (and all its contents) to Trash.
 * Uses user accessToken so the item goes to the user's own Trash.
 */
export async function trashDriveFolder(folderId: string, accessToken?: string): Promise<void> {
  const drive = getDriveClient(accessToken) as any;
  await drive.files.update({
    fileId: folderId,
    requestBody: { trashed: true },
  });
}
