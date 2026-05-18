/**
 * Client-side image compression using Canvas API.
 * Resizes to max 1200px and converts to WebP (JPEG fallback).
 */

const MAX_DIMENSION = 1200;
const QUALITY = 0.8;
const DECODE_TIMEOUT_MS = 30_000;

// AD-299: validate that the file actually decodes to a non-zero-dim image
// before handing it to the upload pipeline. On Windows, pasting a screenshot
// from Snipping Tool can race the clipboard write — `img.onload` fires but
// `naturalWidth` is 0, the canvas renders blank, `toBlob` produces a white
// WebP, and we'd silently upload a blank attachment. `img.decode()` is the
// reliable signal that the bytes are actually paintable; if it rejects (or
// returns zero dimensions), we throw so the caller's catch shows the user
// `Upload failed — try again` instead of a silent blank thumbnail.
async function decodeImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;

    const decoded: Promise<void> = typeof img.decode === 'function'
        ? img.decode()
        : new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Image failed to load'));
        });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Image decode timed out')), DECODE_TIMEOUT_MS);
    });

    try {
        await Promise.race([decoded, timeout]);
    } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
    } finally {
        if (timer) clearTimeout(timer);
    }

    if (!img.naturalWidth || !img.naturalHeight) {
        URL.revokeObjectURL(url);
        throw new Error('Image decoded to zero dimensions (likely a clipboard race; re-paste to retry)');
    }

    return { img, url };
}

export async function compressImage(file: File): Promise<File> {
    // Even when we skip compression for small files, validate that the bytes
    // actually decode to a real image. A 60KB blank placeholder from a racey
    // Windows clipboard would otherwise sail through.
    const { img, url } = await decodeImage(file);

    if (file.size < 100 * 1024) {
        URL.revokeObjectURL(url);
        return file;
    }

    let { naturalWidth: width, naturalHeight: height } = img;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        URL.revokeObjectURL(url);
        return file;
    }

    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);

    return new Promise<File>((resolve) => {
        canvas.toBlob(
            (blob) => {
                if (blob && blob.size < file.size) {
                    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
                    const name = file.name.replace(/\.[^.]+$/, `.${ext}`);
                    resolve(new File([blob], name, { type: blob.type }));
                    return;
                }
                canvas.toBlob(
                    (jpegBlob) => {
                        if (jpegBlob && jpegBlob.size < file.size) {
                            const name = file.name.replace(/\.[^.]+$/, '.jpg');
                            resolve(new File([jpegBlob], name, { type: 'image/jpeg' }));
                        } else {
                            resolve(file);
                        }
                    },
                    'image/jpeg',
                    QUALITY
                );
            },
            'image/webp',
            QUALITY
        );
    });
}
