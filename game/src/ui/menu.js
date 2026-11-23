// OCASO CITY - menu overlay UI.
// Final polish for the OCASO CITY entry.
// Finalized for the OCASO CITY entry.
// Builds one full-screen overlay using document.createElement and inline
// styles only; no CSS files, no imports, no external libraries.

export function createMenu(G, hooks) {
  let overlay = null;
  let mode = null;
  let isShown = false;
  let mounted = false;

  function makeEl(tag, text, styles) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (styles) Object.assign(node.style, styles);
    return node;
  }

  function onOverlayClick() {
    if (!isShown) return;
    const h = hooks || {};
    if (mode === 'title' && typeof h.onStart === 'function') {
      h.onStart();
    } else if (mode === 'paused' && typeof h.onResume === 'function') {
      h.onResume();
    } else if (mode === 'gameover' && typeof h.onRestart === 'function') {
      h.onRestart();
    }
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    if (typeof document === 'undefined' || !document.createElement) return null;

    overlay = makeEl('div', null, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      boxSizing: 'border-box',
      padding: '24px',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      background: 'rgba(4, 6, 16, 0.78)',
      color: '#ffffff',
      fontFamily: 'Arial, Helvetica, sans-serif',
      zIndex: '10000',
      pointerEvents: 'none',
      userSelect: 'none',
    });
    overlay.className = 'ocaso-menu';
    overlay.addEventListener('click', onOverlayClick);
    return overlay;
  }

  function mount() {
    if (mounted || !overlay) return;
    const parent = document.body || document.documentElement;
    if (!parent) return;
    parent.appendChild(overlay);
    mounted = true;
  }

  function render() {
    if (!overlay) return;
    overlay.textContent = '';

    if (mode === 'title') {
      overlay.appendChild(makeEl('h1', 'OCASO CITY', {
        margin: '0 0 12px',
        fontSize: 'clamp(36px, 8vw, 84px)',
        letterSpacing: '6px',
        color: '#7df9ff',
        textShadow: '0 0 18px rgba(0, 229, 255, 0.8)',
      }));
      overlay.appendChild(makeEl('p',
        'A neon coastal crime city. Take the night, own the streets.',
        {
          margin: '0 0 28px',
          fontSize: 'clamp(14px, 2.2vw, 20px)',
          color: '#ff5fd2',
        }));
      overlay.appendChild(makeEl('p', 'CLICK TO START', {
        margin: '0 0 28px',
        fontSize: 'clamp(18px, 3vw, 26px)',
        fontWeight: 'bold',
        color: '#ffffff',
      }));

      const controls = makeEl('div', null, {
        display: 'grid',
        gridTemplateColumns: 'auto auto',
        columnGap: '18px',
        rowGap: '6px',
        fontSize: 'clamp(11px, 1.6vw, 14px)',
        color: '#cfd6e6',
      });
      const pairs = [
        ['WASD', 'Move'],
        ['Mouse', 'Aim / look'],
        ['Space', 'Jump / brake'],
        ['E', 'Interact'],
        ['Shift', 'Sprint'],
        ['F', 'Enter vehicle / action'],
        ['M', 'Map'],
        ['Escape', 'Pause'],
      ];
      for (const pair of pairs) {
        controls.appendChild(makeEl('span', pair[0], {
          color: '#7df9ff',
          textAlign: 'right',
          fontWeight: 'bold',
        }));
        controls.appendChild(makeEl('span', pair[1], {
          color: '#cfd6e6',
          textAlign: 'left',
        }));
      }
      overlay.appendChild(controls);
    } else if (mode === 'paused') {
      overlay.appendChild(makeEl('h1', 'PAUSED', {
        margin: '0 0 24px',
        fontSize: 'clamp(34px, 7vw, 72px)',
        letterSpacing: '5px',
        color: '#7df9ff',
        textShadow: '0 0 16px rgba(0, 229, 255, 0.7)',
      }));
      overlay.appendChild(makeEl('p', 'CLICK TO RESUME', {
        margin: '0 0 18px',
        fontSize: 'clamp(18px, 3vw, 26px)',
        fontWeight: 'bold',
      }));
      overlay.appendChild(makeEl('p', 'Press R to restart', {
        margin: '0',
        fontSize: 'clamp(12px, 1.8vw, 16px)',
        color: '#cfd6e6',
      }));
    } else if (mode === 'gameover') {
      overlay.appendChild(makeEl('h1', 'BUSTED', {
        margin: '0 0 24px',
        fontSize: 'clamp(44px, 10vw, 96px)',
        letterSpacing: '8px',
        color: '#ff3b5c',
        textShadow: '0 0 20px rgba(255, 59, 92, 0.8)',
      }));
      overlay.appendChild(makeEl('p', 'CLICK TO RESTART', {
        margin: '0',
        fontSize: 'clamp(18px, 3vw, 26px)',
        fontWeight: 'bold',
      }));
    }
  }

  function apply() {
    if (!overlay) return;
    const visible = isShown && mode !== null && mode !== 'playing';
    if (visible) {
      mount();
      render();
      overlay.style.display = 'flex';
      overlay.style.pointerEvents = 'auto';
    } else {
      overlay.style.display = 'none';
      overlay.style.pointerEvents = 'none';
    }
  }

  function ready(fn) {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function show(nextMode) {
    mode = nextMode;
    isShown = true;
    if (!ensureOverlay()) return;
    ready(apply);
  }

  function hide() {
    isShown = false;
    mode = null;
    if (!overlay) return;
    ready(apply);
  }

  function isOpen() {
    return isShown && mode !== null && mode !== 'playing' && overlay !== null;
  }

  return { show, hide, isOpen };
}
