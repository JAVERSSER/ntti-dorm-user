"use client";

import { CheckCircle2, Download, ImageUp, Send, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Alert, buttonClass, Card, cn, Spinner } from "@/components/ui";
import { MAX_SLIP_BYTES } from "@/lib/options";
import { submitPayment, type SubmitState } from "./actions";

type Resident = { room: string; name: string; grade: string; institution: string };
type Props = { rooms: string[]; institutions: string[]; grades: string[]; residents: Resident[]; qrUrl: string; months: { value: string; label: string }[] };

/** Value of the "my name is not in the list" choice. */
const OTHER = "__other__";

/** Longest side of the uploaded image; payment slip text stays readable at this size. */
const SLIP_MAX_SIDE = 1280;
/** Smallest longest side we will shrink to while chasing the target size. */
const SLIP_MIN_SIDE = 800;
/** Aim for about 100 KB per screenshot to keep Supabase storage tiny. */
const SLIP_TARGET_BYTES = 100 * 1024;

function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Compress every screenshot in the browser before upload: resize, then WebP
 * (JPEG on browsers that cannot encode WebP), lowering quality and size until
 * it is near SLIP_TARGET_BYTES. Falls back to the original file on failure.
 */
async function shrinkImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    let side = Math.min(SLIP_MAX_SIDE, Math.max(bitmap.width, bitmap.height));
    let best: Blob | null = null;

    while (true) {
      const scale = side / Math.max(bitmap.width, bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      ctx.fillStyle = "#fff"; // transparent PNGs would turn black in JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.7, 0.6, 0.5, 0.4]) {
        let blob = await encode(canvas, "image/webp", quality);
        // Some Safari versions silently return PNG for WebP: use JPEG there.
        if (!blob || blob.type !== "image/webp") blob = await encode(canvas, "image/jpeg", quality);
        if (blob && (!best || blob.size < best.size)) best = blob;
        if (blob && blob.size <= SLIP_TARGET_BYTES) break;
      }

      if (!best || best.size <= SLIP_TARGET_BYTES || side <= SLIP_MIN_SIDE) break;
      side = Math.max(SLIP_MIN_SIDE, Math.round(side * 0.8));
    }
    bitmap.close();

    if (!best || best.size >= file.size) return file;
    const ext = best.type === "image/webp" ? "webp" : "jpg";
    return new File([best], `slip.${ext}`, { type: best.type });
  } catch {
    return file;
  }
}

export function PaymentForm(props: Props) {
  const [formKey, setFormKey] = useState(0);
  return <Inner key={formKey} {...props} onReset={() => setFormKey((k) => k + 1)} />;
}

function Inner({ rooms, institutions, grades, residents, qrUrl, months, onReset }: Props & { onReset: () => void }) {
  const [room, setRoom] = useState("");
  const month = months[0]?.value ?? "";
  const [pickedName, setPickedName] = useState("");
  const [grade, setGrade] = useState("");
  const [institution, setInstitution] = useState("");
  const [state, formAction, submitting] = useActionState<SubmitState, FormData>(submitPayment, { status: "idle" });
  const [preparing, startPreparing] = useTransition();
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const pending = submitting || preparing;

  const file = picked?.file ?? null;
  const preview = picked?.url ?? null;

  // Free the preview's memory when it changes or the form unmounts.
  useEffect(() => {
    const url = picked?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked]);

  function setFile(next: File | null) {
    setPicked(next ? { file: next, url: URL.createObjectURL(next) } : null);
  }

  if (state.status === "success") {
    return (
      <Card className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-14 text-emerald-600" aria-hidden />
        <div>
          <h2 className="text-xl font-bold">Payment submitted</h2>
          <p className="mt-1 text-slate-600">
            Thank you, {state.studentName}. Your payment for <strong>{state.monthLabel}</strong> was received. The dormitory office will check your screenshot.
          </p>
        </div>
        <p className="rounded-xl bg-slate-50 py-3 text-sm text-slate-600">
          Reference <span className="ml-1 font-mono text-lg font-bold tracking-wider text-slate-900">{state.reference}</span>
        </p>
        <ReceiptSaver url={state.receiptUrl} />
        <button type="button" onClick={onReset} className={buttonClass("secondary", "w-full")}>
          Submit another payment
        </button>
      </Card>
    );
  }

  const errors = state.status === "error" ? (state.fields ?? {}) : {};

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setFileError("Please upload the screenshot of your payment.");
      return;
    }
    const formData = new FormData(event.currentTarget);
    startPreparing(async () => {
      const slip = await shrinkImage(file);
      formData.set("slip", slip, slip.name);
      startPreparing(() => formAction(formData));
    });
  }

  function onPick(chosen: File | undefined) {
    setFileError(null);
    if (!chosen) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(chosen.type)) {
      setFileError("Only JPG, PNG or WEBP images are allowed.");
      return;
    }
    if (chosen.size > MAX_SLIP_BYTES * 3) {
      setFileError("The image is too large.");
      return;
    }
    setFile(chosen);
  }

  const noRooms = rooms.length === 0;
  const roomResidents = residents.filter((r) => r.room === room);
  const typing = !room || roomResidents.length === 0 || pickedName === OTHER;

  function onRoom(next: string) {
    setRoom(next);
    setPickedName("");
  }

  function onName(next: string) {
    setPickedName(next);
    const r = roomResidents.find((x) => x.name === next);
    if (r?.grade && grades.includes(r.grade)) setGrade(r.grade);
    if (r?.institution && institutions.includes(r.institution)) setInstitution(r.institution);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {state.status === "error" && <Alert tone="error">{state.message}</Alert>}

      <Card className="space-y-4">
        <StepTitle n={1}>Your details</StepTitle>
        {noRooms && <Alert tone="warning">No rooms are set up yet. Please contact the dormitory office.</Alert>}

        <input type="hidden" name="month" value={month} />
        {errors.month && <Alert tone="error">{errors.month} Please refresh the page.</Alert>}
        <SelectField id="room" label="Room" options={rooms} placeholder="Choose your room" error={errors.room} value={room} onChange={onRoom} />
        <div className="space-y-1.5">
          <label htmlFor={roomResidents.length ? "student_pick" : "student_name"} className="block text-sm font-semibold text-slate-800">
            Student name
          </label>
          {roomResidents.length > 0 && (
            <select
              id="student_pick"
              name={pickedName === OTHER ? undefined : "student_name"}
              required
              value={pickedName}
              onChange={(e) => onName(e.target.value)}
              aria-invalid={Boolean(errors.student_name)}
              className={inputClass(errors.student_name)}
            >
              <option value="" disabled>
                Choose your name
              </option>
              {roomResidents.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
              <option value={OTHER}>My name is not in the list</option>
            </select>
          )}
          {typing && (
          <input
            id="student_name"
            name="student_name"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            placeholder="e.g. Sok Dara"
            aria-invalid={Boolean(errors.student_name)}
            className={inputClass(errors.student_name)}
          />
          )}
          {!room && residents.length > 0 && <p className="text-sm text-slate-500">Choose your room first to pick your name.</p>}
          <FieldError id="student_name" error={errors.student_name} />
        </div>
        <SelectField id="grade" label="Grade" options={grades} placeholder="Choose your grade" error={errors.grade} value={grade} onChange={setGrade} />
        <SelectField
          id="institution"
          label="Student at"
          options={institutions}
          placeholder="Choose your school"
          error={errors.institution}
          value={institution}
          onChange={setInstitution}
        />

        {/* Honeypot for bots — hidden from people and screen readers. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      </Card>

      <Card className="space-y-4">
        <StepTitle n={2}>Scan to pay</StepTitle>
        <p className="text-sm text-slate-600">Open ABA Mobile (or any KHQR banking app), scan this QR and pay your dormitory fee.</p>
        <SaveQrButton qrUrl={qrUrl} />
      </Card>

      <Card className="space-y-4">
        <StepTitle n={3}>Upload payment screenshot</StepTitle>
        {preview ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
            <img src={preview} alt="Your payment screenshot" className="mx-auto max-h-96 rounded-xl border border-slate-200" />
            <button
              type="button"
              onClick={() => setFile(null)}
              className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-slate-700 shadow hover:bg-white"
              aria-label="Remove image"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        ) : (
          <label
            htmlFor="slip"
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition hover:bg-slate-50",
              fileError || errors.slip ? "border-red-300" : "border-slate-300",
            )}
          >
            <ImageUp className="size-10 text-brand-600" aria-hidden />
            <span className="font-semibold text-slate-800">Tap to choose image</span>
            <span className="text-sm text-slate-500">JPG, PNG or WEBP</span>
          </label>
        )}
        <input
          id="slip"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <FieldError id="slip" error={fileError ?? errors.slip} />
      </Card>

      {!file && !noRooms && (
        <p className="text-center text-sm text-slate-500">Upload your payment screenshot to submit.</p>
      )}
      <button type="submit" disabled={pending || noRooms || !file} className={buttonClass("primary", "w-full")}>
        {pending ? (
          <>
            <Spinner label="Submitting" /> Submitting…
          </>
        ) : (
          <>
            <Send className="size-5" aria-hidden /> Submit payment
          </>
        )}
      </button>
    </form>
  );
}

/** Same-origin URL that serves the QR as a file download (see app/qr/download/route.ts). */
const QR_DOWNLOAD_URL = "/qr/download";

/** iPhone / iPad. Every iOS browser (Safari, Chrome, Firefox, Edge, in-app) is WebKit. */
function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

/** In-app browsers (Telegram, Facebook, Instagram, LINE, Android WebViews). */
function isInAppBrowser() {
  return /Telegram|FBAN|FBAV|Instagram|Line\/|; wv\)/i.test(navigator.userAgent);
}

/** Start a download of a same-origin attachment URL without leaving the page. */
function startDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type SaveStatus = "idle" | "downloading" | "hint" | "ios";

/**
 * Download a same-origin attachment URL (/qr/download, /receipt/…) in every
 * browser: Chrome, Safari on iPhone, Vivo / Samsung / Mi / Opera / Firefox /
 * Edge, Telegram, computers. Browsers download an attachment instead of
 * showing it, and the page stays put. iPhone browsers always ask "Download?"
 * first (Apple's rule, cannot be skipped), and some in-app browsers cannot
 * download at all, so those get a "press and hold the image" tip as a backup.
 */
function useDownload(url: string) {
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    if (status === "idle") return;
    const t = setTimeout(() => setStatus("idle"), status === "ios" ? 8000 : 6000);
    return () => clearTimeout(t);
  }, [status]);

  function start() {
    startDownload(url);
    setStatus(isIOS() ? "ios" : isInAppBrowser() ? "hint" : "downloading");
  }

  return { status, start };
}

/** Pulsing ring on the image while the "press and hold" tip shows. */
function highlightClass(status: SaveStatus) {
  return (status === "hint" || status === "ios") && "animate-pulse ring-4 ring-brand-500 ring-offset-2";
}

function DownloadButton({ status, onClick, label }: { status: SaveStatus; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={buttonClass("secondary", "w-full")}>
      {status === "idle" ? (
        <>
          <Download className="size-5" aria-hidden /> {label}
        </>
      ) : (
        <>
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden /> Downloading
        </>
      )}
    </button>
  );
}

function DownloadToast({ status, what }: { status: SaveStatus; what: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 transition-all duration-300",
        status !== "idle" ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      )}
    >
      <span className="flex max-w-sm items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg">
        <CheckCircle2 className="size-5 shrink-0 text-emerald-400" aria-hidden />
        {status === "ios"
          ? `Tap “Download” to save. Or press and hold the ${what}, then tap “Save to Photos”.`
          : status === "hint"
            ? `Downloading… If nothing happens, press and hold the ${what}, then tap “Save image”.`
            : `Downloading ${what} image… check your Downloads.`}
      </span>
    </div>
  );
}

/** QR image plus a "Save QR image" button (see useDownload). */
function SaveQrButton({ qrUrl }: { qrUrl: string }) {
  const { status, start } = useDownload(QR_DOWNLOAD_URL);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- admin-managed image from Supabase Storage */}
      <img
        src={qrUrl}
        alt="Dormitory ABA KHQR code"
        className={cn("mx-auto w-full max-w-xs rounded-xl border border-slate-200 transition-shadow [-webkit-touch-callout:default]", highlightClass(status))}
      />
      <DownloadButton status={status} onClick={start} label="Save QR image" />
      <DownloadToast status={status} what="QR" />
    </>
  );
}

/**
 * Receipt image on the success screen. It downloads by itself as soon as the
 * payment is submitted, and the button saves it again.
 */
function ReceiptSaver({ url }: { url: string }) {
  const { status, start } = useDownload(url);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // once, even in React Strict Mode
    started.current = true;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on the success screen
  }, []);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- generated receipt PNG */}
      <img
        src={url}
        alt="Your payment receipt"
        className={cn("mx-auto w-full max-w-60 rounded-xl border border-slate-200 transition-shadow [-webkit-touch-callout:default]", highlightClass(status))}
      />
      <DownloadButton status={status} onClick={start} label="Save receipt" />
      <DownloadToast status={status} what="receipt" />
    </>
  );
}

function inputClass(error?: string) {
  return cn(
    "block min-h-12 w-full rounded-xl border bg-white px-4 text-base outline-none transition placeholder:text-slate-400 focus:ring-4",
    error ? "border-red-400 focus:ring-red-100" : "border-slate-300 focus:border-brand-500 focus:ring-brand-100",
  );
}

function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-bold">
      <span className="flex size-7 items-center justify-center rounded-full bg-brand-600 text-sm text-white">{n}</span>
      {children}
    </h2>
  );
}

function FieldError({ id, error }: { id: string; error?: string | null }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className="text-sm font-medium text-red-700">
      {error}
    </p>
  );
}

function SelectField({
  id,
  label,
  options,
  placeholder,
  error,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: string[];
  placeholder: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-slate-800">{label}</label>
      <select id={id} name={id} required value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} className={inputClass(error)}>
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <FieldError id={id} error={error} />
    </div>
  );
}
