import type { BoardBucket } from '@lib/buckets'
import { isManualAddTarget, PLAYBACK_TYPE } from '@lib/buckets'

interface ExternalAlbumDropOps {
  addAlbum: (bucketId: string, albumId: string) => Promise<{ conflict: boolean }>
  expandArtists: (bucketId: string, source: { albumId: string }) => Promise<{ added: unknown[] }>
  expandTracks: (bucketId: string, albumId: string) => Promise<unknown[]>
}

/** Domain routing for a Home/Pocket external album copy, kept pure for parity tests. */
export async function completeExternalAlbumDrop(
  target: BoardBucket,
  albumId: string,
  title: string,
  ops: ExternalAlbumDropOps,
): Promise<string | null> {
  if (!isManualAddTarget(target))
    return null
  if (target.type === PLAYBACK_TYPE) {
    const added = await ops.expandTracks(target.id, albumId)
    return added.length > 0 ? `${title} · 트랙 ${added.length}개를 재생 대기열에 추가했어요` : '이 앨범은 아직 트랙 정보가 없어요'
  }
  if (target.type === 'artist') {
    const out = await ops.expandArtists(target.id, { albumId })
    return out.added.length > 0 ? `${title} · 아티스트 ${out.added.length}명 담음` : '담을 새 아티스트가 없어요'
  }
  const out = await ops.addAlbum(target.id, albumId)
  return out.conflict ? '이미 담겨 있어요' : `${title} 담음`
}
