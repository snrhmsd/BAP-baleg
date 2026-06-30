'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Submission, UploadProgress } from '@/types';
import { VerificationBadge, TimeBadge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { formatTanggalWaktu, formatTanggal } from '@/lib/utils';
import { ExternalLink, RefreshCw, ClipboardList, X, AlertCircle, CheckCircle, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import FileUpload from '@/components/ui/FileUpload';

const ALLOWED_PDF_TYPE = {
  'application/pdf': ['.pdf'],
};

export default function RiwayatPage() {
  const { data: session } = useSession();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Draft BAP Upload Modal state
  const [activeBapUploadSub, setActiveBapUploadSub] = useState<Submission | null>(null);
  const [bapFiles, setBapFiles] = useState<File[]>([]);
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalProgresses, setModalProgresses] = useState<UploadProgress[]>([]);
  const [modalError, setModalError] = useState('');
  const [modalSuccess, setModalSuccess] = useState(false);

  // Delete state
  const [confirmDeleteSub, setConfirmDeleteSub] = useState<Submission | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const fetchData = () => {
    setLoading(true);
    setError('');
    fetch('/api/submission')
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          const own = (res.data as Submission[]).filter(
            (s) => s.emailPengirim === session?.user?.email,
          );
          setSubmissions(own.reverse()); // newest first
        } else {
          setError(res.error ?? 'Gagal memuat data');
        }
      })
      .catch(() => setError('Gagal menghubungi server'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (session?.user) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const getFolderIdFromLink = (link: string) => {
    const match = link.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBapUploadSub) return;
    if (bapFiles.length === 0) {
      setModalError('Silakan pilih berkas Laporan BAP (PDF) terlebih dahulu');
      return;
    }
    if (bapFiles[0].type !== 'application/pdf') {
      setModalError('Berkas Laporan BAP harus berformat PDF');
      return;
    }

    setModalSubmitting(true);
    setModalError('');

    const progresses: UploadProgress[] = bapFiles.map((f) => ({
      fileName: f.name,
      progress: 0,
      status: 'pending',
    }));
    setModalProgresses(progresses);

    const progressInterval = setInterval(() => {
      setModalProgresses((prev) =>
        prev.map((p) =>
          p.status === 'pending' || p.status === 'uploading'
            ? { ...p, progress: Math.min(p.progress + 20, 90), status: 'uploading' }
            : p,
        ),
      );
    }, 200);

    try {
      const folderId = getFolderIdFromLink(activeBapUploadSub.linkFolderDrive);
      const fd = new FormData();
      fd.append('folderId', folderId);
      fd.append('rowIndex', activeBapUploadSub.id);
      bapFiles.forEach((f) => fd.append('files', f));

      const res = await fetch('/api/submission', { method: 'POST', body: fd });
      const data = await res.json();

      clearInterval(progressInterval);

      if (res.ok && data.success) {
        setModalProgresses((prev) =>
          prev.map((p) => ({ ...p, progress: 100, status: 'done' })),
        );
        setModalSuccess(true);
        setTimeout(() => {
          closeModal();
          // Refresh after modal is closed so data is accurate
          fetchData();
        }, 1500);
      } else {
        setModalProgresses((prev) =>
          prev.map((p) => ({ ...p, status: 'error' })),
        );
        setModalError(data.error ?? 'Terjadi kesalahan saat mengunggah Laporan BAP.');
      }
    } catch {
      clearInterval(progressInterval);
      setModalError('Gagal menghubungi server. Periksa koneksi internet.');
    } finally {
      setModalSubmitting(false);
    }
  };

  const closeModal = () => {
    setActiveBapUploadSub(null);
    setBapFiles([]);
    setModalProgresses([]);
    setModalError('');
    setModalSuccess(false);
    setModalSubmitting(false);
  };

  const handleDelete = async () => {
    if (!confirmDeleteSub) return;
    setDeleting(true);
    setDeleteError('');

    const folderId = getFolderIdFromLink(confirmDeleteSub.linkFolderDrive);

    try {
      const res = await fetch(`/api/submission/${confirmDeleteSub.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setConfirmDeleteSub(null);
        fetchData();
      } else {
        setDeleteError(data.error ?? 'Gagal menghapus submission');
      }
    } catch {
      setDeleteError('Gagal menghubungi server');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-navy-900">
            Riwayat <span className="text-gold-500">Submission</span>
          </h1>
          <p className="text-gray-500 mt-1">
            Seluruh pengiriman bukti pengawasan milik kamu
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          loading={loading}
          id="btn-refresh-riwayat"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Summary */}
      {!loading && submissions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total', value: submissions.length, icon: '📋' },
            {
              label: 'Draft (Belum BAP)',
              value: submissions.filter((s) => s.statusVerifikasi === 'Draft').length,
              icon: '✏️',
            },
            {
              label: 'Sesuai',
              value: submissions.filter((s) => s.statusVerifikasi === 'Sesuai').length,
              icon: '🎯',
            },
            {
              label: 'Perlu Revisi',
              value: submissions.filter((s) => s.statusVerifikasi === 'Perlu Revisi').length,
              icon: '🔄',
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white border border-gray-100 rounded-2xl p-4 text-center shadow-sm"
            >
              <span className="text-2xl">{stat.icon}</span>
              <p className="text-2xl font-extrabold text-navy-900 mt-1">{stat.value}</p>
              <p className="text-xs text-gray-500 font-medium">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <div className="text-center py-8 text-red-600">
            <p className="text-4xl mb-2">⚠️</p>
            <p className="font-semibold">{error}</p>
            <p className="text-sm text-gray-500 mt-1">Coba lagi atau hubungi admin.</p>
          </div>
        </Card>
      ) : submissions.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <ClipboardList className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-xl font-bold text-navy-900">Belum ada submission</p>
            <p className="text-gray-500 mt-1 text-sm">
              Upload bukti pengawasan pertama kamu dari halaman Upload.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {submissions.map((s) => (
            <div
              key={s.id}
              className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex flex-col md:flex-row md:items-start gap-3">
                {/* Main info */}
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-navy-900 text-base">{s.namaAcara}</h3>
                    <TimeBadge status={s.statusWaktu} />
                    <VerificationBadge status={s.statusVerifikasi} />
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                    <span>🏢 {s.departemen} → {s.divisi}</span>
                    <span>📅 {formatTanggal(s.tanggalPelaksanaan)}</span>
                    <span>📍 {s.lokasi}</span>
                    <span>📁 {s.jumlahFile} file ({s.jenisBerkas})</span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                    <span>Submit: {formatTanggalWaktu(s.timestampInput)}</span>
                    <span>Deadline: {formatTanggal(s.deadlinePengumpulan)}</span>
                  </div>

                  {/* Admin note */}
                  {s.catatanAdmin && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm text-amber-800 mt-2">
                      <span className="font-semibold">Catatan Admin: </span>
                      {s.catatanAdmin}
                    </div>
                  )}
                </div>

                {/* Drive & Upload Actions */}
                <div className="flex flex-wrap md:flex-col items-center md:items-end gap-2 shrink-0">
                  {s.statusVerifikasi === 'Draft' && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setActiveBapUploadSub(s)}
                      id={`btn-upload-bap-${s.id}`}
                    >
                      ✏️ Unggah BAP (PDF)
                    </Button>
                  )}
                  {s.linkFolderDrive && !s.linkFolderDrive.includes('not configured') && (
                    <a
                      href={s.linkFolderDrive}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-sky-600 border border-sky-200 rounded-xl hover:bg-sky-50 transition-colors whitespace-nowrap"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Buka Drive
                    </a>
                  )}
                  {s.statusVerifikasi === 'Draft' && (
                    <button
                      onClick={() => { setConfirmDeleteSub(s); setDeleteError(''); }}
                      id={`btn-delete-${s.id}`}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-red-500 border border-red-200 rounded-xl hover:bg-red-50 transition-colors whitespace-nowrap"
                    >
                      <Trash2 className="w-4 h-4" />
                      Hapus
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Draft Upload BAP Modal */}
      {activeBapUploadSub && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h2 className="text-lg font-bold text-navy-900">✏️ Unggah Laporan BAP (PDF)</h2>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                onClick={closeModal}
                disabled={modalSubmitting}
                title="Tutup"
                aria-label="Tutup"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm text-gray-500">
              <p>Silakan unggah Laporan BAP untuk melengkapi data pengawasan acara:</p>
              <p className="font-semibold text-navy-900 mt-1">{activeBapUploadSub.namaAcara}</p>
            </div>

            {modalError && (
              <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <p>{modalError}</p>
              </div>
            )}

            {modalSuccess && (
              <div className="flex gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                <p>Laporan BAP Berhasil Diunggah! Menyinkronkan...</p>
              </div>
            )}

            <form onSubmit={handleModalSubmit} className="space-y-4">
              <FileUpload
                files={bapFiles}
                onFilesChange={setBapFiles}
                uploadProgresses={modalSubmitting ? modalProgresses : []}
                disabled={modalSubmitting || modalSuccess}
                accept="application/pdf"
                allowedTypes={ALLOWED_PDF_TYPE}
                multiple={false}
                placeholderText="Hanya berkas PDF Laporan BAP — maks. 25 MB"
              />

              <div className="flex gap-2 pt-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeModal}
                  disabled={modalSubmitting}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={modalSubmitting}
                  disabled={modalSubmitting || modalSuccess}
                >
                  Unggah BAP
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {confirmDeleteSub && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-gray-100 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h2 className="text-lg font-bold text-red-600 flex items-center gap-2">
                <Trash2 className="w-5 h-5" />
                Hapus Submission
              </h2>
              <button
                type="button"
                onClick={() => setConfirmDeleteSub(null)}
                disabled={deleting}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                aria-label="Tutup"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                Kamu akan menghapus submission:
              </p>
              <p className="font-bold text-navy-900">{confirmDeleteSub.namaAcara}</p>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 space-y-1">
                <p>⚠️ <span className="font-semibold">Tindakan ini tidak dapat dibatalkan.</span></p>
                <p>• Data submission akan dihapus dari sistem</p>
                <p>• Folder Google Drive akan dipindahkan ke Trash</p>
              </div>
            </div>

            {deleteError && (
              <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p>{deleteError}</p>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDeleteSub(null)}
                disabled={deleting}
              >
                Batal
              </Button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                id="btn-confirm-delete"
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {deleting ? (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {deleting ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
