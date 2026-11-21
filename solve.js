// Fast drop-in for make.fun's csv-reader 1.0.0.
//
// Same answer for every input, {columns, rows, errors}, but read in bulk
// instead of one character at a time. Two tiers:
//
//   - Fast tier (most records): a record whose first line holds no quote
//     and no stray CR is one line slice + one split(',') — the whole
//     record's fields in a single C++ scan, no per-character JS loop.
//   - Slow tier (quoted fields, stray CRs, unterminated quotes, junk):
//     the same policy as csv-reader, but every scan jumps with indexOf /
//     a delimiter regex and every field is a slice, never a char-by-char
//     build.
//
// Policy (csv-reader 1.0.0, reimplemented exactly):
//   - U+FEFF at the very start is dropped.
//   - A record ends at LF or CRLF; a line with no characters is no record.
//   - Outside quotes a CR not followed by LF is dropped (stray_cr).
//   - A field opening with a quote runs to the next quote that is not
//     doubled; "" inside it is one quote, and each CRLF or lone CR inside
//     it reads as LF; what follows its closing quote, up to the next comma
//     or line break, is appended as it stands (quote_junk, when the field
//     ends); a quote that never closes is a literal character, and the text
//     after it is read again as unquoted (unterminated_quote).
//   - A quote inside an unquoted field is a literal character.
//   - Fields stay strings, never trimmed or converted.
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its field count) or cut (long_row,
//     with extra: the cut fields) to the first record's width.
//   - Each error is {code, line, row}, in the order met; line is the
//     1-based line its record starts on (every LF, CRLF and lone CR inside
//     a quoted field counted), row its record's index in rows (null for
//     the header).

/** How a field ended: 0 at a comma, 1 at a line break, 2 at the end. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const N = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and its index in rows
  // (null while the header is being read).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended (COMMA / LINE_BREAK /
  // END) and `added`, the characters kept. The field readers write these
  // instead of returning a fresh object per field (585k fields a set —
  // the allocation alone cost real time).
  let fv = '';
  let fe = END;
  let fa = 0;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break. A CR not followed by LF is dropped (stray_cr). Writes the
  // field to `fv` / `fe` / `fa` (`fa` = the characters kept).
  //
  // No loop: the field ends at the next comma or line break after pos, and
  // a stray CR inside it cannot end it, so one straight-line computation
  // per field — two indexOf calls, one slice, one CR check on the slice.
  function readUnquoted(value) {
    const ci = text.indexOf(',', pos);
    const ni = text.indexOf('\n', pos);
    let end;
    let ended;
    if (ci !== -1 && (ni === -1 || ci < ni)) {
      end = ci;
      ended = COMMA;
    } else if (ni !== -1) {
      end = ni;
      ended = LINE_BREAK;
    } else {
      end = N;
      ended = END;
    }
    // A CRLF's CR is not part of the field.
    let fend = end;
    if (ended === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) fend = end - 1;
    const raw = text.slice(pos, fend);
    if (raw.indexOf('\r') === -1) {
      fv = value === '' ? raw : value + raw;
      fa = raw.length;
    } else {
      // Rare: stray CRs inside the field. Each is dropped and recorded;
      // the field still ends at `end` (no CR in here is followed by LF:
      // if one were, that LF would be the first newline after pos).
      const parts = raw.split('\r');
      for (let k = 0; k < parts.length - 1; k++) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      }
      fv = value === '' ? parts.join('') : value + parts.join('');
      fa = raw.length - (parts.length - 1);
    }
    pos = ended === END ? N : end + 1;
    if (ended === LINE_BREAK) line += 1;
    fe = ended;
  }

  // Reads a quoted field whose opening quote is at pos. Writes the field
  // to `fv` / `fe` / `fa` (`fa` = the characters kept).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      if (q > pos) {
        const seg = text.slice(pos, q);
        if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) {
          value += seg;
        } else {
          // CRLF and a lone CR inside quotes are each one LF; count every
          // line break the segment holds, then normalise them.
          const breaks = seg.match(/\r\n|\r|\n/g);
          if (breaks !== null) line += breaks.length;
          value += seg.replace(/\r\n?/g, '\n');
        }
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote in the value.
        value += '"';
        pos = q + 2;
        continue;
      }
      // The closing quote.
      pos = q + 1;
      if (pos >= N) {
        fv = value;
        fe = END;
        fa = value.length;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fv = value;
        fe = COMMA;
        fa = value.length;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fv = value;
        fe = LINE_BREAK;
        fa = value.length;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fv = value;
        fe = LINE_BREAK;
        fa = value.length;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break. readUnquoted leaves the field in
      // `fv` / `fe` / `fa`; `fa` is the junk kept, if any.
      readUnquoted(value);
      if (fa > 0) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      return;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < N) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= N) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast tier: the record's first line holds no quote and no stray CR,
    // so the whole record is one line slice + one split(',').
    const nl = text.indexOf('\n', pos);
    const seg = nl === -1 ? text.slice(pos) : text.slice(pos, nl);
    let fields = null;
    if (seg.indexOf('"') === -1) {
      const cr = seg.indexOf('\r');
      // No stray CR: the only CR allowed is the CRLF at the line's end
      // (and only when the line does end — a trailing CR at the end of
      // the text is a lone one, so it takes the slow tier).
      if (cr === -1 || (nl !== -1 && cr === seg.length - 1)) {
        const body = cr === seg.length - 1 ? seg.slice(0, -1) : seg;
        fields = body.split(',');
        pos = nl === -1 ? N : nl + 1;
        if (nl !== -1) line += 1;
      }
    }

    if (fields === null) {
      // Slow tier: read the record field by field.
      fields = [];
      let quoted = false;
      do {
        quoted = text.charCodeAt(pos) === 34;
        if (quoted) readQuoted(); else readUnquoted('');
        fields.push(fv);
      } while (fe === COMMA);

      // A line that held only stray CRs is left with no characters: no
      // record (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
