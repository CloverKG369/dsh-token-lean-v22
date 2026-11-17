# dsh-token-lean

**Một plugin DeepSeek Harness (DSH) gộp 9 tính năng tiết kiệm token — 4 engine nén
input và 5 style định hình output — kèm trang cài đặt chi tiết cho từng tính năng.**

Bản này được dựng cho DSH **0.2.1-rc.2** (Web/Desktop) và đã được kiểm chứng bằng
unit test, test tích hợp trên DSH headless và kiểm tra Web UI thật.

---

## 9 tính năng

### Engine nén input (chạy ở `tools/post-execute`)

| # | Engine | Làm gì | Mặc định |
|---|---|---|---|
| 1 | **Session dedup** | Tool result giống hệt từng byte với một kết quả trước đó trong cùng session (trong TTL) được thay bằng stub trỏ về kết quả cũ | Bật |
| 2 | **Lite** | Dọn an toàn: ANSI escape, CRLF, khoảng trắng cuối dòng, chuỗi dòng trống, data-URL ảnh inline | Bật |
| 3 | **Headroom** | Nén bảng JSON lossless: mảng phẳng, object lồng nhau (dotted keys), keyed map, JSONL; hiểu output `read` có số dòng và giữ cột `line` | Bật |
| 4 | **RTK** | Lọc theo lệnh: git diff/status/log, grep, find, ls, tree, build, log, table; giữ dòng lỗi, cắt head/tail theo ngưỡng | Bật |

### Style định hình output (chèn vào `system-prompt/assemble`)

| # | Style | Tác dụng |
|---|---|---|
| 5 | **Caveman** | Văn phong ngắn, mật độ cao; code/lệnh giữ nguyên từng byte |
| 6 | **YAGNI** | Thang giải pháp tối thiểu: bỏ qua → tái dùng → cấu hình → một dòng |
| 7 | **Ponytail** | Lazy senior dev: diff nhỏ nhất, không refactor ngoài phạm vi |
| 8 | **I have ADHD** | Trả lời action-first, tối đa 3–5 bước, không preamble |
| 9 | **Antislop** | Loại bỏ văn phong AI chung chung, sáo rỗng, thừa lời |

Mức theo đúng preset gốc của upstream: Caveman `full`/`ultra`, Ponytail
`lite`/`full`/`ultra`, YAGNI `full`, I-have-ADHD `full`, Antislop `full`.
Bật/tắt từng style độc lập. **Nội dung prompt là bản gốc cố định — không có
đường chỉnh sửa prompt trong UI hay API.**

### Bảo toàn & lưu trữ

- **Cổng đảo ngược:** khi spill bật, kết quả chỉ được thay khi bản gốc đã ghi
  đĩa thành công. Ghi lỗi hoặc vượt `maxBytes` → giữ nguyên kết quả gốc.
- **Giới hạn dung lượng:** giữ `keepFiles` bản gốc mới nhất (mặc định 500,
  `0` = không giới hạn); tệp cũ bị dọn khi ghi. Cấu hình trong UI mục
  **Spill storage**.
- **Thống kê:** `total` đếm **một mục cho mỗi kết quả tool được nén** (before =
  byte gốc, after = byte cuối cùng), không cộng dồn theo từng engine.

---

## Cài đặt

```powershell
# Đóng gói rồi cài từ tarball (khuyến nghị — tránh link:)
cd D:\projects\dsh-token-lean
npm pack --pack-destination D:\projects\dist
dsh plugin --profile desktop add D:\projects\dist\local-dsh-token-lean-v22-1.6.2.tgz

# hoặc từ Git
dsh plugin --profile desktop add git+https://github.com/<you>/dsh-token-lean.git
```

> **Cảnh báo (đã xảy ra thật):** không cài bằng đường dẫn thư mục trực tiếp, vì
> DSH/pnpm biến nó thành `link:` và khi gỡ bundle, bước dọn junction trên Windows
> có thể **xoá sạch thư mục nguồn**. Luôn cài từ `.tgz` (hoặc Git), và giữ bản sao
> lưu trong `D:\projects\dist`.

Sau khi cài, **refresh trang Web GUI** (Ctrl+F5) để client bundle được nạp, rồi mở
**Settings → Token Lean**. Khi chỉ đổi client, Ctrl+Shift+R là đủ. Khi đổi phần host (`lib/*.js`), DSH giữ ESM cache theo tên package: phải khởi động lại DSH Desktop, hoặc đổi tên package rồi cài lại, code mới mới nạp.

Bản trên máy này đã được cài vào profile `desktop` (package `@local/dsh-token-lean-v22`
v1.6.2) và đang chạy thật: tool result lớn đã được nén tại chỗ, dedup hoạt động,
style gốc đã xuất hiện trong system prompt của session hiện tại.

---

## Cách hoạt động

```
tool trả về
  └─ tools/post-execute (prepend)
       ├─ session-dedup  → stub nếu byte-identical trong TTL
       ├─ lite           → dọn an toàn
       ├─ headroom       → bảng JSON lossless
       ├─ rtk            → lọc theo lệnh + cửa sổ head/tail
       └─ cổng never-worse: phải nhỏ hơn thật, nếu không giữ nguyên
            │
            ├─ spill nguyên văn ra $DSH_HOME/token-lean/spill/<id>.txt
            └─ chèn notice `[token-lean #id | engines | before → after]`
               + đường dẫn file gốc để đọc lại khi cần

mỗi request
  └─ system-prompt/assemble
       └─ chèn section chứa các style đang bật, theo thứ tự cấu hình
```

**Fail-open tuyệt đối:** engine lỗi → giữ nguyên kết quả gốc; không có ngoại lệ
nào được ném vào đường chạy của tool.

**Khôi phục:** mọi thay đổi đều ghi bản gốc ra đĩa và nêu đường dẫn trong notice.
Model có thể `read` file đó; con người cũng đọc được.

---

## Cấu hình

Cấu hình lưu tại `$DSH_HOME/token-lean/config.json` (Desktop mặc định:
`%APPDATA%\dsh-desktop\harness\token-lean\config.json`). Có thể đặt mặc định
triển khai trong `cordis.patch.yml`:

```yaml
- id: token-lean
  config:
    master: true
    engines:
      rtk: { enabled: true, keepRatioMax: 0.72 }
    styles:
      caveman: { enabled: true, level: 'full' }
```

### Điều khiển trong UI

- Bật/tắt master, 4 engine, 5 style; chỉnh số liệu từng engine; chọn level cho
  style có nhiều mức upstream; bật/tắt spill, `max MB`, số file giữ.
- **Không còn nút preset, không còn nút Save now.** Mọi thay đổi tự lưu sau 500 ms;
  chip trạng thái cho biết Saving/Saved/Unsaved.
- **Không hiển thị text preset read-only** trong style card; card chỉ còn toggle
  và level select.
- **Không còn System prompt preview** — payload `/state` cũng không còn gửi text
  prompt/`stylePreview`, nên trang nhẹ hơn và không lộ nội dung prompt.

### Tuỳ chọn nâng cao (config/API)

- `engines.rtk.errorMinBytes` (mặc định 6000): output lỗi nhỏ hơn ngưỡng này được
  giữ nguyên; lớn hơn mới được nén (vẫn giữ dòng lỗi + spill).
- `engines.headroom.jsonlMinLines` (mặc định 8): ngưỡng riêng cho JSONL/NDJSON và
  output `read` có số dòng, tách khỏi `minRows`.
- `engines.sessionDedup.ttlOverrides`: map `{ "<toolName>": ms }`; `0` tắt dedup
  cho tool đó (ví dụ tool đọc dữ liệu tươi). Chỉnh qua `POST /api/token-lean/config`.

---

## Đối chiếu upstream (đếm từ repo đã clone)

| Thành phần | Upstream | Plugin này |
|---|---|---|
| RTK | 62 filter TOML + 83 file command (git, js, python, docker, k8s…) | 18 filter JS: git diff/status/log, grep, find, ls, tree, test-runner, install, dotnet build, lint/type-check, python traceback, docker/podman, kubectl/helm, jvm·php·ruby·scala toolchain, build, logs, table; generic fallback |
| Headroom | ML compressor (SmartCrusher/CodeCompressor/Kompress), retrieval tool, history compression | Tabular JSON lossless + **tool `lean_expand`** để lấy lại bản gốc từ spill id (thay cho retrieval tool của upstream) |
| save-token | structure-aware tables, TOON, dedup TTL/overrides, errorMinBytes, compaction assist, dashboard | TOON-style tabular, dedup TTL + **per-tool TTL overrides**, **errorMinBytes**, spill gate, error-line retention; **không** có compaction assist |
| Caveman / Ponytail / ADHD / Antislop | skill text + command/frontmatter | Toàn bộ rule body của level được bật; bỏ frontmatter/command không dùng trong DSH |

Không có parity 1:1 với toàn bộ upstream; các khoảng trống trên là có chủ đích
(tránh history rewriting, tránh nén error mặc định, không phụ thuộc binary ngoài).

### dotnet / python (đợt bổ sung)

- **dotnet build/publish/restore/pack**: port từ `dotnet-build.toml` — build sạch
  `0 Warning(s)/0 Error(s)` rút còn `ok (dotnet build succeeded)`; build lỗi giữ
  `error CSxxxx`, `Build FAILED`, counters, bỏ banner/restore; tối đa 40 dòng.
- **dotnet test**: TRX summary (`Passed! - Failed: 0, Passed: 12`) được test filter giữ.
- **dotnet format**: diagnostics `file.cs(10,5): error WHITESPACE: ...` qua lint filter.
- **python**: pytest giữ failures + short summary; pip/uv/poetry install giữ lỗi,
  warning, summary; ruff/mypy/flake8/pylint/sqlfluff giữ toàn bộ diagnostics + count.
- **Python traceback**: `python app.py` / `uv run` / `poetry run` giữ exception
  chain + các frame sâu nhất (frame user code); frame thư viện bị lược kèm số đếm.
- **Docker/Podman**: `ps`/`images` giữ header + N dòng đầu; build/pull giữ lỗi,
  warning, “Successfully built”; bỏ layer progress.
- **kubectl/helm**: `get` giữ header + N dòng; `describe` giữ Name/Status/Conditions/
  Events/Warning/Error; `logs` giữ dòng lỗi + tail; apply/rollout giữ outcome.
- **JVM/PHP/Ruby/Scala**: `mvn`, `gradle`, `sbt`, `phpunit`, `composer`, `artisan`,
  `rspec`/`rails`/`rake` — giữ lỗi, test counts, `BUILD FAILURE`, `FAILURES!`,
  `N examples, M failures`; bỏ download/progress.
- **Tool `lean_expand`**: `lean_expand(id)` trả nguyên văn bản gốc từ spill; nhận
  id 20 ký tự hoặc full path trong notice. Id hết retention trả lỗi rõ ràng.
- **React/TS**: vitest/jest/Playwright qua test filter; npm/pnpm install qua install;
  `tsc`/vite/webpack qua build; eslint qua lint.

### Đọc source code (Python/React)

Mặc định `engines.rtk.skipSourceReads = true`: khi tool `read` mở file source/config
(`.py .tsx .ts .js .jsx .cs .go .rs .md .yaml .toml ...`), **RTK không cắt head/tail**.
JSON không nằm trong danh sách này vì Headroom xử lý JSON theo bảng. Model thấy đủ
code để sửa; chỉ dedup + Lite (khoảng trắng) chạy. Tắt option này trong card RTK
nếu muốn cửa sổ cắt như log.

---

## Kiểm thử

```powershell
cd D:\projects\dsh-token-lean
node --test
```

Bộ test gồm: cấu hình/clamp, Lite, Headroom (encode + decode + từ chối dữ liệu
không thuần nhất), dedup, spill, pipeline end-to-end, ghép style, preview API,
RTK filters và client bundle.

---

## Giới hạn đã biết

- **Prompt style là cố định.** Chỉ bật/tắt và chọn mức có trong upstream; không
  có `customText`, không có endpoint sửa prompt. Muốn đổi nội dung phải sửa file
  style trong `lib/styles/` và phát hành bản mới.
- **Style cần quyền ghi system prompt.** Nếu một plugin khác đăng ký section
  `complete`, DSH thay toàn bộ section bằng section đó và style của plugin này
  bị bỏ — giống mọi plugin prompt-shaping khác.
- **Headroom chỉ nén dữ liệu dạng bảng**: mảng object phẳng, object lồng nhau
  (flatten thành cột `a.b`), keyed map (object của object), JSONL và output `read`
  có số dòng. Mảng không đồng nhất hoặc chứa array lồng sẽ được giữ nguyên.
- **Session dedup** chỉ so khớp trong cùng một session id; không dedup xuyên
  session (an toàn hơn, tránh stub trỏ vào context không còn tồn tại).
- **RTK** là bản port JS của các filter chính, không phải toàn bộ 60+ filter
  của Rust RTK; các lệnh không khớp filter sẽ dùng cửa sổ generic.
- Plugin **không** nén lịch sử đã gửi (history rewriting) — làm vậy sẽ phá prompt
  cache của provider. Nó chỉ nén tại biên tool result, một lần.

---

## Sự cố đã biết

### Settings → Token Lean mất, báo "Request failed / Failed to fetch"

Console Web hiện `client-modules: duplicate factory registration for ...`. Nguyên
nhân: `PLUGIN_ID` trong `lib/client.js` phải **trùng đúng tên package** (module id),
ví dụ `@local/dsh-token-lean-v22`. Nếu nó lệch, bundle bị nạp hai lần (combo preload +
module import) và entry không activate.

Cách xử lý: sửa `PLUGIN_ID` cho khớp `package.json.name`, đóng gói lại, cài lại,
rồi **Ctrl+Shift+R** để xoá bundle cũ trong cache trình duyệt.

---

## Cấu trúc

```
lib/
  index.js          host plugin: hooks + routes
  config.js         defaults, validation, persistence
  engines/          session-dedup, lite, headroom, rtk
  styles/           caveman, yagni, ponytail, adhd, antislop
  routes.js         /api/token-lean/*
  spill.js          reversible original-text store
  stats.js          per-engine telemetry
  client.js         Web settings page (DSH ModuleLoader bundle)
test/               node:test suites
licenses/           Apache-2.0 + MIT texts for the adapted upstreams
```

---

## Ghi công

Xem `THIRD_PARTY_NOTICES.md`. Tóm tắt: Caveman (Apache-2.0), Ponytail/YAGNI
(MIT), i-have-adhd (MIT), anti-slop (MIT), RTK (Apache-2.0), Headroom
(Apache-2.0), OmniRoute Lite engine (MIT), dsh-plugin-save-token (MIT).

Giấy phép của chính plugin này: MIT.
