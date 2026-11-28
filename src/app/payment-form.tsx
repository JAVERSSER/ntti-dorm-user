"use client";

import { CheckCircle2, Clock, Download, QrCode, RotateCcw, Smartphone, X } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore, useTransition, type FormEvent, type ReactNode } from "react";
import { Alert, buttonClass, Card, cn, Spinner } from "@/components/ui";
import { nextDownloadName, removeReceipt, saveReceipt, useSavedReceipts, type SavedReceipt } from "@/lib/local-saves";
import type { PaidResult } from "@/lib/payments";
import { checkPayment, startPayment, type StartState } from "./actions";

type Resident = { room: string; name: string; grade: string; institution: string };
type Props = { rooms: string[]; institutions: string[]; grades: string[]; residents: Resident[]; monthlyFee: number | null; months: { value: string; label: string }[] };
type QrState = Extract<StartState, { status: "qr" }>;

/** Value of the "my name is not in the list" choice. */
const OTHER = "__other__";

/** How often the page asks the server whether the QR was paid. */
const POLL_MS = 3000;

function usd(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function PaymentForm(props: Props) {
  const [formKey, setFormKey] = useState(0);
  return (
    <div className="space-y-6">
      <Inner key={formKey} {...props} onReset={() => setFormKey((k) => k + 1)} />
      <MyReceipts />
    </div>
  );
}

function Inner({ rooms, institutions, grades, residents, monthlyFee, months, onReset }: Props & { onReset: () => void }) {
  const [room, setRoom] = useState("");
  const month = months[0]?.value ?? "";
  const [pickedName, setPickedName] = useState("");
  const [grade, setGrade] = useState("");
  const [institution, setInstitution] = useState("");
  const [state, formAction, starting] = useActionState<StartState, FormData>(startPayment, { status: "idle" });
  const [, startTransition] = useTransition();
  const lastForm = useRef<FormData | null>(null);
  /** QR the student closed with "Change details"; the details form shows again. */
  const [closedTranId, setClosedTranId] = useState<string | null>(null);
  const [paid, setPaid] = useState<PaidResult | null>(null);

  if (paid) {
    return (
      <Card className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-14 text-emerald-600" aria-hidden />
        <div>
          <h2 className="text-xl font-bold">Payment received</h2>
          <p className="mt-1 text-slate-600">
            Thank you, {paid.studentName}. Your dormitory fee for <strong>{paid.monthLabel}</strong> is paid.
          </p>
        </div>
        <p className="rounded-xl bg-slate-50 py-3 text-sm text-slate-600">
          Reference <span className="ml-1 font-mono text-lg font-bold tracking-wider text-slate-900">{paid.reference}</span>
        </p>
        <ReceiptSaver receipt={paid} />
        <button type="button" onClick={onReset} className={buttonClass("secondary", "w-full")}>
          Pay for someone else
        </button>
      </Card>
    );
  }

  const qr = state.status === "qr" && state.tranId !== closedTranId ? state : null;
  const errors = state.status === "error" ? (state.fields ?? {}) : {};

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    lastForm.current = formData;
    startTransition(() => formAction(formData));
  }

  /** Same details, fresh QR (after the old one expired). */
  function newQr() {
    if (lastForm.current) startTransition(() => formAction(lastForm.current!));
  }

  const noRooms = rooms.length === 0;
  const noFee = monthlyFee === null;
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
    <>
      {qr && <PayStep key={qr.tranId} qr={qr} renewing={starting} onNewQr={newQr} onBack={() => setClosedTranId(qr.tranId)} onPaid={setPaid} />}

      {/* Kept mounted (hidden) while the QR shows, so "Change details" brings the answers back. */}
      <form onSubmit={onSubmit} noValidate className={cn("space-y-6", qr && "hidden")}>
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
          <StepTitle n={2}>Pay with KHQR</StepTitle>
          {noFee ? (
            <Alert tone="warning">The dormitory fee is not set yet. Please contact the dormitory office.</Alert>
          ) : (
            <div className="flex items-baseline justify-between rounded-xl bg-slate-50 px-4 py-3">
              <span className="text-sm text-slate-600">Dormitory fee · {months[0]?.label}</span>
              <span className="text-2xl font-bold text-slate-900">{usd(monthlyFee)}</span>
            </div>
          )}
          <p className="text-sm text-slate-600">You will get a QR for this exact amount. Pay it with ABA Mobile or any KHQR banking app — your payment is confirmed automatically.</p>
          <button type="submit" disabled={starting || noRooms || noFee} className={buttonClass("primary", "w-full")}>
            {starting ? (
              <>
                <Spinner label="Creating QR" /> Creating QR…
              </>
            ) : (
              <>
                <QrCode className="size-5" aria-hidden /> Get payment QR
              </>
            )}
          </button>
        </Card>
      </form>
    </>
  );
}

/** Seconds left until `iso`, updated every second. */
function useSecondsLeft(iso: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((Date.parse(iso) - now) / 1000));
}

type Watch = { state: "pending" } | { state: "expired" } | { state: "failed"; message: string };

/**
 * The one-time QR for this payment. The page asks the server every few seconds
 * (and as soon as the student comes back from the banking app) whether PayWay
 * has the payment; once it does, the receipt shows.
 */
function PayStep({ qr, renewing, onNewQr, onBack, onPaid }: { qr: QrState; renewing: boolean; onNewQr: () => void; onBack: () => void; onPaid: (paid: PaidResult) => void }) {
  const [watch, setWatch] = useState<Watch>({ state: "pending" });
  const secondsLeft = useSecondsLeft(qr.expiresAt);
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  });

  const done = watch.state !== "pending";

  useEffect(() => {
    if (done) return;
    let stopped = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (stopped || busy) return;
      busy = true;
      clearTimeout(timer);
      try {
        const res = await checkPayment(qr.tranId);
        if (stopped) return;
        if (res.state === "paid") {
          stopped = true;
          const { state: _state, ...paid } = res; // eslint-disable-line @typescript-eslint/no-unused-vars
          onPaidRef.current(paid);
          return;
        }
        if (res.state === "expired" || res.state === "failed") {
          stopped = true;
          setWatch(res);
          return;
        }
      } catch {
        // offline for a moment: try again on the next tick
      } finally {
        busy = false;
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    }

    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [qr.tranId, done]);

  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <StepTitle n={2}>Scan to pay</StepTitle>
        <button type="button" onClick={onBack} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Change details">
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="flex items-baseline justify-between rounded-xl bg-slate-50 px-4 py-3">
        <span className="min-w-0 truncate text-sm text-slate-600">
          {qr.studentName} · {qr.monthLabel}
        </span>
        <span className="text-2xl font-bold text-slate-900">{usd(qr.amount)}</span>
      </div>

      {watch.state === "pending" ? (
        <>
          <SaveQr url={qr.qrImageUrl} />
          {qr.deeplink && (
            <a href={qr.deeplink} className={buttonClass("primary", "w-full")}>
              <Smartphone className="size-5" aria-hidden /> Pay in ABA Mobile
            </a>
          )}
          <p className="flex items-center justify-center gap-2 text-sm font-medium text-slate-600" role="status" aria-live="polite">
            <Spinner label="Waiting for payment" className="size-4" /> Waiting for your payment…
            <span className="inline-flex items-center gap-1 font-mono text-slate-500">
              <Clock className="size-4" aria-hidden /> {mm}:{ss}
            </span>
          </p>
          <p className="text-center text-xs text-slate-500">Keep this page open. It updates by itself as soon as the payment goes through.</p>
        </>
      ) : (
        <div className="space-y-3">
          <Alert tone={watch.state === "expired" ? "warning" : "error"} title={watch.state === "expired" ? "This QR has expired" : "Payment not completed"}>
            {watch.state === "expired" ? "Nothing was charged. Create a new QR to pay." : watch.message}
          </Alert>
          <button type="button" onClick={onNewQr} disabled={renewing} className={buttonClass("primary", "w-full")}>
            {renewing ? <Spinner label="Creating QR" /> : <RotateCcw className="size-5" aria-hidden />} Create a new QR
          </button>
        </div>
      )}

      <button type="button" onClick={onBack} className={buttonClass("secondary", "w-full")}>
        Change details
      </button>
    </Card>
  );
}


/** iPhone / iPad. Every iOS browser (Safari, Chrome, Firefox, Edge, in-app) is WebKit. */
function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

/** In-app browsers (Telegram, Facebook, Instagram, LINE, Android WebViews). */
function isInAppBrowser() {
  return /Telegram|FBAN|FBAV|Instagram|Line\/|; wv\)/i.test(navigator.userAgent);
}

/** Start a download of a same-origin attachment URL without leaving the page. */
function startDownload(url: string, fileName: string) {
  const href = new URL(url, location.href);
  href.searchParams.set("name", fileName);
  const a = document.createElement("a");
  a.href = href.pathname + href.search;
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** iPhone gets a "to Photos" label; the server render and other phones get the plain one. */
function useIosLabel(ios: string, other: string) {
  return useSyncExternalStore(
    () => () => {},
    () => (isIOS() ? ios : other),
    () => other,
  );
}

type SaveStatus = "idle" | "downloading" | "hint" | "photos" | "tapAgain";

/**
 * Save an image from a same-origin URL (/qr/download, /receipt/…) to the phone.
 *
 * - iPhone / iPad: the share menu with the image file, so "Save Image" puts it
 *   in Photos and the page stays put. Safari only opens the menu right after a
 *   tap, so the image is fetched ahead of time (`prefetch`, or on touch); if it
 *   was not ready yet, the student is asked to tap once more. Browsers without
 *   file sharing (Facebook / Instagram in-app) get "press and hold the image".
 * - Android and computers: a download of the attachment URL (no question; on
 *   Android it lands in Download, which the Gallery shows as an album).
 *   In-app browsers also get the press-and-hold tip as a backup.
 */
function useDownload(url: string, fileBase: string, { prefetch = false } = {}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const blob = useRef<{ url: string; promise: Promise<Blob>; value?: Blob } | null>(null);

  useEffect(() => {
    if (status === "idle") return;
    const t = setTimeout(() => setStatus("idle"), status === "hint" ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [status]);

  /** Fetch the image once (iPhone only) and remember it for the share menu. */
  function load() {
    if (blob.current?.url === url) return blob.current.promise;
    const entry: { url: string; promise: Promise<Blob>; value?: Blob } = {
      url,
      promise: fetch(url).then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      }),
    };
    entry.promise.then(
      (b) => (entry.value = b),
      () => blob.current === entry && (blob.current = null),
    );
    blob.current = entry;
    return entry.promise;
  }

  useEffect(() => {
    if (prefetch && isIOS()) load().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load reads the latest url
  }, [url, prefetch]);

  async function shareToPhotos() {
    let image = blob.current?.url === url ? blob.current.value : undefined;
    if (!image) {
      // Not fetched yet: fetch now; Safari may then refuse the menu (no recent tap).
      try {
        image = await load();
      } catch {
        return setStatus("hint");
      }
    }
    const type = image.type.startsWith("image/") ? image.type : "image/png";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const file = new File([image], `${nextDownloadName(fileBase)}.${ext}`, { type });
    if (!navigator.canShare?.({ files: [file] })) return setStatus("hint");
    try {
      await navigator.share({ files: [file] });
      setStatus("photos");
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") setStatus("idle"); // closed the menu
      else if (name === "NotAllowedError") setStatus("tapAgain"); // image is ready now
      else setStatus("hint");
    }
  }

  /** `auto`: started by the page, not a tap — iPhone then only gets the image ready. */
  function start({ auto = false }: { auto?: boolean } = {}) {
    if (isIOS()) {
      if (auto) load().catch(() => {});
      else void shareToPhotos();
      return;
    }
    startDownload(url, nextDownloadName(fileBase));
    setStatus(isInAppBrowser() ? "hint" : "downloading");
  }

  /** Warm the image on touch, so the share menu can open on this tap. */
  function warm() {
    if (isIOS()) load().catch(() => {});
  }

  return { status, start, warm };
}

/** Pulsing ring on the image while the "press and hold" tip shows. */
function highlightClass(status: SaveStatus) {
  return status === "hint" && "animate-pulse ring-4 ring-brand-500 ring-offset-2";
}

function DownloadButton({ status, onClick, onTouchStart, label }: { status: SaveStatus; onClick: () => void; onTouchStart?: () => void; label: string }) {
  const done = status === "downloading" || status === "photos";
  return (
    <button type="button" onClick={onClick} onTouchStart={onTouchStart} className={buttonClass("secondary", "w-full")}>
      {done ? (
        <>
          <CheckCircle2 className="size-5 text-emerald-600" aria-hidden /> {status === "photos" ? "Saved" : "Downloading"}
        </>
      ) : (
        <>
          <Download className="size-5" aria-hidden /> {status === "tapAgain" ? "Tap again to save" : label}
        </>
      )}
    </button>
  );
}

function DownloadToast({ status, what }: { status: SaveStatus; what: string }) {
  const message =
    status === "photos"
      ? `${what === "QR" ? "QR" : "Receipt"} image saved.`
      : status === "tapAgain"
        ? `Ready — tap the button again, then choose “Save Image”.`
        : status === "hint"
          ? `Press and hold the ${what} image, then tap “Save image” / “Save to Photos”.`
          : `Saving ${what} image to your phone…`;
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
        {status === "idle" ? "" : message}
      </span>
    </div>
  );
}

/**
 * This payment's QR plus a "Save QR image" button (see useDownload: Photos on
 * iPhone, Download / Gallery on Android), for paying from a banking app on the
 * same phone by choosing the image from the gallery.
 */
function SaveQr({ url }: { url: string }) {
  const { status, start, warm } = useDownload(url, "dormpay-qr", { prefetch: true });
  const label = useIosLabel("Save QR to Photos", "Save QR image");
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- one-time KHQR generated by ABA PayWay */}
      <img
        src={url}
        alt="ABA KHQR code for this payment"
        className={cn("mx-auto w-full max-w-xs rounded-xl border border-slate-200 transition-shadow [-webkit-touch-callout:default]", highlightClass(status))}
      />
      <DownloadButton status={status} onClick={() => start()} onTouchStart={warm} label={label} />
      <DownloadToast status={status} what="QR" />
    </>
  );
}

/**
 * Receipt image on the success screen. As soon as the payment is submitted it
 * is kept in the browser (My receipts). Android also downloads it right away;
 * iPhone needs one tap on the button (Apple only opens the save menu after a tap).
 */
function ReceiptSaver({ receipt }: { receipt: Omit<SavedReceipt, "savedAt"> }) {
  const { status, start, warm } = useDownload(receipt.receiptUrl, `dormpay-receipt-${receipt.reference}`, { prefetch: true });
  const label = useIosLabel("Save receipt to Photos", "Save receipt");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // once, even in React Strict Mode
    started.current = true;
    saveReceipt(receipt);
    start({ auto: true }); // Android: downloads now. iPhone: gets it ready for the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on the success screen
  }, []);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- generated receipt PNG */}
      <img
        src={receipt.receiptUrl}
        alt="Your payment receipt"
        className={cn("mx-auto w-full max-w-60 rounded-xl border border-slate-200 transition-shadow [-webkit-touch-callout:default]", highlightClass(status))}
      />
      <DownloadButton status={status} onClick={() => start()} onTouchStart={warm} label={label} />
      <DownloadToast status={status} what="receipt" />
    </>
  );
}

/** Receipts kept in this browser, newest first. Hidden until there is one. */
function MyReceipts() {
  const receipts = useSavedReceipts();
  if (receipts.length === 0) return null;
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold">My receipts on this phone</h2>
      <ul className="divide-y divide-slate-100">
        {receipts.map((r) => (
          <MyReceiptRow key={r.reference} receipt={r} />
        ))}
      </ul>
    </Card>
  );
}

function MyReceiptRow({ receipt }: { receipt: SavedReceipt }) {
  const { status, start, warm } = useDownload(receipt.receiptUrl, `dormpay-receipt-${receipt.reference}`);
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900">{receipt.monthLabel}</p>
        <p className="truncate text-sm text-slate-500">
          {receipt.studentName} · Room {receipt.room} · <span className="font-mono">{receipt.reference}</span>
        </p>
      </div>
      <button type="button" onClick={() => start()} onTouchStart={warm} className={buttonClass("secondary", "min-h-10 px-3 text-sm")} aria-label={`Save receipt ${receipt.reference}`}>
        {status === "downloading" || status === "photos" ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> : <Download className="size-4" aria-hidden />}{" "}
        {status === "tapAgain" ? "Tap again" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => removeReceipt(receipt.reference)}
        className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label={`Remove receipt ${receipt.reference} from this phone`}
      >
        <X className="size-4" aria-hidden />
      </button>
      <DownloadToast status={status} what="receipt" />
    </li>
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
