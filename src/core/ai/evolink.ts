/**
 * Evolink (api.evolink.ai) — one key for GPT Image 2 and Seedance 2.0.
 *
 * Every generation is an async task: POST returns a task id, then
 * GET /v1/tasks/{id} reports `pending | processing | completed | failed` with
 * result URLs in `results`. Inputs must be public URLs, so local photos go
 * through the files API first (files expire after 72 h; generated media
 * links after 24 h — copy anything worth keeping).
 *
 * Docs: https://evolink.ai/docs/en/api-manual/video-series/seedance2.0/seedance-2.0-image-to-video
 */

export type EvolinkTaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export type EvolinkTask = {
  id: string;
  status: EvolinkTaskStatus;
  progress?: number;
  results?: string[];
  error?: { code?: string; message?: string };
  usage?: { cost?: { usd?: number }; credits_used?: number };
};

export type EvolinkImageRequest = {
  prompt: string;
  imageUrls?: string[];
  /** Ratio ("9:16") or explicit pixels ("720x1280", multiples of 16). */
  size?: string;
  quality?: 'low' | 'medium' | 'high';
};

export type EvolinkVideoRequest = {
  model: string;
  prompt: string;
  imageUrls: string[];
  duration: number;
  quality: string;
  aspectRatio?: string;
  generateAudio?: boolean;
};

const DEFAULT_BASE_URL = 'https://api.evolink.ai';
const FILES_BASE_URL = 'https://files-api.evolink.ai';

export class EvolinkProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor({ apiKey, baseUrl }: { apiKey: string; baseUrl?: string }) {
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private async request(url: string, init?: RequestInit) {
    const resp = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // Same wording as the fal client, so callers can tell 429/5xx
      // (retry next poll) from a real rejection.
      const detail = data?.error?.message || data?.msg || '';
      throw new Error(
        `request failed with status: ${resp.status}${detail ? ` ${detail}` : ''}`
      );
    }
    return data;
  }

  /** Upload a data URL (or bare base64) and return its public URL. */
  async uploadBase64(base64Data: string, fileName?: string) {
    const data = await this.request(
      `${FILES_BASE_URL}/api/v1/files/upload/base64`,
      {
        method: 'POST',
        body: JSON.stringify({
          base64_data: base64Data,
          upload_path: 'zombie',
          ...(fileName ? { file_name: fileName } : {}),
        }),
      }
    );
    const url = data?.data?.file_url;
    if (!data?.success || !url) {
      throw new Error(data?.msg || 'Evolink file upload failed');
    }
    return url as string;
  }

  /** Data URLs are uploaded; http(s) URLs pass through untouched. */
  async toPublicUrl(image: string) {
    return image.startsWith('data:') ? this.uploadBase64(image) : image;
  }

  async createImage(req: EvolinkImageRequest) {
    const data = await this.request(`${this.baseUrl}/v1/images/generations`, {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: req.prompt,
        ...(req.imageUrls?.length ? { image_urls: req.imageUrls } : {}),
        ...(req.size ? { size: req.size } : {}),
        ...(req.quality ? { quality: req.quality } : {}),
        n: 1,
        output_format: 'jpeg',
      }),
    });
    if (!data?.id) throw new Error('Evolink returned no task id');
    return data.id as string;
  }

  async createVideo(req: EvolinkVideoRequest) {
    const data = await this.request(`${this.baseUrl}/v1/videos/generations`, {
      method: 'POST',
      body: JSON.stringify({
        model: req.model,
        prompt: req.prompt,
        image_urls: req.imageUrls,
        duration: req.duration,
        quality: req.quality,
        aspect_ratio: req.aspectRatio ?? 'adaptive',
        generate_audio: req.generateAudio ?? true,
      }),
    });
    if (!data?.id) throw new Error('Evolink returned no task id');
    return data.id as string;
  }

  async getTask(taskId: string): Promise<EvolinkTask> {
    return this.request(
      `${this.baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`
    );
  }
}

/** Provider from admin settings, or null while the key is empty. */
export function evolinkFromConfigs(configs: Record<string, string>) {
  if (!configs.evolink_api_key) return null;
  return new EvolinkProvider({
    apiKey: configs.evolink_api_key,
    baseUrl: configs.evolink_base_url,
  });
}
