import { escapeHtml } from './ui.js';

function inlineMarkdown(value) {
  const preserved = [];
  const preserve = (html) => {
    const token = `\u0000${preserved.length}\u0000`;
    preserved.push(html);
    return token;
  };
  let content = value
    .replace(/\u0000/g, '')
    .replace(/\\\|/g, '|')
    .replace(/`([^`]+)`/g, (_, code) => preserve(`<code>${escapeHtml(code)}</code>`));
  // The backend uses plain <br> in escaped table cells. No other raw HTML is accepted.
  content = content.replace(/<br\s*\/?>/gi, () => preserve('<br>'));
  content = content.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, (_, label, href) => {
    try {
      const url = new URL(href);
      if (!['http:', 'https:'].includes(url.protocol)) return escapeHtml(label);
      return preserve(
        `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
      );
    } catch {
      return escapeHtml(label);
    }
  });
  content = escapeHtml(content)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return content.replace(/\u0000(\d+)\u0000/g, (_, index) => preserved[Number(index)]);
}

function tableCells(line) {
  const source = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cell = '';
  let escaped = false;
  for (const character of source) {
    if (character === '|' && !escaped) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
    escaped = character === '\\' && !escaped;
  }
  cells.push(cell.trim());
  return cells;
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export function renderMarkdown(markdown = '') {
  const lines = String(markdown).split(/\r?\n/);
  const output = [];
  let paragraph = [];
  let listType = '';

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      output.push(`</${listType}>`);
      listType = '';
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = /^\s*(`{3,}|~{3,})[^`~]*$/.exec(line);
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const listItem = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);

    if (fence) {
      flushParagraph();
      closeList();
      const code = [];
      const closing = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (++index < lines.length && !closing.test(lines[index])) code.push(lines[index]);
      output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    } else if (!line.trim()) {
      flushParagraph();
      closeList();
    } else if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(6, heading[1].length + 1);
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (/^\s*---+\s*$/.test(line)) {
      flushParagraph();
      closeList();
      output.push('<hr>');
    } else if (quote) {
      flushParagraph();
      closeList();
      output.push(`<blockquote><p>${inlineMarkdown(quote[1])}</p></blockquote>`);
    } else if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      flushParagraph();
      closeList();
      const headers = tableCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      output.push(
        `<div class="markdown-table-wrap"><table><thead><tr>${headers
          .map((cell) => `<th>${inlineMarkdown(cell)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map(
            (row) =>
              `<tr>${headers.map((_, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`,
          )
          .join('')}</tbody></table></div>`,
      );
    } else if (listItem) {
      flushParagraph();
      const nextType = listItem[1] ? 'ul' : 'ol';
      if (listType !== nextType) {
        closeList();
        output.push(`<${nextType}>`);
        listType = nextType;
      }
      output.push(`<li>${inlineMarkdown(listItem[3])}</li>`);
    } else {
      closeList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  closeList();
  return output.join('');
}
