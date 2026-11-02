import type { DirectoryUser, ThoughtRecord } from '../dsa/search-graph';

export const INITIAL_PEOPLE_DIRECTORY: Record<string, DirectoryUser> = {
  arjun: {
    id: 'arjun',
    name: 'Arjun Mehta',
    handle: '@arjun',
    bio: 'Building calm software & shooting 35mm film in Bengaluru.',
    note: '✨ building',
    avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=160&auto=format&fit=crop&q=80',
    followersCount: 148,
    online: true,
    vibes: ['building', 'design', 'coffee', 'late night'],
  },
  aanya: {
    id: 'aanya',
    name: 'Aanya Sharma',
    handle: '@aanya',
    bio: 'Product designer · Analog photography & coastal drives.',
    note: 'Fred again.. 🎧',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&auto=format&fit=crop&q=80',
    followersCount: 312,
    online: true,
    vibes: ['design', 'film', 'coffee', 'music'],
  },
  rohan: {
    id: 'rohan',
    name: 'Rohan Verma',
    handle: '@rohan',
    bio: 'Sound design, modular synths & late-night voice rooms.',
    note: 'In room 🎙️',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=160&auto=format&fit=crop&q=80',
    followersCount: 204,
    online: true,
    vibes: ['synth', 'music', 'late night'],
  },
  meera: {
    id: 'meera',
    name: 'Meera Nair',
    handle: '@meera',
    bio: 'Archival film scans, books & matcha.',
    note: 'iced matcha',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=160&auto=format&fit=crop&q=80',
    followersCount: 276,
    online: false,
    vibes: ['film', 'coffee', 'books'],
  },
  kabir: {
    id: 'kabir',
    name: 'Kabir Menon',
    handle: '@kabir',
    bio: 'Analog synths, Go backend systems & midnight espresso.',
    note: '🌙 late night',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=160&auto=format&fit=crop&q=80',
    followersCount: 189,
    online: true,
    vibes: ['synth', 'building', 'late night'],
  },
  tara: {
    id: 'tara',
    name: 'Tara Kapoor',
    handle: '@tara',
    bio: 'Visual editorial, ceramics & slow mornings in Indiranagar.',
    note: '☕ blr coffee',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=160&auto=format&fit=crop&q=80',
    followersCount: 410,
    online: true,
    vibes: ['design', 'coffee', 'film'],
  },
  dev: {
    id: 'dev',
    name: 'Devika Rao',
    handle: '@devika',
    bio: 'Typefaces, shaders & quiet creative tools.',
    note: '✨ building',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=160&auto=format&fit=crop&q=80',
    followersCount: 328,
    online: true,
    vibes: ['building', 'design', 'late night'],
  },
  zayn: {
    id: 'zayn',
    name: 'Zayn Merchant',
    handle: '@zayn',
    bio: 'Vinyl collector & ambient tape loops.',
    note: '🎧 listening',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=160&auto=format&fit=crop&q=80',
    followersCount: 164,
    online: false,
    vibes: ['synth', 'music', 'film'],
  },
};

export const INITIAL_SOCIAL_GRAPH: Record<string, Set<string>> = {
  arjun: new Set(['aanya', 'rohan', 'meera', 'kabir']),
  aanya: new Set(['arjun', 'rohan', 'meera', 'tara', 'dev', 'zayn']),
  rohan: new Set(['arjun', 'aanya', 'kabir', 'zayn']),
  meera: new Set(['arjun', 'aanya', 'tara', 'dev']),
  kabir: new Set(['arjun', 'rohan', 'dev', 'zayn', 'tara']),
  tara: new Set(['aanya', 'meera', 'dev']),
  dev: new Set(['aanya', 'kabir', 'tara']),
  zayn: new Set(['rohan', 'kabir', 'aanya']),
};

export const INITIAL_THOUGHTS: ThoughtRecord[] = [
  {
    id: 'th_1',
    authorId: 'aanya',
    mood: '🎞️ analog film',
    timeLabel: '6m',
    hoursAgo: 0.1,
    text: 'Developing the 35mm Portra roll from Pondicherry. Love having a quiet spot to share snapshots with close friends without reels algorithms.',
    photo: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&auto=format&fit=crop&q=80',
    likes: 18,
    likedByMe: true,
    replies: 4,
  },
  {
    id: 'th_2',
    authorId: 'kabir',
    mood: '🌙 late night',
    timeLabel: '22m',
    hoursAgo: 0.35,
    text: 'Recording a new Prophet-6 synth patch in the Late Night Lounge. Door is unlocked if anyone wants to listen in while working.',
    photo: null,
    likes: 12,
    likedByMe: false,
    replies: 3,
  },
  {
    id: 'th_3',
    authorId: 'tara',
    mood: '☕ blr coffee',
    timeLabel: '1h',
    hoursAgo: 1.1,
    text: 'Tested the new Ethiopian pour-over at Paper & Pie this morning. Quietest courtyard table for sketching.',
    photo: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&auto=format&fit=crop&q=80',
    likes: 27,
    likedByMe: false,
    replies: 6,
  },
  {
    id: 'th_4',
    authorId: 'dev',
    mood: '✨ building',
    timeLabel: '2h',
    hoursAgo: 2.0,
    text: 'Switched our search index to a Prefix Trie + trigram matcher. Instant typeahead feels so much more human than spinner screens.',
    photo: null,
    likes: 31,
    likedByMe: true,
    replies: 5,
  },
  {
    id: 'th_5',
    authorId: 'meera',
    mood: '🎞️ analog film',
    timeLabel: '3h',
    hoursAgo: 3.2,
    text: 'Scanning medium format negatives from Sunday’s walk through Cubbon Park.',
    photo: null,
    likes: 19,
    likedByMe: false,
    replies: 2,
  },
];

export interface ChatMessage {
  id: string;
  author: string;
  self: boolean;
  time: string;
  text: string;
  photo?: string | null;
  replyTo?: { author: string; text: string } | null;
  reactions: string[];
}

export interface ConversationThread {
  id: string;
  name: string;
  subtitle: string;
  online: boolean;
  unread: number;
  avatar: string;
  messages: ChatMessage[];
}

export const INITIAL_CHATS: Record<string, ConversationThread> = {
  aanya: {
    id: 'aanya',
    name: 'Aanya Sharma',
    subtitle: 'Active now',
    online: true,
    unread: 0,
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
    messages: [
      {
        id: 'm1',
        author: 'Aanya Sharma',
        self: false,
        time: '12:31 PM',
        text: 'Are we still meeting at Blue Tokai around 5?',
        reactions: [],
      },
      {
        id: 'm2',
        author: 'Aanya Sharma',
        self: false,
        time: '12:32 PM',
        photo: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=700&auto=format&fit=crop&q=80',
        text: 'Grabbed our usual corner table by the window ☕',
        reactions: ['❤️'],
      },
      {
        id: 'm3',
        author: 'You',
        self: true,
        time: '12:35 PM',
        text: 'On my way! Bringing my iPad so we can sketch out the trip itinerary.',
        reactions: [],
      },
    ],
  },
  goa: {
    id: 'goa',
    name: 'Weekend Goa Plan 🌴',
    subtitle: 'Aanya, Rohan, Kabir, Meera',
    online: true,
    unread: 2,
    avatar: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=120&auto=format&fit=crop&q=80',
    messages: [
      {
        id: 'g1',
        author: 'Kabir',
        self: false,
        time: '11:15 AM',
        text: 'Found a quiet villa in Assagao with a private pool.',
        reactions: ['🔥', '🙌'],
      },
      {
        id: 'g2',
        author: 'Meera',
        self: false,
        time: '11:20 AM',
        text: 'Let’s all hop into Arjun’s room tonight at 9 to lock the dates!',
        reactions: ['❤️'],
      },
    ],
  },
  rohan: {
    id: 'rohan',
    name: 'Rohan Verma',
    subtitle: 'In a room 🎧',
    online: true,
    unread: 0,
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
    messages: [
      {
        id: 'r1',
        author: 'Rohan Verma',
        self: false,
        time: 'Yesterday',
        text: 'Sent you the playlist from last night.',
        reactions: [],
      },
    ],
  },
  meera: {
    id: 'meera',
    name: 'Meera Nair',
    subtitle: 'Active 14m ago',
    online: false,
    unread: 1,
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120&auto=format&fit=crop&q=80',
    messages: [
      {
        id: 'me1',
        author: 'Meera Nair',
        self: false,
        time: '10:04 AM',
        text: 'Did you check out the film scans from Sunday?',
        reactions: [],
      },
    ],
  },
  kabir: {
    id: 'kabir',
    name: 'Kabir Menon',
    subtitle: 'Active now',
    online: true,
    unread: 0,
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80',
    messages: [
      {
        id: 'k1',
        author: 'Kabir Menon',
        self: false,
        time: 'Yesterday',
        text: 'Prophet-6 patch is sounding warm tonight.',
        reactions: [],
      },
    ],
  },
  tara: {
    id: 'tara',
    name: 'Tara Kapoor',
    subtitle: 'Active now',
    online: true,
    unread: 0,
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&auto=format&fit=crop&q=80',
    messages: [
      {
        id: 't1',
        author: 'Tara Kapoor',
        self: false,
        time: 'Yesterday',
        text: 'Let’s catch up over coffee in Indiranagar this week!',
        reactions: [],
      },
    ],
  },
};

export interface SpaceData {
  id: string;
  name: string;
  members: string;
  channels: Array<{ id: string; name: string; subtitle: string }>;
}

export const INITIAL_SPACES: Record<string, SpaceData> = {
  design: {
    id: 'design',
    name: 'Design Club',
    members: '28 friends · 6 active now',
    channels: [
      { id: 'sp-general', name: 'general', subtitle: 'Design Club · 28 friends' },
      { id: 'sp-inspo', name: 'inspo-drop', subtitle: 'Visual references & typography' },
      { id: 'sp-music', name: 'music-rotation', subtitle: 'What everyone is listening to' },
    ],
  },
  late: {
    id: 'late',
    name: 'Late Night Crew',
    members: '14 friends · 4 active now',
    channels: [
      { id: 'ln-general', name: 'chat', subtitle: 'Late Night Crew · 14 friends' },
      { id: 'ln-coop', name: 'fifa-and-val', subtitle: 'Match lobbies & clips' },
    ],
  },
};
