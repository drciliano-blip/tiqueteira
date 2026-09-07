import Link from 'next/link';

export function Marca({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden
        className="grid h-7 w-7 place-items-center rounded-lg bg-destaque text-sm font-bold text-fundo"
      >
        T
      </span>
      <span className="text-[15px]">Tiqueteira</span>
    </Link>
  );
}
