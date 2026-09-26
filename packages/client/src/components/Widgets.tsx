import { useEffect, useState } from 'preact/hooks';

export function ClockWidget({ format, showDate }: { format: '12h' | '24h'; showDate: boolean }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 15);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: format === '12h' });
  return (
    <div class="clock">
      <div class="clock-time num">{time}</div>
      {showDate && <div class="clock-date">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>}
    </div>
  );
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Small, safe Markdown: # headings, **bold**, *italic*, `code`, [links](https://…), paragraphs, - lists. */
export function miniMarkdown(md: string): string {
  const inline = (s: string) =>
    escHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const block of md.split(/\n{2,}/)) {
    for (const line of block.split('\n')) {
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      const li = /^\s*[-*]\s+(.*)$/.exec(line);
      if (li) list.push(li[1]);
      else {
        flush();
        if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
        else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
      }
    }
    flush();
  }
  return out.join('');
}

export function TextWidget({ markdown }: { markdown: string }) {
  return <div class="md" dangerouslySetInnerHTML={{ __html: miniMarkdown(markdown) }} />;
}

export function ImageWidget({ url, fit }: { url: string; fit: 'contain' | 'cover' }) {
  return <img class="img-widget" src={url} alt="" style={{ objectFit: fit }} />;
}
