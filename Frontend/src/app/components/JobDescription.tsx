import { HEADING } from './careersUtils';

// Job descriptions arrive as plain text (parsed from the JD file). This turns
// them into readable structure: headings, paragraphs and bullet lists.

const BULLET = /^([-•*·●▪‣◦]|\d{1,2}[.)])\s+(.*)$/;

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; items: string[] };

const looksLikeHeading = (line: string, next: string | undefined): boolean => {
  if (line.length > 70 || BULLET.test(line)) return false;
  if (line.endsWith(':')) return true;
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) return true;
  // short title-like line directly followed by a bullet
  return !!next && BULLET.test(next.trim()) && line.length <= 50 && !/[.!?]$/.test(line);
};

const parse = (text: string): Block[] => {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let list: string[] | null = null;
  const flush = () => { if (list?.length) blocks.push({ kind: 'list', items: list }); list = null; };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) { flush(); return; }

    const b = line.match(BULLET);
    if (b) { (list ??= []).push(b[2]); return; }

    flush();
    if (looksLikeHeading(line, lines[i + 1])) {
      blocks.push({ kind: 'heading', text: line.replace(/:$/, '') });
    } else {
      blocks.push({ kind: 'para', text: line });
    }
  });
  flush();
  return blocks;
};

export default function JobDescription({ text }: { text: string }) {
  const blocks = parse(text || '');
  if (blocks.length === 0) {
    return <p className="text-[15px] text-[#5B6272]">The detailed description for this role will be shared during the hiring process.</p>;
  }

  return (
    <div className="space-y-3 text-[15px] leading-[1.7] text-[#2B3250]">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          return <h3 key={i} className={`${HEADING} !mt-7 text-[16px] font-semibold !leading-snug text-[#050C26] first:!mt-0`}>{b.text}</h3>;
        }
        if (b.kind === 'list') {
          return (
            <ul key={i} className="space-y-1.5 pl-5">
              {b.items.map((it, j) => (
                <li key={j} className="list-disc marker:text-[#F26522]">{it}</li>
              ))}
            </ul>
          );
        }
        return <p key={i} className="max-w-[72ch]">{b.text}</p>;
      })}
    </div>
  );
}
