# Third-party notices

`dsh-token-lean` ports behavior from the projects below. The engine
implementations in `lib/engines/` are new JavaScript; the style texts in
`lib/styles/` reproduce the upstream rule bodies (frontmatter, host-command
sections and navigation text omitted), including the upstream level variants,
under the licenses listed. License texts are in `licenses/`.

| Feature | Upstream | License | What was adapted |
|---|---|---|---|
| caveman style | https://github.com/JuliusBrussee/caveman | Apache-2.0 | level names and compression rules |
| ponytail style | https://github.com/DietrichGebert/ponytail | MIT | lazy-senior rules and YAGNI ladder |
| YAGNI style | https://github.com/DietrichGebert/ponytail | MIT | minimal-solution ladder |
| I have ADHD style | https://github.com/ayghri/i-have-adhd | MIT | action-first output rules |
| Antislop style | https://github.com/miqdadbadjuber/anti-slop | MIT | slop-pattern rejection rules |
| RTK engine | https://github.com/rtk-ai/rtk | Apache-2.0 | command filters, error-line retention, never-worse gates |
| Headroom engine | https://github.com/headroomlabs-ai/headroom | Apache-2.0 | tabular compaction concept (SmartCrusher/CCR) |
| Session dedup | https://github.com/headroomlabs-ai/headroom and https://github.com/ooples/token-optimizer-mcp | Apache-2.0 / MIT | cross-turn content-addressed dedup concept |
| Lite engine | https://github.com/diegosouzapw/OmniRoute (Lite engine definition) | MIT | safe whitespace + inline-image-data cleanup scope |
| Reference implementation | https://github.com/vibe-any/dsh-plugin-save-token | MIT | TOON-style tabular idea, spill/notice pattern, never-worse gates |

Apache-2.0 requires this notice and a copy of the license; both are included.
MIT requires the copyright notice; the upstream MIT text is included and the
projects above are attributed here.
