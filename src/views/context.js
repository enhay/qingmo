export const CONTEXT = Symbol('qingmo-view');
export function safeURL(value, image = false) {
    if (typeof value !== 'string' || /[\u0000-\u0020\\]/.test(value)) return '';
    if (/^\/?assets\//.test(value) && !value.split('/').includes('..'))
        return value.startsWith('/') ? value : '/' + value;
    if (!image && /^(https?:\/\/|mailto:|siyuan:\/\/blocks\/)/i.test(value)) return value;
    return '';
}
export function displayDay(day) {
    return day ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` : '';
}
