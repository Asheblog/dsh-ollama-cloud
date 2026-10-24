/**
 * The little of a cordis patch layer this package needs to read: a row's id and
 * its `inject` list.
 *
 * There is no YAML parser here on purpose. The patch layers this test reads are
 * written for the loader, not for a general parser: they carry `!!js` custom
 * tags and nest rows under `- insert:` layers, so a stock parser would answer
 * for a document nobody loads — or refuse the whole file over a tag it does not
 * know. The question is narrow (which service names does the `connection` row
 * inject?), so the reading is too, and it stays honest about the bytes the
 * loader sees.
 *
 * @module dsh-ollama-cloud/tests/cordis-patch
 */

/** One row found in a patch layer. */
export interface PatchRow {
  /** The id the loader addresses this row by. */
  readonly id: string
  /** The row's `inject:` names, or `undefined` when it declares none. */
  readonly inject: readonly string[] | undefined
  /** 1-based line number of this row's `- id:` entry, for failure messages. */
  readonly line: number
}

const ROW = /^(\s*)-\s+id:\s*['"]?([^\s'"#]+)['"]?\s*$/u
const SIBLING = /^\s*-\s/u
const INJECT = /^\s*inject:\s*(.*)$/u
const BLOCK_ENTRY = /^\s*-\s+(\S+)\s*$/u
const NAME = /^[A-Za-z0-9_$.-]+$/u

/** Strip one layer of quotes and any trailing comment from a scalar. */
function scalar(text: string): string {
  const withoutComment = text.replace(/\s+#.*$/u, '').trim()
  const quoted = /^(['"])(.*)\1$/u.exec(withoutComment)
  return quoted === null ? withoutComment : quoted[2] ?? ''
}

/** Whether a line carries content (a comment or an empty line does not). */
function isContent(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > 0 && !trimmed.startsWith('#')
}

/** Split one flow sequence body (`a, b`) or block scalar list into names. */
function names(body: string): string[] {
  return body
    .split(',')
    .map((entry) => scalar(entry))
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (!NAME.test(entry)) throw new Error(`cordis patch: ${JSON.stringify(entry)} is not a service name`)
      return entry
    })
}

/**
 * Read every row of a patch layer, with its `inject:` list when it declares one.
 *
 * A row's block runs until the next sibling `- ` item at the same or a shallower
 * indent, or until the enclosing block ends. A row that declares `inject:`
 * twice throws: two answers to one question would be guessed, not read.
 * @param text - the patch file's contents.
 * @returns the rows in file order.
 */
export function patchRows(text: string): PatchRow[] {
  const lines = text.split(/\r?\n/u)
  const rows: PatchRow[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = ROW.exec(lines[index] ?? '')
    if (match === null) continue
    const indent = (match[1] ?? '').length
    const id = match[2] ?? ''
    let inject: readonly string[] | undefined
    let end = lines.length
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? ''
      if (!isContent(line)) continue
      const lineIndent = line.length - line.trimStart().length
      if (lineIndent < indent) {
        end = cursor
        break
      }
      if (SIBLING.test(line) && lineIndent <= indent) {
        end = cursor
        break
      }
    }
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      const line = lines[cursor] ?? ''
      if (!isContent(line) || line.trimStart().startsWith('- ')) continue
      const declared = INJECT.exec(line)
      if (declared === null) continue
      if (inject !== undefined) {
        throw new Error(`cordis patch: row ${JSON.stringify(id)} declares inject twice (line ${cursor + 1})`)
      }
      const tail = declared[1] ?? ''
      const trimmed = tail.trim()
      if (trimmed.startsWith('[')) {
        let body = trimmed
        let scan = cursor
        while (!body.includes(']') && scan + 1 < end) {
          scan += 1
          body += ` ${(lines[scan] ?? '').trim()}`
        }
        const closed = body.indexOf(']')
        if (closed < 0) throw new Error(`cordis patch: row ${JSON.stringify(id)} has an unterminated inject list`)
        inject = names(body.slice(1, closed))
        continue
      }
      // Block form: `inject:` followed by `- name` entries at a deeper indent.
      const injectIndent = line.length - line.trimStart().length
      const collected: string[] = []
      for (let scan = cursor + 1; scan < end; scan += 1) {
        const entry = lines[scan] ?? ''
        if (!isContent(entry)) continue
        const entryIndent = entry.length - entry.trimStart().length
        if (entryIndent <= injectIndent) break
        const item = BLOCK_ENTRY.exec(entry)
        if (item !== null && item[1] !== undefined) collected.push(...names(item[1]))
      }
      inject = collected
    }
    rows.push({ id, inject, line: index + 1 })
  }
  return rows
}

/**
 * Find one row by id, failing loudly when it is missing or ambiguous.
 * @param text - the patch file's contents.
 * @param id - the row id to find.
 * @returns the single row with that id.
 */
export function rowById(text: string, id: string): PatchRow {
  const matches = patchRows(text).filter((row) => row.id === id)
  if (matches.length !== 1) {
    throw new Error(`cordis patch: expected exactly one row with id ${JSON.stringify(id)}, found ${matches.length}`)
  }
  return matches[0] as PatchRow
}
