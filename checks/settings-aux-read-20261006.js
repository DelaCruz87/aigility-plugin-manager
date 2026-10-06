(() => {
    if (document.URL !== 'about:blank') throw Error('Expected owned auxiliary Settings document');
    const geometry = element => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display, visibility: style.visibility, opacity: style.opacity, background: style.backgroundColor, minHeight: style.minHeight };
    };
    const rows = [...document.querySelectorAll('.aigility-plugin-row')].slice(0, 6).map(row => {
        const wrapper = row.querySelector('.aigility-switch');
        const input = wrapper?.querySelector('input');
        return { name: row.querySelector('.aigility-plugin-name')?.textContent, row: geometry(row), switchClass: wrapper?.className, checked: input?.checked, switch: geometry(wrapper), input: geometry(input), indicators: [...row.querySelectorAll('.aigility-icon-indicator')].map(x => ({ title: x.title, active: x.classList.contains('is-active') })) };
    });
    const rules = [];
    for (const sheet of document.styleSheets) {
        try {
            for (const rule of sheet.cssRules) {
                if (rule.selectorText && /checkbox-container|aigility-toolbar|aigility-switch/.test(rule.selectorText)) rules.push({ selector: rule.selectorText, style: rule.style?.cssText });
            }
        } catch {}
    }
    return JSON.stringify({ at: new Date().toISOString(), document: document.URL, title: document.title, viewport: { width: innerWidth, height: innerHeight }, rootCount: document.querySelectorAll('.aigility-manager-root').length, toolbars: [...document.querySelectorAll('.aigility-toolbar')].map(x => ({ geometry: geometry(x), text: x.textContent, controls: x.querySelectorAll('button,input,select').length })), rows, rules });
})()
