import {
  getSheetsClient,
  SPREADSHEET_ID,
  SHEET_NAMES,
} from './google';
import { AppUser, DepartmentRow, Submission, VerificationStatus } from '@/types';
import { formatTanggalWaktu, parseIndonesianDate } from './utils';

// ─── Helper: rows → typed array ──────────────────────────────────────────────

function rowsToSubmissions(rows: string[][]): Submission[] {
  // Skip header row (index 0)
  return rows.slice(1).map((row, idx) => {
    const statusVerifikasi = (row[13] as Submission['statusVerifikasi']) ?? 'Belum Diperiksa';
    let statusWaktu = (row[12] as Submission['statusWaktu']) ?? 'Tepat Waktu';

    if (statusVerifikasi === 'Draft') {
      const timestampInput = row[0] ?? '';
      if (timestampInput) {
        try {
          const created = parseIndonesianDate(timestampInput);
          const diffMs = new Date().getTime() - created.getTime();
          const diffDays = diffMs / (1000 * 60 * 60 * 24);
          if (diffDays > 3) {
            statusWaktu = 'Terlambat';
          } else {
            statusWaktu = 'Mohon Upload BAP';
          }
        } catch {
          statusWaktu = 'Mohon Upload BAP';
        }
      } else {
        statusWaktu = 'Mohon Upload BAP';
      }
    }

    return {
      id: String(idx + 2), // 1-indexed, +1 for header
      timestampInput: row[0] ?? '',
      emailPengirim: row[1] ?? '',
      namaPengirim: row[1] ?? '', // will be enriched with user data if needed
      rolePengirim: (row[2] as Submission['rolePengirim']) ?? 'Pengawas',
      departemen: row[3] ?? '',
      divisi: row[4] ?? '',
      namaAcara: row[5] ?? '',
      tanggalPelaksanaan: row[6] ?? '',
      deadlinePengumpulan: row[7] ?? '',
      lokasi: row[8] ?? '',
      jenisBerkas: (row[9] as Submission['jenisBerkas']) ?? 'Foto',
      jumlahFile: parseInt(row[10] ?? '0', 10),
      linkFolderDrive: row[11] ?? '',
      statusWaktu,
      statusVerifikasi,
      catatanAdmin: row[14] ?? '',
      diverifikasiOleh: row[15] ?? '',
      waktuVerifikasi: row[16] ?? '',
    };
  });
}

// ─── Log Submission ───────────────────────────────────────────────────────────

export interface LogSubmissionParams {
  emailPengirim: string;
  namaPengirim: string;
  rolePengirim: string;
  departemen: string;
  divisi: string;
  namaAcara: string;
  tanggalPelaksanaan: string;
  deadlinePengumpulan: string;
  lokasi: string;
  jenisBerkas: string;
  jumlahFile: number;
  linkFolderDrive: string;
  statusWaktu: string;
}

export async function logSubmission(params: LogSubmissionParams): Promise<number> {
  const sheets = getSheetsClient();
  const now = formatTanggalWaktu(new Date());

  const values = [
    now,
    params.emailPengirim,
    params.rolePengirim,
    params.departemen,
    params.divisi,
    params.namaAcara,
    params.tanggalPelaksanaan,
    params.deadlinePengumpulan,
    params.lokasi,
    params.jenisBerkas,
    params.jumlahFile,
    params.linkFolderDrive,
    params.statusWaktu,
    'Draft', // statusVerifikasi initial is Draft
    '', // catatanAdmin
    '', // diverifikasiOleh
    '', // waktuVerifikasi
  ];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.logSubmission}!A:Q`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] },
  });

  const updatedRange = res.data.updates?.updatedRange;
  const match = updatedRange?.match(/A(\d+):/);
  return match ? parseInt(match[1], 10) : 0;
}

export async function deleteSubmissionRow(rowIndex: number): Promise<void> {
  const sheets = getSheetsClient();

  // Get the numeric sheetId for 'Log Submission'
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });
  const sheet = (spreadsheet.data.sheets as any[])?.find(
    (s: any) => s.properties?.title === SHEET_NAMES.logSubmission,
  );
  const sheetId: number = sheet?.properties?.sheetId ?? 0;

  // Delete the row (0-indexed: rowIndex-1 to rowIndex)
  await (sheets.spreadsheets as any).batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex - 1,
              endIndex: rowIndex,
            },
          },
        },
      ],
    },
  });
}

export async function addBapToSubmission(rowIndex: number): Promise<void> {
  const sheets = getSheetsClient();

  // 1. Get current row data (timestamp and file count)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.logSubmission}!A${rowIndex}:K${rowIndex}`,
  });

  const row = res.data.values?.[0] ?? [];
  const timestampStr = row[0] ?? '';
  const currentCount = parseInt(row[10] ?? '0', 10);
  const newCount = currentCount + 1;

  // Calculate if the PDF upload is within 3 days since Step 1 draft creation
  let statusWaktu: 'Tepat Waktu' | 'Terlambat' = 'Tepat Waktu';
  if (timestampStr) {
    try {
      const created = parseIndonesianDate(timestampStr);
      const diffMs = new Date().getTime() - created.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays > 3) {
        statusWaktu = 'Terlambat';
      }
    } catch (e) {
      console.error('Error parsing date in addBapToSubmission:', e);
    }
  }

  // 2. Update J:K (Jenis Berkas & Jumlah File)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.logSubmission}!J${rowIndex}:K${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [['Foto & PDF', newCount]],
    },
  });

  // 3. Update M (Status Waktu)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.logSubmission}!M${rowIndex}:M${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[statusWaktu]],
    },
  });

  // 4. Update N (Status Verifikasi) from 'Draft' to 'Belum Diperiksa'
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.logSubmission}!N${rowIndex}:N${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [['Belum Diperiksa']],
    },
  });
}

// ─── Get Submissions ──────────────────────────────────────────────────────────

export async function getAllSubmissions(): Promise<Submission[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.logSubmission}!A:Q`,
  });

  const rows = (res.data.values as string[][]) ?? [];
  if (rows.length < 2) return [];
  return rowsToSubmissions(rows);
}

export async function getSubmissionsByEmail(email: string): Promise<Submission[]> {
  const all = await getAllSubmissions();
  return all.filter((s) => s.emailPengirim === email);
}

// ─── Update Verification ──────────────────────────────────────────────────────

export async function updateVerificationStatus(params: {
  rowIndex: number; // 1-indexed, includes header row
  statusVerifikasi: VerificationStatus;
  catatanAdmin: string;
  diverifikasiOleh: string;
}): Promise<void> {
  const sheets = getSheetsClient();
  const now = formatTanggalWaktu(new Date());

  // Columns N (14), O (15), P (16), Q (17) — 1-indexed = N=14
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.logSubmission}!N${params.rowIndex}:Q${params.rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [
          params.statusVerifikasi,
          params.catatanAdmin,
          params.diverifikasiOleh,
          now,
        ],
      ],
    },
  });
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getAllUsers(): Promise<AppUser[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.daftarPengguna}!A:F`,
  });

  const rows = (res.data.values as string[][]) ?? [];
  if (rows.length < 2) return [];

  return rows.slice(1).map((row) => ({
    email: row[0] ?? '',
    namaLengkap: row[1] ?? '',
    role: (row[2] as AppUser['role']) ?? 'Pengawas',
    departemenDivisi: row[3] ?? '',
    statusAktif: (row[4] as AppUser['statusAktif']) ?? 'Aktif',
    tanggalTerdaftar: row[5] ?? '',
  }));
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const users = await getAllUsers();
  const searchEmail = email.trim().toLowerCase();
  return users.find((u) => u.email.trim().toLowerCase() === searchEmail && u.statusAktif === 'Aktif') ?? null;
}

export async function addUser(user: Omit<AppUser, 'tanggalTerdaftar'>): Promise<void> {
  const sheets = getSheetsClient();
  const now = new Date().toISOString().split('T')[0];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.daftarPengguna}!A:F`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        user.email,
        user.namaLengkap,
        user.role,
        user.departemenDivisi ?? '',
        user.statusAktif,
        now,
      ]],
    },
  });
}

export async function updateUserStatus(
  email: string,
  updates: Partial<Pick<AppUser, 'role' | 'statusAktif' | 'namaLengkap'>>,
): Promise<boolean> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.daftarPengguna}!A:F`,
  });

  const rows = (res.data.values as string[][]) ?? [];
  const rowIdx = rows.findIndex((r) => r[0] === email);
  if (rowIdx === -1) return false;

  const existing = rows[rowIdx];
  const updated = [
    existing[0],
    updates.namaLengkap ?? existing[1],
    updates.role ?? existing[2],
    existing[3],
    updates.statusAktif ?? existing[4],
    existing[5],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.daftarPengguna}!A${rowIdx + 1}:F${rowIdx + 1}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [updated] },
  });

  return true;
}

// ─── Departments ──────────────────────────────────────────────────────────────

export async function getDepartmentRows(): Promise<DepartmentRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAMES.departemenDivisi}!A:E`,
  });

  const rows = (res.data.values as string[][]) ?? [];
  if (rows.length < 2) return [];

  return rows.slice(1).map((row) => ({
    kodeDepartemen: row[0] ?? '',
    namaDepartemen: row[1] ?? '',
    kodeDivisi: row[2] ?? '',
    namaDivisi: row[3] ?? '',
    statusAktif: (row[4] as DepartmentRow['statusAktif']) ?? 'Aktif',
  }));
}
