(() => {
  'use strict';

  // Re-injecting the extension toggles the existing picker rather than
  // installing duplicate event listeners.
  if (globalThis.__iconSniperV3) {
    globalThis.__iconSniperV3.toggle();
    return;
  }

  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const MAX_ICON = 256;
  const STYLE_PROPERTIES = [
    'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke',
    'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
    'vector-effect', 'paint-order', 'opacity', 'visibility', 'display',
    'clip-rule', 'stop-color', 'stop-opacity', 'mask-type',
    'color-interpolation-filters', 'shape-rendering',
    'filter', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end'
  ];

  let active = false;
  let copying = false;
  let current = null;
  let lastPoint = {x: 0, y: 0};
  let notificationTimer = null;
  let mounted = false;

  const host = document.createElement('div');
  host.setAttribute('data-icon-sniper-ui', '');
  host.style.cssText =
    'all:initial!important;position:fixed!important;inset:0!important;' +
    'z-index:2147483647!important;pointer-events:none!important;display:none!important';
  const root = host.attachShadow({mode: 'closed'});
  root.innerHTML = [
    '<style>',
    ':host {all:initial;pointer-events:none}',
    '*,*::before,*::after {box-sizing:border-box}',
    '.outline {position:fixed;border:2px solid #57a8fa;border-radius:5px;',
    'box-shadow:0 0 0 2px #ffffff88,0 4px 18px #0003;background:#57a8fa20;pointer-events:none}',
    '.banner,.hint,.toast {position:fixed;color:white;background:#162338;',
    'border:1px solid #40506a;box-shadow:0 8px 26px #0003;border-radius:9px;',
    'font:500 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;',
    'padding:8px 11px;pointer-events:none}',
    '.banner {top:14px;left:50%;transform:translateX(-50%);white-space:nowrap}',
    '.hint {white-space:nowrap;max-width:350px}',
    '.hint b {color:#94cbff;font-weight:650}',
    '.hint .no {color:#ffbaba}',
    '.toast {top:15px;left:50%;transform:translateX(-50%);font-size:13px;',
    'max-width:min(570px,92vw);white-space:normal;text-align:center;padding:12px 16px}',
    '.toast.ok {border-color:#65a9f0}.toast.err {border-color:#f17b86}',
    '</style>',
    '<div class="outline" hidden></div>',
    '<div class="hint" hidden></div>',
    '<div class="banner">Icon Sniper · Original SVG only · Click to copy · Esc to exit</div>',
    '<div class="toast" hidden></div>'
  ].join('');
  const outline = root.querySelector('.outline');
  const hint = root.querySelector('.hint');
  const banner = root.querySelector('.banner');
  const toast = root.querySelector('.toast');

  function mount() {
    if (mounted) return;
    (document.documentElement || document.body).appendChild(host);
    mounted = true;
  }

  function rect(el) {
    try { return el.getBoundingClientRect(); }
    catch { return null; }
  }
  function visible(r) {
    return !!r && r.width >= 2 && r.height >= 2 &&
      r.width <= MAX_ICON && r.height <= MAX_ICON;
  }
  function containsPoint(r, x, y, pad = 2) {
    return !!r && x >= r.left - pad && x <= r.right + pad &&
      y >= r.top - pad && y <= r.bottom + pad;
  }
  function ancestry(el) {
    const chain = [];
    for (let i = 0; el instanceof Element && i < 14; i++) {
      if (el === host || el === document.body || el === document.documentElement) break;
      chain.push(el);
      const scope = el.getRootNode();
      el = el.parentElement || (scope instanceof ShadowRoot ? scope.host : null);
    }
    return chain;
  }

  function cssUrl(value) {
    if (!value || value === 'none') return null;
    // Handles quoted data: URLs containing parentheses.
    const match = value.match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/i);
    return match ? (match[1] || match[2] || match[3] || '').trim() : null;
  }
  function absoluteUrl(value) {
    try { return new URL(value, document.baseURI).href; }
    catch { return null; }
  }
  function findUrlSource(element) {
    if (element instanceof HTMLImageElement) {
      const url = element.currentSrc || element.src;
      if (url) return {url, label: 'SVG image'};
    }
    if (element instanceof HTMLObjectElement && element.data) {
      return {url: element.data, label: 'SVG object'};
    }
    for (const pseudo of [null, '::before', '::after']) {
      let style;
      try { style = getComputedStyle(element, pseudo); }
      catch { continue; }
      if (!style) continue;
      for (const property of ['mask-image', '-webkit-mask-image', 'background-image']) {
        const url = cssUrl(style.getPropertyValue(property));
        if (!url) continue;
        return {
          url: absoluteUrl(url),
          label: property.includes('mask') ? 'CSS SVG mask' : 'CSS SVG background',
          property, pseudo, element
        };
      }
    }
    return null;
  }

  function candidateAt(x, y, event) {
    // Inspect the actual click path, including targets inside open Shadow DOM.
    const eventPath = event?.composedPath?.().filter(n => n instanceof Element) || [];
    const target = eventPath.find(n => n !== host && !host.contains(n)) ||
      document.elementFromPoint(x, y);
    if (!target || target === host || host.contains(target)) return null;
    const chain = ancestry(target);

    // First priority: an existing inline SVG. Never trace a screenshot.
    for (const node of chain) {
      const svg = node instanceof SVGSVGElement ? node :
        node instanceof SVGElement ? node.closest('svg') : null;
      if (svg && containsPoint(rect(svg), x, y)) {
        return {kind: 'inline', element: svg, box: rect(svg), label: 'Inline SVG'};
      }
    }

    // Pointer-events:none is common in icon components, so the target may be a button.
    for (const ancestor of chain.slice(0, 9)) {
      for (const svg of ancestor.querySelectorAll('svg')) {
        const box = rect(svg);
        if (visible(box) && containsPoint(box, x, y)) {
          return {kind: 'inline', element: svg, box, label: 'Inline SVG'};
        }
      }
      if (ancestor.shadowRoot) {
        for (const svg of ancestor.shadowRoot.querySelectorAll('svg')) {
          const box = rect(svg);
          if (visible(box) && containsPoint(box, x, y)) {
            return {kind: 'inline', element: svg, box, label: 'Shadow DOM SVG'};
          }
        }
      }
      if (ancestor.children.length > 100) break;
    }

    // Second priority: an SVG image or a CSS mask/background sourced from SVG.
    for (const node of chain.slice(0, 9)) {
      const box = rect(node);
      const urlSource = findUrlSource(node);
      if (urlSource && containsPoint(box, x, y)) {
        return {kind: 'asset', element: node, box, ...urlSource};
      }
      if (visible(box)) {
        for (const child of node.querySelectorAll('img,object')) {
          const childBox = rect(child);
          if (!visible(childBox) || !containsPoint(childBox, x, y)) continue;
          const source = findUrlSource(child);
          if (source) return {kind: 'asset', element: child, box: childBox, ...source};
        }
      }
    }

    const nearest = chain.find(node => visible(rect(node))) || target;
    return {kind: 'unsupported', element: nearest, box: rect(nearest), label: 'No SVG source'};
  }

  function renderSelection() {
    if (!active || !current?.box) {
      outline.hidden = true;
      hint.hidden = true;
      return;
    }
    const box = current.box;
    const left = Math.max(0, box.left);
    const top = Math.max(0, box.top);
    const right = Math.min(innerWidth, box.right);
    const bottom = Math.min(innerHeight, box.bottom);
    if (right <= left || bottom <= top) {
      outline.hidden = true;
      hint.hidden = true;
      return;
    }
    Object.assign(outline.style, {
      left: left + 'px',
      top: top + 'px',
      width: (right - left) + 'px',
      height: (bottom - top) + 'px'
    });
    outline.hidden = false;
    hint.hidden = false;
    hint.innerHTML = current.kind === 'unsupported'
      ? '<b class="no">No original SVG found</b> · click for details'
      : '<b>' + current.label + '</b> · ' +
        Math.round(box.width) + ' × ' + Math.round(box.height) + ' · click to copy';
    hint.style.left = Math.max(6, Math.min(innerWidth - 275, left)) + 'px';
    hint.style.top = (bottom + 9 < innerHeight - 32 ? bottom + 8 : Math.max(8, top - 40)) + 'px';
  }

  function onMove(event) {
    if (!active || copying) return;
    lastPoint = {x: event.clientX, y: event.clientY};
    current = candidateAt(lastPoint.x, lastPoint.y, event);
    renderSelection();
  }
  function onRefresh() {
    if (!active || copying) return;
    current = candidateAt(lastPoint.x, lastPoint.y, null);
    renderSelection();
  }

  function normalisePaintUrls(value) {
    if (!value || !value.includes('url(')) return value;
    return value.replace(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g, (all, address) => {
      if (address.startsWith('#')) return 'url(' + address + ')';
      try {
        const url = new URL(address, document.baseURI);
        if (url.hash && url.href.split('#')[0] === location.href.split('#')[0]) {
          return 'url(' + url.hash + ')';
        }
      } catch { /* ignore invalid URLs */ }
      return 'none';
    });
  }

  function copyComputedStyles(original, clone) {
    const sourceNodes = [original, ...original.querySelectorAll('*')];
    const targetNodes = [clone, ...clone.querySelectorAll('*')];
    for (let i = 0; i < sourceNodes.length && i < targetNodes.length; i++) {
      const sourceNode = sourceNodes[i];
      const targetNode = targetNodes[i];
      if (!(sourceNode instanceof SVGElement) || !(targetNode instanceof SVGElement)) continue;
      let style;
      try { style = getComputedStyle(sourceNode); }
      catch { continue; }
      for (const property of STYLE_PROPERTIES) {
        const value = normalisePaintUrls(style.getPropertyValue(property).trim());
        if (value) targetNode.style.setProperty(property, value);
      }
      if (!sourceNode.hasAttribute('transform') && style.transform !== 'none') {
        targetNode.style.transform = style.transform;
        targetNode.style.transformOrigin = style.transformOrigin;
      }
    }
  }

  async function documentFromUrl(url) {
    if (!url || !/^(https?:|blob:|data:)/i.test(url)) {
      throw new Error('Unsupported SVG asset URL');
    }
    const response = await fetch(url, {credentials: 'same-origin'});
    if (!response.ok) throw new Error('Could not read SVG asset (HTTP ' + response.status + ')');
    const doc = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') {
      throw new Error('This resource does not contain SVG markup');
    }
    return doc;
  }

  function findById(svgNode, id) {
    const scope = svgNode.getRootNode();
    return scope?.getElementById?.(id) || document.getElementById(id);
  }

  async function expandUseReferences(clone, original) {
    // Expand <use>/<symbol> into real vector nodes. Detached referenced
    // symbols are recovered from the original page where possible.
    for (let pass = 0; pass < 6; pass++) {
      const references = [...clone.querySelectorAll('use')];
      if (!references.length) return;
      const originals = [...original.querySelectorAll('use')];

      for (let i = 0; i < references.length; i++) {
        const use = references[i];
        const sourceUse = originals[i] || original;
        const href = use.getAttribute('href') ||
          use.getAttributeNS(XLINK, 'href') || use.getAttribute('xlink:href');
        if (!href) throw new Error('SVG sprite has a missing reference');

        let referenced;
        if (href.startsWith('#')) {
          const id = decodeURIComponent(href.slice(1));
          referenced = clone.querySelector('[id="' + CSS.escape(id) + '"]') ||
            findById(sourceUse, id);
        } else {
          const index = href.indexOf('#');
          if (index < 0) throw new Error('External SVG sprite has no symbol ID');
          const documentUrl = absoluteUrl(href.slice(0, index));
          const external = await documentFromUrl(documentUrl);
          referenced = external.getElementById(decodeURIComponent(href.slice(index + 1)));
        }
        if (!(referenced instanceof SVGElement) || referenced === use) {
          throw new Error('Could not resolve the referenced SVG symbol');
        }

        let replacement;
        if (referenced.localName === 'symbol' || referenced.localName === 'svg') {
          replacement = document.createElementNS(NS, 'svg');
          const viewBox = referenced.getAttribute('viewBox');
          if (viewBox) replacement.setAttribute('viewBox', viewBox);
          for (const name of ['x', 'y', 'width', 'height']) {
            const value = use.getAttribute(name) || referenced.getAttribute(name);
            if (value) replacement.setAttribute(name, value);
          }
          for (const name of [...referenced.attributes]) {
            if (!['id', 'viewBox', 'x', 'y', 'width', 'height'].includes(name.name)) {
              replacement.setAttribute(name.name, name.value);
            }
          }
          for (const child of [...referenced.childNodes]) {
            replacement.appendChild(child.cloneNode(true));
          }
        } else {
          replacement = document.createElementNS(NS, 'g');
          replacement.appendChild(referenced.cloneNode(true));
          const x = use.getAttribute('x') || '0';
          const y = use.getAttribute('y') || '0';
          if (x !== '0' || y !== '0') {
            replacement.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
          }
        }

        const wrapper = document.createElementNS(NS, 'g');
        if (sourceUse instanceof SVGElement && sourceUse.isConnected) {
          const style = getComputedStyle(sourceUse);
          for (const property of ['color','fill','stroke','stroke-width',
            'stroke-linecap','stroke-linejoin']) {
            const value = style.getPropertyValue(property).trim();
            if (value) wrapper.style.setProperty(property, value);
          }
        }
        const transform = use.getAttribute('transform');
        if (transform) wrapper.setAttribute('transform', transform);
        wrapper.appendChild(replacement);
        use.replaceWith(wrapper);
      }
    }
    if (clone.querySelector('use')) throw new Error('Cyclic SVG sprite reference');
  }

  function includeExternalDefinitions(clone, original) {
    // Gradients, clips and masks may be defined in a hidden sprite elsewhere
    // in the DOM; copy these definitions into the standalone SVG.
    let defs = clone.querySelector('defs');
    const alreadyIncluded = new Set();
    for (let pass = 0; pass < 8; pass++) {
      let foundAny = false;
      for (const node of [clone, ...clone.querySelectorAll('*')]) {
        for (const attribute of [...node.attributes]) {
          const regexp = /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g;
          let match;
          while ((match = regexp.exec(attribute.value))) {
            const id = match[1];
            if (alreadyIncluded.has(id) ||
                clone.querySelector('[id="' + CSS.escape(id) + '"]')) continue;
            const originalDefinition = findById(original, id);
            if (!(originalDefinition instanceof SVGElement)) continue;
            if (!defs) {
              defs = document.createElementNS(NS, 'defs');
              clone.prepend(defs);
            }
            const included = originalDefinition.cloneNode(true);
            if (originalDefinition.isConnected) {
              copyComputedStyles(originalDefinition, included);
            }
            defs.appendChild(included);
            alreadyIncluded.add(id);
            foundAny = true;
          }
        }
      }
      if (!foundAny) break;
    }
  }

  function sanitize(svg, keepInternalStyles = false) {
    svg.setAttribute('xmlns', NS);
    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      if (['script','foreignObject','iframe','object','embed','image']
        .includes(element.localName)) {
        if (element.localName === 'image') {
          throw new Error('SVG contains a raster image rather than vector paths');
        }
        element.remove();
        continue;
      }
      for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name) ||
          (/^(?:href|xlink:href)$/i.test(attribute.name) &&
           /^(?:javascript:|https?:|data:)/i.test(attribute.value))) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    for (const style of svg.querySelectorAll('style')) {
      if (!keepInternalStyles) style.remove();
      else style.textContent = style.textContent
        .replace(/@import[^;]*;/gi,'')
        .replace(/url\(\s*['"]?https?:[^)]+\)/gi,'none');
    }
    return svg;
  }

  function setDimensions(svg, box, original) {
    const width = box?.width || Number.parseFloat(svg.getAttribute('width')) || 24;
    const height = box?.height || Number.parseFloat(svg.getAttribute('height')) || 24;
    if (!original.getAttribute('viewBox') && !svg.getAttribute('viewBox')) {
      const intrinsicW = Number.parseFloat(original.getAttribute('width')) || width;
      const intrinsicH = Number.parseFloat(original.getAttribute('height')) || height;
      svg.setAttribute('viewBox', '0 0 ' + intrinsicW + ' ' + intrinsicH);
    }
    svg.setAttribute('width', String(Math.max(1, Math.round(width * 100) / 100)));
    svg.setAttribute('height', String(Math.max(1, Math.round(height * 100) / 100)));
  }

  async function svgFromInline(selection) {
    const original = selection.element;
    const clone = original.cloneNode(true);
    copyComputedStyles(original, clone);
    await expandUseReferences(clone, original);
    includeExternalDefinitions(clone, original);
    setDimensions(clone, selection.box, original);
    sanitize(clone);
    return new XMLSerializer().serializeToString(clone);
  }

  async function svgFromAsset(selection) {
    const doc = await documentFromUrl(selection.url);
    const original = doc.documentElement;
    const clone = original.cloneNode(true);
    await expandUseReferences(clone, original);
    includeExternalDefinitions(clone, original);
    setDimensions(clone, selection.box, original);
    if (selection.property?.includes('mask')) {
      // A CSS mask uses the element's background to colour opaque pixels.
      const style = getComputedStyle(selection.element, selection.pseudo || null);
      const background = style.backgroundColor;
      const colour = background && !['transparent','rgba(0, 0, 0, 0)'].includes(background)
        ? background : style.color;
      for (const shape of clone.querySelectorAll(
        'path,rect,circle,ellipse,polygon,polyline,line')) {
        if (shape.getAttribute('fill') !== 'none') shape.setAttribute('fill', colour);
        if (shape.hasAttribute('stroke') && shape.getAttribute('stroke') !== 'none') {
          shape.setAttribute('stroke', colour);
        }
      }
      clone.setAttribute('color', colour);
    }
    sanitize(clone, true);
    return new XMLSerializer().serializeToString(clone);
  }

  async function writeSvgClipboard(markup) {
    // Supply both formats where supported; never provide a PNG fallback.
    const types = {'text/plain': new Blob([markup], {type: 'text/plain'})};
    if (globalThis.ClipboardItem?.supports?.('image/svg+xml')) {
      types['image/svg+xml'] = new Blob([markup], {type: 'image/svg+xml'});
    }
    if (navigator.clipboard?.write && globalThis.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem(types)]);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(markup);
    } else {
      const temporary = document.createElement('textarea');
      temporary.value = markup;
      temporary.style.cssText = 'position:fixed;left:-10000px;opacity:0';
      document.documentElement.appendChild(temporary);
      temporary.focus();
      temporary.select();
      const ok = document.execCommand('copy');
      temporary.remove();
      if (!ok) throw new Error('The browser blocked clipboard access');
    }
  }

  function stop() {
    active = false;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onRefresh, true);
    window.removeEventListener('resize', onRefresh, true);
    outline.hidden = true;
    hint.hidden = true;
    banner.hidden = true;
    current = null;
    if (toast.hidden) host.style.display = 'none';
  }

  function notify(message, success) {
    mount();
    host.style.display = 'block';
    toast.hidden = false;
    toast.textContent = message;
    toast.className = 'toast ' + (success ? 'ok' : 'err');
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
      toast.hidden = true;
      if (!active) host.style.display = 'none';
    }, success ? 2800 : 6000);
  }

  async function onClick(event) {
    if (!active || copying) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    copying = true;
    const selection = candidateAt(event.clientX, event.clientY, event) || current;
    stop();

    try {
      if (!selection || selection.kind === 'unsupported') {
        throw new Error('No original SVG found in Elements. The icon might be a font, CSS drawing or bitmap. Nothing copied.');
      }
      const markup = selection.kind === 'inline'
        ? await svgFromInline(selection)
        : await svgFromAsset(selection);
      if (!markup.includes('<svg') || !markup.includes('</svg>')) {
        throw new Error('The extracted SVG is invalid');
      }
      await writeSvgClipboard(markup);
      notify(selection.label + ' copied as SVG · paste in Figma', true);
    } catch (error) {
      console.warn('[Icon Sniper] SVG extraction failed:', error);
      notify('Not copied: ' + (error?.message || String(error)), false);
    } finally {
      copying = false;
    }
  }

  function onKey(event) {
    if (event.key === 'Escape' && active) {
      event.preventDefault();
      stop();
    }
  }

  function start() {
    if (active) return;
    active = true;
    mount();
    clearTimeout(notificationTimer);
    host.style.display = 'block';
    toast.hidden = true;
    banner.hidden = false;
    lastPoint = {x: innerWidth / 2, y: innerHeight / 2};
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onRefresh, true);
    window.addEventListener('resize', onRefresh, true);
  }

  globalThis.__iconSniperV3 = {
    toggle: () => active ? stop() : start(),
    pickAt: candidateAt,
    fromInline: svgFromInline,
    fromAsset: svgFromAsset
  };
  start();
})();
