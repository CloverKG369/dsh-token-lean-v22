/*!
 * dsh-token-lean — client half (Web settings page)
 *
 * A classic browser script (no JSX, no bundler, no external packages) that the
 * DSH client-module loader evaluates with `window.__ModuleLoader__.load`. The
 * factory receives the loader's `require`, takes React from it, and returns
 * `{ name, inject, apply }`. `apply` registers one `settings.section` page,
 * one locale namespace and the page CSS.
 *
 * All data comes from the package-private JSON API served by the node half at
 * `/api/token-lean`: GET `state`, POST `config`, POST `preview`, POST
 * `reset-stats`. Every request is same-origin and never throws into React: a
 * failed request keeps the last known state and turns on the error banner.
 *
 * UI is bilingual (en/vi) and follows `ctx.locale`; copy is a flat dictionary
 * of `{name}`-templated strings.
 */

;(function () {
  'use strict'

  var PLUGIN_ID = '@local/dsh-token-lean-v22'
  var NS = 'settings.tokenLean'
  var API_BASE = '/api/token-lean'
  var AUTO_SAVE_MS = 500
  var PREVIEW_CHARS = 4000

  var ENGINE_IDS = ['sessionDedup', 'lite', 'headroom', 'rtk']
  var STYLE_IDS = ['caveman', 'yagni', 'ponytail', 'adhd', 'antislop']
  var DEFAULT_STYLE_LEVELS = ['off', 'lite', 'full', 'ultra']

  /**
   * Bilingual UI copy. Flat keys; `{name}` templates are filled from vars.
   * Lookup order: active locale -> en -> key itself. Vietnamese is the default
   * when the active locale starts with `vi`; every other locale reads English.
   */
  var STR = {
    en: {
      tab: 'Token Lean',
      title: 'Token Lean',
      subtitle: 'Nine token-efficiency features for tool output and the system prompt.',
      saved: 'Saved',
      saving: 'Saving…',
      statusUnsaved: 'Unsaved changes',
      loading: 'Loading settings…',
      unavailable: 'The token-lean host half is not answering yet.',
      retry: 'Retry',
      errorTitle: 'Request failed',
      master: 'Master switch',
      masterHint: 'Turns every engine and output style on or off at once.',
      on: 'On',
      off: 'Off',
      statsTitle: 'Total savings',
      statBefore: 'Bytes before',
      statAfter: 'Bytes after',
      statSaved: 'Saved',
      statSpills: 'Spills written',
      statDetail: '{calls} tool results compressed · {hits} smaller than the original',
      storageTitle: 'Spill storage',
      storageHint: 'Originals kept for lossless recovery. Old files are pruned on write.',
      field_spillEnabled: 'Keep originals on disk',
      field_spillMaxMb: 'Max original size (MB)',
      field_spillKeepFiles: 'Files to keep',
      hint_spillKeepFiles: 'Newest files are kept; 0 means unlimited.',
      resetStats: 'Reset stats',
      enginesTitle: 'Compression engines',
      enginesHint: 'Run on tool results before they enter the model context. Every reduction stays retrievable from the spill file.',
      stylesTitle: 'Output styles',
      stylesHint: 'Extra system-prompt disciplines. Off by default; enabling them changes form, never facts.',
      engineStats: '{before} → {after} · {pct}% saved · {calls} passes · {hits} hits',
      engineStatsEmpty: 'No passes recorded yet.',
      test: 'Test this engine',
      testHint: 'Paste a sample tool result and preview exactly what this engine would send.',
      testPlaceholder: 'Paste a sample tool result here…',
      testRun: 'Preview',
      testRunning: 'Running…',
      testNeedsText: 'Paste some text first.',
      testResult: 'Before {before} · after {after} · saved {pct}%',
      testNote: 'Note',
      testFailed: 'Preview failed: {message}',
      resultPreview: 'Result preview',
      styleLevel: 'Level',
      level_off: 'Off',
      level_lite: 'Lite',
      level_full: 'Full',
      level_ultra: 'Ultra',
      spillDir: 'Spill directory: {path}',
      field_ttlMs: 'Cache TTL (ms)',
      field_minBytes: 'Minimum size (bytes)',
      field_minRows: 'Minimum rows',
      field_jsonlMinLines: 'JSONL min lines',
      field_errorMinBytes: 'Error output min bytes',
      field_skipSourceReads: 'Do not truncate source reads',
      field_maxRows: 'Maximum rows',
      field_keepRatioMax: 'Maximum kept ratio',
      field_maxLines: 'Maximum lines',
      field_headLines: 'Head lines',
      field_tailLines: 'Tail lines',
      field_errorLines: 'Error lines kept',
      field_longLineChars: 'Wrap long lines at (chars)',
      field_stripAnsi: 'Strip ANSI colors',
      field_normalizeNewlines: 'Normalize line endings',
      field_trimTrailingSpaces: 'Trim trailing spaces',
      field_collapseBlankLines: 'Collapse blank line runs',
      field_trimImageDataUrls: 'Replace inline image data',
      field_truncateMiddle: 'Cut from the middle',
      hint_ttlMs: 'How long a dedup fingerprint stays valid.',
      hint_minBytes: 'Results smaller than this are left untouched.',
      hint_keepRatioMax: '1 keeps everything; lower keeps less.',
      hint_minRows: 'Uniform JSON arrays below this row count are left alone.',
      hint_jsonlMinLines: 'Separate minimum for JSONL/NDJSON and numbered read lines.',
      hint_errorMinBytes: 'Failed results smaller than this are left untouched.',
      hint_skipSourceReads: 'Keeps .py/.tsx/.js/.md/.yaml and similar reads complete; command output still compresses.',
      hint_maxRows: 'Upper bound on rows the compactor will touch.',
      hint_truncateMiddle: 'Keep head and tail, cut the middle.',
    },
    vi: {
      tab: 'Token Lean',
      title: 'Token Lean',
      subtitle: 'Chín tính năng tiết kiệm token cho kết quả công cụ và system prompt.',
      saved: 'Đã lưu',
      saving: 'Đang lưu…',
      statusUnsaved: 'Có thay đổi chưa lưu',
      loading: 'Đang tải cài đặt…',
      unavailable: 'Phần máy chủ của token-lean chưa phản hồi.',
      retry: 'Thử lại',
      errorTitle: 'Yêu cầu thất bại',
      master: 'Công tắc tổng',
      masterHint: 'Bật hoặc tắt toàn bộ engine và kiểu đầu ra cùng lúc.',
      on: 'Bật',
      off: 'Tắt',
      statsTitle: 'Tổng mức tiết kiệm',
      statBefore: 'Byte trước',
      statAfter: 'Byte sau',
      statSaved: 'Tiết kiệm',
      statSpills: 'Lần ghi spill',
      statDetail: '{calls} kết quả tool đã nén · {hits} kết quả nhỏ hơn bản gốc',
      storageTitle: 'Lưu bản gốc (spill)',
      storageHint: 'Giữ bản gốc để khôi phục không mất dữ liệu. Tệp cũ bị dọn khi ghi.',
      field_spillEnabled: 'Giữ bản gốc trên đĩa',
      field_spillMaxMb: 'Kích thước gốc tối đa (MB)',
      field_spillKeepFiles: 'Số tệp giữ lại',
      hint_spillKeepFiles: 'Giữ tệp mới nhất; 0 = không giới hạn.',
      resetStats: 'Xoá thống kê',
      enginesTitle: 'Engine nén',
      enginesHint: 'Chạy trên kết quả công cụ trước khi vào ngữ cảnh model. Mọi phần bị cắt vẫn lấy lại được từ tệp spill.',
      stylesTitle: 'Kiểu đầu ra',
      stylesHint: 'Kỷ luật bổ sung cho system prompt. Mặc định tắt; khi bật chỉ đổi hình thức, không bỏ dữ kiện.',
      engineStats: '{before} → {after} · tiết kiệm {pct}% · {calls} lượt · {hits} lần giảm',
      engineStatsEmpty: 'Chưa có lượt xử lý nào.',
      test: 'Thử engine này',
      testHint: 'Dán một mẫu kết quả công cụ để xem đúng nội dung engine sẽ gửi đi.',
      testPlaceholder: 'Dán kết quả công cụ mẫu ở đây…',
      testRun: 'Xem trước',
      testRunning: 'Đang chạy…',
      testNeedsText: 'Hãy dán nội dung trước.',
      testResult: 'Trước {before} · sau {after} · tiết kiệm {pct}%',
      testNote: 'Ghi chú',
      testFailed: 'Xem trước thất bại: {message}',
      resultPreview: 'Bản xem trước kết quả',
      styleLevel: 'Mức',
      level_off: 'Tắt',
      level_lite: 'Nhẹ',
      level_full: 'Đầy đủ',
      level_ultra: 'Cực mạnh',
      spillDir: 'Thư mục spill: {path}',
      field_ttlMs: 'TTL bộ nhớ (ms)',
      field_minBytes: 'Kích thước tối thiểu (byte)',
      field_minRows: 'Số hàng tối thiểu',
      field_jsonlMinLines: 'Số dòng JSONL tối thiểu',
      field_errorMinBytes: 'Byte tối thiểu cho output lỗi',
      field_skipSourceReads: 'Không cắt file source khi read',
      field_maxRows: 'Số hàng tối đa',
      field_keepRatioMax: 'Tỉ lệ giữ lại tối đa',
      field_maxLines: 'Số dòng tối đa',
      field_headLines: 'Số dòng đầu',
      field_tailLines: 'Số dòng cuối',
      field_errorLines: 'Số dòng lỗi giữ lại',
      field_longLineChars: 'Ngắt dòng dài tại (ký tự)',
      field_stripAnsi: 'Bỏ màu ANSI',
      field_normalizeNewlines: 'Chuẩn hoá xuống dòng',
      field_trimTrailingSpaces: 'Bỏ khoảng trắng cuối dòng',
      field_collapseBlankLines: 'Gộp các dòng trống',
      field_trimImageDataUrls: 'Thay dữ liệu ảnh inline',
      field_truncateMiddle: 'Cắt ở giữa',
      hint_ttlMs: 'Thời gian một dấu vân tay dedup còn hiệu lực.',
      hint_minBytes: 'Kết quả nhỏ hơn ngưỡng này được giữ nguyên.',
      hint_keepRatioMax: '1 là giữ tất cả; càng nhỏ càng giữ ít.',
      hint_minRows: 'Mảng JSON đồng nhất dưới số hàng này sẽ bỏ qua.',
      hint_jsonlMinLines: 'Ngưỡng riêng cho JSONL/NDJSON và output read có số dòng.',
      hint_errorMinBytes: 'Kết quả lỗi nhỏ hơn ngưỡng này được giữ nguyên.',
      hint_skipSourceReads: 'Giữ nguyên file .py/.tsx/.js/.md/.yaml khi read; output lệnh vẫn nén.',
      hint_maxRows: 'Giới hạn trên số hàng bộ nén sẽ xử lý.',
      hint_truncateMiddle: 'Giữ đầu và cuối, cắt phần giữa.',
    },
  }

  /** Controls rendered for each engine section, mirroring lib/config.js. */
  var ENGINE_FIELDS = {
    sessionDedup: [
      { key: 'ttlMs', kind: 'number', label: 'field_ttlMs', hint: 'hint_ttlMs', min: 0, max: 86400000, step: 1000 },
      { key: 'minBytes', kind: 'number', label: 'field_minBytes', hint: 'hint_minBytes', min: 64, step: 100 },
    ],
    lite: [
      { key: 'minBytes', kind: 'number', label: 'field_minBytes', hint: 'hint_minBytes', min: 64, step: 100 },
      { key: 'stripAnsi', kind: 'boolean', label: 'field_stripAnsi' },
      { key: 'normalizeNewlines', kind: 'boolean', label: 'field_normalizeNewlines' },
      { key: 'trimTrailingSpaces', kind: 'boolean', label: 'field_trimTrailingSpaces' },
      { key: 'collapseBlankLines', kind: 'boolean', label: 'field_collapseBlankLines' },
      { key: 'trimImageDataUrls', kind: 'boolean', label: 'field_trimImageDataUrls' },
    ],
    headroom: [
      { key: 'minBytes', kind: 'number', label: 'field_minBytes', hint: 'hint_minBytes', min: 128, step: 100 },
      { key: 'minRows', kind: 'number', label: 'field_minRows', hint: 'hint_minRows', min: 2, step: 1 },
      { key: 'jsonlMinLines', kind: 'number', label: 'field_jsonlMinLines', hint: 'hint_jsonlMinLines', min: 2, step: 1 },
      { key: 'maxRows', kind: 'number', label: 'field_maxRows', hint: 'hint_maxRows', min: 2, step: 1 },
      { key: 'keepRatioMax', kind: 'number', label: 'field_keepRatioMax', hint: 'hint_keepRatioMax', min: 0.1, max: 1, step: 0.01 },
    ],
    rtk: [
      { key: 'minBytes', kind: 'number', label: 'field_minBytes', hint: 'hint_minBytes', min: 128, step: 100 },
      { key: 'errorMinBytes', kind: 'number', label: 'field_errorMinBytes', hint: 'hint_errorMinBytes', min: 0, step: 500 },
      { key: 'skipSourceReads', kind: 'boolean', label: 'field_skipSourceReads', hint: 'hint_skipSourceReads' },
      { key: 'maxLines', kind: 'number', label: 'field_maxLines', min: 20, step: 10 },
      { key: 'headLines', kind: 'number', label: 'field_headLines', min: 1, step: 10 },
      { key: 'tailLines', kind: 'number', label: 'field_tailLines', min: 0, step: 10 },
      { key: 'keepRatioMax', kind: 'number', label: 'field_keepRatioMax', hint: 'hint_keepRatioMax', min: 0.1, max: 1, step: 0.01 },
      { key: 'errorLines', kind: 'number', label: 'field_errorLines', min: 0, step: 5 },
      { key: 'longLineChars', kind: 'number', label: 'field_longLineChars', min: 80, step: 20 },
      { key: 'truncateMiddle', kind: 'boolean', label: 'field_truncateMiddle', hint: 'hint_truncateMiddle' },
    ],
  }

  /** Page CSS. Plain CSS with DSH alias tokens and light/dark-safe fallbacks. */
  var CSS = [
    '.tl-root{display:flex;flex-direction:column;gap:16px;max-width:1000px;font-size:13px;line-height:1.5;',
    'color:var(--dsw-alias-label-primary,#1f2937);',
    '--tl-border:var(--dsw-alias-border-l1,#e5e7eb);--tl-border2:var(--dsw-alias-border-l2,#d1d5db);',
    '--tl-muted:var(--dsw-alias-label-secondary,#6b7280);--tl-tertiary:var(--dsw-alias-label-tertiary,#9ca3af);',
    '--tl-brand:var(--dsw-alias-brand-primary,#2563eb);--tl-ok:var(--dsw-alias-state-success-primary,#15803d);',
    '--tl-warn:var(--dsw-alias-state-warn-primary,#b45309);--tl-err:var(--dsw-alias-state-error-primary,#b91c1c);',
    '--tl-card:var(--dsw-alias-bg-layer-2,#fff);--tl-hover:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}',
    '.tl-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}',
    '.tl-grow{flex:1 1 auto;min-width:0}',
    '.tl-h1{margin:0;font-size:17px;font-weight:650;letter-spacing:-.01em}',
    '.tl-sub{margin:2px 0 0;color:var(--tl-muted);font-size:12px}',
    '.tl-card{background:var(--tl-card);border:1px solid var(--tl-border);border-radius:12px;padding:14px 16px;min-width:0}',
    '.tl-card-head{display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap}',
    '.tl-card-title{font-size:13px;font-weight:600}',
    '.tl-desc{margin:6px 0 0;color:var(--tl-muted);font-size:11.5px;line-height:1.45;max-width:70ch}',
    '.tl-section-title{margin:4px 0 -6px;font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.05em;color:var(--tl-muted)}',
    '.tl-section-hint{margin:0;font-size:11.5px;color:var(--tl-tertiary);max-width:80ch}',
    '.tl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}',
    '.tl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:10px}',
    '.tl-stat{border:1px solid var(--tl-border);border-radius:10px;padding:8px 10px;min-width:0}',
    '.tl-stat-k{font-size:10.5px;color:var(--tl-muted);text-transform:uppercase;letter-spacing:.04em}',
    '.tl-stat-v{margin-top:2px;font-size:18px;font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.tl-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px 12px;margin-top:10px}',
    '.tl-field{display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.tl-field-label{font-size:11px;color:var(--tl-muted)}',
    '.tl-field-hint{font-size:10.5px;color:var(--tl-tertiary);line-height:1.35}',
    '.tl-input{width:100%;box-sizing:border-box;background:transparent;border:1px solid var(--tl-border2);border-radius:8px;padding:5px 8px;font:inherit;color:inherit;font-variant-numeric:tabular-nums}',
    '.tl-textarea{width:100%;box-sizing:border-box;background:transparent;border:1px solid var(--tl-border2);border-radius:8px;padding:7px 9px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:inherit;resize:vertical;min-height:62px}',
    '.tl-select{background:transparent;border:1px solid var(--tl-border2);border-radius:8px;padding:4px 8px;font:inherit;color:inherit;min-width:96px}',
    '.tl-input:focus,.tl-textarea:focus,.tl-select:focus{outline:2px solid var(--tl-brand);outline-offset:1px}',
    '.tl-pre{margin:8px 0 0;padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));border:1px solid var(--tl-border);font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.tl-pre-sm{max-height:150px}',
    '.tl-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--tl-border2);background:transparent;color:inherit;border-radius:8px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer}',
    '.tl-btn:hover:not(:disabled){background:var(--tl-hover)}',
    '.tl-btn:disabled{opacity:.5;cursor:default}',
    '.tl-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--tl-brand));color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}',
    '.tl-chip{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 10px;font-size:11.5px;border:1px solid var(--tl-border2);color:var(--tl-muted);white-space:nowrap}',
    '.tl-chip-ok{color:var(--tl-ok);border-color:currentColor}',
    '.tl-chip-warn{color:var(--tl-warn);border-color:currentColor}',
    '.tl-chip-err{color:var(--tl-err);border-color:currentColor}',
    '.tl-banner{display:flex;flex-direction:column;gap:2px;border:1px solid var(--tl-err);color:var(--tl-err);border-radius:10px;padding:9px 12px}',
    '.tl-banner-title{font-weight:600;font-size:12px}',
    '.tl-banner-body{font-size:11.5px;overflow-wrap:anywhere}',
    '.tl-switch{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--tl-border2);background:transparent;color:inherit;border-radius:999px;padding:3px 10px 3px 4px;font:inherit;font-size:12px;cursor:pointer}',
    '.tl-switch:disabled{opacity:.55;cursor:default}',
    '.tl-switch-knob{position:relative;flex:none;width:24px;height:14px;border-radius:999px;background:var(--tl-border2);transition:background .15s}',
    '.tl-switch-knob::after{content:"";position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:#fff;transition:transform .15s}',
    '.tl-switch-on{border-color:var(--tl-ok)}',
    '.tl-switch-on .tl-switch-knob{background:var(--tl-ok)}',
    '.tl-switch-on .tl-switch-knob::after{transform:translateX(10px)}',
    '.tl-switch-state{color:var(--tl-muted);font-variant-numeric:tabular-nums}',
    '.tl-check{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;align-self:end;padding-bottom:6px}',
    '.tl-check input{accent-color:var(--tl-brand);margin:0}',
    '.tl-stats-line{margin-top:10px;font-size:11.5px;color:var(--tl-muted);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
    '.tl-test{margin-top:10px;border-top:1px dashed var(--tl-border);padding-top:8px}',
    '.tl-test summary{cursor:pointer;font-size:12px;color:var(--tl-brand);list-style:none;display:inline-flex;align-items:center;gap:6px}',
    '.tl-test summary::-webkit-details-marker{display:none}',
    '.tl-test summary::before{content:"▸";display:inline-block;transition:transform .15s}',
    '.tl-test[open] summary::before{transform:rotate(90deg)}',
    '.tl-test-body{display:flex;flex-direction:column;gap:8px;margin-top:8px}',
    '.tl-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.tl-pill{font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--tl-border2);color:var(--tl-muted);font-variant-numeric:tabular-nums}',
    '.tl-note{font-size:11.5px;color:var(--tl-warn);overflow-wrap:anywhere}',
    '.tl-error-inline{font-size:11.5px;color:var(--tl-err)}',
    '.tl-muted{color:var(--tl-muted)}',
    '.tl-empty{display:flex;flex-direction:column;gap:10px;align-items:flex-start;color:var(--tl-muted)}',
    '.tl-style-card.tl-on{border-color:var(--tl-brand)}',
    '.tl-foot{font-size:11px;color:var(--tl-tertiary);overflow-wrap:anywhere}',
  ].join('')

  /** Translate one key from the active dictionary, falling back to English. */
  function tr(active, key, params) {
    var tag = typeof active === 'string' ? active.toLowerCase() : ''
    var lang = tag.indexOf('vi') === 0 ? 'vi' : 'en'
    var dict = STR[lang] || STR.en
    var template = dict[key] !== undefined ? dict[key] : STR.en[key] !== undefined ? STR.en[key] : key
    if (typeof template !== 'string') return key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      return params[name] !== undefined && params[name] !== null ? String(params[name]) : match
    })
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  /** Deep-merge a partial patch; arrays and scalars replace wholesale. */
  function mergeDeep(base, patch) {
    if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch
    var out = {}
    var key
    for (key in base) if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key]
    for (key in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
      var value = patch[key]
      if (value === undefined) continue
      out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeDeep(out[key], value) : value
    }
    return out
  }

  function hasKeys(value) {
    if (!isPlainObject(value)) return false
    for (var key in value) if (Object.prototype.hasOwnProperty.call(value, key)) return true
    return false
  }

  function describeError(failure) {
    if (failure instanceof Error) return failure.message
    if (typeof failure === 'string') return failure
    return String(failure)
  }

  function fmtBytes(value) {
    var bytes = Number(value) || 0
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return Math.round(bytes) + ' B'
  }

  function fmtPct(before, after) {
    var b = Number(before) || 0
    var a = Number(after) || 0
    if (b <= 0) return 0
    var pct = (1 - a / b) * 100
    if (!isFinite(pct)) return 0
    return Math.round(pct * 10) / 10
  }

  function clip(value, max) {
    var text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
    if (text.length <= max) return text
    return text.slice(0, max) + '\n… (+' + (text.length - max) + ' chars)'
  }

  function formatNumber(value) {
    return value === undefined || value === null ? '' : String(value)
  }

  /** Read the active locale from the locale service, then `<html lang>`. */
  function readActiveLocale(ctx) {
    try {
      if (ctx && ctx.locale && typeof ctx.locale.getLocale === 'function') {
        var snapshot = ctx.locale.getLocale()
        if (snapshot && typeof snapshot.active === 'string' && snapshot.active !== '') return snapshot.active
      }
    } catch (error) {
      /* locale service not composed — fall through */
    }
    try {
      if (typeof document !== 'undefined' && document.documentElement && typeof document.documentElement.lang === 'string') {
        if (document.documentElement.lang !== '') return document.documentElement.lang
      }
    } catch (error) {
      /* no DOM */
    }
    return 'en'
  }

  var fetchImpl = typeof fetch === 'function' ? fetch.bind(typeof window !== 'undefined' ? window : this) : null

  function request(method, route, body) {
    if (fetchImpl === null) return Promise.reject(new Error('fetch is not available in this host'))
    var init = {
      method: method,
      headers: method === 'POST' ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      credentials: 'same-origin',
    }
    if (method === 'POST') init.body = JSON.stringify(body === undefined ? {} : body)
    return fetchImpl(API_BASE + route, init).then(function (response) {
      return response.text().then(function (raw) {
        var payload = null
        if (raw) {
          try {
            payload = JSON.parse(raw)
          } catch (error) {
            payload = null
          }
        }
        if (!response.ok) {
          var message = payload && payload.error ? String(payload.error) : 'HTTP ' + response.status
          throw new Error(message)
        }
        return payload
      })
    })
  }

  function apiGet(route) {
    return request('GET', route)
  }

  function apiPost(route, body) {
    return request('POST', route, body)
  }

  window.__ModuleLoader__.load({
    id: PLUGIN_ID,
    factory: function (require) {
      var React = require('react')
      var h = React.createElement

      /** Per-apply environment handed to the registered section. */
      var HOST_ENV = null

      function makeTranslator(env, active) {
        var serviceT = env && typeof env.serviceT === 'function' ? env.serviceT : null
        return function t(key, params) {
          if (serviceT !== null) {
            try {
              var viaService = serviceT(key, params)
              if (viaService !== undefined && viaService !== null && viaService !== key) return String(viaService)
            } catch (error) {
              /* fall back to the bundled dictionary */
            }
          }
          return tr(active, key, params)
        }
      }

      function useActiveLocale(env) {
        var state = React.useState(function () {
          return readActiveLocale(env && env.ctx)
        })
        var active = state[0]
        var setActive = state[1]
        React.useEffect(function () {
          var dispose = null
          try {
            var service = env && env.ctx ? env.ctx.locale : undefined
            if (service && typeof service.subscribe === 'function') {
              dispose = service.subscribe(function () {
                setActive(readActiveLocale(env.ctx))
              })
            }
          } catch (error) {
            dispose = null
          }
          return function () {
            if (typeof dispose === 'function') dispose()
          }
        }, [])
        return active
      }

      /**
       * All page data and writes. The last successful state is kept on failure;
       * edits accumulate into one partial patch that is POSTed after a short
       * debounce (or immediately from the Save button).
       */
      function useSectionData() {
        var stateSlot = React.useState(null)
        var state = stateSlot[0]
        var setState = stateSlot[1]
        var loadingSlot = React.useState(true)
        var loading = loadingSlot[0]
        var setLoading = loadingSlot[1]
        var errorSlot = React.useState(null)
        var error = errorSlot[0]
        var setError = errorSlot[1]
        var statusSlot = React.useState('idle')
        var status = statusSlot[0]
        var setStatus = statusSlot[1]

        var alive = React.useRef(true)
        var pending = React.useRef({})
        var timer = React.useRef(null)
        var inflight = React.useRef(false)

        function schedule() {
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(function () {
            timer.current = null
            flush()
          }, AUTO_SAVE_MS)
        }

        function flush() {
          if (timer.current) {
            clearTimeout(timer.current)
            timer.current = null
          }
          if (!alive.current || inflight.current) return
          var patch = pending.current
          if (!hasKeys(patch)) return
          pending.current = {}
          inflight.current = true
          setStatus('saving')
          apiPost('/config', patch)
            .then(function (next) {
              inflight.current = false
              if (!alive.current) return
              if (next && next.config) setState(next)
              setError(null)
              if (hasKeys(pending.current)) {
                setStatus('dirty')
                schedule()
              } else {
                setStatus('saved')
              }
            })
            .catch(function (failure) {
              inflight.current = false
              if (!alive.current) return
              pending.current = mergeDeep(patch, pending.current)
              setError(describeError(failure))
              setStatus('dirty')
            })
        }

        function patch(next) {
          if (!isPlainObject(next)) return
          pending.current = mergeDeep(pending.current, next)
          setState(function (previous) {
            if (!previous || !previous.config) return previous
            return Object.assign({}, previous, { config: mergeDeep(previous.config, next) })
          })
          setStatus('dirty')
          schedule()
        }

        function load() {
          setLoading(true)
          apiGet('/state')
            .then(function (next) {
              if (!alive.current) return
              setState(next && next.config ? next : null)
              setError(null)
              setLoading(false)
              setStatus('idle')
            })
            .catch(function (failure) {
              if (!alive.current) return
              setError(describeError(failure))
              setLoading(false)
            })
        }

        function resetStats() {
          setStatus('saving')
          apiPost('/reset-stats', {})
            .then(function (next) {
              if (!alive.current) return
              if (next && next.config) setState(next)
              setError(null)
              setStatus(hasKeys(pending.current) ? 'dirty' : 'saved')
            })
            .catch(function (failure) {
              if (!alive.current) return
              setError(describeError(failure))
              setStatus('dirty')
            })
        }

        React.useEffect(function () {
          alive.current = true
          load()
          return function () {
            alive.current = false
            if (timer.current) {
              clearTimeout(timer.current)
              timer.current = null
            }
          }
        }, [])

        return {
          state: state,
          loading: loading,
          error: error,
          status: status,
          patch: patch,
          reload: load,
          resetStats: resetStats,
        }
      }

      function Toggle(props) {
        var checked = props.checked === true
        return h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': checked,
            className: 'tl-switch' + (checked ? ' tl-switch-on' : ''),
            title: props.title || props.label || '',
            disabled: props.disabled === true,
            onClick: function () {
              if (typeof props.onChange === 'function') props.onChange(!checked)
            },
          },
          h('span', { className: 'tl-switch-knob', 'aria-hidden': 'true' }),
          props.label ? h('span', null, props.label) : null,
          h('span', { className: 'tl-switch-state' }, checked ? props.onText || '' : props.offText || ''),
        )
      }

      function NumberField(props) {
        var draftSlot = React.useState(function () {
          return formatNumber(props.value)
        })
        var draft = draftSlot[0]
        var setDraft = draftSlot[1]
        var focused = React.useRef(false)
        React.useEffect(function () {
          if (!focused.current) setDraft(formatNumber(props.value))
        }, [props.value])
        return h(
          'label',
          { className: 'tl-field' },
          h('span', { className: 'tl-field-label' }, props.label),
          h('input', {
            className: 'tl-input',
            type: 'number',
            value: draft,
            min: props.min,
            max: props.max,
            step: props.step === undefined ? 'any' : props.step,
            inputMode: 'decimal',
            onFocus: function () {
              focused.current = true
            },
            onBlur: function () {
              focused.current = false
              setDraft(formatNumber(props.value))
            },
            onChange: function (event) {
              var raw = event.target.value
              setDraft(raw)
              var next = Number(raw)
              if (raw !== '' && isFinite(next) && typeof props.onChange === 'function') props.onChange(next)
            },
          }),
          props.hint ? h('span', { className: 'tl-field-hint' }, props.hint) : null,
        )
      }

      function Stat(props) {
        return h(
          'div',
          { className: 'tl-stat' },
          h('div', { className: 'tl-stat-k' }, props.label),
          h('div', { className: 'tl-stat-v' }, props.value),
        )
      }

      function SectionTitle(props) {
        return h(
          'div',
          { className: 'tl-grow' },
          h('div', { className: 'tl-section-title' }, props.title),
          props.hint ? h('p', { className: 'tl-section-hint' }, props.hint) : null,
        )
      }

      function EngineCard(props) {
        var t = props.t
        var id = props.id
        var config = props.config || {}
        var engineStats = props.stats || {}
        var fields = ENGINE_FIELDS[id] || []

        var previewSlot = React.useState(null)
        var preview = previewSlot[0]
        var setPreview = previewSlot[1]
        var busySlot = React.useState(false)
        var busy = busySlot[0]
        var setBusy = busySlot[1]
        var errorSlot = React.useState(null)
        var previewError = errorSlot[0]
        var setPreviewError = errorSlot[1]
        var textSlot = React.useState('')
        var text = textSlot[0]
        var setText = textSlot[1]

        function patchEngine(values) {
          var enginePatch = {}
          enginePatch[id] = values
          props.onPatch({ engines: enginePatch })
        }

        function runPreview() {
          if (String(text).trim() === '') {
            setPreviewError(t('testNeedsText'))
            return
          }
          setBusy(true)
          setPreviewError(null)
          apiPost('/preview', { engine: id, text: text })
            .then(function (result) {
              setPreview(result || null)
              setBusy(false)
            })
            .catch(function (failure) {
              setPreviewError(t('testFailed', { message: describeError(failure) }))
              setBusy(false)
            })
        }

        var controls = []
        for (var index = 0; index < fields.length; index++) {
          var field = fields[index]
          if (field.kind === 'boolean') {
            controls.push(
              h(
                'label',
                { key: field.key, className: 'tl-check' },
                h('input', {
                  type: 'checkbox',
                  checked: config[field.key] !== false,
                  onChange: (function (key) {
                    return function (event) {
                      var values = {}
                      values[key] = event.target.checked
                      patchEngine(values)
                    }
                  })(field.key),
                }),
                h('span', null, t(field.label)),
              ),
            )
          } else {
            controls.push(
              h(NumberField, {
                key: field.key,
                label: t(field.label),
                hint: field.hint ? t(field.hint) : '',
                value: config[field.key],
                min: field.min,
                max: field.max,
                step: field.step,
                onChange: (function (key) {
                  return function (value) {
                    var values = {}
                    values[key] = value
                    patchEngine(values)
                  }
                })(field.key),
              }),
            )
          }
        }

        var before = Number(engineStats.before) || 0
        var after = Number(engineStats.after) || 0
        var statsLine =
          before === 0 && after === 0 && !engineStats.calls
            ? t('engineStatsEmpty')
            : t('engineStats', {
                before: fmtBytes(before),
                after: fmtBytes(after),
                pct: fmtPct(before, after),
                calls: Number(engineStats.calls) || 0,
                hits: Number(engineStats.hits) || 0,
              })

        var result = null
        if (preview !== null) {
          result = h(
            'div',
            null,
            h('div', { className: 'tl-row' },
              h('span', { className: 'tl-pill' }, t('testResult', {
                before: fmtBytes(preview.before),
                after: fmtBytes(preview.after),
                pct: fmtPct(preview.before, preview.after),
              })),
            ),
            preview.note ? h('div', { className: 'tl-note' }, t('testNote') + ': ' + preview.note) : null,
            h('div', { className: 'tl-field-label', style: { marginTop: '8px' } }, t('resultPreview')),
            h('pre', { className: 'tl-pre tl-pre-sm' }, clip(preview.text, PREVIEW_CHARS)),
          )
        }

        return h(
          'div',
          { className: 'tl-card' },
          h(
            'div',
            { className: 'tl-card-head' },
            h('div', { className: 'tl-card-title' }, props.label),
            h(Toggle, {
              checked: config.enabled !== false,
              onText: t('on'),
              offText: t('off'),
              title: props.label,
              onChange: function (next) {
                patchEngine({ enabled: next })
              },
            }),
          ),
          props.short ? h('p', { className: 'tl-desc' }, props.short) : null,
          h('div', { className: 'tl-fields' }, controls),
          h('div', { className: 'tl-stats-line' }, statsLine),
          h(
            'details',
            { className: 'tl-test' },
            h('summary', null, t('test')),
            h(
              'div',
              { className: 'tl-test-body' },
              h('div', { className: 'tl-field-hint' }, t('testHint')),
              h('textarea', {
                className: 'tl-textarea',
                rows: 4,
                placeholder: t('testPlaceholder'),
                value: text,
                onChange: function (event) {
                  setText(event.target.value)
                },
              }),
              h(
                'div',
                { className: 'tl-row' },
                h('button', {
                  type: 'button',
                  className: 'tl-btn',
                  disabled: busy,
                  onClick: runPreview,
                }, busy ? t('testRunning') : t('testRun')),
              ),
              previewError ? h('div', { className: 'tl-error-inline' }, previewError) : null,
              result,
            ),
          ),
        )
      }

      function StyleCard(props) {
        var t = props.t
        var id = props.id
        var config = props.config || {}
        var levels = Array.isArray(props.levels) && props.levels.length > 0 ? props.levels : DEFAULT_STYLE_LEVELS
        var activeLevel = levels.indexOf(config.level) >= 0 ? config.level : (props.defaultLevel || levels[0] || 'full')

        function patchStyle(values) {
          var stylePatch = {}
          stylePatch[id] = values
          props.onPatch({ styles: stylePatch })
        }

        var options = []
        for (var index = 0; index < levels.length; index++) {
          var level = levels[index]
          options.push(h('option', { key: level, value: level }, t('level_' + level)))
        }

        return h(
          'div',
          { className: 'tl-card tl-style-card' + (config.enabled === true ? ' tl-on' : '') },
          h(
            'div',
            { className: 'tl-card-head' },
            h('div', { className: 'tl-card-title' }, props.label),
            h(Toggle, {
              checked: config.enabled === true,
              onText: t('on'),
              offText: t('off'),
              onChange: function (next) {
                patchStyle({ enabled: next })
              },
            }),
          ),
          props.short ? h('p', { className: 'tl-desc' }, props.short) : null,
          levels.length > 1
            ? h(
                'label',
                { className: 'tl-field', style: { marginTop: '10px' } },
                h('span', { className: 'tl-field-label' }, t('styleLevel')),
                h('select', {
                  className: 'tl-select',
                  value: activeLevel,
                  onChange: function (event) {
                    patchStyle({ level: event.target.value })
                  },
                }, options),
              )
            : null,
        )
      }

      function TokenLeanSection() {
        var env = HOST_ENV || {}
        var active = useActiveLocale(env)
        var t = makeTranslator(env, active)
        var data = useSectionData()

        var state = data.state
        var config = state && state.config ? state.config : null
        var stats = state && state.stats ? state.stats : null
        var meta = state && state.meta ? state.meta : {}
        var busy = data.status === 'saving'

        var statusLabel = ''
        if (data.loading) statusLabel = t('loading')
        else if (data.status === 'saving') statusLabel = t('saving')
        else if (data.status === 'dirty') statusLabel = t('statusUnsaved')
        else if (data.status === 'saved') statusLabel = t('saved')

        var chipClass = 'tl-chip'
        if (data.error) chipClass += ' tl-chip-err'
        else if (data.loading) chipClass += ''
        else if (data.status === 'saved') chipClass += ' tl-chip-ok'
        else if (data.status === 'dirty' || data.status === 'saving') chipClass += ' tl-chip-warn'

        var children = []

        children.push(
          h(
            'div',
            { key: 'head', className: 'tl-head' },
            h(
              'div',
              { className: 'tl-grow' },
              h('h1', { className: 'tl-h1' }, t('title')),
              h('p', { className: 'tl-sub' }, t('subtitle')),
            ),
            statusLabel !== '' ? h('span', { key: 'chip', className: chipClass }, statusLabel) : null,
          ),
        )

        if (data.error) {
          children.push(
            h(
              'div',
              { key: 'error', className: 'tl-banner', role: 'alert' },
              h('div', { className: 'tl-banner-title' }, t('errorTitle')),
              h('div', { className: 'tl-banner-body' }, data.error),
            ),
          )
        }

        if (config === null) {
          children.push(
            h(
              'div',
              { key: 'empty', className: 'tl-card tl-empty' },
              h('span', null, data.loading ? t('loading') : t('unavailable')),
              data.loading
                ? null
                : h('button', { type: 'button', className: 'tl-btn', onClick: data.reload }, t('retry')),
            ),
          )
          return h('div', { className: 'tl-root' }, children)
        }

        var total = stats && stats.total ? stats.total : { before: 0, after: 0, calls: 0, hits: 0 }
        var spillCount = stats ? Number(stats.spills) || 0 : 0

        children.push(
          h(
            'div',
            { key: 'master', className: 'tl-card' },
            h(
              'div',
              { className: 'tl-card-head' },
              h(
                'div',
                { className: 'tl-grow' },
                h('div', { className: 'tl-card-title' }, t('master')),
                h('p', { className: 'tl-desc' }, t('masterHint')),
              ),
              h(Toggle, {
                checked: config.master !== false,
                onText: t('on'),
                offText: t('off'),
                onChange: function (next) {
                  data.patch({ master: next })
                },
              }),
            ),
          ),
        )

        children.push(
          h(
            'div',
            { key: 'stats', className: 'tl-card' },
            h(
              'div',
              { className: 'tl-card-head' },
              h(
                'div',
                { className: 'tl-grow' },
                h('div', { className: 'tl-card-title' }, t('statsTitle')),
                h('p', { className: 'tl-desc' }, t('statDetail', {
                  calls: Number(total.calls) || 0,
                  hits: Number(total.hits) || 0,
                })),
              ),
              h('button', {
                type: 'button',
                className: 'tl-btn',
                disabled: busy,
                onClick: data.resetStats,
              }, t('resetStats')),
            ),
            h(
              'div',
              { className: 'tl-stats', style: { marginTop: '10px' } },
              h(Stat, { key: 'before', label: t('statBefore'), value: fmtBytes(total.before) }),
              h(Stat, { key: 'after', label: t('statAfter'), value: fmtBytes(total.after) }),
              h(Stat, { key: 'saved', label: t('statSaved'), value: fmtPct(total.before, total.after) + '%' }),
              h(Stat, { key: 'spills', label: t('statSpills'), value: String(spillCount) }),
            ),
          ),
        )

        children.push(h('div', { key: 'engines-title' }, h(SectionTitle, {
          title: t('enginesTitle'),
          hint: t('enginesHint'),
        })))

        var engineMeta = meta.engines || {}
        var engineStatsMap = stats && stats.engines ? stats.engines : {}
        var engineCards = []
        for (var engineIndex = 0; engineIndex < ENGINE_IDS.length; engineIndex++) {
          var engineId = ENGINE_IDS[engineIndex]
          var engineInfo = engineMeta[engineId] || {}
          engineCards.push(
            h(EngineCard, {
              key: engineId,
              t: t,
              id: engineId,
              label: engineInfo.label || engineId,
              short: engineInfo.short || '',
              config: config.engines ? config.engines[engineId] : {},
              stats: engineStatsMap[engineId],
              onPatch: data.patch,
            }),
          )
        }
        children.push(h('div', { key: 'engines', className: 'tl-grid' }, engineCards))

        var spillConfig = config.spill || {}
        children.push(
          h(
            'div',
            { key: 'storage', className: 'tl-card', style: { marginTop: '14px' } },
            h(
              'div',
              { className: 'tl-card-head' },
              h('div', { className: 'tl-card-title' }, t('storageTitle')),
              h(Toggle, {
                checked: spillConfig.enabled !== false,
                onText: t('on'),
                offText: t('off'),
                onChange: function (next) {
                  data.patch({ spill: { enabled: next } })
                },
              }),
            ),
            h('p', { className: 'tl-desc' }, t('storageHint')),
            h(
              'div',
              { className: 'tl-fields' },
              h(NumberField, {
                label: t('field_spillMaxMb'),
                hint: '',
                value: Math.round((Number(spillConfig.maxBytes) || 0) / 1_000_000),
                min: 0,
                step: 1,
                onChange: function (value) {
                  data.patch({ spill: { maxBytes: Math.max(0, Number(value) || 0) * 1_000_000 } })
                },
              }),
              h(NumberField, {
                label: t('field_spillKeepFiles'),
                hint: t('hint_spillKeepFiles'),
                value: spillConfig.keepFiles,
                min: 0,
                step: 50,
                onChange: function (value) {
                  data.patch({ spill: { keepFiles: Math.max(0, Math.floor(Number(value) || 0)) } })
                },
              }),
            ),
          ),
        )

        children.push(h('div', { key: 'styles-title' }, h(SectionTitle, {
          title: t('stylesTitle'),
          hint: t('stylesHint'),
        })))

        var styleList = Array.isArray(meta.styleList) ? meta.styleList : []
        var styleLevels = Array.isArray(meta.styleLevels) && meta.styleLevels.length > 0 ? meta.styleLevels : DEFAULT_STYLE_LEVELS
        var styleCards = []
        for (var styleIndex = 0; styleIndex < STYLE_IDS.length; styleIndex++) {
          var styleId = STYLE_IDS[styleIndex]
          var styleInfo = null
          for (var lookup = 0; lookup < styleList.length; lookup++) {
            if (styleList[lookup] && styleList[lookup].id === styleId) {
              styleInfo = styleList[lookup]
              break
            }
          }
          if (styleInfo === null) styleInfo = {}
          styleCards.push(
            h(StyleCard, {
              key: styleId,
              t: t,
              id: styleId,
              label: styleInfo.label || styleId,
              short: styleInfo.short || '',
              preview: styleInfo.preview || '',
              levels: Array.isArray(styleInfo.levels) && styleInfo.levels.length > 0 ? styleInfo.levels : styleLevels,
              defaultLevel: styleInfo.defaultLevel || 'full',
              config: config.styles ? config.styles[styleId] : {},
              onPatch: data.patch,
            }),
          )
        }
        children.push(h('div', { key: 'styles', className: 'tl-grid' }, styleCards))

        var spillDir = typeof meta.spillDir === 'string' ? meta.spillDir : ''
        children.push(
          h('div', { key: 'foot', className: 'tl-foot' },
            spillDir !== '' ? t('spillDir', { path: spillDir }) : ''),
        )

        return h('div', { className: 'tl-root' }, children)
      }

      function apply(ctx) {
        var serviceT = null
        try {
          if (ctx && ctx.locale && typeof ctx.locale.bind === 'function') serviceT = ctx.locale.bind(NS)
        } catch (error) {
          serviceT = null
        }

        HOST_ENV = { ctx: ctx, serviceT: serviceT }

        function install(fn, label) {
          if (ctx && typeof ctx.effect === 'function') {
            try {
              ctx.effect(fn, label)
              return
            } catch (error) {
              /* fall through: install inline */
            }
          }
          try {
            fn()
          } catch (error) {
            /* a missing host feature must never break the settings page */
          }
        }

        install(function () {
          try {
            if (ctx && ctx.locale && typeof ctx.locale.register === 'function') return ctx.locale.register(NS, STR)
          } catch (error) {
            if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
              console.warn('token-lean: locale registration skipped: ' + describeError(error))
            }
          }
          return function () {}
        }, 'token-lean: settings dictionaries')

        install(function () {
          if (typeof document === 'undefined' || !document.head) return function () {}
          var style = document.createElement('style')
          style.setAttribute('data-plugin', PLUGIN_ID)
          style.textContent = CSS
          document.head.appendChild(style)
          return function () {
            if (style.parentNode) style.parentNode.removeChild(style)
          }
        }, 'token-lean: settings styles')

        var t = makeTranslator(HOST_ENV, readActiveLocale(ctx))

        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'token-lean',
            order: 41,
            label: function () {
              return t('tab')
            },
            locale: NS,
          }, TokenLeanSection)
        })
      }

      return {
        name: PLUGIN_ID,
        inject: ['slots', 'locale'],
        apply: apply,
      }
    },
  })
})()
