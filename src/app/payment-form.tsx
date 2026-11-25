"use client";

import { CheckCircle2, Download, ImageUp, Send, X } from "lucide-react";
import { useActionState, useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Alert, buttonClass, Card, cn, Spinner } from "@/components/ui";
import { MAX_SLIP_BYTES } from "@/lib/options";
import { submitPayment, type SubmitState } from "./actions";

type Resident = { room: string; name: string; grade: string; institution: string };
type Props = { rooms: string[]; institutions: string[]; grades: string[]; residents: Resident[]; qrUrl: string; months: { value: string; label: string }[] };

/** Value of the "my name is not in the list" choice. */
const OTHER = "__other__";

/** Shrink very large photos in the browser so uploads stay fast on mobile data. */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], "slip.jpg", { type: "image/jpeg" }) : file;
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
        <p className="text-xs text-slate-500">Take a screenshot of this page to keep your reference.</p>
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
        {/* eslint-disable-next-line @next/next/no-img-element -- admin-managed image from Supabase Storage */}
        <img src={qrUrl} alt="Dormitory ABA KHQR code" className="mx-auto w-full max-w-xs rounded-xl border border-slate-200" />
        <a href={qrUrl} download className={buttonClass("secondary", "w-full")}>
          <Download className="size-5" aria-hidden /> Save QR image
        </a>
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
