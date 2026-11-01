import { getStore } from '@netlify/blobs';

export default async function handler() {
    const store = getStore('visitor-counter');
    const storedCount = await store.get('count');
    const currentCount = storedCount === null ? 0 : Number(storedCount);
    if (!Number.isSafeInteger(currentCount) || currentCount < 0) {
        throw new Error('Stored visitor count is not a valid non-negative integer.');
    }

    const count = currentCount + 1;
    if (!Number.isSafeInteger(count)) {
        throw new Error('Visitor count exceeded the safe integer range.');
    }

    await store.set('count', String(count));

    return new Response(generateSvg(String(count).padStart(7, '0')), {
        headers: {
            'content-type': 'image/svg+xml; charset=utf-8',
            'cache-control': 'no-cache, no-store, must-revalidate, max-age=0'
        }
    });
}

export const config = {
    path: '/count',
    method: ['GET']
};

function generateSvg(value) {
    const font = 24;
    const size = 29;
    const margin = 32;
    let text = '';

    for (let i = 0; i < value.length; i++) {
        text += `<rect x="${i * margin}" y="0.5"/><text><tspan x="${i * margin + 7}" y="22">${value[i]}</tspan></text>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${margin * value.length}" height="30"><style>rect {fill: #000;width: ${size}px;height: ${size}px;}text {font: ${font}px Courier;fill: #0f1;}</style><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">${text}</g></svg>`;
}
