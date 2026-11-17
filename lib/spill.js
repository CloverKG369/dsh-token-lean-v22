/**
 * Reversible spill store: every compressed tool result keeps its exact original
 * text on disk so the model (or a human) can recover it losslessly.
 *
 * Bounded retention: the newest `keepFiles` originals are retained; older ones
 * are pruned on write. Re-spilling identical text touches the file so a live
 * reference is never pruned as "old".
 */

import fs from 'node:fs'
import path from 'node:path'
import { resolveDshHome } from './config.js'
import { sha256, stripBom, utf8Bytes } from './util.js'

export class SpillStore {
  constructor(home = resolveDshHome()) {
    this.dir = path.join(home, 'token-lean', 'spill')
    this.maxBytes = 8_000_000
    this.keepFiles = 500
  }

  setMaxBytes(maxBytes) {
    this.maxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 0
  }

  setKeepFiles(keepFiles) {
    const value = Number(keepFiles)
    this.keepFiles = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
    this.prune()
  }

  /**
   * Persist the original text and return its content address. Existing files
   * are reused, so the same evidence never occupies disk twice.
   * @returns {{id: string, path: string, bytes: number}|undefined}
   */
  save(text) {
    try {
      if (typeof text !== 'string' || text.length === 0) return undefined
      const bytes = utf8Bytes(text)
      if (this.maxBytes > 0 && bytes > this.maxBytes) return undefined
      const id = sha256(text).slice(0, 20)
      const filePath = path.join(this.dir, `${id}.txt`)
      if (!fs.existsSync(filePath)) {
        fs.mkdirSync(this.dir, { recursive: true })
        fs.writeFileSync(filePath, text, 'utf8')
      } else {
        const now = new Date()
        fs.utimesSync(filePath, now, now)
      }
      this.prune(id)
      return { id, path: filePath, bytes }
    } catch {
      return undefined
    }
  }

  /** Keep the newest files, never deleting the file just written. */
  prune(keepId) {
    if (!(this.keepFiles > 0)) return
    try {
      const entries = fs
        .readdirSync(this.dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
        .map((entry) => {
          const filePath = path.join(this.dir, entry.name)
          return { filePath, mtime: fs.statSync(filePath).mtimeMs }
        })
        .sort((left, right) => left.mtime - right.mtime)
      let excess = entries.length - this.keepFiles
      for (const entry of entries) {
        if (excess <= 0) break
        if (keepId !== undefined && entry.filePath === path.join(this.dir, `${keepId}.txt`)) continue
        try {
          fs.unlinkSync(entry.filePath)
          excess -= 1
        } catch {
          /* another process may have removed it */
        }
      }
    } catch {
      /* retention is best-effort and must never break a request */
    }
  }

  /** Read a spilled original by id, or undefined when it is gone. */
  read(id) {
    try {
      if (!/^[a-f0-9]{6,64}$/.test(String(id))) return undefined
      const filePath = path.join(this.dir, `${id}.txt`)
      if (!fs.existsSync(filePath)) return undefined
      return stripBom(fs.readFileSync(filePath, 'utf8'))
    } catch {
      return undefined
    }
  }

  /** Absolute path for an id, without checking existence. */
  pathFor(id) {
    return path.join(this.dir, `${id}.txt`)
  }
}
