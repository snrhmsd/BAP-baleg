import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAllSubmissions, deleteSubmissionRow } from '@/lib/sheets';
import { trashDriveFolder } from '@/lib/drive';

// ─── DELETE /api/submission/[id] ──────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const rowIndex = parseInt(id, 10);

  if (isNaN(rowIndex) || rowIndex < 2) {
    return NextResponse.json({ error: 'ID tidak valid' }, { status: 400 });
  }

  // Parse optional folderId from body
  let folderId = '';
  try {
    const body = await req.json();
    folderId = body.folderId ?? '';
  } catch {
    // folderId is optional
  }

  try {
    // Fetch and verify ownership
    if (process.env.SPREADSHEET_ID) {
      const all = await getAllSubmissions();
      const submission = all.find((s) => s.id === String(rowIndex));

      if (!submission) {
        return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 });
      }

      // Only the owner can delete
      if (submission.emailPengirim !== session.user.email && session.user.role !== 'Master Admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // Only Draft submissions can be self-deleted
      if (submission.statusVerifikasi !== 'Draft' && session.user.role !== 'Master Admin') {
        return NextResponse.json(
          { error: 'Hanya submission berstatus Draft yang dapat dihapus' },
          { status: 400 },
        );
      }
    }

    // Trash Drive folder (non-fatal if fails)
    if (folderId) {
      try {
        const accessToken = (session as any).accessToken;
        await trashDriveFolder(folderId, accessToken);
      } catch (driveErr) {
        console.warn('[DELETE] Gagal memindahkan folder Drive ke Trash:', driveErr);
      }
    }

    // Delete row from Sheets
    if (process.env.SPREADSHEET_ID) {
      await deleteSubmissionRow(rowIndex);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API/submission/[id] DELETE] Error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
