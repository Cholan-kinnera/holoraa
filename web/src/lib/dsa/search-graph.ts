/**
 * High-performance, client-side Search & Social Graph engine for Holoraa.
 *
 * Implements:
 * 1. Prefix Trie: Sub-millisecond prefix typeahead for usernames, handles, and vibes.
 * 2. Trigram Fuzzy Matcher: Jaccard set similarity over character 3-grams for typo tolerance.
 * 3. 2-Hop BFS Mutual Graph: Traversal over directed social adjacency lists for mutual connections.
 * 4. Calm Gravity Ranking: Recency and social density decay model with zero engagement bait.
 */

export interface DirectoryUser {
  id: string;
  name: string;
  handle: string;
  bio: string;
  note?: string;
  avatar: string;
  followersCount: number;
  online: boolean;
  vibes: string[];
}

export interface ThoughtRecord {
  id: string;
  authorId: string;
  mood: string;
  timeLabel: string;
  hoursAgo: number;
  text: string;
  photo?: string | null;
  likes: number;
  likedByMe: boolean;
  replies: number;
}

export interface MutualConnectionMatch {
  user: DirectoryUser;
  mutuals: DirectoryUser[];
  score: number;
}

export interface OrbitRecommendation {
  user: DirectoryUser;
  mutuals: DirectoryUser[];
  isFollowing: boolean;
}

// ---------------------------------------------------------------------------
// 1. PREFIX TRIE
// ---------------------------------------------------------------------------

export class PrefixTrieNode {
  children: Map<string, PrefixTrieNode>;
  items: Set<string>;

  constructor() {
    this.children = new Map();
    this.items = new Set();
  }
}

/**
 * Prefix Trie index for rapid sub-millisecond keyword lookup.
 * Space Complexity: O(N * L) where N is token count and L is average length.
 * Lookup Complexity: O(K) where K is query length.
 */
export class SearchPrefixTrie {
  root: PrefixTrieNode;

  constructor() {
    this.root = new PrefixTrieNode();
  }

  insert(token: string, refId: string): void {
    const clean = token.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!clean || !refId) return;

    let current = this.root;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      let next = current.children.get(ch);
      if (!next) {
        next = new PrefixTrieNode();
        current.children.set(ch, next);
      }
      current = next;
      current.items.add(refId);
    }
  }

  searchPrefix(prefix: string): Set<string> {
    const clean = prefix.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!clean) return new Set();

    let current = this.root;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      const next = current.children.get(ch);
      if (!next) {
        return new Set();
      }
      current = next;
    }
    return new Set(current.items);
  }
}

/**
 * Populates a SearchPrefixTrie from a user directory.
 */
export function buildUserSearchTrie(directory: Record<string, DirectoryUser>): SearchPrefixTrie {
  const trie = new SearchPrefixTrie();
  for (const user of Object.values(directory)) {
    if (!user || !user.id) continue;
    // Index name tokens
    const words = user.name.split(/\s+/);
    for (const word of words) {
      trie.insert(word, user.id);
    }
    // Index handle without leading '@'
    trie.insert(user.handle.replace(/^@/, ''), user.id);
    // Index vibes
    if (Array.isArray(user.vibes)) {
      for (const vibe of user.vibes) {
        const vibeWords = vibe.split(/\s+/);
        for (const vw of vibeWords) {
          trie.insert(vw, user.id);
        }
      }
    }
  }
  return trie;
}

// ---------------------------------------------------------------------------
// 2. TRIGRAM FUZZY MATCHER
// ---------------------------------------------------------------------------

/**
 * Extracts padded character 3-grams from a string.
 */
export function trigramsOf(input: string): Set<string> {
  const s = '  ' + (input || '').toLowerCase().trim() + ' ';
  const set = new Set<string>();
  if (s.length < 3) return set;
  for (let i = 0; i < s.length - 2; i++) {
    set.add(s.slice(i, i + 3));
  }
  return set;
}

/**
 * Computes Jaccard index over character trigrams: |A ∩ B| / |A ∪ B|.
 * Range: [0.0, 1.0].
 */
export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a.toLowerCase() === b.toLowerCase()) return 1.0;

  const setA = trigramsOf(a);
  const setB = trigramsOf(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const tri of setA) {
    if (setB.has(tri)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// 3. SOCIAL GRAPH & 2-HOP BFS MUTUAL CONNECTIONS
// ---------------------------------------------------------------------------

/**
 * Computes mutual connections between current user and a target user.
 * Finds all X such that (currentUser follows X) AND (X follows targetUser).
 */
export function getMutualFollowers(
  currentUserId: string,
  targetUserId: string,
  socialGraph: Record<string, Set<string>>,
  directory: Record<string, DirectoryUser>
): DirectoryUser[] {
  if (!currentUserId || !targetUserId || currentUserId === targetUserId) {
    return [];
  }
  const myFollowing = socialGraph[currentUserId];
  if (!myFollowing || myFollowing.size === 0) {
    return [];
  }

  const mutuals: DirectoryUser[] = [];
  for (const friendId of myFollowing) {
    if (friendId === targetUserId) continue;
    const friendFollowing = socialGraph[friendId];
    if (friendFollowing && friendFollowing.has(targetUserId)) {
      const user = directory[friendId];
      if (user) {
        mutuals.push(user);
      }
    }
  }
  return mutuals;
}

/**
 * Computes 2-hop orbit recommendations sorted by mutual connection density.
 */
export function computeOrbitRecommendations(
  currentUserId: string,
  socialGraph: Record<string, Set<string>>,
  directory: Record<string, DirectoryUser>,
  limit: number = 5
): OrbitRecommendation[] {
  const myFollowing = socialGraph[currentUserId] || new Set<string>();
  const candidates: OrbitRecommendation[] = [];

  for (const user of Object.values(directory)) {
    if (!user || user.id === currentUserId) continue;

    const isFollowing = myFollowing.has(user.id);
    const mutuals = getMutualFollowers(currentUserId, user.id, socialGraph, directory);

    candidates.push({
      user,
      mutuals,
      isFollowing,
    });
  }

  // Rank: Unfollowed people with highest mutuals first, then followed people
  candidates.sort((a, b) => {
    if (a.isFollowing !== b.isFollowing) {
      return a.isFollowing ? 1 : -1;
    }
    return b.mutuals.length - a.mutuals.length;
  });

  return candidates.slice(0, Math.max(1, limit));
}

// ---------------------------------------------------------------------------
// 4. UNIFIED SEARCH & RANKING
// ---------------------------------------------------------------------------

/**
 * Hybrid search across Prefix Trie, Trigram fuzzy match, and Mutual Graph.
 */
export function searchPeople(
  query: string,
  directory: Record<string, DirectoryUser>,
  trie: SearchPrefixTrie,
  currentUserId: string,
  socialGraph: Record<string, Set<string>>
): MutualConnectionMatch[] {
  const q = (query || '').trim().toLowerCase();

  if (!q) {
    return Object.values(directory)
      .filter((u) => u && u.id !== currentUserId)
      .map((u) => {
        const mutuals = getMutualFollowers(currentUserId, u.id, socialGraph, directory);
        return { user: u, mutuals, score: mutuals.length };
      })
      .sort((a, b) => b.score - a.score);
  }

  const prefixMatches = trie.searchPrefix(q);
  const results: MutualConnectionMatch[] = [];

  for (const user of Object.values(directory)) {
    if (!user || user.id === currentUserId) continue;

    const isPrefix = prefixMatches.has(user.id);
    const nameSim = trigramSimilarity(q, user.name);
    const handleSim = trigramSimilarity(q, user.handle);
    const bioMatch =
      user.bio.toLowerCase().includes(q) ||
      (Array.isArray(user.vibes) && user.vibes.some((v) => v.toLowerCase().includes(q)));
    const mutuals = getMutualFollowers(currentUserId, user.id, socialGraph, directory);

    if (isPrefix || nameSim > 0.22 || handleSim > 0.25 || bioMatch) {
      const score =
        (isPrefix ? 10 : 0) +
        Math.max(nameSim, handleSim) * 5 +
        (bioMatch ? 3 : 0) +
        mutuals.length * 0.5;
      results.push({ user, mutuals, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Ranks thoughts by Calm Gravity Score: (likes + 1.5*replies + 4*mutualBoost) / (hoursAgo + 1.5)^1.6
 */
export function rankThoughts(
  thoughts: ThoughtRecord[],
  currentUserId: string,
  socialGraph: Record<string, Set<string>>,
  filter: 'foryou' | 'following' | 'media' = 'foryou'
): ThoughtRecord[] {
  const myFollowing = socialGraph[currentUserId] || new Set<string>();

  const filtered = thoughts.filter((t) => {
    if (filter === 'following') {
      return t.authorId === currentUserId || myFollowing.has(t.authorId);
    }
    if (filter === 'media') {
      return Boolean(t.photo);
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    const boostA = myFollowing.has(a.authorId) ? 3 : 1;
    const boostB = myFollowing.has(b.authorId) ? 3 : 1;
    const scoreA =
      (a.likes + a.replies * 1.5 + boostA * 4) / Math.pow(Math.max(0.01, a.hoursAgo) + 1.5, 1.6);
    const scoreB =
      (b.likes + b.replies * 1.5 + boostB * 4) / Math.pow(Math.max(0.01, b.hoursAgo) + 1.5, 1.6);
    return scoreB - scoreA;
  });
}
