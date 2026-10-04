import { errorMessage, request } from '../../services/client';
import type { Campaign } from '../../services/types';

export async function uploadSources(
  campaign: Campaign,
  files: File[],
  language: string,
  uploadBytes: number,
  onProgress: (message: string) => void,
  isCurrent: () => boolean,
  purpose?: string
) {
  let revision = campaign.revision;
  let latestCampaign = campaign;
  const imported: string[] = [];
  for (let index = 0; index < files.length; index++) {
    if (!isCurrent()) break;
    const file = files[index];
    try {
      if (file.size > uploadBytes) throw new Error('File exceeds the configured upload limit.');
      onProgress(`Importing ${index + 1} of ${files.length}: ${file.name}`);
      const body = new FormData();
      body.append('file', file);
      body.append('revision', String(revision));
      body.append('language', language);
      if (purpose) body.append('purpose', purpose);
      const updated = await request<Campaign>(`/campaigns/${campaign.id}/sources/extract`, {
        method: 'POST',
        body,
      });
      revision = updated.revision;
      latestCampaign = updated;
      imported.push(file.name);
    } catch (error) {
      return {
        imported,
        campaign: latestCampaign,
        remaining: files.slice(index),
        error: `${file.name}: ${errorMessage(error)} Import stopped. Earlier imports are saved; review sources before retrying the remaining files.`,
      };
    }
  }
  return { imported, campaign: latestCampaign, remaining: files.slice(imported.length), error: '' };
}
