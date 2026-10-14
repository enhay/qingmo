export function safeHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const allowed = new Set('P BR STRONG B EM I U MARK DEL S UL OL LI BLOCKQUOTE PRE CODE A IMG SPAN DIV H1 H2 H3 H4 H5 H6 HR TABLE THEAD TBODY TR TH TD'.split(' '));
    for (const element of Array.from(template.content.querySelectorAll('*'))) {
        if (!allowed.has(element.tagName)) { element.remove(); continue; }
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            if (!['href', 'src', 'alt', 'title', 'start', 'class', 'data-type', 'data-content'].includes(name)) element.removeAttribute(attribute.name);
        }
        for (const name of ['href', 'src']) {
            const value = element.getAttribute(name);
            if (value == null) continue;
            const compact = value.replace(/[\u0000-\u0020\u007f]/g, '');
            const safe = name === 'src' ? /^(?:https?:\/\/|\/?assets\/)/i.test(compact) : /^(?:https?:\/\/|mailto:|siyuan:\/\/blocks\/|#|\/?assets\/)/i.test(compact);
            if (!safe) element.removeAttribute(name);
        }
        if (element.tagName === 'A') element.setAttribute('rel', 'noopener noreferrer');
    }
    return template.innerHTML;
}

export function renderBlockDOM(dom) {
    const template = document.createElement('template');
    template.innerHTML = dom;
    template.content.querySelectorAll('.protyle-attr,.protyle-icons').forEach(node => node.remove());
    for (const node of Array.from(template.content.querySelectorAll('[data-type^="Node"]'))) {
        if (node.dataset.type === 'NodeSuperBlock' || node.dataset.type === 'NodeDocument') { node.replaceWith(...node.childNodes); continue; }
        for (const attribute of Array.from(node.attributes)) if (!['data-type', 'data-subtype', 'data-marker', 'class'].includes(attribute.name)) node.removeAttribute(attribute.name);
    }
    const lute = window.Lute.New();
    lute.SetTag(true); lute.SetMark(true);
    return safeHTML(lute.BlockDOM2HTML(template.innerHTML));
}
