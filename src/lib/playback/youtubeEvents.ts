export const OPEN_YOUTUBE_MAPPING = 'myblog:open-youtube-mapping'
export interface YouTubeMappingDetail { trackId: string, title: string }
export function openYouTubeMapping(trackId: string, title: string): void {
  window.dispatchEvent(new CustomEvent<YouTubeMappingDetail>(OPEN_YOUTUBE_MAPPING, { detail: { trackId, title } }))
}
