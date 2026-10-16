const encoder = new TextEncoder();
const fail = code => Object.assign(new Error(code), { code });
const cancelled = signal => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};
export function audioErrorCode(error) {
    const code = error?.code || error?.name || '';
    if (/AuthFailure|UnauthorizedOperation/.test(code)) return 'credentials';
    if (
        /ResourceUnavailable|FailedOperation.UserNotAuthorized|FailedOperation.ServiceIsolate|FailedOperation.UserNotRegistered|FailedOperation.UserNotInService|FailedOperation.BalanceNotEnough/.test(
            code
        )
    )
        return 'account';
    if (/InvalidParameter|LimitExceeded|audioFormat|audioDuration|audioSize|EncodingError|NotSupportedError/.test(code))
        return 'audio';
    if (/NotAllowedError|SecurityError|microphoneUnavailable/.test(code)) return 'microphone';
    if (code === 'AbortError') return 'cancelled';
    return 'network';
}
export function pcmToWav(samples, sampleRate = 16000) {
    const buffer = new ArrayBuffer(44 + samples.length * 2),
        view = new DataView(buffer);
    const text = (offset, value) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return buffer;
}
export async function toRecognitionWav(blob, { signal } = {}) {
    cancelled(signal);
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext,
        Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!Context || !Offline) throw fail('audioFormat');
    const context = new Context();
    let decoded;
    try {
        decoded = await context.decodeAudioData(await blob.arrayBuffer());
    } catch {
        throw fail('audioFormat');
    } finally {
        await context.close();
    }
    cancelled(signal);
    if (decoded.duration <= 0 || decoded.duration > 60.1) throw fail('audioDuration');
    const offline = new Offline(1, Math.ceil(decoded.duration * 16000), 16000),
        source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    cancelled(signal);
    return pcmToWav(rendered.getChannelData(0));
}
export async function startRecording({ onTick, onLimit, onLevel } = {}) {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.MediaRecorder)
        throw fail('microphoneUnavailable');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let recorder;
    try {
        const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type =>
            MediaRecorder.isTypeSupported(type)
        );
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (error) {
        stream.getTracks().forEach(track => track.stop());
        throw error;
    }
    let discarded = false,
        timer,
        limit,
        settled = false,
        meterContext,
        meterSource,
        analyser;
    if (onLevel) {
        const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (Context) {
            try {
                meterContext = new Context();
                meterSource = meterContext.createMediaStreamSource(stream);
                analyser = meterContext.createAnalyser();
                analyser.fftSize = 128;
                meterSource.connect(analyser);
                await meterContext.resume();
            } catch {
                meterSource?.disconnect();
                await meterContext?.close();
                meterContext = null;
                analyser = null;
            }
        }
    }
    const chunks = [],
        started = Date.now();
    const cleanup = () => {
        clearInterval(timer);
        clearTimeout(limit);
        meterSource?.disconnect();
        if (meterContext && meterContext.state !== 'closed') void meterContext.close();
        stream.getTracks().forEach(track => track.stop());
    };
    let resolve, reject;
    const result = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    result.catch(() => {});
    recorder.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => {
        settled = true;
        cleanup();
        reject(fail('audioFormat'));
    };
    recorder.onstop = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(discarded ? null : new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type }));
    };
    const stop = () => {
        if (recorder.state !== 'inactive') recorder.stop();
        return result;
    };
    try {
        recorder.start();
    } catch (error) {
        cleanup();
        throw error;
    }
    timer = setInterval(() => {
        onTick?.(Math.min(60, Math.floor((Date.now() - started) / 1000)));
        if (analyser) {
            const samples = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(samples);
            const levels = Array.from({ length: 20 }, (_, index) => {
                const from = Math.floor((index * samples.length) / 20),
                    to = Math.floor(((index + 1) * samples.length) / 20);
                let sum = 0;
                for (let i = from; i < to; i++) sum += ((samples[i] - 128) / 128) ** 2;
                return Math.min(1, Math.sqrt(sum / (to - from)));
            });
            onLevel(levels);
        }
    }, 100);
    limit = setTimeout(() => {
        stop();
        onLimit?.();
    }, 60000);
    onTick?.(0);
    return {
        stop,
        cancel() {
            discarded = true;
            stop();
        },
        get mimeType() {
            return recorder.mimeType;
        }
    };
}
function base64(bytes) {
    let result = '';
    for (let i = 0; i < bytes.length; i += 32768) result += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(result);
}
async function hash(value) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}
async function hmac(key, value) {
    const imported = await crypto.subtle.importKey(
        'raw',
        typeof key === 'string' ? encoder.encode(key) : key,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    return crypto.subtle.sign('HMAC', imported, encoder.encode(value));
}
export async function recognitionRequest(wav, { secretId, secretKey, timestamp = Math.floor(Date.now() / 1000) } = {}) {
    if (!secretId || !secretKey) throw fail('AuthFailure.MissingCredentials');
    const bytes =
        wav instanceof ArrayBuffer ? new Uint8Array(wav) : new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength);
    if (bytes.length < 44) throw fail('audioFormat');
    const data = base64(bytes);
    if (data.length > 3 * 1024 * 1024) throw fail('audioSize');
    const body = JSON.stringify({
        EngSerViceType: '16k_zh',
        SourceType: 1,
        VoiceFormat: 'wav',
        Data: data,
        DataLen: bytes.length
    });
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10),
        scope = date + '/asr/tc3_request',
        canonical =
            'POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:asr.tencentcloudapi.com\n\ncontent-type;host\n' +
            (await hash(body));
    const signing = await hmac(await hmac(await hmac('TC3' + secretKey, date), 'asr'), 'tc3_request');
    const signature = [
        ...new Uint8Array(
            await hmac(signing, 'TC3-HMAC-SHA256\n' + timestamp + '\n' + scope + '\n' + (await hash(canonical)))
        )
    ]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
    return {
        url: 'https://asr.tencentcloudapi.com',
        method: 'POST',
        timeout: 90000,
        headers: [
            {
                'Content-Type': 'application/json; charset=utf-8',
                Authorization:
                    'TC3-HMAC-SHA256 Credential=' +
                    secretId +
                    '/' +
                    scope +
                    ', SignedHeaders=content-type;host, Signature=' +
                    signature,
                'X-TC-Action': 'SentenceRecognition',
                'X-TC-Version': '2019-06-14',
                'X-TC-Timestamp': String(timestamp)
            }
        ],
        contentType: 'application/json; charset=utf-8',
        payload: base64(encoder.encode(body)),
        payloadEncoding: 'base64',
        responseEncoding: 'text'
    };
}
export async function transcribeWav(wav, { request, signal, ...credentials }) {
    cancelled(signal);
    const payload = await recognitionRequest(wav, credentials);
    cancelled(signal);
    let response;
    try {
        response = await request('/api/network/forwardProxy', payload, { signal });
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw fail('network');
    }
    cancelled(signal);
    let decoded;
    try {
        decoded = JSON.parse(response.body);
    } catch {
        throw fail('network');
    }
    const result = decoded.Response;
    if (result?.Error) throw fail(result.Error.Code || 'network');
    if (typeof result?.Result !== 'string') throw fail('network');
    return result.Result;
}
export async function transcribeAudio(blob, options) {
    return transcribeWav(await toRecognitionWav(blob, options), options);
}
