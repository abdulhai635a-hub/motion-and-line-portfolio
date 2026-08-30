export type ProjectCategory =
  | "character"
  | "explainer"
  | "motion"
  | "game"
  | "personal";

export const categoryLabels: Record<ProjectCategory, string> = {
  character: "Character Animation",
  explainer: "Explainer",
  motion: "Motion Graphics",
  game: "Game Animation",
  personal: "Personal Work",
};

export type Project = {
  slug: string;
  title: string;
  category: ProjectCategory;
  accent: "coral" | "teal" | "yellow";
  driveId: string;
  client?: string;
  year?: number;
  summary?: string;
  role?: string;
  tools?: string[];
  timeline?: string;
  brief?: string;
  process?: string[];
};

export const projects: Project[] = [
  // Signature stickman pieces
  {
    slug: "serious-history-scene-1",
    title: "Serious History — Scene 1",
    category: "personal",
    accent: "coral",
    driveId: "1G6UEwH2WazlSFgCHkij5IbCI30e0oSST",
    summary: "A stickman take on a serious historical moment.",
  },
  {
    slug: "ferry-intro",
    title: "Ferry — Intro",
    category: "personal",
    accent: "coral",
    driveId: "159nu9Gok_XFc91gZcM-1ydHe9aozAi0O",
    summary: "Opening title sequence for the Ferry stickman series.",
  },
  {
    slug: "napoleon",
    title: "Napoleon",
    category: "personal",
    accent: "coral",
    driveId: "1YXhQCLLBPhOqqa1WkLHYr3XcFyxH5VnZ",
    summary: "A frame-by-frame stickman short set during the Napoleonic era.",
  },
  {
    slug: "ww2-soldiers",
    title: "WW2 Soldiers",
    category: "personal",
    accent: "coral",
    driveId: "1WKtfPy7fAtuKykJzrxpd2KK7_2BzXcVK",
    summary: "A fast-paced stickman battle sequence set in WW2.",
  },
  {
    slug: "goska",
    title: "Goska",
    category: "personal",
    accent: "coral",
    driveId: "1FPJv6wuMzyq_O37bWyKR7G5tiMRZtbea",
    summary: "A full stickman fight short — the closest thing to the signature centerpiece.",
  },
  {
    slug: "roman-empire",
    title: "Roman Empire",
    category: "personal",
    accent: "coral",
    driveId: "1zBHU-QzaR1exa-7qwwJOogdoaIqmPQNm",
    summary: "A stickman short set in ancient Rome.",
  },
  {
    slug: "historical-figures",
    title: "Historical Figures",
    category: "personal",
    accent: "coral",
    driveId: "1TMxyfP4A2-ahx2-YtfEVXGciIto4dGOF",
    summary: "A stickman short built around a well-known historical figure.",
  },
  {
    slug: "arena",
    title: "Arena",
    category: "personal",
    accent: "coral",
    driveId: "1wNEmi9oGrtqX-qG1HOokjmIXA-qnOlCt",
    summary: "A gladiator-arena stickman fight sequence.",
  },
  {
    slug: "einstein",
    title: "Einstein",
    category: "personal",
    accent: "coral",
    driveId: "1BSP_q9Ne3qDmZmScuyvahqVvohAcAaos",
    summary: "A stickman short built around Einstein.",
  },
  {
    slug: "ww2",
    title: "WW2",
    category: "personal",
    accent: "coral",
    driveId: "1vXV86qGyNtP4q8qO3dhbAGcxtTR41Z6O",
    summary: "Another WW2-set stickman sequence.",
  },
  {
    slug: "date-or-detonate",
    title: "Date or Detonate",
    category: "personal",
    accent: "coral",
    driveId: "1f1HJXSZ4ErKjzAh8qbEcceANenD8EYDB",
    summary: "A stickman short.",
  },
  {
    slug: "why-it-sucks",
    title: "Why It Sucks When Women Use You",
    category: "personal",
    accent: "coral",
    driveId: "1c5dVOirqb7Lw9osJpb3vcyJWVaoFU83S",
    summary: "An animated storytime-style short.",
  },
  {
    slug: "goska-raw-cut",
    title: "Goska — Raw Cut",
    category: "personal",
    accent: "coral",
    driveId: "18dX5rvYwL3Cu8VHPvrx3rCSvJyhcTTPW",
    summary: "An earlier cut of the Goska stickman fight short.",
  },
  {
    slug: "serious-history-alt-cut",
    title: "Serious History — Alternate Cut",
    category: "personal",
    accent: "coral",
    driveId: "1_5Tz54HSGsYVfuJePagZHFBsj2clVQGI",
    summary: "Another stickman take on a serious historical moment.",
  },
  {
    slug: "ready",
    title: "Ready",
    category: "personal",
    accent: "coral",
    driveId: "1Q04QRrAlC6POiABTeFYLm1-FSFh1rXA9",
    summary: "A stickman short.",
  },
  {
    slug: "war",
    title: "War",
    category: "personal",
    accent: "coral",
    driveId: "1uK7O3s8r4n_s9j0nN-nHDJ5H4yhCtc69",
    summary: "A stickman battle sequence.",
  },
  {
    slug: "ww1-soldiers",
    title: "WW1 Soldiers",
    category: "personal",
    accent: "coral",
    driveId: "16cAvSU6PB1NfQV4dQlQ6-aEdXMlsgwse",
    summary: "A stickman short set during WW1.",
  },
  {
    slug: "ww2-cut-2",
    title: "WW2 — Cut 2",
    category: "personal",
    accent: "coral",
    driveId: "1OCSAy66ITGvIFIY9lo-8mUtRXocA7CSq",
    summary: "Another WW2-set stickman sequence.",
  },
  {
    slug: "historical-short",
    title: "Historical Short",
    category: "personal",
    accent: "coral",
    driveId: "1DQWNKMf9ifeT4Z12H3LjAaGWXe9iTdmD",
    summary: "A stickman short set in a historical period.",
  },
  {
    slug: "cleopatra-historical",
    title: "Cleopatra — Historical Cut",
    category: "personal",
    accent: "coral",
    driveId: "1HWNVj28mQr0dBOcVH-UpxoEFpjIZIisA",
    summary: "A stickman short set in ancient Egypt.",
  },
  {
    slug: "dantal",
    title: "Dantal",
    category: "personal",
    accent: "coral",
    driveId: "1SY5YeBSTtPTTXMbnK0obKGXzA62SU5-i",
    summary: "A stickman short.",
  },

  // Animal character set
  {
    slug: "axolotl",
    title: "Axolotl",
    category: "character",
    accent: "teal",
    driveId: "1rEQlq1N14CszKdKH_c1v_hjtP7xjWKue",
    summary: "Character animation study of an axolotl.",
  },
  {
    slug: "king-cobra",
    title: "King Cobra",
    category: "character",
    accent: "teal",
    driveId: "12VCocczqYXOCn9jUGVOvGHHVA57sFVjL",
    summary: "Character animation study of a king cobra.",
  },
  {
    slug: "pigeon",
    title: "Pigeon",
    category: "character",
    accent: "teal",
    driveId: "1j72imn8jw5qo0MKex8l5yVChbw5AilYW",
    summary: "Character animation study of a pigeon.",
  },
  {
    slug: "fox",
    title: "Fox",
    category: "character",
    accent: "teal",
    driveId: "1jjy2zaIWwkxLSWOpetyVz_J09QRjkWDC",
    summary: "Character animation study of a fox.",
  },
  {
    slug: "hippo",
    title: "Hippo",
    category: "character",
    accent: "teal",
    driveId: "1mYcmWkxBIVICkdDYJx9_ItvgMlJ9ktO5",
    summary: "Character animation study of a hippo.",
  },
  {
    slug: "anaconda",
    title: "Anaconda",
    category: "character",
    accent: "teal",
    driveId: "178OyE8nvS4FGfGuranDytAWQlBtYHbaL",
    summary: "Character animation study of an anaconda.",
  },
  {
    slug: "bat",
    title: "Bat",
    category: "character",
    accent: "teal",
    driveId: "17-YivHNaoIvZ1_czQwhrJ7gs9lmhav13",
    summary: "Character animation study of a bat.",
  },
  {
    slug: "nemo",
    title: "Nemo",
    category: "character",
    accent: "teal",
    driveId: "1Bt3hR69tughb0p-6UEwVAtVNiHVQrm_l",
    summary: "Character animation study of a clownfish.",
  },
  {
    slug: "police-officer",
    title: "Police Officer",
    category: "character",
    accent: "teal",
    driveId: "1-GZ_fsIZ0KCIY-FOWhpSZReTtD30HgUw",
    summary: "Character turnaround/study of a police officer.",
  },
  {
    slug: "character-study",
    title: "Character Study",
    category: "character",
    accent: "teal",
    driveId: "1nSjrBHQKqOOWieovu4fI-zNjMU0_SKwR",
    summary: "A character animation study.",
  },

  // Brand / client-style pieces
  {
    slug: "nike",
    title: "Nike",
    category: "motion",
    accent: "yellow",
    driveId: "1SlDulgLe5snOnr4Z22kxdc0yNB1WyplT",
    summary: "A stickman-style animated piece built around the Nike brand.",
  },
  {
    slug: "tesla",
    title: "Tesla",
    category: "motion",
    accent: "yellow",
    driveId: "125xROw9CS_o8Aro2jXWwrnP_fxYbH3kp",
    summary: "A stickman-style animated piece built around Tesla.",
  },
  {
    slug: "uber",
    title: "Uber",
    category: "motion",
    accent: "yellow",
    driveId: "1P5DC6tTamS9vaJK_CyxG6z7h6p2T9kD_",
    summary: "A stickman-style animated piece built around Uber.",
  },
  {
    slug: "sigmund-freud",
    title: "Sigmund Freud",
    category: "motion",
    accent: "yellow",
    driveId: "1aKGafxq-ys3RTGgdH4ys5Z_uTf6vRpTh",
    summary: "A stickman-style animated piece built around Sigmund Freud.",
  },
  {
    slug: "amazon",
    title: "Amazon",
    category: "motion",
    accent: "yellow",
    driveId: "16NrlJ8ik8t1x3PRdeoajbbPqcCRRiMTY",
    summary: "A stickman-style animated piece built around Amazon.",
  },
  {
    slug: "cleopatra",
    title: "Cleopatra",
    category: "motion",
    accent: "yellow",
    driveId: "1Mq0NCkIyg8PIHrpy7nGR3dAchzloTEAo",
    summary: "A stickman-style animated piece built around Cleopatra.",
  },
  {
    slug: "fragrance",
    title: "Fragrance",
    category: "motion",
    accent: "yellow",
    driveId: "1oIhHu5UfFail2r4sAKN-jgZFEh9STdJm",
    summary: "A stickman-style animated piece built around a fragrance brand.",
  },
  {
    slug: "maikel-junction",
    title: "Maikel Junction",
    category: "motion",
    accent: "yellow",
    driveId: "1DUgv-giy3DANPjVLUySHEAHR1ArbvMHT",
    summary: "A stickman-style animated piece.",
  },
  {
    slug: "ryanair",
    title: "Ryanair",
    category: "motion",
    accent: "yellow",
    driveId: "1FHAcHK20I6PqncaKFfWuOVSaOwRfCXCW",
    summary: "A stickman-style animated piece built around Ryanair.",
  },

  // Explainer
  {
    slug: "wealth-explainer",
    title: "The Wealth Explainer",
    category: "explainer",
    accent: "teal",
    driveId: "17kGol4c9bsLotmJlamkFHg1yk5joDbDy",
    summary: "An explainer-style animated video.",
  },

  // Game
  {
    slug: "game-piece",
    title: "Game Animation Piece",
    category: "game",
    accent: "yellow",
    driveId: "1qPI8P0pDGrtGLgd8MrDtFduXRGHluMxA",
    summary: "A game-style animation piece.",
  },
];

export type SkillGroup = {
  label: string;
  skills: string[];
};

export const skillGroups: SkillGroup[] = [
  { label: "Animation", skills: ["After Effects", "Character Animation", "Frame-by-Frame", "Motion Graphics"] },
  { label: "Rigging", skills: ["Spine 2D", "Rive", "Puppet Pin / Mesh Rigs"] },
  { label: "Design", skills: ["Illustrator", "Photoshop", "Procreate", "Figma"] },
  { label: "Web", skills: ["Lottie / Bodymovin", "Basic React", "GSAP"] },
];

export type TimelineEntry = {
  year: string;
  title: string;
  place: string;
  description: string;
};

export const timeline: TimelineEntry[] = [
  {
    year: "2026",
    title: "Freelance 2D Animator",
    place: "Independent",
    description: "Add your current work situation here.",
  },
];

export const testimonials: { quote: string; name: string; role: string }[] = [];

export const availability: {
  status: "open" | "booked";
  note: string;
} = {
  status: "open",
  note: "Open for freelance",
};
