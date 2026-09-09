type ClassInput = string | false | null | undefined | ClassInput[] | Record<string, boolean>;

export function cn(...classes: ClassInput[]): string {
  const out: string[] = [];
  const flatten = (v: ClassInput): void => {
    if (!v) return;
    if (typeof v === 'string') {
      out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) flatten(item);
      return;
    }
    for (const [key, on] of Object.entries(v)) if (on) out.push(key);
  };
  for (const c of classes) flatten(c);
  return out.join(' ');
}
