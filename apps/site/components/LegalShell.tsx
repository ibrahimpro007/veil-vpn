export default function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
        Legal
      </p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white">
        {title}
      </h1>
      <p className="mt-3 text-sm text-slate-500">Last updated: {updated}</p>
      <div className="prose-legal mt-8 space-y-6 text-[15px] leading-relaxed text-slate-300 [&_h2]:pt-4 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_h3]:pt-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-white [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_strong]:text-white [&_a]:text-emerald-300 [&_a]:hover:underline [&_code]:rounded [&_code]:bg-black/40 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-emerald-200">
        {children}
      </div>
    </div>
  );
}
