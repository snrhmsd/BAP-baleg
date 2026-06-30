import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { logSubmission, getAllSubmissions, getSubmissionsByEmail } from '@/lib/sheets';
import { ensureSubmissionFolder, uploadFileToDrive } from '@/lib/drive';
import { isValidDeptDivision, groupDepartments, DEPARTMENTS_SEED } from '@/lib/departments';
import { getDepartmentRows } from '@/lib/sheets';
import { computeDeadline, calcTimeStatus, MAX_FILE_SIZE_BYTES, ALLOWED_FILE_TYPES } from '@/lib/utils';

// ─── POST /api/submission ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { role, email, name } = session.user;
  if (role !== 'Pengawas' && role !== 'Master Admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const formData = await req.formData();

    // ─── Step 2: BAP PDF Upload (if folderId is provided) ─────────────────────
    const folderIdInput = formData.get('folderId') as string;
    const rowIndexInput = formData.get('rowIndex') as string;

    if (folderIdInput) {
      const files = formData.getAll('files') as File[];
      if (!files || files.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 file PDF harus diunggah' }, { status: 400 });
      }

      // Validate that it's PDF
      for (const file of files) {
        if (file.type !== 'application/pdf') {
          return NextResponse.json({ error: `${file.name}: Hanya file PDF yang diperbolehkan untuk Laporan BAP` }, { status: 400 });
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          return NextResponse.json({ error: `${file.name}: ukuran melebihi 25 MB` }, { status: 400 });
        }
      }

      const accessToken = (session as any).accessToken;

      // Upload to same Drive folder
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        await uploadFileToDrive({
          buffer,
          fileName: file.name,
          mimeType: file.type,
          folderId: folderIdInput,
          accessToken,
        });
      }

      // Update spreadsheet row if rowIndex is provided
      if (rowIndexInput) {
        const rIndex = parseInt(rowIndexInput, 10);
        if (!isNaN(rIndex) && rIndex > 0) {
          const { addBapToSubmission } = await import('@/lib/sheets');
          await addBapToSubmission(rIndex);
        }
      }

      return NextResponse.json({
        success: true,
        message: 'Laporan BAP (PDF) berhasil diunggah dan dicatat.',
      });
    }

    // ─── Step 1: Initial Submission (Images only) ───────────────────────────
    const kodeDepartemen = formData.get('kodeDepartemen') as string;
    const namaDepartemen = formData.get('namaDepartemen') as string;
    const kodeDivisi = formData.get('kodeDivisi') as string;
    const namaDivisi = formData.get('namaDivisi') as string;
    const namaAcara = formData.get('namaAcara') as string;
    const tanggalPelaksanaan = formData.get('tanggalPelaksanaan') as string;
    const lokasi = formData.get('lokasi') as string;
    const jenisBerkas = formData.get('jenisBerkas') as string;

    if (!kodeDepartemen || !kodeDivisi || !namaAcara || !tanggalPelaksanaan || !lokasi || !jenisBerkas) {
      return NextResponse.json({ error: 'Semua field wajib diisi' }, { status: 400 });
    }

    // Validate dept/division combination
    let departments;
    try {
      if (process.env.SPREADSHEET_ID) {
        const rows = await getDepartmentRows();
        departments = groupDepartments(rows.length > 0 ? rows : DEPARTMENTS_SEED);
      } else {
        departments = groupDepartments(DEPARTMENTS_SEED);
      }
    } catch {
      departments = groupDepartments(DEPARTMENTS_SEED);
    }

    if (!isValidDeptDivision(departments, kodeDepartemen, kodeDivisi)) {
      return NextResponse.json(
        { error: 'Kombinasi Departemen & Divisi tidak valid' },
        { status: 400 },
      );
    }

    // File validation (images only)
    const files = formData.getAll('files') as File[];
    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'Minimal 1 file gambar harus diunggah' }, { status: 400 });
    }

    const fileErrors: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        fileErrors.push(`${file.name}: hanya file gambar yang diperbolehkan pada tahap ini`);
      }
      if (!Object.keys(ALLOWED_FILE_TYPES).includes(file.type)) {
        fileErrors.push(`${file.name}: tipe file tidak didukung`);
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        fileErrors.push(`${file.name}: ukuran melebihi 25 MB`);
      }
    }
    if (fileErrors.length > 0) {
      return NextResponse.json({ error: fileErrors.join('; ') }, { status: 400 });
    }

    // Auto-calculate deadline H+3
    const deadlinePengumpulan = computeDeadline(new Date());
    const statusWaktu = 'Mohon Upload BAP';

    let linkFolderDrive = '';
    let folderId = '';

    const accessToken = (session as any).accessToken;

    if (process.env.DRIVE_ROOT_FOLDER_ID) {
      const result = await ensureSubmissionFolder({
        namaDepartemen,
        namaDivisi,
        namaAcara,
        tanggalPelaksanaan,
        accessToken,
      });
      linkFolderDrive = result.folderLink;
      folderId = result.folderId;

      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        await uploadFileToDrive({
          buffer,
          fileName: file.name,
          mimeType: file.type,
          folderId,
          accessToken,
        });
      }
    } else {
      console.warn('[submission] DRIVE_ROOT_FOLDER_ID not set — skipping Drive upload');
      linkFolderDrive = 'https://drive.google.com (not configured)';
    }

    let rowIndex = 0;
    if (process.env.SPREADSHEET_ID) {
      rowIndex = await logSubmission({
        emailPengirim: email ?? '',
        namaPengirim: name ?? email ?? '',
        rolePengirim: role,
        departemen: namaDepartemen,
        divisi: namaDivisi,
        namaAcara,
        tanggalPelaksanaan,
        deadlinePengumpulan,
        lokasi,
        jenisBerkas,
        jumlahFile: files.length,
        linkFolderDrive,
        statusWaktu,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: rowIndex,
        folderId,
        namaAcara,
        departemen: namaDepartemen,
        divisi: namaDivisi,
        jumlahFile: files.length,
        deadline: deadlinePengumpulan,
        linkFolderDrive,
      },
    });
  } catch (err) {
    console.error('[API/submission POST] Error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// ─── GET /api/submission ──────────────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { role, email } = session.user;

  try {
    if (role === 'Master Admin') {
      if (!process.env.SPREADSHEET_ID) {
        return NextResponse.json({ success: true, data: [] });
      }
      const submissions = await getAllSubmissions();
      return NextResponse.json({ success: true, data: submissions });
    } else {
      if (!process.env.SPREADSHEET_ID) {
        return NextResponse.json({ success: true, data: [] });
      }
      const submissions = await getSubmissionsByEmail(email ?? '');
      return NextResponse.json({ success: true, data: submissions });
    }
  } catch (err) {
    console.error('[API/submission GET] Error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
