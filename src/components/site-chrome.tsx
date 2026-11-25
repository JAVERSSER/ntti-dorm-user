import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-2xl items-center px-4">
        <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
          <Image src="/logo.png" alt="" width={36} height={36} className="rounded-full" priority />
          <span>DormPay</span>
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-2xl px-4 py-6 text-sm text-slate-500">
        Need help? Contact the dormitory office.
      </div>
    </footer>
  );
}
