'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Department, FileType, UploadProgress } from '@/types';
import CascadingSelect from '@/components/ui/CascadingSelect';
import FileUpload from '@/components/ui/FileUpload';
import Button from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { computeDeadline, formatTanggal } from '@/lib/utils';
import { CheckCircle, AlertCircle, ClipboardList } from 'lucide-react';

interface FormState {
  kodeDepartemen: string;
  namaDepartemen: string;
  kodeDivisi: string;
  namaDivisi: string;
  namaAcara: string;
  tanggalPelaksanaan: string;
  lokasi: string;
  jenisBerkas: FileType;
}

interface FormErrors {
  kodeDepartemen?: string;
  kodeDivisi?: string;
  namaAcara?: string;
  tanggalPelaksanaan?: string;
  lokasi?: string;
  jenisBerkas?: string;
  files?: string;
}

const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
};

const ALLOWED_PDF_TYPE = {
  'application/pdf': ['.pdf'],
};

export default function PengawasPage() {
  const { data: session } = useSession();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptLoading, setDeptLoading] = useState(true);

  // Step flow: 1 = Upload Bukti Foto, 2 = Upload Laporan BAP (PDF), 3 = Selesai
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isDraft, setIsDraft] = useState(false);
  const [createdSubmission, setCreatedSubmission] = useState<{
    id: number;
    folderId: string;
    linkFolderDrive: string;
    namaAcara: string;
  } | null>(null);

  const [form, setForm] = useState<FormState>({
    kodeDepartemen: '',
    namaDepartemen: '',
    kodeDivisi: '',
    namaDivisi: '',
    namaAcara: '',
    tanggalPelaksanaan: '',
    lokasi: '',
    jenisBerkas: 'Foto',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [bapFiles, setBapFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgresses, setUploadProgresses] = useState<UploadProgress[]>([]);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string; link?: string } | null>(null);

  // Computed deadline: H+3 from today
  const deadline = computeDeadline();

  // Load departments
  useEffect(() => {
    setDeptLoading(true);
    fetch('/api/departments')
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setDepartments(res.data);
      })
      .catch(console.error)
      .finally(() => setDeptLoading(false));
  }, []);

  const validateStep1 = (): boolean => {
    const errs: FormErrors = {};
    if (!form.kodeDepartemen) errs.kodeDepartemen = 'Departemen wajib dipilih';
    if (!form.kodeDivisi) errs.kodeDivisi = 'Divisi wajib dipilih';
    if (!form.namaAcara.trim()) errs.namaAcara = 'Nama acara wajib diisi';
    if (!form.tanggalPelaksanaan) errs.tanggalPelaksanaan = 'Tanggal pelaksanaan wajib diisi';
    if (!form.lokasi.trim()) errs.lokasi = 'Lokasi wajib diisi';
    if (files.length === 0) errs.files = 'Minimal 1 file gambar harus diunggah';

    const invalidFiles = files.filter((f) => !f.type.startsWith('image/'));
    if (invalidFiles.length > 0) {
      errs.files = 'Hanya file gambar (JPG, PNG, WEBP, GIF) yang diperbolehkan di tahap ini';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validateStep2 = (): boolean => {
    const errs: FormErrors = {};
    if (bapFiles.length === 0) {
      errs.files = 'Laporan BAP wajib diunggah';
    } else if (bapFiles[0].type !== 'application/pdf') {
      errs.files = 'Berkas Laporan BAP harus berformat PDF';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmitStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep1()) return;

    setSubmitting(true);
    setSubmitResult(null);

    const progresses: UploadProgress[] = files.map((f) => ({
      fileName: f.name,
      progress: 0,
      status: 'pending',
    }));
    setUploadProgresses(progresses);

    const progressInterval = setInterval(() => {
      setUploadProgresses((prev) =>
        prev.map((p) =>
          p.status === 'pending' || p.status === 'uploading'
            ? { ...p, progress: Math.min(p.progress + 15, 90), status: 'uploading' }
            : p,
        ),
      );
    }, 300);

    try {
      const fd = new FormData();
      fd.append('kodeDepartemen', form.kodeDepartemen);
      fd.append('namaDepartemen', form.namaDepartemen);
      fd.append('kodeDivisi', form.kodeDivisi);
      fd.append('namaDivisi', form.namaDivisi);
      fd.append('namaAcara', form.namaAcara);
      fd.append('tanggalPelaksanaan', form.tanggalPelaksanaan);
      fd.append('lokasi', form.lokasi);
      fd.append('jenisBerkas', 'Foto'); // default Foto for step 1
      files.forEach((f) => fd.append('files', f));

      const res = await fetch('/api/submission', { method: 'POST', body: fd });
      const data = await res.json();

      clearInterval(progressInterval);

      if (res.ok && data.success) {
        setUploadProgresses((prev) =>
          prev.map((p) => ({ ...p, progress: 100, status: 'done' })),
        );

        setCreatedSubmission({
          id: data.data?.id,
          folderId: data.data?.folderId,
          linkFolderDrive: data.data?.linkFolderDrive,
          namaAcara: form.namaAcara,
        });

        // Advance to step 2
        setStep(2);
        setFiles([]);
        setUploadProgresses([]);
        setErrors({});
      } else {
        setUploadProgresses((prev) =>
          prev.map((p) => ({ ...p, status: 'error' })),
        );
        setSubmitResult({ success: false, message: data.error ?? 'Terjadi kesalahan.' });
      }
    } catch {
      clearInterval(progressInterval);
      setSubmitResult({ success: false, message: 'Gagal menghubungi server. Periksa koneksi internet.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep2()) return;
    if (!createdSubmission) return;

    setSubmitting(true);
    setSubmitResult(null);

    const progresses: UploadProgress[] = bapFiles.map((f) => ({
      fileName: f.name,
      progress: 0,
      status: 'pending',
    }));
    setUploadProgresses(progresses);

    const progressInterval = setInterval(() => {
      setUploadProgresses((prev) =>
        prev.map((p) =>
          p.status === 'pending' || p.status === 'uploading'
            ? { ...p, progress: Math.min(p.progress + 20, 90), status: 'uploading' }
            : p,
        ),
      );
    }, 200);

    try {
      const fd = new FormData();
      fd.append('folderId', createdSubmission.folderId);
      fd.append('rowIndex', String(createdSubmission.id));
      bapFiles.forEach((f) => fd.append('files', f));

      const res = await fetch('/api/submission', { method: 'POST', body: fd });
      const data = await res.json();

      clearInterval(progressInterval);

      if (res.ok && data.success) {
        setUploadProgresses((prev) =>
          prev.map((p) => ({ ...p, progress: 100, status: 'done' })),
        );

        // Advance to success page
        setStep(3);
        setBapFiles([]);
        setUploadProgresses([]);
        setErrors({});
      } else {
        setUploadProgresses((prev) =>
          prev.map((p) => ({ ...p, status: 'error' })),
        );
        setSubmitResult({ success: false, message: data.error ?? 'Terjadi kesalahan.' });
      }
    } catch {
      clearInterval(progressInterval);
      setSubmitResult({ success: false, message: 'Gagal menghubungi server. Periksa koneksi internet.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setForm({
      kodeDepartemen: '', namaDepartemen: '',
      kodeDivisi: '', namaDivisi: '',
      namaAcara: '', tanggalPelaksanaan: '',
      lokasi: '', jenisBerkas: 'Foto',
    });
    setFiles([]);
    setBapFiles([]);
    setCreatedSubmission(null);
    setSubmitResult(null);
    setStep(1);
    setErrors({});
    setIsDraft(false);
  };

  const inputClass = (hasError?: boolean) =>
    `w-full border-2 rounded-xl px-4 py-3 text-navy-900 font-medium transition-all duration-200
    focus:outline-none focus:ring-2 focus:ring-gold-500 focus:border-gold-500
    ${hasError ? 'border-red-400' : 'border-gray-200 hover:border-gold-500'}`;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Progress Wizard */}
      <div className="flex items-center justify-between bg-navy-50 border border-navy-100 rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step >= 1 ? 'bg-gold-500 text-white' : 'bg-gray-200 text-gray-400'}`}>1</div>
          <span className={`text-xs sm:text-sm font-bold ${step === 1 ? 'text-navy-900' : 'text-gray-400'}`}>Upload Bukti Foto</span>
        </div>
        <div className="flex-1 border-t-2 border-dashed border-gray-200 mx-4" />
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${step >= 2 ? 'bg-gold-500 text-white' : 'bg-gray-200 text-gray-400'}`}>2</div>
          <span className={`text-xs sm:text-sm font-bold ${step === 2 ? 'text-navy-900' : 'text-gray-400'}`}>Upload Laporan BAP (PDF)</span>
        </div>
      </div>

      {/* STEP 1: Upload Bukti Foto */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <div className="inline-flex items-center gap-2 bg-gold-100 border border-gold-500/40 rounded-full px-3 py-1 mb-3">
              <span className="text-gold-500 text-xs font-semibold">✨ Halo, {session?.user?.name?.split(' ')[0] ?? 'Pengawas'}</span>
            </div>
            <h1 className="text-3xl font-extrabold text-navy-900">
              Upload Bukti <span className="text-gold-500">Pengawasan</span>
            </h1>
            <p className="text-gray-500 mt-1">
              Deadline otomatis <span className="font-semibold text-navy-900">H+3</span> setelah upload Bukti Foto —{' '}
              <span className="text-gold-500 font-semibold">{formatTanggal(deadline)}</span>
            </p>
          </div>

          {submitResult && !submitResult.success && (
            <div className="flex gap-3 p-4 rounded-2xl border bg-red-50 border-red-200 text-red-800">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-sm">Gagal!</p>
                <p className="text-sm">{submitResult.message}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmitStep1} className="space-y-5">
            <Card>
              <h2 className="text-lg font-bold text-navy-900 mb-4">📋 Informasi BAP</h2>

              {/* Cascading dropdowns */}
              <div className="mb-4">
                {deptLoading ? (
                  <div className="h-14 bg-gray-100 rounded-xl animate-pulse" />
                ) : (
                  <CascadingSelect
                    departments={departments}
                    selectedDeptCode={form.kodeDepartemen}
                    selectedDivCode={form.kodeDivisi}
                    onDeptChange={(kode, nama) => setForm((f) => ({ ...f, kodeDepartemen: kode, namaDepartemen: nama, kodeDivisi: '', namaDivisi: '' }))}
                    onDivChange={(kode, nama) => setForm((f) => ({ ...f, kodeDivisi: kode, namaDivisi: nama }))}
                    disabled={submitting}
                    error={{ dept: errors.kodeDepartemen, div: errors.kodeDivisi }}
                  />
                )}
              </div>

              {/* Nama Acara */}
              <div className="space-y-1 mb-4">
                <label className="block text-sm font-semibold text-navy-900">
                  Deskripsi BAP <span className="text-red-500">*</span>
                </label>
                <input
                  id="input-nama-acara"
                  type="text"
                  placeholder="cth: Rapat Koordinasi Divisi Visual Desain"
                  className={inputClass(!!errors.namaAcara)}
                  value={form.namaAcara}
                  onChange={(e) => setForm((f) => ({ ...f, namaAcara: e.target.value }))}
                  disabled={submitting}
                />
                {errors.namaAcara && <p className="text-xs text-red-500">{errors.namaAcara}</p>}
              </div>

              {/* Tanggal & Lokasi */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="space-y-1">
                  <label className="block text-sm font-semibold text-navy-900">
                    Tanggal Pelaksanaan <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="input-tanggal"
                    type="date"
                    title="Pilih Tanggal Pelaksanaan"
                    aria-label="Tanggal Pelaksanaan"
                    className={inputClass(!!errors.tanggalPelaksanaan)}
                    value={form.tanggalPelaksanaan}
                    onChange={(e) => setForm((f) => ({ ...f, tanggalPelaksanaan: e.target.value }))}
                    disabled={submitting}
                    max={new Date().toISOString().split('T')[0]}
                  />
                  {errors.tanggalPelaksanaan && <p className="text-xs text-red-500">{errors.tanggalPelaksanaan}</p>}
                </div>

                <div className="space-y-1">
                  <label className="block text-sm font-semibold text-navy-900">
                    Lokasi <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="input-lokasi"
                    type="text"
                    placeholder="cth: Gedung Sains Data Lt. 3, ITERA"
                    className={inputClass(!!errors.lokasi)}
                    value={form.lokasi}
                    onChange={(e) => setForm((f) => ({ ...f, lokasi: e.target.value }))}
                    disabled={submitting}
                  />
                  {errors.lokasi && <p className="text-xs text-red-500">{errors.lokasi}</p>}
                </div>
              </div>

              <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-sky-50 text-sky-700 text-xs font-semibold rounded-full">
                  Jenis Berkas: Foto & Bukti Kegiatan
                </span>
              </div>
            </Card>

            <Card>
              <h2 className="text-lg font-bold text-navy-900 mb-4">Unggah Bukti Foto</h2>
              <FileUpload
                files={files}
                onFilesChange={setFiles}
                uploadProgresses={submitting ? uploadProgresses : []}
                disabled={submitting}
                error={errors.files}
                accept="image/*"
                allowedTypes={ALLOWED_IMAGE_TYPES}
                placeholderText="Hanya file gambar (JPG, PNG, WEBP, GIF) — maks. 25 MB"
              />
            </Card>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              id="btn-submit-foto"
            >
              {submitting ? 'Mengunggah Foto...' : `Lanjut ke Langkah 2: Upload BAP (PDF) ➜`}
            </Button>
          </form>
        </div>
      )}

      {/* STEP 2: Upload Laporan BAP (PDF) */}
      {step === 2 && createdSubmission && (
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-extrabold text-navy-900">
              Langkah 2: Upload <span className="text-gold-500">Laporan BAP</span>
            </h1>
            <p className="text-gray-500 mt-1">
              Foto bukti acara &apos;{createdSubmission.namaAcara}&apos; berhasil diunggah. Sekarang, silakan unggah berkas PDF Laporan BAP.
            </p>
          </div>

          <div className="flex gap-3 p-4 rounded-2xl border bg-emerald-50 border-emerald-200 text-emerald-800">
            <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-sm">Bukti Foto Berhasil Diunggah!</p>
              <p className="text-xs">Folder Drive: <a href={createdSubmission.linkFolderDrive} target="_blank" rel="noreferrer" className="underline text-sky-600 font-semibold">Buka Google Drive ➜</a></p>
            </div>
          </div>

          {submitResult && !submitResult.success && (
            <div className="flex gap-3 p-4 rounded-2xl border bg-red-50 border-red-200 text-red-800">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-sm">Gagal!</p>
                <p className="text-sm">{submitResult.message}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmitStep2} className="space-y-5">
            <Card>
              <h2 className="text-lg font-bold text-navy-900 mb-4">📄 Berkas Laporan BAP (PDF)</h2>
              <FileUpload
                files={bapFiles}
                onFilesChange={setBapFiles}
                uploadProgresses={submitting ? uploadProgresses : []}
                disabled={submitting}
                error={errors.files}
                accept="application/pdf"
                allowedTypes={ALLOWED_PDF_TYPE}
                multiple={false}
                placeholderText="Hanya file PDF Laporan BAP (Maks 1 file) — maks. 25 MB"
              />
            </Card>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={submitting}
                disabled={submitting}
                className="flex-1"
                id="btn-submit-bap"
              >
                {submitting ? 'Mengunggah BAP...' : '🚀 Submit Laporan BAP (PDF)'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={submitting}
                onClick={() => {
                  setIsDraft(true);
                  setStep(3);
                }}
                className="sm:w-1/3"
                id="btn-skip-bap"
              >
                Lewati / Selesai
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* STEP 3: Sukses Lengkap */}
      {step === 3 && createdSubmission && (
        <Card className="text-center py-12 space-y-6">
          {isDraft ? (
            <div className="inline-flex items-center justify-center w-20 h-20 bg-amber-100 text-amber-600 rounded-full">
              <ClipboardList className="w-12 h-12" />
            </div>
          ) : (
            <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full">
              <CheckCircle className="w-12 h-12" />
            </div>
          )}

          <div className="space-y-2">
            <h2 className="text-2xl font-extrabold text-navy-900">
              {isDraft ? 'Tersimpan sebagai Draft!' : 'Pengunggahan Bukti & BAP Selesai!'}
            </h2>
            <p className="text-gray-500 max-w-md mx-auto">
              {isDraft ? (
                <>
                  Bukti foto kegiatan untuk acara &apos;{createdSubmission.namaAcara}&apos; telah disimpan sebagai draft.
                  Silakan lengkapi dan unggah Laporan BAP (PDF) nanti melalui halaman <strong>Riwayat</strong> untuk menyelesaikannya.
                </>
              ) : (
                <>
                  Bukti foto kegiatan dan berkas Laporan BAP (PDF) untuk acara &apos;{createdSubmission.namaAcara}&apos; telah berhasil disimpan di Google Drive & Google Sheets.
                </>
              )}
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-4 max-w-md mx-auto border border-gray-100 flex flex-col items-center gap-2">
            <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Tautan Google Drive</span>
            <a
              href={createdSubmission.linkFolderDrive}
              target="_blank"
              rel="noreferrer"
              className="text-navy-900 hover:text-gold-500 font-semibold underline text-sm break-all"
            >
              Buka Folder Bukti Kegiatan ➜
            </a>
          </div>

          <div className="pt-4">
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={handleReset}
              id="btn-reset-form"
            >
              Unggah Bukti Baru
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
