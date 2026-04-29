/**
 * Client-side image compression using Canvas API.
 * Resizes to max 1200px and converts to WebP (JPEG fallback).
 */

const MAX_DIMENSION = 1200;
const QUALITY = 0.8;

export async function compressImage(file: File): Promise<File> {
    // Skip compression for small images
    if (file.size < 100 * 1024) return file;

    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            let { width, height } = img;

            // Scale down if needed
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
                resolve(file); // fallback to original
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);

            // Try WebP first, fallback to JPEG
            canvas.toBlob(
                (blob) => {
                    if (blob && blob.size < file.size) {
                        const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
                        const name = file.name.replace(/\.[^.]+$/, `.${ext}`);
                        resolve(new File([blob], name, { type: blob.type }));
                    } else {
                        // WebP not supported or bigger — try JPEG
                        canvas.toBlob(
                            (jpegBlob) => {
                                if (jpegBlob && jpegBlob.size < file.size) {
                                    const name = file.name.replace(/\.[^.]+$/, '.jpg');
                                    resolve(new File([jpegBlob], name, { type: 'image/jpeg' }));
                                } else {
                                    resolve(file); // original is smaller
                                }
                            },
                            'image/jpeg',
                            QUALITY
                        );
                    }
                },
                'image/webp',
                QUALITY
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image for compression'));
        };

        img.src = url;
    });
}
