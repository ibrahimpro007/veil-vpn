/**
 * Minimal markdown renderer for blog posts (subset: ##, ###, paragraphs,
 * - lists, 1. lists, **bold**, *italic*, [links](/x), | tables |, blockquotes).
 * Keeps the bundle tiny vs pulling in a full MDX pipeline.
 */

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  // Split on **bold**, *italic*, [link](url)
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={key}>{bold[1]}</strong>;
    const italic = part.match(/^\*([^*]+)\*$/);
    if (italic) return <em key={key}>{italic[1]}</em>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = link[2];
      const external = href.startsWith("http");
      return (
        <a
          key={key}
          href={href}
          className="font-medium text-emerald-300 underline decoration-emerald-300/40 underline-offset-2 hover:text-emerald-200"
          {...(external
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {})}
        >
          {link[1]}
        </a>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

function Table({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <div className="my-6 overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="bg-white/5">
            {head.map((c, i) => (
              <th key={i} className="px-4 py-3 font-bold text-white">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="border-t border-white/10">
              {r.map((c, ci) => (
                <td key={ci} className="px-4 py-3 text-slate-300">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Markdown({ body }: { body: string }) {
  const lines = body.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  let listItems: string[] = [];
  let listOrdered = false;
  let tableRows: string[][] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    out.push(
      listOrdered ? (
        <ol
          key={key++}
          className="my-4 list-decimal space-y-2 pl-6 text-slate-300"
        >
          {items.map((t, j) => (
            <li key={j}>{inline(t, `li-${key}-${j}`)}</li>
          ))}
        </ol>
      ) : (
        <ul
          key={key++}
          className="my-4 list-disc space-y-2 pl-6 text-slate-300"
        >
          {items.map((t, j) => (
            <li key={j}>{inline(t, `li-${key}-${j}`)}</li>
          ))}
        </ul>
      ),
    );
  };

  const flushTable = () => {
    if (tableRows.length === 0) return;
    out.push(<Table key={key++} rows={tableRows} />);
    tableRows = [];
  };

  const parseRow = (line: string): string[] =>
    line
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushList();
      flushTable();
      i++;
      continue;
    }
    if (trimmed.startsWith("### ")) {
      flushList();
      flushTable();
      out.push(
        <h3 key={key++} className="mb-3 mt-8 text-xl font-bold text-white">
          {inline(trimmed.slice(4), `h3-${key}`)}
        </h3>,
      );
      i++;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushList();
      flushTable();
      out.push(
        <h2
          key={key++}
          className="mb-4 mt-10 text-2xl font-extrabold tracking-tight text-white"
        >
          {inline(trimmed.slice(3), `h2-${key}`)}
        </h2>,
      );
      i++;
      continue;
    }
    if (trimmed.startsWith("|")) {
      flushList();
      const cells = parseRow(trimmed);
      // skip the markdown separator row (|---|---|)
      if (cells.every((c) => /^:?-+:?$/.test(c))) {
        i++;
        continue;
      }
      tableRows.push(cells);
      i++;
      continue;
    }
    if (/^[-*] /.test(trimmed)) {
      flushTable();
      if (listOrdered) flushList();
      listOrdered = false;
      listItems.push(trimmed.slice(2));
      i++;
      continue;
    }
    const ordered = trimmed.match(/^\d+\. (.+)/);
    if (ordered) {
      flushTable();
      if (!listOrdered) flushList();
      listOrdered = true;
      listItems.push(ordered[1]);
      i++;
      continue;
    }
    if (trimmed.startsWith("> ")) {
      flushList();
      flushTable();
      out.push(
        <blockquote
          key={key++}
          className="my-6 border-l-4 border-emerald-400/60 bg-emerald-400/5 px-5 py-3 text-slate-200"
        >
          {inline(trimmed.slice(2), `q-${key}`)}
        </blockquote>,
      );
      i++;
      continue;
    }
    flushList();
    flushTable();
    out.push(
      <p key={key++} className="my-4 leading-relaxed text-slate-300">
        {inline(trimmed, `p-${key}`)}
      </p>,
    );
    i++;
  }
  flushList();
  flushTable();
  return <>{out}</>;
}
