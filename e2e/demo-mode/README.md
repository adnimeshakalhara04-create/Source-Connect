# Demo-mode audits (no API)

These check the original browser-only site still works (what GitHub Pages serves when `js/config.js` has no API).
Serve the repository root on port 8765, then run each script:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 &
node e2e/demo-mode/audit1.cjs   # 63 storefront routes x 5 widths
node e2e/demo-mode/audit2.cjs   # cart, checkout, order, tracking, account, intro
node e2e/demo-mode/audit3.cjs   # every admin view and editor window at 3 widths
node e2e/demo-mode/xss.cjs      # escaping of every editable text, colour and photo link
node e2e/demo-mode/edge.cjs     # empty catalogue, blocked storage
node e2e/demo-mode/inputs.cjs   # form validation
```
