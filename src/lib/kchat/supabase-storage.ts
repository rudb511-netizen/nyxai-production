import { supabase } from '@/lib/supabase';

/**
 * Supabase Storage media upload handler replacing local filesystem storage.
 * Preserves image, voice note, sticker, and video uploads.
 */
export async function uploadMediaToSupabase(file: File | Blob, bucket: string = 'media', path?: string): Promise<string> {
  const fileName = path || `${Date.now()}-${Math.random().toString(36.substring(2, 9))}`;
  const { data, error } = await supabase.storage.from(bucket).upload(fileName, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return publicUrlData.publicUrl;
}
