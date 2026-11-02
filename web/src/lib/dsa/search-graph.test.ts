import { describe, expect, it } from 'vitest';
import {
  buildUserSearchTrie,
  computeOrbitRecommendations,
  getMutualFollowers,
  rankThoughts,
  searchPeople,
  SearchPrefixTrie,
  trigramsOf,
  trigramSimilarity,
  type DirectoryUser,
  type ThoughtRecord,
} from './search-graph';

describe('SearchPrefixTrie', () => {
  it('inserts tokens and returns matching items', () => {
    const trie = new SearchPrefixTrie();
    trie.insert('aanya', 'u1');
    trie.insert('aaron', 'u2');
    trie.insert('coffee', 'u1');

    expect(Array.from(trie.searchPrefix('aa'))).toEqual(expect.arrayContaining(['u1', 'u2']));
    expect(Array.from(trie.searchPrefix('cof'))).toEqual(['u1']);
    expect(Array.from(trie.searchPrefix('nonexistent'))).toEqual([]);
    expect(Array.from(trie.searchPrefix(''))).toEqual([]);
  });

  it('handles case-insensitivity and special characters', () => {
    const trie = new SearchPrefixTrie();
    trie.insert('@Aanya_Sharma', 'u1');

    expect(Array.from(trie.searchPrefix('aanya'))).toEqual(['u1']);
    expect(Array.from(trie.searchPrefix('AANYA'))).toEqual(['u1']);
  });
});

describe('Trigram Fuzzy Matcher', () => {
  it('extracts trigrams properly', () => {
    const trigrams = trigramsOf('cat');
    // "  cat " -> ["  c", " ca", "cat", "at "]
    expect(trigrams.size).toBe(4);
    expect(trigrams.has('cat')).toBe(true);
  });

  it('computes 1.0 for identical strings', () => {
    expect(trigramSimilarity('aanya', 'aanya')).toBe(1.0);
    expect(trigramSimilarity('Aanya', 'aanya')).toBe(1.0);
  });

  it('computes positive similarity for single-character typos', () => {
    const sim = trigramSimilarity('aanya', 'anya');
    expect(sim).toBeGreaterThan(0.3);
  });

  it('returns 0 for empty or completely distinct strings', () => {
    expect(trigramSimilarity('', 'test')).toBe(0);
    expect(trigramSimilarity('xyz', 'abc')).toBe(0);
  });
});

describe('2-Hop BFS Mutual Connections & Orbit', () => {
  const directory: Record<string, DirectoryUser> = {
    arjun: {
      id: 'arjun',
      name: 'Arjun Mehta',
      handle: '@arjun',
      bio: 'Building calm software',
      avatar: '/avatar1.jpg',
      followersCount: 10,
      online: true,
      vibes: ['building'],
    },
    aanya: {
      id: 'aanya',
      name: 'Aanya Sharma',
      handle: '@aanya',
      bio: 'Design and coffee',
      avatar: '/avatar2.jpg',
      followersCount: 20,
      online: true,
      vibes: ['coffee'],
    },
    rohan: {
      id: 'rohan',
      name: 'Rohan Verma',
      handle: '@rohan',
      bio: 'Modular synths',
      avatar: '/avatar3.jpg',
      followersCount: 15,
      online: false,
      vibes: ['synth'],
    },
    meera: {
      id: 'meera',
      name: 'Meera Nair',
      handle: '@meera',
      bio: 'Film photography',
      avatar: '/avatar4.jpg',
      followersCount: 30,
      online: true,
      vibes: ['film'],
    },
  };

  const socialGraph: Record<string, Set<string>> = {
    arjun: new Set(['aanya', 'rohan']),
    aanya: new Set(['arjun', 'meera']), // aanya follows meera -> meera is in arjun's 2-hop orbit via aanya
    rohan: new Set(['arjun', 'meera']), // rohan also follows meera
    meera: new Set(['aanya']),
  };

  it('identifies mutual connections correctly', () => {
    const mutuals = getMutualFollowers('arjun', 'meera', socialGraph, directory);
    const mutualIds = mutuals.map((u) => u.id);
    expect(mutualIds).toEqual(expect.arrayContaining(['aanya', 'rohan']));
    expect(mutuals.length).toBe(2);
  });

  it('handles isolated users and cycles gracefully', () => {
    // Cycle: arjun -> aanya -> arjun
    const mutualsSelf = getMutualFollowers('arjun', 'arjun', socialGraph, directory);
    expect(mutualsSelf).toEqual([]);

    // Missing user
    const mutualsMissing = getMutualFollowers('arjun', 'unknown_user', socialGraph, directory);
    expect(mutualsMissing).toEqual([]);
  });

  it('ranks orbit recommendations by mutual connection count', () => {
    const orbit = computeOrbitRecommendations('arjun', socialGraph, directory);
    // meera has 2 mutuals (aanya, rohan) and is not followed by arjun -> should be first candidate
    expect(orbit[0].user.id).toBe('meera');
    expect(orbit[0].mutuals.length).toBe(2);
    expect(orbit[0].isFollowing).toBe(false);
  });
});

describe('Search & Ranking', () => {
  const directory: Record<string, DirectoryUser> = {
    u1: {
      id: 'u1',
      name: 'Aanya Sharma',
      handle: '@aanya',
      bio: 'Analog photography and coastal coffee',
      avatar: '/a1.jpg',
      followersCount: 50,
      online: true,
      vibes: ['film', 'coffee'],
    },
    u2: {
      id: 'u2',
      name: 'Kabir Menon',
      handle: '@kabir',
      bio: 'Late night synths',
      avatar: '/a2.jpg',
      followersCount: 40,
      online: false,
      vibes: ['synth', 'late night'],
    },
  };

  const graph: Record<string, Set<string>> = {
    me: new Set(['u1']),
    u1: new Set(['me', 'u2']),
    u2: new Set(['u1']),
  };

  it('searches by name, handle, and vibe keywords', () => {
    const trie = buildUserSearchTrie(directory);

    const matchName = searchPeople('aanya', directory, trie, 'me', graph);
    expect(matchName.length).toBeGreaterThan(0);
    expect(matchName[0].user.id).toBe('u1');

    const matchVibe = searchPeople('synth', directory, trie, 'me', graph);
    expect(matchVibe.length).toBeGreaterThan(0);
    expect(matchVibe[0].user.id).toBe('u2');
  });

  it('ranks thoughts by Calm Gravity formula', () => {
    const thoughts: ThoughtRecord[] = [
      {
        id: 't_old',
        authorId: 'u2',
        mood: 'synth',
        timeLabel: '20h',
        hoursAgo: 20,
        text: 'Old thought with high likes',
        photo: null,
        likes: 100,
        likedByMe: false,
        replies: 10,
      },
      {
        id: 't_new_mutual',
        authorId: 'u1', // followed by 'me' -> mutual boost
        mood: 'film',
        timeLabel: '5m',
        hoursAgo: 0.08,
        text: 'Fresh thought from close friend',
        photo: '/beach.jpg',
        likes: 15,
        likedByMe: true,
        replies: 3,
      },
    ];

    const ranked = rankThoughts(thoughts, 'me', graph, 'foryou');
    // Fresh thought from followed friend decays much slower than 20-hour-old thought
    expect(ranked[0].id).toBe('t_new_mutual');

    const mediaOnly = rankThoughts(thoughts, 'me', graph, 'media');
    expect(mediaOnly.length).toBe(1);
    expect(mediaOnly[0].id).toBe('t_new_mutual');
  });
});
