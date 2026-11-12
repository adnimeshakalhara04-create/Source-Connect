/* Show / hide password: adds an eye button inside every password box on the site and in the admin,
   including forms drawn later by app.js / admin.js. Works without any other script. */
(function () {
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3.2"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 4.5c6.5 0 10.5 7.5 10.5 7.5a17.6 17.6 0 0 1-3.3 4.2M6.6 6.6C3.4 8.6 1.5 12 1.5 12s4 7.5 10.5 7.5a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  var css = '.pw-wrap{position:relative;display:block}.pw-wrap>input{width:100%;padding-right:44px!important;box-sizing:border-box}' +
    '.pw-eye{position:absolute;top:50%;right:4px;transform:translateY(-50%);width:36px;height:36px;display:flex;align-items:center;justify-content:center;' +
    'background:none;border:0;padding:0;margin:0;cursor:pointer;color:#64748b;border-radius:8px;box-shadow:none;min-width:0}' +
    '.pw-eye:hover{color:#0f172a;background:rgba(100,116,139,.12)}.pw-eye:focus-visible{outline:2px solid #2563eb;outline-offset:1px}' +
    '.pw-eye svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}';
  function addStyle() {
    if (document.getElementById('pw-eye-css')) return;
    var st = document.createElement('style'); st.id = 'pw-eye-css'; st.textContent = css; document.head.appendChild(st);
  }
  function enhance(input) {
    if (input.dataset.pwEye) return;
    input.dataset.pwEye = '1';
    var wrap = document.createElement('span'); wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pw-eye'; b.innerHTML = EYE;
    b.setAttribute('aria-label', 'Show password'); b.title = 'Show password';
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep the cursor in the box
    b.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.innerHTML = show ? EYE_OFF : EYE;
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); b.title = show ? 'Hide password' : 'Show password';
      b.setAttribute('aria-pressed', show ? 'true' : 'false');
    });
    // hide the password again when the form is sent, so the browser does not remember it as plain text
    if (input.form) input.form.addEventListener('submit', function () {
      if (input.type === 'text') { input.type = 'password'; b.innerHTML = EYE; b.setAttribute('aria-label', 'Show password'); b.title = 'Show password'; b.setAttribute('aria-pressed', 'false'); }
    }, true);
    wrap.appendChild(b);
  }
  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches('input[type=password]')) enhance(root);
    var list = root.querySelectorAll ? root.querySelectorAll('input[type=password]') : [];
    for (var i = 0; i < list.length; i++) enhance(list[i]);
  }
  function start() {
    addStyle(); scan(document.body);
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) scan(ms[i].addedNodes[j]);
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
