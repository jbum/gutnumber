export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.hl { position: fixed; pointer-events: none; z-index: 2147483646; border: 2px dashed #8a93a6; background: rgba(138,147,166,.08); border-radius: 3px; transition: all 60ms linear; display: none; }
.hl.num { border: 2px solid #17a589; background: rgba(23,165,137,.12); }
.badge { position: fixed; pointer-events: none; z-index: 2147483647; font: 600 12px/1 system-ui, sans-serif; background: #17a589; color: #fff; padding: 4px 6px; border-radius: 4px; display: none; white-space: nowrap; }
.bar { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 2147483647; font: 13px/1.3 system-ui, sans-serif; background: #1d2330; color: #fff; padding: 8px 14px; border-radius: 8px; box-shadow: 0 4px 18px rgba(0,0,0,.25); display: flex; gap: 12px; align-items: center; }
.bar b { color: #7ee2c9; }
.bar button { all: unset; cursor: pointer; color: #b9c2d6; text-decoration: underline; }
.modal-bg { position: fixed; inset: 0; background: rgba(10,14,22,.45); z-index: 2147483647; display: flex; align-items: center; justify-content: center; }
.dlg { --fg:#1d2330; --muted:#5b6475; --line:#d6dae3; --bg:#fff; --accent:#2f6fdf; --ok:#17804c; --err:#c0392b; --soft:#f3f5f9;
  font: 14px/1.45 system-ui, sans-serif; color: var(--fg); background: var(--bg); width: min(540px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; border-radius: 12px; box-shadow: 0 12px 48px rgba(0,0,0,.35); padding: 20px 22px; }
@media (prefers-color-scheme: dark) { .dlg { --fg:#e8eaf0; --muted:#9aa3b5; --line:#343945; --bg:#1b1e25; --accent:#6b9cff; --ok:#4cc38a; --err:#ff7b6b; --soft:#23272f; } }
.dlg h2 { font-size: 17px; margin: 0 0 12px; }
.value { display: flex; align-items: baseline; gap: 10px; background: var(--soft); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.value .big { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; }
.value .raw { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
label { display: block; font-weight: 600; font-size: 12px; color: var(--muted); margin: 10px 0 4px; text-transform: uppercase; letter-spacing: .03em; }
input, select { width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; font: inherit; color: inherit; background: transparent; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.check { display: flex; gap: 8px; align-items: center; margin-top: 10px; font-size: 13px; }
.check input { width: auto; }
.preview { margin-top: 14px; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; font-size: 13px; }
.preview .row { display: flex; justify-content: space-between; gap: 8px; }
.ok { color: var(--ok); } .err { color: var(--err); } .muted { color: var(--muted); }
.tip { margin-top: 12px; padding: 10px 12px; border-radius: 8px; background: var(--soft); font-size: 13px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
button.btn { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
button.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
button.btn:disabled { opacity: .5; cursor: default; }
a { color: var(--accent); }
`;
