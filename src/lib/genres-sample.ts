/**
 * Hardcoded seed data for the /genres ontology sample page.
 *
 * This is a spike: no backend, no persistence. The shape mirrors the planned
 * `genres` / `genre_relations` tables (slug as the stable key, three relation
 * types matching the MusicBrainz genre-genre set) so a later API swap is
 * mechanical. Positions are hand-placed, Musicmap-style: y grows with era.
 */

export type RelationType = 'subgenre_of' | 'influenced_by' | 'fusion_of'

export interface GenreSeed {
  slug: string
  nameKo: string
  nameEn: string
  eraStart: string
  shortDesc: string
  history: string
  x: number
  y: number
}

export interface GenreRelationSeed {
  /** lineage flow: the older/parent genre */
  source: string
  /** the newer/derived genre */
  target: string
  type: RelationType
}

export const GENRES: GenreSeed[] = [
  {
    slug: 'trot',
    nameKo: '트로트',
    nameEn: 'Trot',
    eraStart: '1930s',
    shortDesc: '정형화된 반복 리듬과 꺾기 창법이 특징인 한국 대중가요의 가장 오래된 형식.',
    history: '일제강점기 엔카와 서양 폭스트로트의 영향 속에서 형성됐다. 시대에 따라 부침을 겪었지만 2000년대 이후 세대를 넘는 리바이벌을 거치며 현재까지 살아 있는 장르로 남아 있다.',
    x: 560,
    y: 0,
  },
  {
    slug: 'soul',
    nameKo: '솔',
    nameEn: 'Soul',
    eraStart: '1950s',
    shortDesc: '가스펠의 창법과 R&B의 세속적 정서가 결합한 미국 흑인 음악.',
    history: '1950년대 후반 가스펠 보컬 전통이 세속 음악으로 넘어오며 형성됐다. 이후 펑크, 컨템퍼러리 R&B, 힙합에 이르는 흑인 대중음악 계보 전체의 뿌리가 됐다.',
    x: 40,
    y: 110,
  },
  {
    slug: 'pop',
    nameKo: '팝',
    nameEn: 'Pop',
    eraStart: '1950s',
    shortDesc: '대중적 호소력과 후렴 중심 구조를 우선하는 주류 대중음악.',
    history: '로큰롤 이후의 주류 상업 음악을 폭넓게 가리키는 우산 장르. 시대마다 지배적인 사운드를 흡수하며 형태를 바꿔 왔고, 다른 장르와의 융합이 가장 활발하다.',
    x: 560,
    y: 130,
  },
  {
    slug: 'rock',
    nameKo: '록',
    nameEn: 'Rock',
    eraStart: '1950s',
    shortDesc: '일렉트릭 기타와 밴드 편성을 중심으로 한 백비트 기반 음악.',
    history: '로큰롤에서 출발해 1960~70년대 하위장르 폭발을 거치며 대중음악의 한 축이 됐다. 인디 록을 포함한 수많은 분화의 출발점이다.',
    x: 1060,
    y: 110,
  },
  {
    slug: 'funk',
    nameKo: '펑크',
    nameEn: 'Funk',
    eraStart: '1960s',
    shortDesc: '리듬 그루브를 곡의 중심에 두는 댄서블한 흑인 음악.',
    history: '1960년대 솔에서 리듬 중심성을 극단화하며 갈라져 나왔다. 베이스라인과 신코페이션의 어휘는 디스코, 하우스, 힙합 샘플링의 원천이 됐다.',
    x: 160,
    y: 210,
  },
  {
    slug: 'hip-hop',
    nameKo: '힙합',
    nameEn: 'Hip Hop',
    eraStart: '1970s',
    shortDesc: '랩과 비트메이킹을 두 축으로 하는 음악이자 문화.',
    history: '1970년대 뉴욕 브롱크스의 블록 파티에서 출발했다. 펑크·솔 레코드의 브레이크를 잘라 쓰던 디제잉 기법이 샘플링 기반 프로덕션으로 발전하며 독립된 장르가 됐다.',
    x: 310,
    y: 290,
  },
  {
    slug: 'electronic',
    nameKo: '일렉트로닉',
    nameEn: 'Electronic',
    eraStart: '1970s',
    shortDesc: '신시사이저와 시퀀서 등 전자 악기를 1차 음원으로 쓰는 음악군.',
    history: '신시사이저의 보급과 함께 1970년대 본격화됐다. 클럽 문화와 결합한 댄스 계열과 실험적 계열로 폭넓게 분화하며 현대 프로덕션 전반의 기본기가 됐다.',
    x: 840,
    y: 280,
  },
  {
    slug: 'city-pop',
    nameKo: '시티팝',
    nameEn: 'City Pop',
    eraStart: '1970s',
    shortDesc: '도시적 세련미를 내세운 일본발 팝 — 펑크·솔의 그루브를 흡수했다.',
    history: '1970~80년대 일본 버블 경제기의 도시 정서를 담아 유행했다. 2010년대 유튜브 알고리즘과 시티팝 리바이벌을 타고 한국 인디·R&B 신에도 뚜렷한 흔적을 남겼다.',
    x: 450,
    y: 330,
  },
  {
    slug: 'synth-pop',
    nameKo: '신스팝',
    nameEn: 'Synth-pop',
    eraStart: '1970s',
    shortDesc: '신시사이저 사운드를 전면에 세운 팝 — 팝과 일렉트로닉의 융합.',
    history: '1970년대 말 신시사이저가 밴드 악기를 대체하며 등장했다. 1980년대 주류를 장악했고, 이후 K-팝 프로덕션을 포함한 댄스 팝 전반의 기본 어휘로 흡수됐다.',
    x: 680,
    y: 360,
  },
  {
    slug: 'contemporary-rnb',
    nameKo: '컨템퍼러리 R&B',
    nameEn: 'Contemporary R&B',
    eraStart: '1980s',
    shortDesc: '솔의 보컬 전통을 현대적 프로덕션 위에 올린 R&B의 현재형.',
    history: '1980년대 드럼머신과 신시사이저가 솔·펑크의 어휘와 만나며 형성됐다. 이후 힙합 프로덕션과의 결합을 거듭하며 미국 대중음악의 중심 장르로 유지되고 있다.',
    x: 40,
    y: 400,
  },
  {
    slug: 'boom-bap',
    nameKo: '붐뱁',
    nameEn: 'Boom Bap',
    eraStart: '1980s',
    shortDesc: '묵직한 킥-스네어 루프와 샘플링 중심의 힙합 고전 문법.',
    history: '1980년대 말~90년대 뉴욕에서 정점에 달한 프로덕션 양식이다. 트랩 이후에도 리리시즘 중심 힙합의 기준점으로 소환된다.',
    x: 230,
    y: 470,
  },
  {
    slug: 'house',
    nameKo: '하우스',
    nameEn: 'House',
    eraStart: '1980s',
    shortDesc: '4/4 킥이 일정하게 깔리는 클럽 지향 댄스 음악.',
    history: '1980년대 시카고의 클럽에서 디스코의 유산 위에 드럼머신을 얹으며 탄생했다. 일렉트로닉 댄스 뮤직 계보의 사실상 표준이 됐다.',
    x: 900,
    y: 430,
  },
  {
    slug: 'indie-rock',
    nameKo: '인디 록',
    nameEn: 'Indie Rock',
    eraStart: '1980s',
    shortDesc: '메이저 시스템 바깥의 자립적 제작 방식과 미학을 가리키는 록의 분파.',
    history: '1980년대 영미 인디 레이블 신에서 형성됐다. 사운드보다 태도와 유통 방식에서 출발한 이름이지만, 점차 고유한 미학적 계보를 갖춘 장르로 굳어졌다.',
    x: 1060,
    y: 430,
  },
  {
    slug: 'k-ballad',
    nameKo: 'K-발라드',
    nameEn: 'K-Ballad',
    eraStart: '1980s',
    shortDesc: '서정적 멜로디와 절정부 고음을 중심에 둔 한국식 발라드.',
    history: '1980년대 팝과 솔 보컬의 영향 아래 한국 가요의 중심 양식으로 자리잡았다. 차트 환경이 어떻게 바뀌어도 꾸준히 살아남는, 한국 대중음악의 기본값에 가까운 장르다.',
    x: 540,
    y: 470,
  },
  {
    slug: 'k-pop',
    nameKo: '케이팝',
    nameEn: 'K-Pop',
    eraStart: '1990s',
    shortDesc: '팝·힙합·일렉트로닉을 융합한 한국의 아이돌 중심 산업형 팝.',
    history: '1990년대 초 랩 댄스의 충격에서 출발해 기획사 트레이닝 시스템과 함께 고유한 형식으로 진화했다. 여러 장르를 한 곡 안에 편집해 넣는 융합적 프로덕션이 정체성의 핵심이다.',
    x: 700,
    y: 540,
  },
  {
    slug: 'k-hip-hop',
    nameKo: '한국 힙합',
    nameEn: 'K-Hip Hop',
    eraStart: '1990s',
    shortDesc: '한국어 라이밍의 어휘를 구축해 온 한국의 힙합 신.',
    history: '1990년대 PC통신 동호회와 언더그라운드 클럽에서 출발했다. 한국어 플로우의 가능성을 실험해 온 역사이며, 2010년대 이후 주류 차트의 한 축이 됐다.',
    x: 330,
    y: 560,
  },
  {
    slug: 'neo-soul',
    nameKo: '네오 솔',
    nameEn: 'Neo-Soul',
    eraStart: '1990s',
    shortDesc: '고전 솔의 질감을 힙합 시대의 감각으로 되살린 R&B의 분파.',
    history: '1990년대 중반 클래식 솔·펑크의 유산을 힙합 그루브 위에 복원하며 등장했다. 라이브 연주와 재즈 화성의 결이 특징으로, 이후 얼터너티브 R&B의 토양이 됐다.',
    x: 90,
    y: 560,
  },
  {
    slug: 'k-indie',
    nameKo: '한국 인디',
    nameEn: 'K-Indie',
    eraStart: '1990s',
    shortDesc: '홍대 신을 모태로 한 한국의 독립 음악 계보.',
    history: '1990년대 중반 홍대 앞 라이브 클럽 신에서 형성됐다. 록 기반에서 출발했지만 포크, 일렉트로닉, R&B까지 포괄하는 느슨한 우산으로 확장됐다.',
    x: 1060,
    y: 560,
  },
  {
    slug: 'trap',
    nameKo: '트랩',
    nameEn: 'Trap',
    eraStart: '2000s',
    shortDesc: '808 베이스와 잘게 쪼갠 하이햇이 특징인 힙합의 지배적 현재형.',
    history: '2000년대 미국 남부에서 형성돼 2010년대 전 세계 힙합 프로덕션의 표준이 됐다. 한국 힙합과 케이팝 프로덕션에도 가장 큰 영향을 준 동시대 문법이다.',
    x: 230,
    y: 640,
  },
  {
    slug: 'k-rnb',
    nameKo: 'K-R&B',
    nameEn: 'K-R&B',
    eraStart: '2010s',
    shortDesc: '한국 힙합 신과 함께 성장한 한국의 컨템퍼러리 R&B.',
    history: '2010년대 사운드클라우드 세대와 힙합 레이블의 토양 위에서 독자적 신으로 성장했다. 얼터너티브 R&B의 동시대 감각과 한국어 가사의 정서를 결합한 것이 특징이다.',
    x: 40,
    y: 730,
  },
]

/** era choices for the add/edit form, oldest first */
export const ERA_OPTIONS = ['1930s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']

export const RELATIONS: GenreRelationSeed[] = [
  // subgenre_of — parent → child, child is a form of the parent (RYM rule)
  { source: 'soul', target: 'funk', type: 'subgenre_of' },
  { source: 'contemporary-rnb', target: 'neo-soul', type: 'subgenre_of' },
  { source: 'contemporary-rnb', target: 'k-rnb', type: 'subgenre_of' },
  { source: 'hip-hop', target: 'boom-bap', type: 'subgenre_of' },
  { source: 'hip-hop', target: 'trap', type: 'subgenre_of' },
  { source: 'hip-hop', target: 'k-hip-hop', type: 'subgenre_of' },
  { source: 'pop', target: 'city-pop', type: 'subgenre_of' },
  { source: 'electronic', target: 'house', type: 'subgenre_of' },
  { source: 'rock', target: 'indie-rock', type: 'subgenre_of' },
  { source: 'indie-rock', target: 'k-indie', type: 'subgenre_of' },

  // influenced_by — source left a mark on target without containing it
  { source: 'soul', target: 'hip-hop', type: 'influenced_by' },
  { source: 'funk', target: 'hip-hop', type: 'influenced_by' },
  { source: 'soul', target: 'contemporary-rnb', type: 'influenced_by' },
  { source: 'funk', target: 'contemporary-rnb', type: 'influenced_by' },
  { source: 'funk', target: 'city-pop', type: 'influenced_by' },
  { source: 'soul', target: 'city-pop', type: 'influenced_by' },
  { source: 'funk', target: 'house', type: 'influenced_by' },
  { source: 'soul', target: 'k-ballad', type: 'influenced_by' },
  { source: 'pop', target: 'k-ballad', type: 'influenced_by' },
  { source: 'hip-hop', target: 'neo-soul', type: 'influenced_by' },
  { source: 'k-hip-hop', target: 'k-rnb', type: 'influenced_by' },
  { source: 'electronic', target: 'trap', type: 'influenced_by' },
  { source: 'city-pop', target: 'k-indie', type: 'influenced_by' },

  // fusion_of — target originated as a hybrid of 2+ sources
  { source: 'pop', target: 'synth-pop', type: 'fusion_of' },
  { source: 'electronic', target: 'synth-pop', type: 'fusion_of' },
  { source: 'pop', target: 'k-pop', type: 'fusion_of' },
  { source: 'hip-hop', target: 'k-pop', type: 'fusion_of' },
  { source: 'electronic', target: 'k-pop', type: 'fusion_of' },
]

export const RELATION_LABEL: Record<RelationType, string> = {
  subgenre_of: '하위장르',
  influenced_by: '영향',
  fusion_of: '융합',
}
