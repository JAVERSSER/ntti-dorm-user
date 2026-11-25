"use client";

import { useSyncExternalStore } from "react";

/**
 * Things kept silently in this browser's localStorage (no download, no
 * question): the payment QR image and the student's past receipts.
 * Every access is wrapped: private mode or a full storage just skips saving.
 */

const QR_IMAGE_KEY = "dormpay:qr-image";
const QR_SAVED_KEY = "dormpay:qr-saved";
const RECEIPTS_KEY = "dormpay:receipts";
/** Keep the latest receipts only; localStorage is small (about 5 MB). */
const MAX_RECEIPTS = 24;

export type SavedReceipt = {
  reference: string;
  studentName: string;
  room: string;
  monthLabel: string;
  receiptUrl: string;
  savedAt: string;
};

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return; // private mode / quota: not saved, nothing else breaks
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener); // other tabs
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Raw stored string for a key, kept in sync across components and tabs (null on the server). */
function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
}

// ---- QR ----------------------------------------------------------------

/** Keep a copy of the current QR image in the browser (skipped if already stored). */
export async function storeQrImage(qrUrl: string, downloadUrl: string) {
  try {
    const stored = JSON.parse(read(QR_IMAGE_KEY) ?? "null") as { src: string } | null;
    if (stored?.src === qrUrl) return;
    const res = await fetch(downloadUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    write(QR_IMAGE_KEY, JSON.stringify({ src: qrUrl, dataUrl, savedAt: new Date().toISOString() }));
  } catch {
    // best effort
  }
}

/** The stored copy of this QR as a data: URL, if any (used when the image cannot load). */
export function useStoredQrImage(qrUrl: string): string | null {
  const raw = useStored(QR_IMAGE_KEY);
  try {
    const stored = JSON.parse(raw ?? "null") as { src: string; dataUrl: string } | null;
    return stored?.src === qrUrl ? stored.dataUrl : null;
  } catch {
    return null;
  }
}

/** Whether this exact QR was already saved to the phone from this browser. */
export function useQrAlreadySaved(qrUrl: string): boolean {
  return useStored(QR_SAVED_KEY) === qrUrl;
}

export function markQrSaved(qrUrl: string) {
  write(QR_SAVED_KEY, qrUrl);
}

// ---- Download file names ------------------------------------------------

/**
 * Next file name for a download from this phone: "dormpay-qr" the first time,
 * then "dormpay-qr_1", "dormpay-qr_2", … so a new download never has the same
 * name as one already saved.
 */
export function nextDownloadName(base: string): string {
  const key = `dormpay:downloads:${base}`;
  const count = Number(read(key)) || 0;
  write(key, String(count + 1));
  return count === 0 ? base : `${base}_${count}`;
}

// ---- Receipts ----------------------------------------------------------

function parseReceipts(raw: string | null): SavedReceipt[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list) ? (list as SavedReceipt[]) : [];
  } catch {
    return [];
  }
}

/** Newest first. */
export function useSavedReceipts(): SavedReceipt[] {
  return parseReceipts(useStored(RECEIPTS_KEY));
}

export function saveReceipt(receipt: Omit<SavedReceipt, "savedAt">) {
  const list = parseReceipts(read(RECEIPTS_KEY)).filter((r) => r.reference !== receipt.reference);
  list.unshift({ ...receipt, savedAt: new Date().toISOString() });
  write(RECEIPTS_KEY, JSON.stringify(list.slice(0, MAX_RECEIPTS)));
}

export function removeReceipt(reference: string) {
  const list = parseReceipts(read(RECEIPTS_KEY)).filter((r) => r.reference !== reference);
  write(RECEIPTS_KEY, list.length ? JSON.stringify(list) : null);
}
