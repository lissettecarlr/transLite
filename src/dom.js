// Read-only segmentation. Original nodes are never wrapped, moved or cloned.
var LT_DOM = (() => {
  const forbidden = 'script,style,noscript,template,iframe,code,pre,kbd,samp,var,math,svg,canvas,input,textarea,select,option,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[hidden],[inert],[aria-hidden="true"],.sr-only,.visually-hidden,.screen-reader-only,[popover],tool-tip,tooltip,.lt-result,#lt-selection-popup,#lt-error-toast';
  const controls = 'button,summary,label,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[role="switch"],[role="checkbox"],[role="radio"],[onclick]';

  function collect(settings, completedNodes = new Set(), root = document.body) {
    let excluded = forbidden;
    let included = '';
    // Old saved settings can contain malformed selectors. Ignore just that
    // setting, leaving built-in protections active.
    try {
      if (settings.excludeSelectors?.trim()) {
        document.querySelector(settings.excludeSelectors);
        excluded += `,${settings.excludeSelectors}`;
      }
    } catch (_) {}
    try {
      if (settings.includeSelectors?.trim()) {
        document.querySelector(settings.includeSelectors);
        included = settings.includeSelectors;
      }
    } catch (_) {}
    const styles = new WeakMap();
    const skipped = new WeakMap();
    const style = el => {
      if (!styles.has(el)) styles.set(el, getComputedStyle(el));
      return styles.get(el);
    };
    function skip(el) {
      if (!el) return true;
      if (skipped.has(el)) return skipped.get(el);
      const s = style(el);
      const hidden = el.matches(excluded) || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0'
        || (el !== document.body && skip(el.parentElement));
      skipped.set(el, hidden);
      return hidden;
    }
    function ownerOf(node) {
      let el = node.parentElement;
      while (el && el !== document.body) {
        if (included && el.matches(included)) return el;
        const display = style(el).display;
        if (el.matches(controls) || !['inline', 'contents'].includes(display)) return el;
        if (/flex|grid/.test(style(el.parentElement).display)) return el;
        el = el.parentElement;
      }
      return el;
    }
    function compact(el) {
      if (el.closest(`${controls},td,th,nav,[role="navigation"],[role="grid"],[role="tree"]`)) return true;
      if (/flex|grid/.test(style(el).display)) return true;
      if (['inline', 'inline-block', 'inline-flex', 'inline-grid'].includes(style(el).display)) return true;
      for (let current = el; current && current !== document.body; current = current.parentElement) {
        const s = style(current);
        if (s.whiteSpace === 'nowrap' || s.textOverflow === 'ellipsis' || parseInt(s.webkitLineClamp, 10) > 0) return true;
        // Clipping only truncates text when the box is short. Tall article wrappers
        // routinely use overflow:hidden/clip for layout (e.g. Tailwind overflow-clip).
        if (['hidden', 'clip'].includes(s.overflowY) && (s.maxHeight !== 'none' || current.clientHeight < 160)) return true;
      }
      return false;
    }

    const units = [];
    let group = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (completedNodes.has(node)) continue;
      const parent = node.parentElement;
      if (skip(parent)) continue;
      if (!settings.aggressiveMode) {
        if (parent.closest(`nav,[role="navigation"],${controls}`)) continue;
        const chrome = parent.closest('header,footer');
        if (chrome && !chrome.closest('main,article,[role="main"]')) continue;
      }
      const el = ownerOf(node);
      if (!el) continue;
      const mode = compact(el) ? 'replace' : 'bilingual';
      if (mode === 'replace') {
        units.push({ el, node, text: node.nodeValue.trim(), mode, sources: [{ node, value: node.nodeValue, parent }] });
        group = null;
      } else {
        if (!group || group.el !== el) {
          group = { el, text: '', mode, sources: [], anchor: null };
          units.push(group);
        }
        // A <br> is a meaningful boundary even though it has no text node.
        let anchor = node;
        while (anchor.parentNode !== el) anchor = anchor.parentNode;
        if (group.anchor && group.anchor !== anchor) {
          let sibling = group.anchor.nextSibling;
          while (sibling && sibling !== anchor) {
            if (sibling.nodeName === 'BR') group.text += '\n';
            sibling = sibling.nextSibling;
          }
        }
        group.anchor = anchor;
        group.text += node.nodeValue;
        group.sources.push({ node, value: node.nodeValue, parent });
      }
    }
    return units.filter(unit => {
      unit.text = unit.text.trim();
      return unit.text.length >= (unit.mode === 'replace' ? 2 : 4) && /\p{L}/u.test(unit.text);
    });
  }

  // ===== 追加段落译文的门禁 =====
  // 只有真正的「段落块」才适合在原文下方追加一段译文。导航条、面包屑、按钮里的
  // 文字都由交互元素贡献，追加块会多出一个盒子，把横向布局顶歪。
  const CONTROLS = 'a,button,label,summary,[role="link"],[role="button"],[role="tab"],[role="menuitem"],[onclick]';
  const BLOCK_MIN_CHARS = 24;

  function compactText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.nodeValue;
      else if (node.nodeType === 1 && !node.classList.contains('lt-result')) text += compactText(node);
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  // 纯函数：只吃事实，方便单测（不依赖 DOM）。
  function blockPolicy({ inControl, display, cursor, position, float, textLength, controlRatio }) {
    if (inControl) return false;                       // 自己在链接/按钮里
    if (/^inline/.test(display || '')) return false;   // 行内元素里塞块必然乱
    if (/flex|grid/.test(display || '')) return false; // 自己就是 flex/grid 容器
    if (position === 'absolute' || position === 'fixed') return false;
    if (float && float !== 'none') return false;
    if (cursor === 'pointer') return false;            // 按钮类容器（<a onclick> 没有 href）
    if (textLength < BLOCK_MIN_CHARS) return false;    // 短标签串不是段落
    if (controlRatio >= 0.5) return false;             // 文字主要来自控件 ⇒ 导航
    return true;
  }

  function canAppendBlock(el) {
    try {
      const style = getComputedStyle(el);
      const text = compactText(el);
      let controlled = 0;
      for (const node of el.querySelectorAll(CONTROLS)) controlled += compactText(node).length;
      return blockPolicy({
        inControl: !!el.closest(CONTROLS),
        display: style.display,
        cursor: style.cursor,
        position: style.position,
        float: style.float,
        textLength: text.length,
        controlRatio: text.length ? controlled / text.length : 0,
      });
    } catch (_) {
      return false;
    }
  }

  function isCurrent(unit) {
    return unit.el.isConnected && unit.sources.every(({ node, value, parent }) =>
      node.isConnected && node.parentElement === parent && node.nodeValue === value && unit.el.contains(node) && !parent.closest(forbidden));
  }
  function scanRoot(el) {
    while (el.parentElement && el !== document.body && ['inline','contents'].includes(getComputedStyle(el).display)) el = el.parentElement;
    return el;
  }
  return { collect, isCurrent, forbidden, scanRoot, canAppendBlock, blockPolicy, CONTROLS, BLOCK_MIN_CHARS };
})();
